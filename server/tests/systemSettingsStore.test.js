import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, `.system_settings_test_data_${process.pid}_${Date.now()}`);

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

    it('persists independent local inbound remarks per server and clears back to panel default', () => {
        const savedV4 = systemSettingsStore.setInboundRemark('srv-v4', 1, '  HK-IPv4  ');
        const savedV6 = systemSettingsStore.setInboundRemark('srv-v6', '1', 'HK-IPv6');
        assert.deepEqual(savedV4, { serverId: 'srv-v4', inboundId: '1', remark: 'HK-IPv4', hasCustomRemark: true });
        assert.deepEqual(savedV6, { serverId: 'srv-v6', inboundId: '1', remark: 'HK-IPv6', hasCustomRemark: true });

        assert.deepEqual(systemSettingsStore.getInboundRemarks(), {
            'srv-v4': { 1: 'HK-IPv4' },
            'srv-v6': { 1: 'HK-IPv6' },
        });
        assert.deepEqual(systemSettingsStore.getInboundRemarks('srv-v4'), { 1: 'HK-IPv4' });

        // Decorates identically named upstream inbounds independently & is idempotent
        const raw = [{ id: 1, remark: 'shared-3xui', protocol: 'vless', port: 443 }];
        const decoratedV4Once = systemSettingsStore.applyInboundRemarks('srv-v4', raw);
        const decoratedV4Twice = systemSettingsStore.applyInboundRemarks('srv-v4', decoratedV4Once);
        const decoratedV6 = systemSettingsStore.applyInboundRemarks('srv-v6', raw);
        assert.equal(decoratedV4Once[0].remark, 'HK-IPv4');
        assert.equal(decoratedV4Once[0].panelRemark, 'shared-3xui');
        assert.equal(decoratedV4Once[0].nmsRemark, 'HK-IPv4');
        assert.equal(decoratedV4Once[0].hasCustomRemark, true);
        assert.deepEqual(decoratedV4Twice, decoratedV4Once);
        assert.equal(decoratedV6[0].remark, 'HK-IPv6');
        assert.equal(decoratedV6[0].panelRemark, 'shared-3xui');

        // Survives unrelated systemSettingsStore.update()
        systemSettingsStore.update({ jobs: { retentionDays: 45 } });
        assert.equal(systemSettingsStore.getInboundRemark('srv-v4', 1), 'HK-IPv4');
        assert.equal(systemSettingsStore.getInboundRemark('srv-v6', 1), 'HK-IPv6');

        // Clearing restores panel default without affecting sibling server
        const cleared = systemSettingsStore.setInboundRemark('srv-v4', 1, '');
        assert.deepEqual(cleared, { serverId: 'srv-v4', inboundId: '1', remark: '', hasCustomRemark: false });
        const afterClearV4 = systemSettingsStore.applyInboundRemarks('srv-v4', raw);
        assert.equal(afterClearV4[0].remark, 'shared-3xui');
        assert.equal(afterClearV4[0].hasCustomRemark, false);
        assert.equal(systemSettingsStore.getInboundRemark('srv-v6', 1), 'HK-IPv6');

        // Remove server bucket cleanly
        assert.equal(systemSettingsStore.removeInboundRemark('srv-v6'), true);
        assert.equal(systemSettingsStore.removeInboundRemark('srv-v6'), false);
        assert.deepEqual(systemSettingsStore.getInboundRemarks('srv-v6'), {});
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
            assert.throws(() => new module.SystemSettingsStore());
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
        assert.equal(systemSettingsStore.getSite().camouflageTitle, 'City Field Notes');

        const updated = systemSettingsStore.update({
            site: {
                accessPath: ' portal/team/ ',
                camouflageEnabled: true,
                camouflageTemplate: 'blog',
                camouflageTitle: '  Willow   City   Weekly  ',
            },
        });

        assert.equal(updated.site.accessPath, '/portal/team');
        assert.equal(updated.site.camouflageEnabled, true);
        assert.equal(updated.site.camouflageTemplate, 'blog');
        assert.equal(updated.site.camouflageTitle, 'Willow City Weekly');
        assert.equal(systemSettingsStore.getSite().accessPath, '/portal/team');
        assert.equal(systemSettingsStore.getSite().camouflageEnabled, true);
        assert.equal(systemSettingsStore.getSite().camouflageTemplate, 'blog');
        assert.equal(systemSettingsStore.getSite().camouflageTitle, 'Willow City Weekly');

        const migrated = systemSettingsStore.update({
            site: {
                camouflageTitle: 'Edge Precision Systems',
            },
        });
        assert.equal(migrated.site.camouflageTitle, 'City Field Notes');
        assert.equal(systemSettingsStore.getSite().camouflageTitle, 'City Field Notes');
    });

    it('persists the webhook section sent by the settings page', () => {
        assert.equal(systemSettingsStore.getWebhook().channel, 'bark');

        const updated = systemSettingsStore.update({
            webhook: {
                channel: 'discord',
                url: 'https://discord.example/api/webhooks/1/abc',
                barkKey: '',
                secret: 's3cret',
                events: { nodeOffline: true, trafficAlert: false, certExpiring: true },
            },
        });
        assert.equal(updated.webhook.channel, 'discord');
        assert.equal(updated.webhook.url, 'https://discord.example/api/webhooks/1/abc');
        assert.deepEqual(updated.webhook.events, { nodeOffline: true, trafficAlert: false, certExpiring: true });
        assert.equal(updated.webhook.secret, '********');
        assert.equal(updated.webhook.secretConfigured, true);
        assert.equal(updated.webhook.barkKey, '');
        assert.equal(updated.webhook.barkKeyConfigured, false);
        assert.equal(systemSettingsStore.getWebhook().secret, 's3cret');

        const maskedSave = systemSettingsStore.update({
            webhook: {
                channel: 'bark',
                barkKey: 'device-key-123',
                secret: '********',
            },
        });
        assert.equal(maskedSave.webhook.barkKey, '********');
        assert.equal(maskedSave.webhook.barkKeyConfigured, true);
        assert.equal(systemSettingsStore.getWebhook().secret, 's3cret');
        assert.equal(systemSettingsStore.getWebhook().barkKey, 'device-key-123');

        const sanitized = systemSettingsStore.update({
            webhook: { channel: 'carrier-pigeon', url: 'javascript:alert(1)' },
        });
        assert.equal(sanitized.webhook.channel, 'bark');
        assert.equal(sanitized.webhook.url, 'https://discord.example/api/webhooks/1/abc');
    });

    it('fails closed and does not overwrite a non-object settings file at startup', async () => {
        const module = await import('../store/systemSettingsStore.js');
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

        const settingsFile = path.join(TEST_DATA_DIR, 'system_settings.json');
        fs.writeFileSync(settingsFile, '["corrupted"]');
        try {
            assert.throws(() => new module.SystemSettingsStore(), /expected a JSON object/);
            assert.equal(fs.readFileSync(settingsFile, 'utf8'), '["corrupted"]');
        } finally {
            systemSettingsStore.settings = systemSettingsStore._normalizeSettings({});
            systemSettingsStore._save();
        }
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
