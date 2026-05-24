import test from 'node:test';
import assert from 'node:assert/strict';
import { resetInboundTrafficCompat } from '../routes/batch.js';

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
