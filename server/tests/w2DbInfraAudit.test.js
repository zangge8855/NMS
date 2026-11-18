import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const require = createRequire(import.meta.url);

const { default: config } = await import('../config.js');
const { initDb, closeDb } = await import('../db/client.js');
const { getStoreModes, setStoreModes } = await import('../db/runtimeModes.js');
const {
    pauseSnapshotQueue,
    resumeSnapshotQueue,
    flushSnapshotQueue,
} = await import('../db/snapshots.js');
const {
    initSqliteDb,
    closeSqliteDb,
    sqliteWriteSnapshot,
} = await import('../db/sqliteClient.js');
const { shouldWriteFile } = await import('../store/dbMirror.js');
const { verifyStoresAgainstDatabase } = await import('../store/storeRegistry.js');
const { collectSecurityIssues, collectStartupIssues } = await import('../lib/startupPreflight.js');
const { applySecurityBootstrap, resolveSecurityEnvFile } = await import('../lib/securityBootstrap.js');
const { default: systemSettingsStore } = await import('../store/systemSettingsStore.js');
const { default: certificateStore } = await import('../store/certificateStore.js');
const { default: subscriptionTokenStore } = await import('../store/subscriptionTokenStore.js');
const { default: serverStore } = await import('../store/serverStore.js');
const { default: userStore, ROLES } = await import('../store/userStore.js');
const { default: userPolicyStore } = await import('../store/userPolicyStore.js');
const { default: userGroupStore } = await import('../store/userGroupStore.js');
const { createBackupArchive, inspectBackupArchive } = await import('../lib/systemBackup.js');
const { default: notificationService, SEVERITY } = await import('../lib/notifications.js');
const { sendWebhookAlert } = await import('../lib/alertWebhookService.js');
const { appendSecurityAudit, closeSecurityAuditLog } = await import('../lib/securityAudit.js');
const { RotatingLineWriter } = await import('../lib/rotatingLogWriter.js');
const {
    generateSelfSignedCert,
    issueOrRenewCertificate,
    dispatchCertificateToServers,
    runCertificateRenewalCycle,
    stopCertificateRenewalLoop,
} = await import('../services/acmeService.js');
const { default: certificatesRouter } = await import('../routes/certificates.js');
const { default: systemRouter } = await import('../routes/system.js');
const {
    default: subscriptionsRouter,
    invalidatePublicSubCache,
    getPublicSubCacheSize,
} = await import('../routes/subscriptions.js');
const { registerClientCommands } = await import('../lib/telegram/commands/clients.js');
const { registerOpsCommands } = await import('../lib/telegram/commands/ops.js');
const { createCommandRegistry } = await import('../lib/telegram/commandRegistry.js');
const { createTelegramAlertService } = await import('../lib/telegramAlertService.js');
const { seedDemoData } = await import('../scripts/seed_demo.js');

