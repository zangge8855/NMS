import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { invokeApp } from './helpers/invokeApp.js';

const { default: config } = await import('../config.js');
const { default: userStore, ROLES } = await import('../store/userStore.js');
const { default: serverStore } = await import('../store/serverStore.js');
const { default: systemSettingsStore } = await import('../store/systemSettingsStore.js');
const { default: subscriptionTokenStore } = await import('../store/subscriptionTokenStore.js');
const { default: userPolicyStore } = await import('../store/userPolicyStore.js');
const { getServerPanelSnapshot, invalidateServerPanelSnapshotCache } = await import('../lib/serverPanelSnapshotService.js');
const { listPanelInbounds } = await import('../services/panelGateway.js');
const { default: systemRouter } = await import('../routes/system.js');
const { default: proxyRouter } = await import('../routes/proxy.js');
const { default: batchRouter } = await import('../routes/batch.js');
const { default: serversRouter } = await import('../routes/servers.js');
const {
    default: subscriptionsRouter,
    invalidatePublicSubCache,
    getPublicSubCacheSize,
} = await import('../routes/subscriptions.js');

function readRequestBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function parseBodyFields(req, rawBody) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!rawBody) return {};
    if (contentType.includes('application/json')) {
        try {
            return JSON.parse(rawBody);
        } catch {
            return {};
        }
    }
    const params = new URLSearchParams(rawBody);
    const out = {};
    for (const [key, value] of params.entries()) {
        out[key] = value;
    }
    return out;
}

