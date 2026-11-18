import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { invokeApp } from './helpers/invokeApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(SERVER_DIR, '..');

const { default: app } = await import('../index.js');
const { default: config } = await import('../config.js');
const { default: userStore, ROLES } = await import('../store/userStore.js');
const { default: userPolicyStore } = await import('../store/userPolicyStore.js');
const { default: userGroupStore } = await import('../store/userGroupStore.js');
const { default: serverStore } = await import('../store/serverStore.js');
const { default: systemSettingsStore } = await import('../store/systemSettingsStore.js');
const { default: jobStore } = await import('../store/jobStore.js');
const { resolveClientIpDetails, resolveClientIp, canTrustCloudflareHeaders } = await import('../lib/requestIp.js');
const { checkBoundedRateLimit } = await import('../routes/auth.js');
const { resendVerificationCode, verifyEmailCode, resetPasswordWithCode } = await import('../services/emailAuthService.js');
const { createDirectUserSession } = await import('../services/authSessionService.js');
const { setPublicSubCacheEntry, getPublicSubCacheEntry, invalidatePublicSubCache } = await import('../routes/subscriptions.js');
const { evaluateProxyAccess } = await import('../lib/proxyAccessPolicy.js');
const { resolveGuestPassSubscriptionBase } = await import('../routes/users.js');
const {
    canAccessSubscriptionEmail,
    canReadSubscriptionEmail,
    canManageSubscriptionEmail,
    isReadOnlySubscriptionRole,
} = await import('../lib/subscriptionAccess.js');
const { isReservedSubscriptionAliasPath, validateSubscriptionAliasPath } = await import('../lib/subscriptionAlias.js');
const { pingServer } = await import('../lib/probe.js');
const { collectSubscriptionExpirySnapshot } = await import('../lib/subscriptionExpiryNotifier.js');
const { sweepClusterConcurrency } = await import('../services/concurrencySentinel.js');
const { syncAddedInboundsToExistingUsers, updateManagedUserPolicyByEmail, deleteManagedUser } = await import('../services/userAdminService.js');
const { resolveRegisteredUserNoticeRecipients } = await import('../services/registeredUserNoticeService.js');
const { buildGlobalDashboardSnapshot, buildSingleDashboardSnapshot } = await import('../lib/dashboardSnapshotService.js');
const { buildAppBootstrapPayload } = await import('../lib/appBootstrapService.js');
const { summarizeRegisteredTrafficTotals } = await import('../store/trafficStatsStore.js');
const { issueWsTicket, verifyWsTicket } = await import('../lib/wsTicket.js');
const { initWebSocket, closeWebSocketServer } = await import('../wsServer.js');
const { initSqliteDb, closeSqliteDb, sqliteWriteSnapshot } = await import('../db/sqliteClient.js');
const { bootstrapRuntime } = await import('../index.ts');