async function requestLocal(routerOrApp, { method = 'GET', url = '/', user = null, body } = {}) {
    const storedAdmin = userStore.getAll().find((u) => u.role === ROLES.admin && u.enabled !== false);
    const fullAdmin = storedAdmin ? userStore.getById(storedAdmin.id) : null;
    const acting = user || (fullAdmin
        ? { userId: fullAdmin.id, username: fullAdmin.username, role: fullAdmin.role, tokenVersion: fullAdmin.tokenVersion ?? 1 }
        : { role: ROLES.admin, username: 'admin', userId: 'admin-1', tokenVersion: 1 });
    const bearer = jwt.sign(
        {
            userId: acting.userId,
            username: acting.username,
            role: acting.role,
            tokenVersion: acting.tokenVersion ?? 1,
        },
        config.jwt.secret,
        { algorithm: 'HS256', expiresIn: '1h' }
    );
    const app = express();
    app.use(express.json());
    app.use('/api', routerOrApp);
    const server = await new Promise((resolve) => {
        const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    try {
        const port = server.address().port;
        const headers = { Authorization: `Bearer ${bearer}` };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(`http://127.0.0.1:${port}/api${url}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: res.status, json, text };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('1. config.security.trustCloudflareHeaders defaults to false', () => {
    assert.equal(config.security.trustCloudflareHeaders, false);
});

test('2. snapshot queue flush does not deadlock while paused and resume drains cleanly', async () => {
    pauseSnapshotQueue();
    try {
        const result = await Promise.race([
            flushSnapshotQueue().then(() => 'flushed'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('flushSnapshotQueue deadlocked while paused')), 1000)),
        ]);
        assert.equal(result, 'flushed');
    } finally {
        resumeSnapshotQueue();
    }
});

test('2b. initDb resets initialized/pool state on failure so subsequent retries are attempted', async () => {
    const prevEnabled = config.db.enabled;
    const prevUrl = config.db.url;
    config.db.enabled = true;
    config.db.url = '';
    try {
        const first = await initDb();
        assert.equal(first.ready, false);
        const second = await initDb();
        assert.equal(second.ready, false);
        assert.match(second.error || '', /DB_URL/i);
    } finally {
        config.db.enabled = prevEnabled;
        config.db.url = prevUrl;
        await closeDb();
    }
});

test('3. dbMirror.shouldWriteFile returns false in STORE_WRITE_MODE=db even before DB ready, and storeRegistry supports SQLite verify', async () => {
    const prevDbEnabled = config.db.enabled;
    const prevWriteMode = config.db.storeWriteMode;
    const prevSqliteEnabled = config.db.sqliteEnabled;
    const prevModes = getStoreModes();
    try {
        config.db.enabled = true;
        config.db.storeWriteMode = 'db';
        setStoreModes({ writeMode: 'db' });
        assert.equal(shouldWriteFile(), false);

        setStoreModes({ writeMode: prevModes.writeMode, readMode: prevModes.readMode });
        config.db.enabled = false;
        config.db.sqliteEnabled = true;
        assert.equal(initSqliteDb(), true);
        sqliteWriteSnapshot('users', userStore.exportState());
        const report = await verifyStoresAgainstDatabase({ keys: ['users'] });
        assert.equal(report.total, 1);
        assert.equal(report.ok, 1);
        assert.equal(report.failed, 0);
    } finally {
        closeSqliteDb();
        config.db.enabled = prevDbEnabled;
        config.db.storeWriteMode = prevWriteMode;
        config.db.sqliteEnabled = prevSqliteEnabled;
        setStoreModes({ writeMode: prevModes.writeMode, readMode: prevModes.readMode });
    }
});

test('3b. startupPreflight checks user_groups/certificates, avoids false-positive ADMIN_PASSWORD with strong stored admin, and securityBootstrap omits plaintext password in runtime.env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-preflight-strong-'));
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync('StrongAdminPass!99', salt, 210000, 64, 'sha512').toString('hex');
        fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([
            {
                id: 'admin-strong-1',
                username: 'opsmanager',
                role: 'admin',
                enabled: true,
                passwordSalt: salt,
                passwordHash: hash,
                pbkdf2Iterations: 210000,
            },
        ]));
        fs.writeFileSync(path.join(dir, 'certificates.json'), '{bad json');
        fs.writeFileSync(path.join(dir, 'user_groups.json'), '{bad json');

        const startupIssues = collectStartupIssues({
            NODE_ENV: 'production',
            ENFORCE_STRICT_SECURITY: 'true',
            DATA_DIR: dir,
            JWT_SECRET: 'a-very-strong-random-jwt-secret-key-at-least-32-chars',
            CREDENTIALS_SECRET: 'b-very-strong-random-cred-secret-key-at-least-32-chars',
            ADMIN_USERNAME: 'opsmanager',
        }, { includeClientBuildCheck: false, includeEnvFileNotice: false });
        const codes = startupIssues.map((i) => i.code);
        assert.equal(codes.includes('unsafe_admin_password'), false);
        assert.ok(startupIssues.some((i) => i.message.includes('certificates.json')));
        assert.ok(startupIssues.some((i) => i.message.includes('user_groups.json')));

        const legacyIssues = collectSecurityIssues({
            NODE_ENV: 'production',
            ENFORCE_STRICT_SECURITY: 'true',
            ALLOW_LEGACY_PASSWORD_LOGIN: 'true',
            DATA_DIR: dir,
            JWT_SECRET: 'a-very-strong-random-jwt-secret-key-at-least-32-chars',
            CREDENTIALS_SECRET: 'b-very-strong-random-cred-secret-key-at-least-32-chars',
            ADMIN_USERNAME: 'opsmanager',
        });
        assert.equal(legacyIssues.some((i) => i.code === 'unsafe_admin_password'), true);

        const prevCreds = config.credentials.secret;
        const prevLegacyCreds = [...config.credentials.legacySecrets];
        const prevJwt = config.jwt.secret;
        const prevSub = config.subscription.tokenSecret;
        const prevSubLegacy = [...config.subscription.legacySecrets];
        const prevAdminUser = config.auth.adminUsername;
        const prevAdminPass = config.auth.adminPassword;
        const prevUsersState = userStore.exportState();
        const envFile = resolveSecurityEnvFile();
        const hadEnvFile = fs.existsSync(envFile);
        const prevEnvFileContent = hadEnvFile ? fs.readFileSync(envFile, 'utf8') : '';
        const admin = userStore.getAll().find((u) => u.role === ROLES.admin);
        try {
            applySecurityBootstrap({
                adminUsername: 'bootstrapboss',
                adminPassword: 'StrongBootstrap!234',
                jwtSecret: 'c-very-strong-jwt-secret-for-bootstrap-test-32chars',
                credentialsSecret: 'd-very-strong-cred-secret-for-bootstrap-test-32chars',
            }, { userId: admin.id, username: admin.username, role: ROLES.admin });
            const envContent = fs.readFileSync(envFile, 'utf8');
            assert.equal(envContent.includes('ADMIN_PASSWORD='), false);
            assert.equal(envContent.includes('StrongBootstrap!234'), false);
            assert.equal(envContent.includes('ADMIN_USERNAME='), true);
        } finally {
            userStore.importState(prevUsersState);
            if (hadEnvFile) {
                fs.writeFileSync(envFile, prevEnvFileContent, 'utf8');
            } else if (fs.existsSync(envFile)) {
                fs.rmSync(envFile, { force: true });
            }
            config.credentials.secret = prevCreds;
            config.credentials.legacySecrets = prevLegacyCreds;
            config.jwt.secret = prevJwt;
            config.subscription.tokenSecret = prevSub;
            config.subscription.legacySecrets = prevSubLegacy;
            config.auth.adminUsername = prevAdminUser;
            config.auth.adminPassword = prevAdminPass;
            process.env.CREDENTIALS_SECRET = prevCreds;
            process.env.JWT_SECRET = prevJwt;
            process.env.SUBSCRIPTION_TOKEN_SECRET = prevSub;
            delete process.env.ADMIN_PASSWORD;
            delete process.env.ADMIN_USERNAME;
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('4. Webhook/Cert/Token encryption at rest, full credential rotation, backup fallback keys, and public sub cache invalidation', async () => {
    const prevCredSecret = config.credentials.secret;
    const prevLegacyCreds = [...config.credentials.legacySecrets];
    const prevSubSecret = config.subscription.tokenSecret;
    const prevSubLegacy = [...config.subscription.legacySecrets];

    const settingsFile = path.join(config.dataDir, 'system_settings.json');
    const certsFile = path.join(config.dataDir, 'certificates.json');
    const certRec = certificateStore.create({
        domain: 'enc-audit.example.com',
        provider: 'selfsigned',
        challengeType: 'manual',
        cfApiToken: 'cf-secret-token-xyz',
        privateKey: '-----BEGIN PRIVATE KEY-----\nSECRETKEYDATA\n-----END PRIVATE KEY-----',
    });
    const tokIssued = subscriptionTokenStore.issue('rotate@example.com', { name: 'rot-test', ttlDays: 7 });

    try {
        systemSettingsStore.update({
            webhook: {
                enabled: true,
                channel: 'custom',
                url: 'https://hooks.example.com/wh',
                secret: 'wh-plaintext-secret-xyz',
                barkKey: 'bark-plaintext-key-xyz',
            },
        });
        const settingsRaw = fs.readFileSync(settingsFile, 'utf8');
        assert.equal(settingsRaw.includes('wh-plaintext-secret-xyz'), false);
        assert.equal(settingsRaw.includes('bark-plaintext-key-xyz'), false);
        assert.equal(systemSettingsStore.getAll().webhook.secret, '********');
        assert.equal(systemSettingsStore.getWebhook().secret, 'wh-plaintext-secret-xyz');
        assert.equal(systemSettingsStore.getWebhook().barkKey, 'bark-plaintext-key-xyz');

        const certsRaw = fs.readFileSync(certsFile, 'utf8');
        assert.equal(certsRaw.includes('cf-secret-token-xyz'), false);
        assert.equal(certsRaw.includes('SECRETKEYDATA'), false);
        assert.equal(certificateStore.getById(certRec.id).cfApiToken, 'cf-secret-token-xyz');

        // Dry run should not modify stored ciphertexts
        const dryRes = await requestLocal(systemRouter, {
            method: 'POST',
            url: '/credentials/rotate',
            body: { dryRun: true },
        });
        assert.equal(dryRes.status, 200);
        assert.equal(dryRes.json.obj.dryRun, true);
        assert.ok(dryRes.json.obj.stores.systemSettings);
        assert.ok(dryRes.json.obj.stores.certificates);
        assert.ok(dryRes.json.obj.stores.subscriptionTokens);

        // Rotate secrets and verify full rotation + backup decryption fallback
        const archive = createBackupArchive({ storeKeys: ['users'] });
        config.credentials.legacySecrets = [prevCredSecret, ...prevLegacyCreds];
        config.credentials.secret = 'new-rotated-credentials-secret-value-32chars!';
        config.subscription.legacySecrets = [prevSubSecret, ...prevSubLegacy];
        config.subscription.tokenSecret = 'new-rotated-subscription-secret-value-32chars!';

        const inspected = inspectBackupArchive(archive.buffer);
        assert.equal(inspected.encrypted, true);

        const rotRes = await requestLocal(systemRouter, {
            method: 'POST',
            url: '/credentials/rotate',
            body: { dryRun: false },
        });
        assert.equal(rotRes.status, 200);
        assert.ok(rotRes.json.obj.rotatedFields >= 3);
        assert.equal(systemSettingsStore.getWebhook().secret, 'wh-plaintext-secret-xyz');
        assert.equal(certificateStore.getById(certRec.id).cfApiToken, 'cf-secret-token-xyz');

        const [tokId, tokSec] = tokIssued.token.split('.');
        assert.equal(subscriptionTokenStore.verify('rotate@example.com', tokId, tokSec).ok, true);

        // Public sub cache invalidation after PUT /settings, PUT /servers/order, PUT /inbounds/order
        const cacheEmail = 'cachecheck@example.com';
        const subToken = subscriptionTokenStore.issue(cacheEmail, { name: 'cache', ttlDays: 7 });
        const cacheUser = userStore.add({
            username: 'cachecheckuser',
            password: 'CacheUserPass123!',
            role: ROLES.user,
            email: cacheEmail,
            subscriptionEmail: cacheEmail,
        });
        userPolicyStore.upsert(cacheEmail, { serverScopeMode: 'none' }, 'admin');
        const srv = serverStore.add({ name: 'cache-srv', url: 'http://127.0.0.1:29999', username: 'u', password: 'p' });
        invalidatePublicSubCache();
        try {
            const subApp = express();
            subApp.use('/api/subscriptions', subscriptionsRouter);
            const subSrv = await new Promise((r) => { const s = subApp.listen(0, '127.0.0.1', () => r(s)); });
            try {
                const baseSubUrl = `http://127.0.0.1:${subSrv.address().port}/api/subscriptions/public/t/${encodeURIComponent(subToken.publicTokenId)}/${encodeURIComponent(subToken.token.split('.')[1])}`;
                const s1 = await fetch(`${baseSubUrl}?format=raw`);
                assert.equal(s1.status, 200);
                assert.ok(getPublicSubCacheSize() >= 1);
                const s1Hit = await fetch(`${baseSubUrl}?format=raw`);
                assert.equal(s1Hit.headers.get('x-nms-cache'), 'HIT');

                const putOrder = await requestLocal(systemRouter, {
                    method: 'PUT',
                    url: '/servers/order',
                    body: { serverIds: [srv.id] },
                });
                assert.equal(putOrder.status, 200);
                assert.equal(getPublicSubCacheSize(), 0);

                await fetch(`${baseSubUrl}?format=raw`);
                assert.ok(getPublicSubCacheSize() >= 1);
                const putSettings = await requestLocal(systemRouter, {
                    method: 'PUT',
                    url: '/settings',
                    body: { site: { camouflageTitle: 'Cache Check Title' } },
                });
                assert.equal(putSettings.status, 200);
                assert.equal(getPublicSubCacheSize(), 0);

                await fetch(`${baseSubUrl}?format=raw`);
                assert.ok(getPublicSubCacheSize() >= 1);
                const putInbOrder = await requestLocal(systemRouter, {
                    method: 'PUT',
                    url: '/inbounds/order',
                    body: { serverId: srv.id, inboundIds: ['1'] },
                });
                assert.equal(putInbOrder.status, 200);
                assert.equal(getPublicSubCacheSize(), 0);
            } finally {
                await new Promise((r) => subSrv.close(r));
            }
        } finally {
            serverStore.remove(srv.id);
            userPolicyStore.remove(cacheEmail);
            subscriptionTokenStore.revokeAllByEmail(cacheEmail);
            userStore.remove(cacheUser.id);
        }
    } finally {
        subscriptionTokenStore.revokeAllByEmail('rotate@example.com');
        certificateStore.delete(certRec.id);
        config.credentials.secret = prevCredSecret;
        config.credentials.legacySecrets = prevLegacyCreds;
        config.subscription.tokenSecret = prevSubSecret;
        config.subscription.legacySecrets = prevSubLegacy;
    }
});

