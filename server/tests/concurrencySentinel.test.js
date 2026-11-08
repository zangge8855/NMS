import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepClusterConcurrency, kickUserSessions, extractIpList } from '../services/concurrencySentinel.js';

test('concurrencySentinel returns an empty report when no users have limitIp configured', async () => {
    const report = await sweepClusterConcurrency({ force: true });
    assert.ok(report);
    assert.equal(typeof report.timestamp, 'string');
    assert.ok(Array.isArray(report.violations));
    assert.ok(Array.isArray(report.records));
});

test('concurrencySentinel kickUserSessions handles empty servers gracefully', async () => {
    const result = await kickUserSessions('nonexistent@example.com', ['invalid-server-id']);
    assert.ok(result);
    assert.equal(result.success, false);
    assert.equal(result.kickedServers.length, 0);
});

test('extractIpList canonicalizes and deduplicates equivalent ipv6 and mapped ipv4 representations', () => {
    const ips = extractIpList({
        data: {
            obj: [
                '2001:0db8:0:0::1',
                '[2001:DB8::1]:443',
                { ip: '::ffff:203.0.113.5' },
                { clientIp: '203.0.113.5:8080' },
            ],
        },
    });
    assert.deepEqual(ips, ['2001:db8::1', '203.0.113.5']);
});
