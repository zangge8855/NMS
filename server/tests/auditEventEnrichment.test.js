import test from 'node:test';
import assert from 'node:assert/strict';
import {
    enrichAuditEvent,
    enrichAuditEvents,
    normalizeAuditIp,
    normalizeAuditUserAgent,
} from '../lib/auditEventEnrichment.js';

test('normalizeAuditIp hides masked audit IP values', () => {
    assert.equal(normalizeAuditIp('ip_1b2b75909e944f4e'), '');
    assert.equal(normalizeAuditIp('203.0.113.8'), '203.0.113.8');
});

test('normalizeAuditUserAgent hides masked audit user agent values', () => {
    assert.equal(normalizeAuditUserAgent('ua_1234567890abcdef'), '');
    assert.equal(normalizeAuditUserAgent('Mozilla/5.0'), 'Mozilla/5.0');
});

test('enrichAuditEvents attaches geo and carrier metadata for real IPs', async () => {
    const items = await enrichAuditEvents([
        {
            id: 'audit-1',
            ip: '203.0.113.8',
            details: {
                userAgent: 'Mozilla/5.0',
            },
        },
        {
            id: 'audit-2',
            ip: 'ip_1b2b75909e944f4e',
            details: {
                userAgent: 'ua_1234567890abcdef',
            },
        },
    ], {
        systemSettingsRepository: {
            getAuditIpGeo() {
                return { enabled: true };
            },
        },
        ipGeoResolver: {
            configure() {},
            isEnabled() { return true; },
            async lookupMany(values) {
                return new Map(values.map((value) => [value, value === '203.0.113.8' ? '中国 浙江 杭州' : '']));
            },
            pickFromMap(map, ip) {
                return map.get(ip) || '';
            },
        },
        ipIspResolver: {
            configure() {},
            isEnabled() { return true; },
            async lookupMany(values) {
                return new Map(values.map((value) => [value, value === '203.0.113.8' ? '中国电信' : '']));
            },
            pickFromMap(map, ip) {
                return map.get(ip) || '';
            },
        },
    });

    assert.equal(items[0].ip, '203.0.113.8');
    assert.equal(items[0].ipLocation, '中国 浙江 杭州');
    assert.equal(items[0].ipCarrier, '中国电信');
    assert.equal(items[0].userAgent, 'Mozilla/5.0');
    assert.equal(items[1].ip, '');
    assert.equal(items[1].ipMasked, true);
    assert.equal(items[1].userAgent, '');
    assert.equal(items[1].userAgentMasked, true);
});

test('enrichAuditEvent returns null for invalid input', async () => {
    assert.equal(await enrichAuditEvent(null), null);
});