function makeAuthHeader(user) {
    const token = jwt.sign(
        {
            userId: user.id,
            username: user.username,
            role: user.role,
            tokenVersion: Number(user.tokenVersion || 1),
        },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
    return `Bearer ${token}`;
}

test('W2-1 requestIp: gates CF headers, trusts CF edge IP ranges, and parses XFF right-to-left', () => {
    const prevEnv = process.env.TRUST_CLOUDFLARE_HEADERS;
    const prevCfg = config.security.trustCloudflareHeaders;
    delete process.env.TRUST_CLOUDFLARE_HEADERS;
    config.security.trustCloudflareHeaders = false;

    try {
        // Private proxy with spoofed CF headers must NOT trust cf-connecting-ip unless opted in
        const privateReq = {
            ip: '172.18.0.5',
            headers: {
                'cf-connecting-ip': '1.2.3.4',
                'true-client-ip': '5.6.7.8',
                'cf-ipcountry': 'ZZ',
                'x-forwarded-for': '8.8.8.8, 198.51.100.77, 10.0.0.2',
            },
            socket: { remoteAddress: '172.18.0.5' },
        };
        assert.equal(canTrustCloudflareHeaders(privateReq), false);
        const privateDetails = resolveClientIpDetails(privateReq);
        assert.equal(privateDetails.clientIp, '198.51.100.77');
        assert.equal(privateDetails.ipSource, 'x-forwarded-for');
        assert.equal(privateDetails.cfCountry, '');

        // IPv6 Cloudflare edge range (2400:cb00::/32) is trusted automatically
        const cfEdgeReq = {
            ip: '2400:cb00::1',
            ips: ['2400:cb00::1'],
            headers: {
                'cf-connecting-ip': '203.0.113.88',
                'cf-ipcountry': 'JP',
            },
            socket: { remoteAddress: '2400:cb00::1' },
        };
        assert.equal(canTrustCloudflareHeaders(cfEdgeReq), true);
        assert.equal(resolveClientIpDetails(cfEdgeReq).clientIp, '203.0.113.88');

        // Opt-in via config.security.trustCloudflareHeaders allows trusting CF behind private proxy
        config.security.trustCloudflareHeaders = true;
        assert.equal(canTrustCloudflareHeaders(privateReq), true);
        assert.equal(resolveClientIpDetails(privateReq).clientIp, '1.2.3.4');

        // Express trust proxy parsed req.ip differing from private socket takes precedence over leftmost spoofed XFF
        config.security.trustCloudflareHeaders = false;
        const expressResolved = resolveClientIp({
            ip: '198.51.100.55',
            headers: { 'x-forwarded-for': '9.9.9.9, 198.51.100.55' },
            socket: { remoteAddress: '127.0.0.1' },
        });
        assert.equal(expressResolved, '198.51.100.55');
    } finally {
        config.security.trustCloudflareHeaders = prevCfg;
        if (prevEnv === undefined) {
            delete process.env.TRUST_CLOUDFLARE_HEADERS;
        } else {
            process.env.TRUST_CLOUDFLARE_HEADERS = prevEnv;
        }
    }
});

test('W2-2 checkBoundedRateLimit: prunes expired first, evicts oldest when full, never fails open', () => {
    const map = new Map();
    const now = 1_000_000;
    const windowMs = 60_000;
    const maxAttempts = 2;
    const mapLimit = 3;

    // 2 expired entries + 1 live entry fill the map to capacity
    map.set('old-1', { count: 2, firstAttempt: now - 120_000 });
    map.set('old-2', { count: 2, firstAttempt: now - 90_000 });
    map.set('live-1', { count: 1, firstAttempt: now - 1_000 });

    assert.equal(checkBoundedRateLimit(map, windowMs, maxAttempts, mapLimit, 'new-a', now), true);
    assert.equal(map.has('old-1'), false);
    assert.equal(map.has('old-2'), false);
    assert.equal(map.has('live-1'), true);
    assert.equal(map.has('new-a'), true);

    // Fill remaining slot and add one more live IP -> oldest is evicted instead of failing open untracked
    assert.equal(checkBoundedRateLimit(map, windowMs, maxAttempts, mapLimit, 'new-b', now + 1), true);
    assert.equal(checkBoundedRateLimit(map, windowMs, maxAttempts, mapLimit, 'new-c', now + 2), true);
    assert.equal(map.size, mapLimit);
    assert.equal(map.has('live-1'), false);
    // Subsequent attempts from tracked new-c MUST enforce maxAttempts
    assert.equal(checkBoundedRateLimit(map, windowMs, maxAttempts, mapLimit, 'new-c', now + 3), true);
    assert.equal(checkBoundedRateLimit(map, windowMs, maxAttempts, mapLimit, 'new-c', now + 4), false);
    // Zero capacity map fails closed
    assert.equal(checkBoundedRateLimit(new Map(), windowMs, maxAttempts, 0, 'blocked', now), false);
});

test('W2-2 emailAuthService & authSessionService: OTP validation, anti-enumeration /resend-code, direct session guards', async () => {
    const stamp = Date.now();
    const users = [
        {
            id: 'u-unverified',
            username: `unv_${stamp}`,
            email: `unv_${stamp}@example.com`,
            emailVerified: false,
            verifyCode: '654321',
            verifyCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            resetCode: '112233',
            resetCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        {
            id: 'u-verified',
            username: `ver_${stamp}`,
            email: `ver_${stamp}@example.com`,
            emailVerified: true,
        },
    ];
    const repo = {
        getByEmail: (email) => users.find((u) => u.email === email) || null,
        setEmailVerified: () => {},
        update: () => {},
        clearPasswordResetCode: () => {},
    };

    // Wrong-length OTP rejected via timingSafeStringEqual
    assert.throws(
        () => verifyEmailCode({ email: users[0].email, code: '65' }, { userRepository: repo }),
        (err) => err?.status === 400
    );
    assert.throws(
        () => resetPasswordWithCode(
            { email: users[0].email, code: '112', newPassword: 'ValidPassword#123' },
            { userRepository: repo }
        ),
        (err) => err?.status === 400
    );

    // resendVerificationCode returns identical 400 status/message for unknown vs already-verified email
    let errMissing = null;
    let errVerified = null;
    try {
        await resendVerificationCode({ email: 'nobody-enum@example.com' }, { userRepository: repo, locale: 'en-US' });
    } catch (err) {
        errMissing = err;
    }
    try {
        await resendVerificationCode({ email: users[1].email }, { userRepository: repo, locale: 'en-US' });
    } catch (err) {
        errVerified = err;
    }
    assert.equal(errMissing?.status, 400);
    assert.equal(errVerified?.status, 400);
    assert.equal(errMissing?.message, errVerified?.message);

    // HTTP POST /api/auth/resend-code anti-enumeration response
    const verifiedUser = userStore.add({
        username: `ver_http_${stamp}`,
        email: `ver_http_${stamp}@example.com`,
        password: 'StrongUser#1234',
        role: ROLES.user,
        enabled: true,
        emailVerified: true,
    });
    try {
        const resMissing = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/resend-code',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US' },
            body: { email: `nonexistent_${stamp}@example.com` },
        });
        const resVerified = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/resend-code',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US' },
            body: { email: verifiedUser.email },
        });
        assert.equal(resMissing.statusCode, 400);
        assert.equal(resVerified.statusCode, 400);
        assert.equal(resMissing.json?.success, false);
        assert.equal(resVerified.json?.success, false);
        assert.equal(resMissing.json?.msg, resVerified.json?.msg);
    } finally {
        userStore.remove(verifiedUser.id);
    }

    // createDirectUserSession enforces enabled !== false && !isGuest
    assert.throws(
        () => createDirectUserSession({ id: 'u-dis', username: 'dis', role: 'user', enabled: false, isGuest: false }),
        (err) => err?.status === 403
    );
    assert.throws(
        () => createDirectUserSession({ id: 'u-gst', username: 'gst', role: 'user', enabled: true, isGuest: true }),
        (err) => err?.status === 403
    );
    assert.throws(
        () => createDirectUserSession({ id: 'u-gr', username: 'gr', role: 'guest', enabled: true }),
        (err) => err?.status === 403
    );
    const okSession = createDirectUserSession({ id: 'u-ok', username: 'okuser', role: 'operator', enabled: true, tokenVersion: 2 });
    assert.equal(okSession.success, true);
    assert.ok(okSession.token);
});

