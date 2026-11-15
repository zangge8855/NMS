import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { invokeApp } from './helpers/invokeApp.js';

const {
    evaluateProxyAccess,
    isAdminOnlyProxyRequest,
    isMutatingProxyRequest,
} = await import('../lib/proxyAccessPolicy.js');
const { default: app } = await import('../index.js');
const { default: config } = await import('../config.js');
const { default: userStore, ROLES } = await import('../store/userStore.js');

const ADMIN_ONLY = [
    ['GET', '/panel/api/setting/apiTokens'],
    ['POST', '/panel/api/setting/apiTokens/delete/1'],
    ['POST', '/panel/api/setting/update'],
    ['POST', '/panel/api/setting/updateUser'],
    ['GET', '/panel/api/server/database/export'],
    ['POST', '/panel/api/server/database/import'],
    ['GET', '/panel/api/server/getDb'],
    ['POST', '/panel/api/server/importDB'],
    ['GET', '/sui/tokens'],
    ['POST', '/sui/addToken'],
    ['POST', '/sui/deleteToken'],
    ['GET', '/sui/users'],
    ['GET', '/sui/sessions'],
    ['POST', '/sui/closeSessions'],
    ['GET', '/sui/settings'],
    ['GET', '/sui/load'],
    ['GET', '/sui/getdb'],
    ['POST', '/sui/importdb'],
];

const OPERATOR_ALLOWED = [
    ['GET', '/panel/api/inbounds/list'],
    ['POST', '/panel/api/inbounds/add'],
    ['POST', '/panel/api/inbounds/update/3'],
    ['POST', '/panel/api/inbounds/del/3'],
    ['POST', '/panel/api/inbounds/addClient'],
    ['POST', '/panel/api/clients/clearIps/a@example.com'],
    ['POST', '/panel/api/server/restartXray'],
    ['POST', '/panel/api/server/installXray/v25.1.1'],
    ['POST', '/sui/save'],
    ['POST', '/sui/restartSb'],
    ['GET', '/sub/abc123'],
];

const AUDITOR_ALLOWED = [
    ['GET', '/panel/api/inbounds/list'],
    ['GET', '/panel/api/inbounds/get/3'],
    ['GET', '/panel/api/clients/list'],
    ['GET', '/panel/api/server/status'],
    ['GET', '/panel/api/server/getXrayVersion'],
    ['GET', '/panel/api/server/getNewUUID'],
    ['POST', '/panel/api/server/getNewEchCert'],
    ['POST', '/panel/api/inbounds/onlines'],
    ['POST', '/panel/api/clients/ips/a@example.com'],
    ['POST', '/panel/api/server/logs/20'],
    ['POST', '/panel/api/inbounds/getClientTraffics/a@example.com'],
    ['GET', '/sui/inbounds'],
    ['GET', '/sui/tls'],
    ['GET', '/sui/outbounds'],
];

const AUDITOR_DENIED = [
    ...ADMIN_ONLY,
    ['POST', '/panel/api/inbounds/add'],
    ['POST', '/panel/api/inbounds/del/3'],
    ['POST', '/panel/api/clients/clearIps/a@example.com'],
    ['POST', '/panel/api/server/restartXray'],
    ['GET', '/panel/api/server/getConfigJson'],
    ['GET', '/panel/api/some/new/endpoint'],
    ['DELETE', '/panel/api/inbounds/list'],
    ['GET', '/sub/abc123'],
    ['GET', '/sui/checkOutbound'],
    ['POST', '/sui/save'],
];

test('proxy policy: admins reach every endpoint', () => {
    for (const [method, path] of [...ADMIN_ONLY, ...OPERATOR_ALLOWED, ...AUDITOR_ALLOWED]) {
        assert.equal(evaluateProxyAccess('admin', method, path).allowed, true, `admin ${method} ${path}`);
    }
});

