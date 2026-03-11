import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, '.system_settings_test_data');

function cleanTestData() {
    if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
}

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = 'test';

describe('SystemSettingsStore ordering', { concurrency: false }, () => {
    let systemSettingsStore;

    before(async () => {
        cleanTestData();
        const module = await import('../store/systemSettingsStore.js');
        systemSettingsStore = module.default;
        systemSettingsStore.settings = systemSettingsStore._normalizeSettings({});
        systemSettingsStore._save();
    });

    after(() => {
        cleanTestData();
    });

    it('persists and returns user order arrays', () => {
        const order = systemSettingsStore.setUserOrder([' user-b ', 'user-a', 'user-b']);
        assert.deepEqual(order, ['user-b', 'user-a']);
        assert.deepEqual(systemSettingsStore.getUserOrder(), ['user-b', 'user-a']);
    });

    it('persists inbound order without losing user order', () => {
        const inboundOrder = systemSettingsStore.setInboundOrder('server-a', ['2', '1']);
        assert.deepEqual(inboundOrder, ['2', '1']);
        assert.deepEqual(systemSettingsStore.getUserOrder(), ['user-b', 'user-a']);
    });
});