test('W2-2 routes/auth & routes/userGroups: user and group mutations invalidate public subscription cache', async () => {
    const stamp = Date.now();
    const admin = userStore.add({
        username: `adm_cache_${stamp}`,
        email: `adm_cache_${stamp}@example.com`,
        password: 'StrongAdmin#1234',
        role: ROLES.admin,
        enabled: true,
        emailVerified: true,
    });
    const customer = userStore.add({
        username: `cust_cache_${stamp}`,
        email: `cust_cache_${stamp}@example.com`,
        subscriptionEmail: `cust_cache_${stamp}@example.com`,
        password: 'StrongUser#1234',
        role: ROLES.user,
        enabled: true,
        emailVerified: true,
    });
    const authHeader = makeAuthHeader(admin);
    const cacheKey = `audit-cache-${stamp}`;
    const seedCache = () => {
        setPublicSubCacheEntry(cacheKey, { body: 'cached', contentType: 'text/plain', userInfo: '' }, customer.subscriptionEmail);
        assert.ok(getPublicSubCacheEntry(cacheKey));
    };

    try {
        seedCache();
        await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${customer.id}`,
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { username: customer.username },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${customer.id}/subscription-binding`,
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { subscriptionEmail: customer.subscriptionEmail },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${customer.id}/set-enabled`,
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { enabled: false },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/users/bulk-set-enabled',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { userIds: [customer.id], enabled: true },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${customer.id}/update-expiry`,
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { expiryTime: 0 },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'POST',
            url: `/api/auth/users/${customer.id}/provision-subscription`,
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { subscriptionEmail: customer.subscriptionEmail },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        // User group routes
        seedCache();
        const grpCreate = await invokeApp(app, {
            method: 'POST',
            url: '/api/user-groups',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { name: `GrpCache_${stamp}` },
        });
        const groupId = grpCreate.json?.obj?.group?.id;
        assert.ok(groupId);
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'PUT',
            url: `/api/user-groups/${groupId}`,
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: { name: `GrpCacheUpd_${stamp}` },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'POST',
            url: `/api/user-groups/${groupId}/sync`,
            headers: { Authorization: authHeader },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'DELETE',
            url: `/api/user-groups/${groupId}`,
            headers: { Authorization: authHeader },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);

        seedCache();
        await invokeApp(app, {
            method: 'DELETE',
            url: `/api/auth/users/${customer.id}`,
            headers: { Authorization: authHeader },
        });
        assert.equal(getPublicSubCacheEntry(cacheKey), null);
    } finally {
        invalidatePublicSubCache();
        if (userStore.getById(customer.id)) userStore.remove(customer.id);
        userStore.remove(admin.id);
        userPolicyStore.remove(customer.subscriptionEmail);
    }
});

