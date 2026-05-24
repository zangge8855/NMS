import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientAdjustPatch, resetInboundTrafficCompat } from '../routes/batch.js';

test('resetInboundTrafficCompat uses the current 3x-ui endpoint first', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(['post', path]);
            return { data: { success: true } };
        },
        async get(path) {
            calls.push(['get', path]);
            return { data: { obj: { settings: JSON.stringify({ clients: [] }) } } };
        },
    };

    await resetInboundTrafficCompat(client, 7);

    assert.deepEqual(calls, [
        ['post', '/panel/api/inbounds/7/resetTraffic'],
        ['get', '/panel/api/inbounds/get/7'],
    ]);
});

test('resetInboundTrafficCompat falls back to the legacy endpoint on 404', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(['post', path]);
            if (path === '/panel/api/inbounds/9/resetTraffic') {
                const error = new Error('Not found');
                error.response = { status: 404 };
                throw error;
            }
            return { data: { success: true } };
        },
    };

    await resetInboundTrafficCompat(client, 9);

    assert.deepEqual(calls, [
        ['post', '/panel/api/inbounds/9/resetTraffic'],
        ['post', '/panel/api/inbounds/resetAllClientTraffics/9'],
    ]);
});

test('buildClientAdjustPatch extends expiry from the later of current expiry or now and preserves depleted guards', () => {
    const now = Date.now();
    const source = {
        email: 'alice@example.com',
        expiryTime: now - 60_000,
        totalGB: 10 * 1024,
        up: 1024,
        down: 1024,
    };

    const adjusted = buildClientAdjustPatch(source, {
        addDays: 1,
        addBytes: 1024,
    });

    assert.equal(adjusted.changed, true);
    assert.ok(adjusted.client.expiryTime > now);
    assert.equal(adjusted.client.totalGB, 11 * 1024);
});

test('buildClientAdjustPatch skips unlimited fields instead of making destructive changes', () => {
    const adjusted = buildClientAdjustPatch({
        expiryTime: 0,
        totalGB: 0,
    }, {
        addDays: 30,
        addBytes: -1024,
    });

    assert.equal(adjusted.changed, false);
    assert.deepEqual(adjusted.notes, [
        'unlimited expiry skipped',
        'unlimited traffic skipped',
    ]);
});