test('5. Notifications flush & gating, webhook HMAC signing, audit URL redaction, and Windows log rotation', async () => {
    // a. notifications flush & gating
    const origGetWebhook = systemSettingsStore.getWebhook.bind(systemSettingsStore);
    notificationService.clearDedupCache();
    let dispatched = 0;
    try {
        systemSettingsStore.getWebhook = () => ({
            enabled: false,
            channel: 'custom',
            url: 'https://hooks.example.com/disabled',
            events: { nodeOffline: true, trafficAlert: true, certExpiring: true },
        });
        const origFetch = globalThis.fetch;
        globalThis.fetch = async () => { dispatched += 1; return new Response('{}', { status: 200 }); };
        try {
            notificationService.notify({ type: 'node_offline', severity: SEVERITY.CRITICAL, title: 'T1', body: 'B1', dedupKey: 'k1-' + Date.now() });
            systemSettingsStore.getWebhook = () => ({
                enabled: true,
                channel: 'custom',
                url: 'https://hooks.example.com/allfalse',
                events: { nodeOffline: false, trafficAlert: false, certExpiring: false },
            });
            notificationService.notify({ type: 'security_custom', severity: SEVERITY.WARNING, title: 'T2', body: 'B2', dedupKey: 'k2-' + Date.now() });
            await new Promise((r) => setTimeout(r, 30));
            assert.equal(dispatched, 0);
        } finally {
            globalThis.fetch = origFetch;
        }
        notificationService.flush();
        const persisted = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'notifications.json'), 'utf8'));
        assert.ok(Array.isArray(persisted) && persisted.some((n) => n.title === 'T1'));
    } finally {
        systemSettingsStore.getWebhook = origGetWebhook;
    }

    // b. alertWebhookService signing (X-NMS-Signature + Feishu timestamp/sign)
    const capturedCalls = [];
    const mockFetch = async (url, init) => {
        capturedCalls.push({ url, init });
        return { ok: true, status: 200 };
    };
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    await sendWebhookAlert(
        { channel: 'custom', url: 'https://hooks.example.com/signed', secret: 'my-hmac-secret' },
        { title: 'Signed', message: 'Hello', event: 'node_offline', timestamp: '2026-01-01T00:00:00.000Z' },
        { fetchImpl: mockFetch, lookup }
    );
    const customCall = capturedCalls[0];
    const expectedSig = `sha256=${crypto.createHmac('sha256', 'my-hmac-secret').update(customCall.init.body).digest('hex')}`;
    assert.equal(customCall.init.headers['X-NMS-Signature'], expectedSig);

    await sendWebhookAlert(
        { channel: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc', secret: 'feishu-sec' },
        { title: 'Feishu', message: 'Alert' },
        { fetchImpl: mockFetch, lookup }
    );
    const feishuBody = JSON.parse(capturedCalls[1].init.body);
    assert.ok(feishuBody.timestamp);
    assert.equal(
        feishuBody.sign,
        crypto.createHmac('sha256', `${feishuBody.timestamp}\nfeishu-sec`).digest('base64')
    );

    // c. securityAudit URL redaction
    appendSecurityAudit('test_url_redaction', {
        method: 'GET',
        originalUrl: '/api/subscriptions/public/t/tok1/secretPartHere?token=leakedToken',
        headers: {},
    }, {});
    await closeSecurityAuditLog();
    const auditLogContent = fs.readFileSync(path.join(config.dataDir, 'security_audit.log'), 'utf8');
    assert.equal(auditLogContent.includes('secretPartHere'), false);
    assert.equal(auditLogContent.includes('leakedToken'), false);
    assert.ok(auditLogContent.includes('[redacted]'));

    // d. rotatingLogWriter zero EPERM/EBUSY errors under Windows rotation bursts
    const rotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-win-rot-'));
    try {
        const logFile = path.join(rotDir, 'burst.log');
        const errors = [];
        const writer = new RotatingLineWriter({
            file: logFile,
            maxBytes: 100,
            maxFiles: 2,
            onError: (err) => errors.push(err),
        });
        const line = `${'a'.repeat(39)}\n`;
        for (let i = 0; i < 20; i += 1) {
            writer.write(line);
        }
        await writer.close();
        assert.deepEqual(errors, []);
        assert.ok(fs.existsSync(logFile));
        assert.ok(fs.existsSync(`${logFile}.1`));
        assert.ok(fs.existsSync(`${logFile}.2`));
    } finally {
        fs.rmSync(rotDir, { recursive: true, force: true });
    }
});

