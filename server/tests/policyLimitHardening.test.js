import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

process.env.DATA_DIR = process.env.DATA_DIR || path.join('/tmp', 'nms-policy-limit-hardening-test');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-policy-limit-tests';

const { normalizeGroupPayload, parseNonNegativeInt } = await import('../routes/userGroups.js');
const { parseRequestLimit } = await import('../routes/userPolicy.js');
const { default: subscriptionTokenStore } = await import('../store/subscriptionTokenStore.js');
const { evictServerDashboardCaches } = await import('../lib/dashboardSnapshotService.js');
const { evictServerStatusCaches } = await import('../lib/serverStatusService.js');

describe('user group / policy numeric limit hardening', () => {
    it('treats absent or empty limits as 0 (unlimited)', () => {
        assert.equal(parseNonNegativeInt(undefined, 'limitIp'), 0);
        assert.equal(parseNonNegativeInt(null, 'limitIp'), 0);
        assert.equal(parseNonNegativeInt('', 'limitIp'), 0);
        assert.equal(parseRequestLimit('', 'limitIp'), 0);
    });

    it('accepts and floors valid non-negative numbers', () => {
        assert.equal(parseNonNegativeInt('42', 'limitIp'), 42);
        assert.equal(parseNonNegativeInt(7.9, 'limitIp'), 7);
        assert.equal(parseRequestLimit('1024', 'trafficLimitBytes'), 1024);
    });

    it('rejects garbage instead of silently granting an unlimited policy', () => {
        for (const bad of ['abc', '12x', NaN, -1, Infinity]) {
            assert.throws(() => parseNonNegativeInt(bad, 'limitIp'), (error) => error?.status === 400);
            assert.throws(() => parseRequestLimit(bad, 'limitIp'), (error) => error?.status === 400);
        }
    });

    it('rejects garbage numeric fields inside the group payload', () => {
        assert.throws(
            () => normalizeGroupPayload({ name: 'g', trafficLimitBytes: 'lots' }),
            (error) => error?.status === 400
        );
        const ok = normalizeGroupPayload({ name: 'g', trafficLimitBytes: '2048', limitIp: '' });
        assert.equal(ok.trafficLimitBytes, 2048);
        assert.equal(ok.limitIp, 0);
    });
});

describe('subscription token TTL hardening', () => {
    it('never mints a permanent token from ttlDays<=0 without the explicit flag', () => {
        const issued = subscriptionTokenStore.issue('ttl-hardening@example.com', {
            ttlDays: 0,
            ignoreActiveLimit: true,
        });
        try {
            assert.ok(issued.metadata.expiresAt, 'ttlDays:0 must fall back to the default TTL');
        } finally {
            subscriptionTokenStore.revoke('ttl-hardening@example.com', issued.tokenId);
        }
    });

    it('still honours the explicit noExpiry flag', () => {
        const issued = subscriptionTokenStore.issue('ttl-hardening@example.com', {
            noExpiry: true,
            ignoreActiveLimit: true,
        });
        try {
            assert.equal(issued.metadata.expiresAt, null);
        } finally {
            subscriptionTokenStore.revoke('ttl-hardening@example.com', issued.tokenId);
        }
    });
});

describe('per-server cache eviction hooks', () => {
    it('are safe on unknown or empty server ids', () => {
        assert.equal(evictServerDashboardCaches(''), false);
        assert.equal(evictServerDashboardCaches('missing-server'), false);
        assert.equal(evictServerStatusCaches(''), false);
        assert.equal(evictServerStatusCaches('missing-server'), false);
    });
});
