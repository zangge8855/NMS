import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichClientIpPayload } from '../lib/clientIpEnrichment.js';

function makeResolver(prefix, enabled = true) {
    return {
        configure() {},
        isEnabled: () => enabled,
        lookupMany: async (ips) => new Map(ips.map((ip) => [ip, `${prefix}:${ip}`])),
        pickFromMap: (map, ip) => map.get(ip) || '',
        metadata: () => ({}),
    };
}

const deps = {
    systemSettingsStore: { getAuditIpGeo: () => ({ enabled: true }) },
    ipGeoResolver: makeResolver('geo'),
    ipIspResolver: makeResolver('isp'),
};

test('enriches string client IP rows with location and carrier', async () => {
    const result = await enrichClientIpPayload(['198.51.100.10'], deps);
    assert.deepEqual(result, [{
        ip: '198.51.100.10',
        ipLocation: 'geo:198.51.100.10',
        ipCarrier: 'isp:198.51.100.10',
    }]);
});

test('preserves client IP row metadata while adding geo labels', async () => {
    const result = await enrichClientIpPayload({
        items: [{ ip: '203.0.113.8', count: 2, note: 'panel' }],
    }, deps);
    assert.equal(result.items[0].count, 2);
    assert.equal(result.items[0].note, 'panel');
    assert.equal(result.items[0].ipLocation, 'geo:203.0.113.8');
    assert.equal(result.items[0].ipCarrier, 'isp:203.0.113.8');
});