test('proxy policy: operators manage nodes but not the panel administration surface', () => {
    for (const [method, path] of ADMIN_ONLY) {
        const decision = evaluateProxyAccess('operator', method, path);
        assert.equal(decision.allowed, false, `operator ${method} ${path}`);
        assert.equal(decision.reason, 'admin_only_endpoint');
    }
    for (const [method, path] of OPERATOR_ALLOWED) {
        assert.equal(evaluateProxyAccess('operator', method, path).allowed, true, `operator ${method} ${path}`);
    }
    assert.equal(evaluateProxyAccess('operator', 'POST', '/sui/save', { object: 'settings' }).allowed, false);
    assert.equal(evaluateProxyAccess('operator', 'POST', '/sui/save', { object: 'Settings ' }).allowed, false);
    assert.equal(evaluateProxyAccess('operator', 'POST', '/sui/save', { object: 'clients' }).allowed, true);
});

test('proxy policy: auditors only reach allow-listed read-only queries', () => {
    for (const [method, path] of AUDITOR_ALLOWED) {
        assert.equal(evaluateProxyAccess('auditor', method, path).allowed, true, `auditor ${method} ${path}`);
    }
    for (const [method, path] of AUDITOR_DENIED) {
        assert.equal(evaluateProxyAccess('auditor', method, path).allowed, false, `auditor ${method} ${path}`);
    }
});

test('proxy policy: other roles are denied', () => {
    for (const role of ['user', 'guest', '', undefined, 'superadmin']) {
        const decision = evaluateProxyAccess(role, 'GET', '/panel/api/inbounds/list');
        assert.equal(decision.allowed, false, `role ${String(role)}`);
        assert.equal(decision.reason, 'role_not_permitted');
    }
});

test('proxy policy: key generators and read queries do not count as mutations', () => {
    assert.equal(isMutatingProxyRequest('POST', '/panel/api/server/getNewEchCert'), false);
    assert.equal(isMutatingProxyRequest('POST', '/panel/api/inbounds/onlines'), false);
    assert.equal(isMutatingProxyRequest('POST', '/panel/api/inbounds/add'), true);
    assert.equal(isMutatingProxyRequest('DELETE', '/panel/api/inbounds/list'), true);
    assert.equal(isMutatingProxyRequest('GET', '/panel/api/inbounds/list'), false);
    assert.equal(isAdminOnlyProxyRequest('/panel/api/settings-preview'), false);
});

function makeAuthHeader(user) {
    const token = jwt.sign(
        { userId: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion || 1 },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
    return `Bearer ${token}`;
}

test('proxy route enforces the policy before contacting the panel', async () => {
    const stamp = Date.now();
    const operator = userStore.add({ username: `op_rbac_${stamp}`, password: 'OpRbac#12345', role: ROLES.operator });
    const auditor = userStore.add({ username: `aud_rbac_${stamp}`, password: 'AudRbac#12345', role: ROLES.auditor });

    const operatorDenied = await invokeApp(app, {
        method: 'GET',
        url: '/api/panel/srv-1/panel/api/setting/apiTokens',
        headers: { Authorization: makeAuthHeader(operator), 'Accept-Language': 'en-US' },
    });
    assert.equal(operatorDenied.statusCode, 403);
    assert.match(String(operatorDenied.json?.msg || ''), /restricted to administrators/);

    const encodedBypass = await invokeApp(app, {
        method: 'GET',
        url: '/api/panel/srv-1/panel/api/%73etting/apiTokens',
        headers: { Authorization: makeAuthHeader(operator) },
    });
    assert.equal(encodedBypass.statusCode, 403);

    const operatorSettingsSave = await invokeApp(app, {
        method: 'POST',
        url: '/api/panel/srv-1/sui/save',
        headers: { Authorization: makeAuthHeader(operator), 'Content-Type': 'application/json' },
        body: { object: 'settings', action: 'set', data: '{}' },
    });
    assert.equal(operatorSettingsSave.statusCode, 403);

    const auditorWrite = await invokeApp(app, {
        method: 'POST',
        url: '/api/panel/srv-1/panel/api/inbounds/del/1',
        headers: { Authorization: makeAuthHeader(auditor), 'Accept-Language': 'zh-CN' },
    });
    assert.equal(auditorWrite.statusCode, 403);
    assert.match(String(auditorWrite.json?.msg || ''), /审计员角色仅限只读查询/);
});