test('6. ACME rejects custom/manual cert renewal with 400, s-ui dispatch does not swallow errors, and renewal loop handles autoRenew/notify/stop cleanly', async () => {
    const pair = generateSelfSignedCert('ca-custom.example.com', 365);
    const customRec = certificateStore.create({
        domain: 'ca-custom.example.com',
        provider: 'custom',
        challengeType: 'manual',
        certificate: pair.cert,
        privateKey: pair.key,
    });
    const manualLets = certificateStore.create({
        domain: 'manual-le.example.com',
        provider: 'letsencrypt',
        challengeType: 'manual',
        certificate: pair.cert,
        privateKey: pair.key,
    });
    const expiringSelfSigned = certificateStore.create({
        domain: 'autorenew-ss.example.com',
        provider: 'selfsigned',
        challengeType: 'manual',
        certificate: pair.cert,
        privateKey: pair.key,
        expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        autoRenew: true,
    });
    const expiringCustomNotify = certificateStore.create({
        domain: 'expiring-custom.example.com',
        provider: 'custom',
        challengeType: 'manual',
        certificate: pair.cert,
        privateKey: pair.key,
        expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        autoRenew: false,
    });
    const suiServer = serverStore.add({
        name: 'sui-unreachable',
        url: 'http://127.0.0.1:1',
        panelType: 's-ui',
        username: 'admin',
        password: 'password',
    });

    try {
        const resCustom = await requestLocal(certificatesRouter, {
            method: 'POST',
            url: `/${customRec.id}/renew`,
        });
        assert.equal(resCustom.status, 400, resCustom.text);
        assert.equal(certificateStore.getById(customRec.id).certificate, pair.cert);

        const resManual = await requestLocal(certificatesRouter, {
            method: 'POST',
            url: `/${manualLets.id}/renew`,
        });
        assert.equal(resManual.status, 400, resManual.text);
        await assert.rejects(() => issueOrRenewCertificate(customRec.id));
        await assert.rejects(() => issueOrRenewCertificate(manualLets.id));

        const dispatchRes = await dispatchCertificateToServers(customRec.id, [suiServer.id]);
        assert.equal(dispatchRes.success, false);
        assert.ok(dispatchRes.failedServers.includes('sui-unreachable'));
        assert.equal(dispatchRes.details[0].ok, false);

        notificationService.clearDedupCache();
        const cycle = await runCertificateRenewalCycle();
        assert.ok(cycle.renewed >= 1);
        assert.ok(cycle.notified >= 1);
        stopCertificateRenewalLoop();
    } finally {
        certificateStore.delete(customRec.id);
        certificateStore.delete(manualLets.id);
        certificateStore.delete(expiringSelfSigned.id);
        certificateStore.delete(expiringCustomNotify.id);
        serverStore.remove(suiServer.id);
    }
});

