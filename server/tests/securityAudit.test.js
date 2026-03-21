import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import auditStore from '../store/auditStore.js';
import {
    __resetRecentSecurityEventsForTests,
    appendSecurityAudit,
} from '../lib/securityAudit.js';
import notificationService from '../lib/notifications.js';
import ipGeoResolver from '../lib/ipGeoResolver.js';
import ipIspResolver from '../lib/ipIspResolver.js';

test('appendSecurityAudit forwards explicit outcome to audit store', (t) => {
    __resetRecentSecurityEventsForTests();
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

test('appendSecurityAudit escalates rate-limited login events into notifications', async (t) => {
    __resetRecentSecurityEventsForTests();
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'appendFileSync', () => {});
    t.mock.method(auditStore, 'queryEvents', () => {
        throw new Error('ring buffer path should not query audit history');
    });
    t.mock.method(auditStore, 'appendEvent', () => ({
        eventType: 'login_rate_limited',
        actor: 'anonymous',
        ip: '203.0.113.8',
        path: '/api/auth/login',
        details: {
            username: 'alice',
        },
    }));
    t.mock.method(ipGeoResolver, 'lookupMany', async () => new Map([['203.0.113.8', '中国 浙江 杭州']]));
    t.mock.method(ipGeoResolver, 'pickFromMap', (map, ip) => map.get(ip) || '');
    t.mock.method(ipIspResolver, 'lookupMany', async () => new Map([['203.0.113.8', '中国电信']]));
    t.mock.method(ipIspResolver, 'pickFromMap', (map, ip) => map.get(ip) || '');
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

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(notificationMock.mock.calls.length, 1);
    const [payload] = notificationMock.mock.calls[0].arguments;
    assert.equal(payload.type, 'security_attack_login_rate_limited');
    assert.equal(payload.severity, 'critical');
    assert.equal(payload.meta.ipLocation, '中国 浙江 杭州');
    assert.equal(payload.meta.ipCarrier, '中国电信');
});

test('appendSecurityAudit marks repeated login failures as suspected brute force', async (t) => {
    __resetRecentSecurityEventsForTests();
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'appendFileSync', () => {});
    t.mock.method(auditStore, 'queryEvents', () => ({
        items: Array.from({ length: 8 }, (_, index) => ({
            id: `event-${index}`,
            ts: new Date(Date.now() - 30_000).toISOString(),
            eventType: index < 7 ? 'login_failed' : 'login_rate_limited',
            ip: '203.0.113.11',
            details: {
                username: index % 2 === 0 ? 'alice' : 'bob',
            },
        })),
    }));
    t.mock.method(auditStore, 'appendEvent', () => ({
        eventType: 'login_failed',
        actor: 'anonymous',
        ip: '203.0.113.11',
        path: '/api/auth/login',
        details: {
            username: 'alice',
        },
    }));
    t.mock.method(ipGeoResolver, 'lookupMany', async () => new Map([['203.0.113.11', '中国 北京']]));
    t.mock.method(ipGeoResolver, 'pickFromMap', (map, ip) => map.get(ip) || '');
    t.mock.method(ipIspResolver, 'lookupMany', async () => new Map([['203.0.113.11', '中国联通']]));
    t.mock.method(ipIspResolver, 'pickFromMap', (map, ip) => map.get(ip) || '');
    const notificationMock = t.mock.method(notificationService, 'notify', () => ({}));

    appendSecurityAudit(
        'login_failed',
        {
            user: null,
            method: 'POST',
            originalUrl: '/api/auth/login',
            headers: {},
            socket: { remoteAddress: '203.0.113.11' },
        },
        { username: 'alice' },
        { outcome: 'failed' }
    );

    await new Promise((resolve) => setImmediate(resolve));
    const [payload] = notificationMock.mock.calls[0].arguments;
    assert.equal(payload.severity, 'critical');
    assert.equal(payload.title, '疑似登录爆破');
    assert.equal(payload.meta.recentAttempts, 8);
    assert.equal(payload.meta.distinctTargets, 2);
    assert.equal(payload.meta.suspectedBruteforce, true);
    assert.equal(payload.meta.rateLimited, true);
});
