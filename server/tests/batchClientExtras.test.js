import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClientData, pickPanelClientExtras, setInboundEnableCompat } from '../routes/batch.js';

test('client normalization keeps panel extras only when they were sent', () => {
    const plain = normalizeClientData({ email: 'a@x', id: '11111111-1111-4111-8111-111111111111' }, '', { protocol: 'vless' });
    for (const key of ['group', 'resetDay', 'resetWeekday', 'resetMax', 'trafficReset', 'trafficResetDay']) {
        assert.equal(Object.prototype.hasOwnProperty.call(plain, key), false, `${key} is left out for older panels`);
    }

    const full = normalizeClientData({
        email: 'b@x',
        id: '22222222-2222-4222-8222-222222222222',
        group: ' vip ',
        resetDay: 15,
        resetWeekday: 0,
        resetMax: 3,
        trafficReset: 'Monthly',
        trafficResetDay: 10,
    }, '', { protocol: 'vless' });
    assert.equal(full.group, 'vip');
    assert.equal(full.resetDay, 15);
    assert.equal(full.resetWeekday, 0);
    assert.equal(full.resetMax, 3);
    assert.equal(full.trafficReset, 'monthly');
    assert.equal(full.trafficResetDay, 10);
});

test('panel extras are clamped to the ranges 3x-ui accepts', () => {
    assert.deepEqual(pickPanelClientExtras({
        resetDay: 40,
        resetWeekday: -2,
        resetMax: 'x',
        trafficReset: 'yearly',
        trafficResetDay: 0,
    }), {
        resetDay: 31,
        resetWeekday: 0,
        resetMax: 0,
        trafficReset: 'never',
        trafficResetDay: 1,
    });
    assert.deepEqual(pickPanelClientExtras({ group: null, resetDay: undefined }), {});
});

test('inbound enable uses setEnable first and falls back to update on old panels', async () => {
    const calls = [];
    const modern = {
        async post(path, body) {
            calls.push([path, body]);
            return { data: { success: true } };
        },
    };
    await setInboundEnableCompat(modern, 3, false, { id: 3, enable: false });
    assert.deepEqual(calls, [['/panel/api/inbounds/setEnable/3', 'enable=false']]);

    calls.length = 0;
    const legacy = {
        async post(path, body) {
            calls.push(path);
            if (path.includes('setEnable')) {
                const error = new Error('not found');
                error.response = { status: 404, data: {} };
                throw error;
            }
            return { data: { success: true } };
        },
    };
    await setInboundEnableCompat(legacy, 3, true, { id: 3, enable: true });
    assert.deepEqual(calls, ['/panel/api/inbounds/setEnable/3', '/panel/api/inbounds/update/3']);

    const failing = {
        async post() {
            return { data: { success: false, msg: 'inbound locked' } };
        },
    };
    await assert.rejects(() => setInboundEnableCompat(failing, 3, true, {}), /inbound locked/);
});
