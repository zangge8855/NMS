import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    issueSubscriptionToken,
    querySubscriptionAccess,
    revokeSubscriptionTokens,
} from '../services/subscriptionAuditService.js';

describe('subscriptionAuditService', () => {
    it('issues token payload with derived urls', () => {
        const result = issueSubscriptionToken('user@example.com', {
            name: 'smoke',
            ttlDays: 30,
            createdBy: 'admin',
            buildUrls: () => ({ subscriptionUrl: 'https://example.com/sub' }),
        }, {
            subscriptionTokenRepository: {
                issue: (email, options) => ({
                    tokenId: 'tid-1',
                    token: 'secret-token',
                    metadata: {
                        id: 'tid-1',
                        email,
                        name: options.name,
                    },
                }),
            },
        });

        assert.equal(result.email, 'user@example.com');
        assert.equal(result.tokenId, 'tid-1');
        assert.equal(result.urls.subscriptionUrl, 'https://example.com/sub');
    });

    it('reuses clientIp for geo enrichment', async () => {
        const payload = await querySubscriptionAccess({ page: 1 }, { includeGeo: true }, {
            auditRepository: {
                querySubscriptionAccess: () => ({
                    items: [{ clientIp: '203.0.113.9', ip: '198.51.100.1' }],
                    topIps: [{ ip: '203.0.113.9', count: 1 }],
                }),
            },
            systemSettingsRepository: {
                getAuditIpGeo: () => ({ enabled: true }),
            },
            ipGeoResolver: {
                configure() {},
                isEnabled() { return true; },
                async lookupMany(values) { return new Map(values.map((item) => [item, `geo:${item}`])); },
                pickFromMap(map, ip) { return map.get(ip) || ''; },
                metadata() { return { provider: 'fake' }; },
            },
        });

        assert.equal(payload.items[0].ipLocation, 'geo:203.0.113.9');
        assert.equal(payload.topIps[0].ipLocation, 'geo:203.0.113.9');
        assert.equal(payload.geo.enabled, true);
    });

    it('rejects single-token revoke when token id is missing', () => {
        assert.throws(
            () => revokeSubscriptionTokens('user@example.com', { revokeAll: false }, {
                subscriptionTokenRepository: {},
            }),
            /tokenId is required/
        );
    });
});