test('W2-3 deep RBAC: proxy /sui/save allowlist, canonicalPath, operator staff blocks, subscriptionAccess, customer role separation', async () => {
    // 1. /sui/save allowlist for operator
    for (const allowedObj of ['inbounds', 'outbounds', 'endpoints', 'services', 'tls', 'clients', 'config']) {
        assert.equal(evaluateProxyAccess('operator', 'POST', '/sui/save', { object: allowedObj }).allowed, true);
    }
    for (const blockedBody of [{ object: 'users' }, { object: 'settings' }, undefined, null, 'raw-text', ['clients'], {}]) {
        assert.equal(evaluateProxyAccess('operator', 'POST', '/sui/save', blockedBody).allowed, false);
    }
    assert.equal(evaluateProxyAccess('admin', 'POST', '/sui/save', { object: 'users' }).allowed, true);

    // 2. subscriptionAccess read/write separation
    assert.equal(canAccessSubscriptionEmail({ role: 'admin' }, 'c@example.com'), true);
    assert.equal(canAccessSubscriptionEmail({ role: 'operator' }, 'c@example.com'), true);
    assert.equal(canAccessSubscriptionEmail({ role: 'auditor' }, 'c@example.com'), true);
    assert.equal(canReadSubscriptionEmail({ role: 'auditor' }, 'c@example.com'), true);
    assert.equal(canManageSubscriptionEmail({ role: 'auditor' }, 'c@example.com'), false);
    assert.equal(canAccessSubscriptionEmail({ role: 'auditor', email: 'aud@example.com' }, 'aud@example.com', { mode: 'write' }), false);
    assert.equal(isReadOnlySubscriptionRole('auditor'), true);
    assert.equal(isReadOnlySubscriptionRole('operator'), false);
    assert.equal(
        canManageSubscriptionEmail({ role: 'operator' }, 'admin@example.com', {
            findUserByEmail: () => ({ role: 'admin', email: 'admin@example.com' }),
        }),
        false
    );

    const stamp = Date.now();
    const admin = userStore.add({
        username: `adm_rbac_${stamp}`,
        email: `adm_rbac_${stamp}@example.com`,
        password: 'StrongAdmin#1234',
        role: ROLES.admin,
        enabled: true,
        emailVerified: true,
    });
    const operator = userStore.add({
        username: `op_rbac_${stamp}`,
        email: `op_rbac_${stamp}@example.com`,
        password: 'StrongOp#1234',
        role: ROLES.operator,
        enabled: true,
        emailVerified: true,
    });
    const auditor = userStore.add({
        username: `aud_rbac_${stamp}`,
        email: `aud_rbac_${stamp}@example.com`,
        subscriptionEmail: `aud_sub_${stamp}@example.com`,
        password: 'StrongAud#1234',
        role: ROLES.auditor,
        enabled: true,
        emailVerified: true,
    });
    const customer = userStore.add({
        username: `cust_rbac_${stamp}`,
        email: `cust_rbac_${stamp}@example.com`,
        subscriptionEmail: `cust_rbac_${stamp}@example.com`,
        password: 'StrongUser#1234',
        role: ROLES.user,
        enabled: true,
        emailVerified: true,
    });

    try {
        const opHeader = makeAuthHeader(operator);

        // 3. Proxy encoded traversal / percent-encoded /sui check uses canonicalPath
        const encodedSuiUsers = await invokeApp(app, {
            method: 'POST',
            url: '/api/panel/srv-1/%73ui/save',
            headers: { Authorization: opHeader, 'Content-Type': 'application/json' },
            body: { object: 'users' },
        });
        assert.equal(encodedSuiUsers.statusCode, 403);

        // 4. Operator blocked 403 on staff subscription tokens & staff policies
        for (const staff of [admin, operator, auditor]) {
            const postTok = await invokeApp(app, {
                method: 'POST',
                url: `/api/users/${staff.id}/tokens`,
                headers: { Authorization: opHeader, 'Content-Type': 'application/json' },
                body: { name: 'illegal' },
            });
            assert.equal(postTok.statusCode, 403);

            const delTok = await invokeApp(app, {
                method: 'DELETE',
                url: `/api/users/${staff.id}/tokens/fake-tok`,
                headers: { Authorization: opHeader },
            });
            assert.equal(delTok.statusCode, 403);
        }

        const custTok = await invokeApp(app, {
            method: 'POST',
            url: `/api/users/${customer.id}/tokens`,
            headers: { Authorization: opHeader, 'Content-Type': 'application/json' },
            body: { name: 'allowed-cust' },
        });
        assert.equal(custTok.statusCode, 200);

        const putStaffPolicy = await invokeApp(app, {
            method: 'PUT',
            url: `/api/user-policy/${encodeURIComponent(auditor.subscriptionEmail)}`,
            headers: { Authorization: opHeader, 'Content-Type': 'application/json' },
            body: { serverScopeMode: 'all' },
        });
        assert.equal(putStaffPolicy.statusCode, 403);

        await assert.rejects(
            () => updateManagedUserPolicyByEmail(
                auditor.subscriptionEmail,
                { serverScopeMode: 'all' },
                operator.username,
                { actorRole: 'operator' }
            ),
            (err) => err?.status === 403
        );

        // 5. Staff vs customer separation across services & stores
        const mixedUsers = [
            { id: 'u-adm', username: 'adm', role: 'admin', email: 'adm@example.com', enabled: true, emailVerified: true },
            { id: 'u-op', username: 'op', role: 'operator', email: 'op@example.com', enabled: true, emailVerified: true },
            { id: 'u-aud', username: 'aud', role: 'auditor', email: 'aud@example.com', enabled: true, emailVerified: true },
            { id: 'u-cust', username: 'cust', role: 'user', email: 'cust@example.com', enabled: true, emailVerified: true },
            { id: 'u-legacy', username: 'leg', role: '', email: 'leg@example.com', enabled: true, emailVerified: true },
        ];

        const syncRes = await syncAddedInboundsToExistingUsers(
            [{ serverId: 's1', inboundId: '1', protocol: 'vless', port: 443 }],
            'admin',
            {
                userRepository: { list: () => mixedUsers },
                serverRepository: { list: () => [] },
                userPolicyRepository: { get: () => ({ serverScopeMode: 'all', protocolScopeMode: 'all' }) },
            }
        );
        assert.equal(syncRes.totalUsers, 2);

        const notices = resolveRegisteredUserNoticeRecipients(mixedUsers);
        assert.deepEqual(notices.recipients.map((r) => r.email).sort(), ['cust@example.com', 'leg@example.com']);

        const trafficSummary = summarizeRegisteredTrafficTotals(mixedUsers, []);
        assert.equal(trafficSummary.totalUsers, 2);

        const bootstrapPayload = await buildAppBootstrapPayload({ role: 'admin', username: admin.username, userId: admin.id });
        const managedUsernames = bootstrapPayload.managedUsers.map((u) => u.username);
        assert.equal(managedUsernames.includes(operator.username), false);
        assert.equal(managedUsernames.includes(auditor.username), false);
        assert.equal(managedUsernames.includes(customer.username), true);

        const globalSnap = await buildGlobalDashboardSnapshot({}, {
            userStore: { getAll: () => mixedUsers },
            serverStore: { getAll: () => [] },
            collectClusterStatusSnapshot: async () => ({ items: [], byServerId: {}, summary: {} }),
            getAllServerPanelSnapshots: async () => [],
            trafficStatsStore: {
                counters: {},
                getOverviewBatch: () => ({
                    day: { ready: true, upBytes: 0, downBytes: 0, totalBytes: 0 },
                    week: { ready: true, upBytes: 0, downBytes: 0, totalBytes: 0 },
                    month: { ready: true, upBytes: 0, downBytes: 0, totalBytes: 0 },
                }),
            },
        });
        assert.equal(globalSnap.globalAccountSummary.totalUsers, 2);

        const singleSnap = await buildSingleDashboardSnapshot('s-test', {}, {
            serverStore: { getById: () => ({ id: 's-test', name: 'TestNode' }) },
            userStore: { getAll: () => mixedUsers },
            collectClusterStatusSnapshot: async () => ({ items: [{ serverId: 's-test', online: true }], summary: {} }),
            getServerPanelSnapshot: async () => ({
                server: { id: 's-test' },
                inbounds: [{
                    id: 1,
                    protocol: 'vless',
                    enable: true,
                    settings: JSON.stringify({
                        clients: [
                            { email: 'op@example.com', id: 'op-uuid' },
                            { email: 'cust@example.com', id: 'cust-uuid' },
                        ],
                    }),
                }],
                onlines: ['op@example.com', 'cust@example.com'],
            }),
            trafficStatsStore: { counters: { 's-test:1:op@example.com': { serverId: 's-test', inboundId: '1', email: 'op@example.com', lastSeenAt: new Date().toISOString() } } },
            systemSettingsStore: { sortInboundList: (_id, list) => list },
        });
        assert.equal(singleSnap.onlineCount, 1);
        assert.deepEqual(singleSnap.onlineUsers.map((u) => u.email), ['cust@example.com']);
    } finally {
        userPolicyStore.remove(customer.subscriptionEmail);
        userStore.remove(customer.id);
        userStore.remove(auditor.id);
        userStore.remove(operator.id);
        userStore.remove(admin.id);
    }
});