test('7. Telegram bot hydrates policy/group/tokens in /client /myinfo /sub, extends from max(now, policyExpiry), primes offset=-1, and enforces initiatorId on callbacks', async () => {
    const email = 'tg-policy-user@example.com';
    const user = userStore.add({
        username: 'tgpolicyuser',
        password: 'TgPolicyPass123!',
        role: ROLES.user,
        email,
        subscriptionEmail: email,
    });
    const futureExpiryMs = Date.now() + 365 * 86400000;
    userPolicyStore.upsert(email, {
        expiryTime: futureExpiryMs,
        trafficLimitBytes: 50 * 1024 * 1024 * 1024,
        limitIp: 7,
    }, 'admin');
    subscriptionTokenStore.issue(email, { name: 'tg-sub-profile', ttlDays: 30 });

    const prevTg = { ...systemSettingsStore.getAll().telegram };
    try {
        const registry = createCommandRegistry();
        const listSessions = { create: () => ({ id: 's1' }) };
        let recordedExpiry = '';
        const ctx = {
            helpers: {
                joinHtmlMessage: (title, sections) => `${title}\n${sections.join('\n')}`,
                sectionHeader: (s) => `[${s}]`,
                formatHtmlKeyValueRow: (k, v) => `${k}: ${v}`,
                escapeTelegramHtml: (v) => String(v ?? ''),
                formatBytesHuman: (n) => `${n}B`,
                trimLines: (rows) => rows.join('\n'),
            },
            listSessions,
            services: {
                userAdmin: async () => ({
                    listUsers: () => userStore.getAll(),
                    updateManagedUserExpiry: async (_id, payload) => {
                        recordedExpiry = payload.expiryTime;
                    },
                }),
                auditRepository: async () => ({ appendEvent: () => {} }),
                userPolicy: async () => userPolicyStore,
                userGroup: async () => userGroupStore,
                subscriptionTokens: async () => subscriptionTokenStore,
            },
        };
        registerClientCommands(registry, ctx);
        registerOpsCommands(registry, ctx);

        const clientRes = await registry.dispatch({ command: '/client', args: { positional: [email] }, ctx: {} });
        assert.ok(clientRes.text.includes('7'));
        assert.ok(!clientRes.text.includes('到期: 永久'));

        const subRes = await registry.dispatch({ command: '/sub', args: { positional: [email] }, ctx: {} });
        assert.ok(subRes.text.includes('Token 数: 1'));
        assert.ok(subRes.text.includes('tg-sub-profile'));

        const extRes = await registry.dispatch({ command: '/client_extend', args: { positional: [email, '10'] }, ctx: {} });
        await extRes.pending.execute({ actor: 'admin' });
        const expectedMin = futureExpiryMs + 9 * 86400000;
        assert.ok(new Date(recordedExpiry).getTime() >= expectedMin);

        // Telegram primeUpdates & initiatorId callback enforcement
        const apiCalls = [];
        const tgService = createTelegramAlertService({
            fetcher: async ({ body }) => {
                apiCalls.push(body);
                return { ok: true, result: [] };
            },
        });
        systemSettingsStore.update({
            telegram: {
                enabled: true,
                botToken: '123456:fakeBotTokenForTest',
                chatId: '9999999',
            },
        });
        await tgService._pollOnce();
        const primeCall = apiCalls.find((c) => c.limit === 1 && c.offset === -1);
        assert.ok(primeCall, 'primeUpdates sends offset=-1, limit=1');
        assert.deepEqual(primeCall.allowed_updates, ['message', 'callback_query']);

        let executed = 0;
        const rec = tgService.getPendingActions().create({
            command: '/restart_core',
            actor: 'alice',
            initiatorId: '11111',
            level: 'write',
            execute: async () => { executed += 1; return { toast: 'ok' }; },
        });
        await tgService._handleCallbackQuery({
            id: 'cb1',
            from: { id: 22222, username: 'mallory' },
            data: `c:${rec.id}`,
        });
        assert.equal(executed, 0);
        assert.ok(tgService.getPendingActions().peek(rec.id), 'non-initiator callback does not consume pending action');
        await tgService._handleCallbackQuery({
            id: 'cb2',
            from: { id: 11111, username: 'alice' },
            data: `c:${rec.id}`,
        });
        assert.equal(executed, 1);
        tgService.stop();
    } finally {
        systemSettingsStore.update({ telegram: prevTg });
        subscriptionTokenStore.revokeAllByEmail(email);
        userPolicyStore.remove(email);
        userStore.remove(user.id);
    }
});

