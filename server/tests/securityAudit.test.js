import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import auditStore from '../store/auditStore.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import notificationService from '../lib/notifications.js';

test('appendSecurityAudit forwards explicit outcome to audit store', (t) => {
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'appendFileSync', () => {});
    const appendEventMock = t.mock.method(auditStore, 'appendEvent', () => {});
    const notificationMock = t.mock.method(notificationService, 'notify', () => null);

    appendSecurityAudit(
        'invite_code_revoked',
        {
            user: { username: 'admin', role: 'admin' },
            method: 'DELETE',
            originalUrl: '/api/system/invite-codes/invite-1',
            headers: {},
            socket: { remoteAddress: '127.0.0.1' },
        },
        { inviteId: 'invite-1', preview: 'ABCD-****-WXYZ' },
        { outcome: 'success' }
    );

    assert.equal(appendEventMock.mock.calls.length, 1);
    const [payload] = appendEventMock.mock.calls[0].arguments;
    assert.equal(payload.event, 'invite_code_revoked');
    assert.equal(payload.outcome, 'success');
    assert.equal(notificationMock.mock.calls.length, 0);
});

test('appendSecurityAudit escalates rate-limited login events into notifications', (t) => {
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'appendFileSync', () => {});
    t.mock.method(auditStore, 'appendEvent', () => ({
        eventType: 'login_rate_limited',
        actor: 'anonymous',
        ip: '203.0.113.8',
        path: '/api/auth/login',
        details: {
            username: 'alice',
        },
    }));
    const notificationMock = t.mock.method(notificationService, 'notify', () => ({}));

    appendSecurityAudit(
        'login_rate_limited',
        {
            user: null,
            method: 'POST',
            originalUrl: '/api/auth/login',
            headers: {},
            socket: { remoteAddress: '203.0.113.8' },
        },
        { username: 'alice' },
        { outcome: 'failed' }
    );

    assert.equal(notificationMock.mock.calls.length, 1);
    const [payload] = notificationMock.mock.calls[0].arguments;
    assert.equal(payload.type, 'security_attack_login_rate_limited');
    assert.equal(payload.severity, 'critical');
});