test('W2-3 deleteManagedUser records complete jobStore.appendBatch retry schema and persists in jobStore', async () => {
    const origJobs = jobStore.exportState();
    const origSave = jobStore._save;
    jobStore._save = () => {};

    try {
        const res = await deleteManagedUser('u-del-comp', {
            actor: 'admin-tester',
            userRepository: {
                getById: () => ({
                    id: 'u-del-comp',
                    username: 'delcomp',
                    role: 'user',
                    email: 'delcomp@example.com',
                    subscriptionEmail: 'delcomp@example.com',
                }),
                remove: () => true,
            },
            userPolicyRepository: { remove: () => true },
            subscriptionTokenRepository: { revokeAllByEmail: () => 0 },
            serverRepository: { list: () => [{ id: 'srv-down-1', name: 'DownNode' }] },
            autoRemoveClients: async () => ({
                total: 1,
                removed: 0,
                failed: 1,
                details: [{ serverId: 'srv-down-1', serverName: 'DownNode', status: 'failed', reason: 'panel-unreachable' }],
            }),
        });
        assert.ok(res.compensatingJobId);
        const storedJob = jobStore.getById(res.compensatingJobId);
        assert.ok(storedJob);
        assert.equal(storedJob.type, 'user_sync');
        assert.equal(storedJob.action, 'delete_user_cleanup');
        assert.equal(storedJob.summary.failed, 1);
        assert.equal(storedJob.results.length, 1);
        assert.deepEqual(storedJob.request, {
            operation: 'delete_user_cleanup',
            emails: ['delcomp@example.com'],
            serverIds: ['srv-down-1'],
        });
    } finally {
        jobStore.importState(origJobs);
        jobStore._save = origSave;
    }
});