test('8. seed_demo schemas, deployment configs, and fake panel v3 parity on healthy vs 404 on legacy', async () => {
    const ecosystem = require(path.join(REPO_ROOT, 'ecosystem.config.cjs'));
    assert.equal(ecosystem.apps[0].max_memory_restart, '512M');

    const serverPkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8'));
    assert.equal(Boolean(serverPkg.dependencies?.tsx), true);
    assert.equal(Boolean(serverPkg.devDependencies?.tsx), false);

    const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-seed-demo-'));
    try {
        seedDemoData(demoDir);
        const seededServers = JSON.parse(fs.readFileSync(path.join(demoDir, 'servers.json'), 'utf8'));
        assert.ok(seededServers[0].url && seededServers[0].basePath);
        const seededGroups = JSON.parse(fs.readFileSync(path.join(demoDir, 'user_groups.json'), 'utf8'));
        assert.ok('speedLimitUp' in seededGroups[0] && 'speedLimitDown' in seededGroups[0] && 'limitIp' in seededGroups[0]);
        const seededTokens = JSON.parse(fs.readFileSync(path.join(demoDir, 'subscription_tokens.json'), 'utf8'));
        assert.ok(seededTokens[0].tokenSecretEnc && seededTokens[0].tokenSecretHash);
        const seededCounters = JSON.parse(fs.readFileSync(path.join(demoDir, 'traffic_counters.json'), 'utf8'));
        assert.ok(!Array.isArray(seededCounters) && !('totalUploadBytes' in seededCounters));
        const seededAudit = JSON.parse(fs.readFileSync(path.join(demoDir, 'audit_events.json'), 'utf8'));
        assert.ok(seededAudit[0].eventType && seededAudit[0].actor && seededAudit[0].details && seededAudit[0].ts);
    } finally {
        fs.rmSync(demoDir, { recursive: true, force: true });
    }

    // Spawn fake panel on dynamic ports to verify 3x-ui v3 endpoints vs legacy 404
    const net = (await import('net')).default;
    const allocPort = () => new Promise((res) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
            const p = s.address().port;
            s.close(() => res(p));
        });
    });
    const [healthyPort, legacyPort, suiPort, downPort] = await Promise.all([allocPort(), allocPort(), allocPort(), allocPort()]);
    const proc = spawn(process.execPath, [
        '--import', 'tsx',
        'scripts/review_fake_panel.js',
        `--healthy-port=${healthyPort}`,
        `--legacy-port=${legacyPort}`,
        `--sui-port=${suiPort}`,
        `--down-port=${downPort}`,
    ], { cwd: SERVER_DIR, env: { ...process.env, REVIEW_PANEL_HOST: '127.0.0.1' } });
    try {
        let buf = '';
        const info = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('fake panel startup timeout')), 15000);
            proc.stdout.on('data', (chunk) => {
                buf += chunk.toString();
                if (buf.includes('panels')) {
                    try {
                        const parsed = JSON.parse(buf.slice(buf.indexOf('{'), buf.lastIndexOf('}') + 1));
                        if (parsed.success) {
                            clearTimeout(t);
                            resolve(parsed);
                        }
                    } catch {}
                }
            });
            proc.on('error', (err) => { clearTimeout(t); reject(err); });
        });
        const hDef = info.panels.find((p) => p.key === 'healthy');
        const lDef = info.panels.find((p) => p.key === 'legacy');
        const login = async (def) => {
            const r = await fetch(`${def.url}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: def.username, password: def.password }),
            });
            return r.headers.get('set-cookie').split(';')[0];
        };
        const [hCookie, lCookie] = await Promise.all([login(hDef), login(lDef)]);
        const hCall = async (p, method = 'GET', body = undefined) => fetch(`${hDef.url}${p}`, {
            method,
            headers: { Cookie: hCookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const lCall = async (p, method = 'GET', body = undefined) => fetch(`${lDef.url}${p}`, {
            method,
            headers: { Cookie: lCookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });

        assert.equal((await hCall('/panel/api/inbounds/setEnable/101', 'POST', { enable: false })).status, 200);
        assert.equal((await lCall('/panel/api/inbounds/setEnable/201', 'POST', { enable: false })).status, 404);
        assert.equal((await hCall('/panel/api/clients/get/subId/alice-sub')).status, 200);
        assert.equal((await lCall('/panel/api/clients/get/subId/alice-sub')).status, 404);
        assert.equal((await hCall('/panel/api/clients/groups/create', 'POST', { name: 'vip' })).status, 200);
        assert.equal((await lCall('/panel/api/clients/groups')).status, 404);
        assert.equal((await hCall('/panel/api/hosts/add', 'POST', { remark: 'h1', inboundIds: [101], hosts: [] })).status, 200);
        assert.equal((await lCall('/panel/api/hosts/list')).status, 404);
        assert.equal((await hCall('/panel/api/sub-balancers', 'POST', { remark: 'b1', strategy: 'random', inboundIds: [101] })).status, 200);
        assert.equal((await lCall('/panel/api/sub-balancers')).status, 404);
        assert.equal((await hCall('/panel/api/xray/outbound-subs', 'POST', { url: 'https://sub.example.com/1' })).status, 200);
        assert.equal((await lCall('/panel/api/xray/outbound-subs')).status, 404);
        assert.equal((await hCall('/panel/api/nodes/add', 'POST', { name: 'n1', address: '1.2.3.4', port: 2053 })).status, 200);
        assert.equal((await lCall('/panel/api/nodes/list')).status, 404);
        assert.equal((await hCall('/panel/api/clients/hwids/user@example.com', 'POST')).status, 200);
        assert.equal((await lCall('/panel/api/clients/hwids/user@example.com', 'POST')).status, 404);
    } finally {
        await new Promise((resolve) => {
            proc.once('exit', resolve);
            proc.kill('SIGTERM');
            setTimeout(resolve, 3000).unref();
        });
    }
});