function makeAuthHeader(user) {
    const token = jwt.sign(
        {
            userId: user.id,
            username: user.username,
            role: user.role,
            tokenVersion: user.tokenVersion ?? 1,
        },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
    return `Bearer ${token}`;
}

describe('NMS local inbound remarks (per-server override isolated from 3x-ui / s-ui)', { concurrency: false }, () => {
    let ipv4Server;
    let ipv6Server;
    let srvV4;
    let srvV6;
    let app;
    let adminUser;
    let operatorUser;
    let auditorUser;
    let subUser;
    let subToken;

    const subEmail = 'dualstack-sub@example.com';
    const panelUpdates = [];
    const panelInbound = {
        id: 1,
        remark: 'shared-3xui',
        protocol: 'vless',
        port: 443,
        listen: '0.0.0.0',
        enable: true,
        up: 1024,
        down: 2048,
        total: 0,
        expiryTime: 0,
        settings: JSON.stringify({
            clients: [
                {
                    id: '11111111-1111-1111-1111-111111111111',
                    email: subEmail,
                    enable: true,
                    totalGB: 0,
                    expiryTime: 0,
                },
            ],
            decryption: 'none',
        }),
        streamSettings: JSON.stringify({
            network: 'tcp',
            security: 'none',
        }),
        sniffing: JSON.stringify({
            enabled: false,
            destOverride: ['http', 'tls'],
        }),
    };

    function createPanelHandler() {
        return async (req, res) => {
            const urlPath = String(req.url || '').split('?')[0];
            if (req.method === 'POST' && urlPath === '/login') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Set-Cookie', '3x-ui=mock-panel-cookie; Path=/');
                res.end(JSON.stringify({ success: true, msg: '' }));
                return;
            }
            if (req.method === 'GET' && urlPath === '/panel/api/server/status') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    success: true,
                    obj: {
                        cpu: 12,
                        mem: { current: 256, total: 1024 },
                        uptime: 120,
                        xray: { state: 'running', version: '1.8.24' },
                    },
                }));
                return;
            }
            if (req.method === 'GET' && urlPath === '/panel/api/inbounds/list') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    success: true,
                    obj: [{ ...panelInbound }],
                }));
                return;
            }
            if (req.method === 'GET' && urlPath === '/panel/api/inbounds/get/1') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    success: true,
                    obj: { ...panelInbound },
                }));
                return;
            }
            if (req.method === 'GET' && urlPath === '/panel/api/nodes/list') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, obj: [] }));
                return;
            }
            if (req.method === 'POST' && (urlPath === '/panel/api/inbounds/onlines' || urlPath === '/panel/api/clients/onlines')) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, obj: [] }));
                return;
            }
            if (req.method === 'POST' && urlPath === '/panel/api/inbounds/update/1') {
                const rawBody = await readRequestBody(req);
                const parsed = parseBodyFields(req, rawBody);
                panelUpdates.push({ url: urlPath, body: parsed });
                if (parsed.remark !== undefined) {
                    panelInbound.remark = String(parsed.remark);
                }
                if (parsed.enable !== undefined) {
                    panelInbound.enable = parsed.enable === true || parsed.enable === 'true';
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, obj: { ...panelInbound } }));
                return;
            }
            if (req.method === 'POST' && urlPath === '/panel/api/inbounds/setEnable/1') {
                const rawBody = await readRequestBody(req);
                const parsed = parseBodyFields(req, rawBody);
                panelUpdates.push({ url: urlPath, body: parsed });
                panelInbound.enable = parsed.enable === true || parsed.enable === 'true';
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, msg: '' }));
                return;
            }

            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, msg: `Unhandled ${req.method} ${urlPath}` }));
        };
    }

    before(async () => {
        ipv4Server = http.createServer(createPanelHandler());
        await new Promise((resolve) => ipv4Server.listen(0, '127.0.0.1', resolve));
        const portV4 = ipv4Server.address().port;

        let urlV6 = `http://localhost:${portV4}`;
        const candidateV6 = http.createServer(createPanelHandler());
        try {
            await new Promise((resolve, reject) => {
                candidateV6.once('error', reject);
                candidateV6.listen(0, '::1', resolve);
            });
            ipv6Server = candidateV6;
            urlV6 = `http://[::1]:${ipv6Server.address().port}`;
        } catch {
            candidateV6.close();
            ipv6Server = null;
        }

        const uniq = `${process.pid}_${Date.now()}`;
        adminUser = userStore.add({
            username: `remarks_admin_${uniq}`,
            password: 'AdminPassword123!',
            role: ROLES.admin,
            email: `remarks_admin_${uniq}@example.com`,
        });
        operatorUser = userStore.add({
            username: `remarks_op_${uniq}`,
            password: 'OpPassword123!',
            role: ROLES.operator,
            email: `remarks_op_${uniq}@example.com`,
        });
        auditorUser = userStore.add({
            username: `remarks_aud_${uniq}`,
            password: 'AudPassword123!',
            role: ROLES.auditor,
            email: `remarks_aud_${uniq}@example.com`,
        });
        subUser = userStore.add({
            username: `remarks_sub_${uniq}`,
            password: 'SubPassword123!',
            role: ROLES.user,
            email: subEmail,
            subscriptionEmail: subEmail,
        });
        userPolicyStore.upsert(subEmail, {
            serverScopeMode: 'all',
            protocolScopeMode: 'all',
        }, adminUser.username);
        subToken = subscriptionTokenStore.issue(subEmail, { name: 'dualstack', ttlDays: 7 });

        srvV4 = serverStore.add({
            name: 'HK-IPv4-Node',
            url: `http://127.0.0.1:${portV4}`,
            username: 'admin',
            password: 'panel-password',
        });
        srvV6 = serverStore.add({
            name: 'HK-IPv6-Node',
            url: urlV6,
            username: 'admin',
            password: 'panel-password',
        });

        app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use('/api/system', systemRouter);
        app.use('/api/panel', proxyRouter);
        app.use('/api/batch', batchRouter);
        app.use('/api/servers', serversRouter);
        app.use('/api/subscriptions', subscriptionsRouter);
    });

    after(async () => {
        invalidateServerPanelSnapshotCache();
        invalidatePublicSubCache();
        if (srvV4?.id) serverStore.remove(srvV4.id);
        if (srvV6?.id) serverStore.remove(srvV6.id);
        systemSettingsStore.removeInboundRemark(srvV4?.id || '');
        systemSettingsStore.removeInboundRemark(srvV6?.id || '');
        subscriptionTokenStore.revokeAllByEmail(subEmail);
        userPolicyStore.remove(subEmail);
        if (adminUser?.id) userStore.remove(adminUser.id);
        if (operatorUser?.id) userStore.remove(operatorUser.id);
        if (auditorUser?.id) userStore.remove(auditorUser.id);
        if (subUser?.id) userStore.remove(subUser.id);
        if (ipv4Server) await new Promise((resolve) => ipv4Server.close(resolve));
        if (ipv6Server) await new Promise((resolve) => ipv6Server.close(resolve));
    });

    it('enforces RBAC, validates inputs, and invalidates public subscription cache on PUT /api/system/inbounds/remarks', async () => {
        invalidatePublicSubCache();
        const secret = subToken.token.split('.')[1];
        const subUrl = `/api/subscriptions/public/t/${encodeURIComponent(subToken.publicTokenId)}/${encodeURIComponent(secret)}?format=raw`;
        const primeRes = await invokeApp(app, { method: 'GET', url: subUrl });
        assert.equal(primeRes.statusCode, 200);
        assert.ok(getPublicSubCacheSize() >= 1);

        // Auditor is read-only
        const auditorPut = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/remarks',
            headers: { Authorization: makeAuthHeader(auditorUser) },
            body: { serverId: srvV4.id, inboundId: 1, remark: 'Forbidden' },
        });
        assert.equal(auditorPut.statusCode, 403);

        // Unknown server -> 404
        const missingServerPut = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/remarks',
            headers: { Authorization: makeAuthHeader(operatorUser) },
            body: { serverId: 'non-existent-server', inboundId: 1, remark: 'Test' },
        });
        assert.equal(missingServerPut.statusCode, 404);

        // Missing inboundId -> 400
        const missingInboundPut = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/remarks',
            headers: { Authorization: makeAuthHeader(operatorUser) },
            body: { serverId: srvV4.id, inboundId: '', remark: 'Test' },
        });
        assert.equal(missingInboundPut.statusCode, 400);

        // Operator sets local remark on srvV4 & clears public sub cache
        const okPut = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/remarks',
            headers: { Authorization: makeAuthHeader(operatorUser) },
            body: { serverId: srvV4.id, inboundId: 1, remark: '香港-IPv4' },
        });
        assert.equal(okPut.statusCode, 200);
        assert.equal(okPut.json?.obj?.remark, '香港-IPv4');
        assert.equal(okPut.json?.obj?.hasCustomRemark, true);
        assert.equal(getPublicSubCacheSize(), 0);

        // GET endpoint returns scoped and full maps
        const getAll = await invokeApp(app, {
            method: 'GET',
            url: '/api/system/inbounds/remarks',
            headers: { Authorization: makeAuthHeader(auditorUser) },
        });
        assert.equal(getAll.statusCode, 200);
        assert.deepEqual(getAll.json?.obj?.[srvV4.id], { 1: '香港-IPv4' });
    });

    it('enforces RBAC, supports single and batch visibility updates, and hides inbounds from user subscriptions immediately', async () => {
        invalidatePublicSubCache();
        const secret = subToken.token.split('.')[1];
        const subUrl = `/api/subscriptions/public/t/${encodeURIComponent(subToken.publicTokenId)}/${encodeURIComponent(secret)}?format=raw`;

        // Prime public subscription: both srvV4 and srvV6 links appear
        const beforeRes = await invokeApp(app, { method: 'GET', url: subUrl });
        assert.equal(beforeRes.statusCode, 200);
        const beforeLines = beforeRes.text.trim().split(/\r?\n/).filter(Boolean);
        assert.equal(beforeLines.length, 2);
        assert.ok(getPublicSubCacheSize() >= 1);

        // Auditor cannot mutate visibility
        const auditorPut = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/visibility',
            headers: { Authorization: makeAuthHeader(auditorUser) },
            body: { serverId: srvV4.id, inboundId: 1, hidden: true },
        });
        assert.equal(auditorPut.statusCode, 403);

        // Non-boolean hidden -> 400
        const invalidPut = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/visibility',
            headers: { Authorization: makeAuthHeader(operatorUser) },
            body: { serverId: srvV4.id, inboundId: 1, hidden: 'yes' },
        });
        assert.equal(invalidPut.statusCode, 400);

        // Operator hides srvV4 inbound 1 -> invalidates cache and removes it from user subscription
        const hideV4 = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/visibility',
            headers: { Authorization: makeAuthHeader(operatorUser) },
            body: { serverId: srvV4.id, inboundId: 1, hidden: true },
        });
        assert.equal(hideV4.statusCode, 200);
        assert.equal(hideV4.json?.obj?.hidden, true);
        assert.equal(getPublicSubCacheSize(), 0);

        const getVisibility = await invokeApp(app, {
            method: 'GET',
            url: '/api/system/inbounds/visibility',
            headers: { Authorization: makeAuthHeader(auditorUser) },
        });
        assert.equal(getVisibility.statusCode, 200);
        assert.deepEqual(getVisibility.json?.obj?.[srvV4.id], ['1']);

        const snapAfterHide = await getServerPanelSnapshot(srvV4, { force: true });
        assert.equal(snapAfterHide.inbounds[0].hiddenFromUsers, true);

        const afterHideRes = await invokeApp(app, { method: 'GET', url: subUrl });
        assert.equal(afterHideRes.statusCode, 200);
        const afterHideLines = afterHideRes.text.trim().split(/\r?\n/).filter(Boolean);
        assert.equal(afterHideLines.length, 1);

        // Batch hide both -> no links delivered; batch show both -> 2 links restored
        const batchHide = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/visibility',
            headers: { Authorization: makeAuthHeader(operatorUser) },
            body: {
                targets: [
                    { serverId: srvV4.id, inboundId: 1 },
                    { serverId: srvV6.id, inboundId: 1 },
                ],
                hidden: true,
            },
        });
        assert.equal(batchHide.statusCode, 200);
        assert.equal(batchHide.json?.obj?.updated?.length, 2);

        const allHiddenSub = await invokeApp(app, { method: 'GET', url: subUrl });
        assert.notEqual(allHiddenSub.statusCode, 200);

        const batchShow = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/visibility',
            headers: { Authorization: makeAuthHeader(operatorUser) },
            body: {
                targets: [
                    { serverId: srvV4.id, inboundId: 1 },
                    { serverId: srvV6.id, inboundId: 1 },
                ],
                hidden: false,
            },
        });
        assert.equal(batchShow.statusCode, 200);

        const restoredRes = await invokeApp(app, { method: 'GET', url: subUrl });
        assert.equal(restoredRes.statusCode, 200);
        assert.equal(restoredRes.text.trim().split(/\r?\n/).filter(Boolean).length, 2);
    });

    it('applies distinct NMS local remarks to dual-stack entries backed by the same 3x-ui panel across snapshots, proxy, gateway, and subscriptions without mutating upstream panel', async () => {
        const authHeader = makeAuthHeader(adminUser);

        const putV4 = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/remarks',
            headers: { Authorization: authHeader },
            body: { serverId: srvV4.id, inboundId: 1, remark: '香港-IPv4' },
        });
        assert.equal(putV4.statusCode, 200);

        const putV6 = await invokeApp(app, {
            method: 'PUT',
            url: '/api/system/inbounds/remarks',
            headers: { Authorization: authHeader },
            body: { serverId: srvV6.id, inboundId: 1, remark: '香港-IPv6' },
        });
        assert.equal(putV6.statusCode, 200);

        // Snapshots preserve panelRemark='shared-3xui' and expose local remarks
        const [snapV4, snapV6] = await Promise.all([
            getServerPanelSnapshot(srvV4, { force: true }),
            getServerPanelSnapshot(srvV6, { force: true }),
        ]);
        assert.equal(snapV4.inbounds[0].remark, '香港-IPv4');
        assert.equal(snapV4.inbounds[0].panelRemark, 'shared-3xui');
        assert.equal(snapV4.inbounds[0].hasCustomRemark, true);
        assert.equal(snapV6.inbounds[0].remark, '香港-IPv6');
        assert.equal(snapV6.inbounds[0].panelRemark, 'shared-3xui');
        assert.equal(snapV6.inbounds[0].hasCustomRemark, true);

        // PanelGateway listPanelInbounds
        const gwV4 = await listPanelInbounds(srvV4.id);
        const gwV6 = await listPanelInbounds(srvV6.id);
        assert.equal(gwV4.inbounds[0].remark, '香港-IPv4');
        assert.equal(gwV6.inbounds[0].remark, '香港-IPv6');

        // Proxy routes (/list and /get/:id)
        const proxyListV4 = await invokeApp(app, {
            method: 'GET',
            url: `/api/panel/${srvV4.id}/panel/api/inbounds/list`,
            headers: { Authorization: authHeader },
        });
        const proxyGetV6 = await invokeApp(app, {
            method: 'GET',
            url: `/api/panel/${srvV6.id}/panel/api/inbounds/get/1`,
            headers: { Authorization: authHeader },
        });
        assert.equal(proxyListV4.statusCode, 200);
        assert.equal(proxyListV4.json?.obj?.[0]?.remark, '香港-IPv4');
        assert.equal(proxyListV4.json?.obj?.[0]?.panelRemark, 'shared-3xui');
        assert.equal(proxyGetV6.statusCode, 200);
        assert.equal(proxyGetV6.json?.obj?.remark, '香港-IPv6');
        assert.equal(proxyGetV6.json?.obj?.panelRemark, 'shared-3xui');

        // Subscription output emits separate #labels for IPv4 & IPv6 entries
        const secret = subToken.token.split('.')[1];
        const rawSubRes = await invokeApp(app, {
            method: 'GET',
            url: `/api/subscriptions/public/t/${encodeURIComponent(subToken.publicTokenId)}/${encodeURIComponent(secret)}?format=raw`,
        });
        assert.equal(rawSubRes.statusCode, 200);
        const rawLines = rawSubRes.text.trim().split(/\r?\n/).filter(Boolean);
        assert.equal(rawLines.length, 2);
        assert.ok(rawLines.some((line) => line.includes(`#${encodeURIComponent('香港-IPv4')}`)));
        assert.ok(rawLines.some((line) => line.includes(`#${encodeURIComponent('香港-IPv6')}`)));

        // Upstream panel remark was never altered
        assert.equal(panelInbound.remark, 'shared-3xui');
        assert.equal(panelUpdates.length, 0);
    });

    it('never syncs local NMS remarks back to the upstream panel during batch disable/update and cleans up on server delete', async () => {
        const authHeader = makeAuthHeader(adminUser);
        panelUpdates.length = 0;

        // Issue risk token for sensitive disable action
        const riskRes = await invokeApp(app, {
            method: 'POST',
            url: '/api/system/batch-risk-token',
            headers: { Authorization: authHeader },
            body: { type: 'inbounds', action: 'disable', targetCount: 1 },
        });
        assert.equal(riskRes.statusCode, 200);
        const confirmToken = riskRes.json?.obj?.token || '';

        // Batch disable sending customized target remark -> upstream remark must stay 'shared-3xui'
        const disableRes = await invokeApp(app, {
            method: 'POST',
            url: '/api/batch/inbounds',
            headers: { Authorization: authHeader },
            body: {
                action: 'disable',
                confirmToken,
                targets: [
                    {
                        serverId: srvV4.id,
                        serverName: srvV4.name,
                        id: 1,
                        remark: '香港-IPv4',
                        protocol: 'vless',
                        port: 443,
                    },
                ],
            },
        });
        assert.equal(disableRes.statusCode, 200);
        assert.equal(disableRes.json?.obj?.summary?.success, 1);
        assert.equal(panelInbound.remark, 'shared-3xui');
        for (const call of panelUpdates) {
            if (call.body?.remark !== undefined) {
                assert.equal(call.body.remark, 'shared-3xui');
            }
        }

        // Batch update with payload.remark updates local NMS override, leaving upstream 'shared-3xui' untouched
        panelUpdates.length = 0;
        const updateRes = await invokeApp(app, {
            method: 'POST',
            url: '/api/batch/inbounds',
            headers: { Authorization: authHeader },
            body: {
                action: 'update',
                targets: [
                    {
                        serverId: srvV4.id,
                        serverName: srvV4.name,
                        id: 1,
                    },
                ],
                payload: {
                    remark: '香港-IPv4-专线',
                },
            },
        });
        assert.equal(updateRes.statusCode, 200);
        assert.equal(updateRes.json?.obj?.summary?.success, 1);
        assert.equal(panelInbound.remark, 'shared-3xui');
        assert.equal(panelUpdates.length, 1);
        assert.equal(panelUpdates[0].body?.remark, 'shared-3xui');
        assert.equal(systemSettingsStore.getInboundRemark(srvV4.id, 1), '香港-IPv4-专线');
        assert.equal(systemSettingsStore.getInboundRemark(srvV6.id, 1), '香港-IPv6');

        // Delete srvV4 clears only srvV4 local remarks
        const deleteRes = await invokeApp(app, {
            method: 'DELETE',
            url: `/api/servers/${srvV4.id}`,
            headers: { Authorization: authHeader },
        });
        assert.equal(deleteRes.statusCode, 200);
        assert.equal(systemSettingsStore.getInboundRemark(srvV4.id, 1), '');
        assert.equal(systemSettingsStore.getInboundRemark(srvV6.id, 1), '香港-IPv6');
        srvV4 = null;
    });
});