test('W2-4 SSRF & Host/Alias validation: pingServer DNS check, Host validation, reserved alias paths', async () => {
    // 1. pingServer DNS rebinding / SSRF protection
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const prevAllow = config.servers.allowPrivateServerUrl;
    config.servers.allowPrivateServerUrl = false;
    try {
        // Direct loopback IPv4 blocked when allowPrivateServerUrl=false
        assert.equal((await pingServer(`http://127.0.0.1:${port}`)).online, false);
        // Hostname resolving to private/loopback IP blocked via DNS check
        const dnsRebind = await pingServer(`https://rebind-panel.example.com:${port}`, {
            lookup: async () => [{ address: '127.0.0.1', family: 4 }],
        });
        assert.equal(dnsRebind.online, false);
        // Internal hostname blocked
        assert.equal((await pingServer(`http://panel.local:${port}`)).online, false);
    } finally {
        config.servers.allowPrivateServerUrl = prevAllow;
        await new Promise((resolve) => server.close(resolve));
    }

    // 2. Host header validation on guest-pass subscription base URL
    assert.equal(
        resolveGuestPassSubscriptionBase({ protocol: 'https', get: () => 'evil.com/path', headers: {} }),
        ''
    );
    assert.equal(
        resolveGuestPassSubscriptionBase({ protocol: 'https', get: () => 'user@evil.com', headers: {} }),
        ''
    );
    assert.equal(
        resolveGuestPassSubscriptionBase({ protocol: 'https', get: () => 'evil.com\r\nX-Test: 1', headers: {} }),
        ''
    );
    assert.equal(
        resolveGuestPassSubscriptionBase({
            protocol: 'https',
            get: () => 'panel.example.com:8443',
            headers: { host: 'panel.example.com:8443' },
            socket: { remoteAddress: '203.0.113.1' },
        }),
        'https://panel.example.com:8443'
    );

    // 3. Reserved static & dynamic alias paths
    for (const p of ['/ws', '/theme-init.js', '/sw.js', '/stories/item-1', '/posts', '/guides/x', '/archive', '/about', '/section/a', '/media/x.png', '/feed.xml', '/sitemap.xml']) {
        assert.equal(isReservedSubscriptionAliasPath(p), true, `expected ${p} reserved`);
        assert.equal(validateSubscriptionAliasPath(p).ok, false, `expected ${p} invalid`);
    }
    const prevSite = systemSettingsStore.getSite();
    try {
        systemSettingsStore.update({ site: { accessPath: '/secret-portal' } });
        assert.equal(isReservedSubscriptionAliasPath('/secret-portal'), true);
        assert.equal(isReservedSubscriptionAliasPath('/secret-portal/sub'), true);
    } finally {
        systemSettingsStore.update({ site: { accessPath: prevSite?.accessPath || '/' } });
    }
});

test('W2-5 Group policy inheritance applies in subscriptionExpiryNotifier and concurrencySentinel', async () => {
    const now = new Date('2026-06-01T00:00:00.000Z').getTime();
    const soonExpiry = now + 2 * 24 * 60 * 60 * 1000;
    const groupRepo = {
        getById(id) {
            if (id === 'grp-vip') {
                return {
                    id: 'grp-vip',
                    name: 'VIP Group',
                    enabled: true,
                    expiryTime: soonExpiry,
                    limitIp: 2,
                    trafficLimitBytes: 1024 * 1024 * 1024,
                };
            }
            return null;
        },
        getAll() {
            return [this.getById('grp-vip')];
        },
    };
    const userRepo = {
        getAll: () => [
            {
                id: 'u-inherit',
                username: 'inherit_user',
                email: 'inherit@example.com',
                subscriptionEmail: 'inherit@example.com',
                role: 'user',
                enabled: true,
                groupId: 'grp-vip',
            },
            {
                id: 'u-override',
                username: 'override_user',
                email: 'override@example.com',
                subscriptionEmail: 'override@example.com',
                role: 'user',
                enabled: true,
                groupId: 'grp-vip',
            },
        ],
    };
    const policyRepo = {
        get(email) {
            if (email === 'override@example.com') {
                return {
                    email,
                    inheritGroup: true,
                    overrideFields: ['expiryTime'],
                    expiryTime: now + 30 * 24 * 60 * 60 * 1000,
                    updatedAt: new Date(now).toISOString(),
                };
            }
            return { email };
        },
        getAll: () => [],
    };

    const expirySnap = collectSubscriptionExpirySnapshot({
        now,
        userStore: userRepo,
        policyStore: policyRepo,
        userGroupStore: groupRepo,
    });
    assert.deepEqual(expirySnap.items.map((i) => i.subscriptionEmail), ['inherit@example.com']);
    assert.equal(expirySnap.items[0].stage, '3d');

    const concurrencyReport = await sweepClusterConcurrency({
        force: true,
        userStore: userRepo,
        userPolicyStore: policyRepo,
        userGroupStore: groupRepo,
        serverStore: { getAll: () => [{ id: 's-1', name: 'Node1', enabled: true }] },
        ensureAuthenticated: async () => ({}),
        getClientIps: async (_client, email) => (
            email === 'inherit@example.com'
                ? { data: { obj: ['1.1.1.1', '2.2.2.2', '3.3.3.3'] } }
                : { data: { obj: ['4.4.4.4'] } }
        ),
    });
    assert.equal(concurrencyReport.totalMonitoredUsers, 2);
    assert.equal(concurrencyReport.totalViolations, 1);
    assert.equal(concurrencyReport.violations[0].email, 'inherit@example.com');
    assert.equal(concurrencyReport.violations[0].limitIp, 2);
});

