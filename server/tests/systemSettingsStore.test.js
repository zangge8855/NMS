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
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
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

    it('persists server order arrays', () => {
        const order = systemSettingsStore.setServerOrder([' server-b ', 'server-a', 'server-b']);
        assert.deepEqual(order, ['server-b', 'server-a']);
        assert.deepEqual(systemSettingsStore.getServerOrder(), ['server-b', 'server-a']);
    });

    it('defaults invite-only registration to disabled and persists updates', () => {
        assert.equal(systemSettingsStore.getRegistration().inviteOnlyEnabled, false);

        const updated = systemSettingsStore.update({
            registration: {
                inviteOnlyEnabled: true,
            },
        });

        assert.equal(updated.registration.inviteOnlyEnabled, true);
        assert.equal(systemSettingsStore.getRegistration().inviteOnlyEnabled, true);
    });

    it('persists external subscription converter config urls', () => {
        const updated = systemSettingsStore.update({
            subscription: {
                publicBaseUrl: 'https://nms.example.com',
                converterBaseUrl: 'https://converter.example.com',
                converterClashConfigUrl: 'https://worker.example.com/subconverter?selectedRules=balanced',
                converterSingboxConfigUrl: 'https://worker.example.com/subconverter?selectedRules=comprehensive',
                converterSurgeConfigUrl: 'https://worker.example.com/subconverter?selectedRules=minimal',
            },
        });

        assert.deepEqual(updated.subscription, {
            publicBaseUrl: 'https://nms.example.com',
            converterBaseUrl: 'https://converter.example.com',
            converterClashConfigUrl: 'https://worker.example.com/subconverter?selectedRules=balanced',
            converterSingboxConfigUrl: 'https://worker.example.com/subconverter?selectedRules=comprehensive',
            converterSurgeConfigUrl: 'https://worker.example.com/subconverter?selectedRules=minimal',
        });
        assert.deepEqual(systemSettingsStore.getSubscription(), {
            publicBaseUrl: 'https://nms.example.com',
            converterBaseUrl: 'https://converter.example.com',
            converterClashConfigUrl: 'https://worker.example.com/subconverter?selectedRules=balanced',
            converterSingboxConfigUrl: 'https://worker.example.com/subconverter?selectedRules=comprehensive',
            converterSurgeConfigUrl: 'https://worker.example.com/subconverter?selectedRules=minimal',
        });
    });

    it('stores telegram bot configuration without exposing the raw token in public settings', () => {
        const updated = systemSettingsStore.update({
            telegram: {
                enabled: true,
                botToken: '123456:ABCDEF-token',
                chatId: '-1001234567890',
                commandMenuEnabled: true,
                opsDigestIntervalMinutes: 45,
                dailyDigestIntervalHours: 12,
                dailyBackupTime: '08:30',
                sendDailyBackup: true,
                sendSystemStatus: true,
                sendSecurityAudit: true,
                sendEmergencyAlerts: true,
            },
        });

        assert.equal(updated.telegram.enabled, true);
        assert.equal(updated.telegram.botTokenConfigured, true);
        assert.equal(updated.telegram.botToken, '');
        assert.equal(updated.telegram.chatId, '-1001234567890');
        assert.equal(updated.telegram.commandMenuEnabled, true);
        assert.equal(updated.telegram.opsDigestIntervalMinutes, 45);
        assert.equal(updated.telegram.dailyDigestIntervalHours, 12);
        assert.equal(updated.telegram.dailyBackupTime, '08:30');
        assert.equal(updated.telegram.sendDailyBackup, true);

        const telegram = systemSettingsStore.getTelegram();
        assert.equal(telegram.botToken, '123456:ABCDEF-token');
        assert.equal(telegram.chatId, '-1001234567890');
        assert.equal(telegram.botTokenConfigured, true);
        assert.equal(telegram.commandMenuEnabled, true);
        assert.equal(telegram.opsDigestIntervalMinutes, 45);
        assert.equal(telegram.dailyDigestIntervalHours, 12);
        assert.equal(telegram.dailyBackupTime, '08:30');
        assert.equal(telegram.sendDailyBackup, true);
    });

    it('allows explicitly clearing a previously saved telegram token', () => {
        systemSettingsStore.update({
            telegram: {
                enabled: true,
                botToken: '123456:ABCDEF-token',
                chatId: '-1001234567890',
            },
        });

        const updated = systemSettingsStore.update({
            telegram: {
                enabled: false,
                clearBotToken: true,
            },
        });

        assert.equal(updated.telegram.botTokenConfigured, false);
        assert.equal(systemSettingsStore.getTelegram().botToken, '');
    });

    it('does not overwrite a corrupted settings file at startup', async () => {
        const module = await import('../store/systemSettingsStore.js');
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

        const settingsFile = path.join(TEST_DATA_DIR, 'system_settings.json');
        fs.writeFileSync(settingsFile, '{broken json');
        try {
            const reloaded = new module.SystemSettingsStore();
            assert.equal(reloaded.getTelegram().botTokenConfigured, false);
            assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{broken json');
        } finally {
            systemSettingsStore.settings = systemSettingsStore._normalizeSettings({});
            systemSettingsStore._save();
        }
    });

    it('defaults site access path to root and normalizes custom values', () => {
        assert.equal(systemSettingsStore.getSite().accessPath, '/');
        assert.equal(systemSettingsStore.getSite().camouflageEnabled, false);
        assert.equal(systemSettingsStore.getSite().camouflageTemplate, 'corporate');
        assert.equal(systemSettingsStore.getSite().camouflageTitle, 'Edge Precision Systems');

        const updated = systemSettingsStore.update({
            site: {
                accessPath: ' portal/team/ ',
                camouflageEnabled: true,
                camouflageTemplate: 'blog',
                camouflageTitle: '  Northline   Field   Journal  ',
            },
        });

        assert.equal(updated.site.accessPath, '/portal/team');
        assert.equal(updated.site.camouflageEnabled, true);
        assert.equal(updated.site.camouflageTemplate, 'blog');
        assert.equal(updated.site.camouflageTitle, 'Northline Field Journal');
        assert.equal(systemSettingsStore.getSite().accessPath, '/portal/team');
        assert.equal(systemSettingsStore.getSite().camouflageEnabled, true);
        assert.equal(systemSettingsStore.getSite().camouflageTemplate, 'blog');
        assert.equal(systemSettingsStore.getSite().camouflageTitle, 'Northline Field Journal');
    });

    it('rejects reserved site access paths', () => {
        assert.throws(() => {
            systemSettingsStore.update({
                site: {
                    accessPath: '/api/private',
                },
            });
        }, /site\.accessPath cannot use/);
    });

    it('rejects enabling camouflage when the site access path is root', () => {
        assert.throws(() => {
            systemSettingsStore.update({
                site: {
                    accessPath: '/',
                    camouflageEnabled: true,
                },
            });
        }, /site\.camouflageEnabled requires a non-root site\.accessPath/);
    });
});
