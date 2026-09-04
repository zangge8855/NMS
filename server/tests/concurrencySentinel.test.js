import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepClusterConcurrency, kickUserSessions } from '../services/concurrencySentinel.js';

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