test('W2-6 wsTicket & wsServer: single-use jti, tokenVersion & role check, maxPayload, 0-server broadcast, clean close', async () => {
    const stamp = Date.now();
    const staff = userStore.add({
        username: `ws_staff_${stamp}`,
        email: `ws_staff_${stamp}@example.com`,
        password: 'StrongStaff#1234',
        role: ROLES.operator,
        enabled: true,
        emailVerified: true,
    });
    const customer = userStore.add({
        username: `ws_user_${stamp}`,
        email: `ws_user_${stamp}@example.com`,
        password: 'StrongUser#1234',
        role: ROLES.user,
        enabled: true,
        emailVerified: true,
    });
    const origServers = serverStore.exportState();
    const origServersSave = serverStore._save;
    serverStore._save = () => {};
    serverStore.importState({ servers: [] });

    const httpServer = http.createServer();
    initWebSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = httpServer.address().port;

    try {
        // 1. Single-use ticket unit check
        const singleUse = issueWsTicket({
            userId: staff.id,
            username: staff.username,
            role: staff.role,
            tokenVersion: staff.tokenVersion,
        });
        const decoded = verifyWsTicket(singleUse.ticket);
        assert.ok(decoded.jti);
        assert.equal(decoded.tokenVersion, 1);
        assert.throws(() => verifyWsTicket(singleUse.ticket), /Ticket already used/);

        // Legacy ticket missing jti is rejected
        const missingJtiTicket = jwt.sign(
            { type: 'ws_ticket', userId: staff.id, username: staff.username, role: staff.role },
            config.jwt.secret,
            { algorithm: 'HS256', issuer: 'nms', audience: 'nms-websocket', expiresIn: 60 }
        );
        assert.throws(() => verifyWsTicket(missingJtiTicket), /Missing ticket jti/);

        // 2. Customer role ticket rejected on WebSocket upgrade
        const custTicket = issueWsTicket({ userId: customer.id, username: customer.username, role: customer.role, tokenVersion: 1 });
        await assert.rejects(
            () => new Promise((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(custTicket.ticket)}`);
                ws.on('open', () => { ws.close(); reject(new Error('should not connect')); });
                ws.on('unexpected-response', (_req, res) => reject(new Error(`status:${res.statusCode}`)));
                ws.on('error', reject);
            }),
            /status:40[13]/
        );

        // 3. Stale tokenVersion rejected on WebSocket upgrade
        const staleTicket = issueWsTicket({
            userId: staff.id,
            username: staff.username,
            role: staff.role,
            tokenVersion: Number(staff.tokenVersion || 1) + 99,
        });
        await assert.rejects(
            () => new Promise((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(staleTicket.ticket)}`);
                ws.on('open', () => { ws.close(); reject(new Error('should not connect')); });
                ws.on('unexpected-response', (_req, res) => reject(new Error(`status:${res.statusCode}`)));
                ws.on('error', reject);
            }),
            /status:401/
        );

        // 4. Valid staff receives 0-server cluster_status snapshot, replay fails, >64KB rejected
        const validTicket = issueWsTicket({
            userId: staff.id,
            username: staff.username,
            role: staff.role,
            tokenVersion: staff.tokenVersion,
        });
        const wsClient = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(validTicket.ticket)}`);
        const firstClusterMsg = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timeout waiting cluster_status')), 5000);
            wsClient.on('message', (raw) => {
                const parsed = JSON.parse(raw.toString());
                if (parsed.type === 'cluster_status') {
                    clearTimeout(timer);
                    resolve(parsed);
                }
            });
            wsClient.on('error', reject);
        });
        assert.equal(firstClusterMsg.data.serverCount, 0);
        assert.deepEqual(firstClusterMsg.data.servers, {});

        // Ticket replay over WS fails
        await assert.rejects(
            () => new Promise((resolve, reject) => {
                const replay = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(validTicket.ticket)}`);
                replay.on('open', () => { replay.close(); reject(new Error('replay should fail')); });
                replay.on('unexpected-response', (_req, res) => reject(new Error(`status:${res.statusCode}`)));
                replay.on('error', reject);
            }),
            /status:401/
        );

        // maxPayload (64KB) closes oversized frame
        await new Promise((resolve) => {
            wsClient.once('close', () => resolve(undefined));
            wsClient.send('x'.repeat(70 * 1024));
        });

        // 5. closeWebSocketServer terminates open clients quickly (<1s)
        const secondTicket = issueWsTicket({
            userId: staff.id,
            username: staff.username,
            role: staff.role,
            tokenVersion: staff.tokenVersion,
        });
        const secondClient = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(secondTicket.ticket)}`);
        await new Promise((resolve) => secondClient.once('open', resolve));

        const t0 = Date.now();
        await closeWebSocketServer();
        await new Promise((resolve) => httpServer.close(resolve));
        assert.ok(Date.now() - t0 < 2000);
    } finally {
        await closeWebSocketServer();
        if (httpServer.listening) {
            await new Promise((resolve) => httpServer.close(resolve));
        }
        serverStore.importState(origServers);
        serverStore._save = origServersSave;
        userStore.remove(customer.id);
        userStore.remove(staff.id);
    }
});

test('W2-6 server/index bootstrapRuntime hydrates SQLite snapshots without Postgres', async () => {
    const prevSqliteEnv = process.env.SQLITE_ENABLED;
    const sqliteFile = path.join(config.dataDir, `w2_boot_${Date.now()}.sqlite`);
    const origUsers = userStore.exportState();
    const origUsersSave = userStore._save;
    userStore._save = () => {};

    try {
        process.env.SQLITE_ENABLED = 'true';
        const ok = initSqliteDb(sqliteFile);
        assert.equal(ok, true);
        const rawUsers = Array.isArray(origUsers?.users) ? origUsers.users : [];
        const seededUser = {
            ...rawUsers[0],
            username: `sqlite_hydrated_${Date.now()}`,
        };
        sqliteWriteSnapshot('users', { users: [seededUser, ...rawUsers.slice(1)] });

        await bootstrapRuntime();
        assert.ok(userStore.getAll().some((u) => u.username === seededUser.username));
    } finally {
        closeSqliteDb();
        try { fs.rmSync(sqliteFile, { force: true }); } catch {}
        userStore.importState(origUsers);
        userStore._save = origUsersSave;
        if (prevSqliteEnv === undefined) {
            delete process.env.SQLITE_ENABLED;
        } else {
            process.env.SQLITE_ENABLED = prevSqliteEnv;
        }
    }
});

test('W2-6 server/index setupGracefulShutdown closes HTTP+WS+SQLite and exits cleanly in <2s on SIGTERM', async () => {
    const childScript = `
        import { WebSocket } from 'ws';
        const { startServer } = await import('./server/index.ts');
        const { default: userStore } = await import('./server/store/userStore.js');
        const { issueWsTicket } = await import('./server/lib/wsTicket.js');
        const { httpServer } = await startServer({ port: 0, host: '127.0.0.1', enableWebSocket: true });
        const port = httpServer.address().port;
        const admin = userStore.getAll().find((u) => u.role === 'admin') || userStore.getAll()[0];
        const issued = issueWsTicket({ userId: admin.id, username: admin.username, role: admin.role, tokenVersion: admin.tokenVersion || 1 });
        const ws = new WebSocket(\`ws://127.0.0.1:\${port}/ws?ticket=\${encodeURIComponent(issued.ticket)}\`);
        ws.on('open', () => {
            process.stdout.write('READY\\n');
            process.emit('SIGTERM');
        });
    `;

    let shutdownStartedAt = 0;
    const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['--import', 'tsx', '--import', './server/tests/setup/isolateDataDir.js', '--input-type=module', '-e', childScript],
            {
                cwd: WORKSPACE_ROOT,
                env: {
                    ...process.env,
                    SERVE_CLIENT: 'false',
                    SQLITE_ENABLED: 'true',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );
        let sawReady = false;
        let stderr = '';
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch {}
            reject(new Error(`Graceful shutdown timed out; stderr=${stderr}`));
        }, 15000);
        child.stdout.on('data', (chunk) => {
            if (!sawReady && String(chunk).includes('READY')) {
                sawReady = true;
                shutdownStartedAt = Date.now();
            }
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('exit', (code) => {
            clearTimeout(timer);
            assert.equal(sawReady, true, `Child never became READY; stderr=${stderr}`);
            resolve(code);
        });
    });
    const shutdownElapsedMs = Date.now() - shutdownStartedAt;
    assert.equal(exitCode, 0);
    assert.ok(shutdownElapsedMs < 2500, `Expected graceful shutdown before forced timeout, took ${shutdownElapsedMs}ms`);
});
