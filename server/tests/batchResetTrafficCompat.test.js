import test from 'node:test';
import assert from 'node:assert/strict';
import { resetInboundTrafficCompat } from '../routes/batch.js';

test('resetInboundTrafficCompat uses the current 3x-ui endpoint first', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            return { data: { success: true } };
        },
    };

    await resetInboundTrafficCompat(client, 7);

    assert.deepEqual(calls, [
        '/panel/api/inbounds/resetAllClientTraffics/7',
    ]);
});

test('resetInboundTrafficCompat falls back to the legacy endpoint on 404', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/inbounds/resetAllClientTraffics/9') {
                const error = new Error('Not found');
                error.response = { status: 404 };
                throw error;
            }
            return { data: { success: true } };
        },
    };

    await resetInboundTrafficCompat(client, 9);

    assert.deepEqual(calls, [
        '/panel/api/inbounds/resetAllClientTraffics/9',
        '/panel/api/inbounds/resetTraffic/9',
    ]);
});
