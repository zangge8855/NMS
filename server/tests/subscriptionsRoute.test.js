import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join('/tmp', 'nms-subscriptions-route-test');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-subscription-routes';

const {
    buildMihomoConfigFromSubscriptionUrl,
    buildSingboxConfigFromLinks,
    buildSubscriptionUrls,
    normalizeSubscriptionFormat,
    selectNativeSubIds,
} = await import('../routes/subscriptions.js');

describe('subscription native fallback selection', () => {
    it('returns all unique subIds in native mode', () => {
        assert.deepEqual(
            selectNativeSubIds('native', [' sub-a ', 'sub-b', 'sub-a'], ['sub-c']),
            ['sub-a', 'sub-b']
        );
    });

    it('returns only fallback subIds in auto mode', () => {
        assert.deepEqual(
            selectNativeSubIds('auto', ['sub-a', 'sub-b'], [' sub-b ', 'sub-c', '']),
            ['sub-b', 'sub-c']
        );
    });

    it('does not request native links in reconstructed-only mode', () => {
        assert.deepEqual(
            selectNativeSubIds('reconstructed', ['sub-a'], ['sub-b']),
            []
        );
    });
});

describe('subscription response formats', () => {
    it('normalizes clash and mihomo formats to clash output', () => {
        assert.equal(normalizeSubscriptionFormat('clash'), 'clash');
        assert.equal(normalizeSubscriptionFormat('mihomo'), 'clash');
        assert.equal(normalizeSubscriptionFormat('singbox'), 'singbox');
        assert.equal(normalizeSubscriptionFormat('raw'), 'raw');
        assert.equal(normalizeSubscriptionFormat('encoded'), 'encoded');
        assert.equal(normalizeSubscriptionFormat('something-else'), 'encoded');
    });
});

describe('subscription url generation', () => {
    it('builds core subscription variants from the token url', () => {
        const urls = buildSubscriptionUrls(
            'https://new.example.com/api/subscriptions/public/t/token-id/token-value',
            'auto',
            ''
        );

        assert.equal(urls.subscriptionUrl, 'https://new.example.com/api/subscriptions/public/t/token-id/token-value');
        assert.equal(urls.subscriptionUrlRaw, 'https://new.example.com/api/subscriptions/public/t/token-id/token-value?format=raw');
        assert.equal(urls.subscriptionUrlClash, 'https://new.example.com/api/subscriptions/public/t/token-id/token-value?format=clash');
        assert.equal(urls.subscriptionUrlMihomo, 'https://new.example.com/api/subscriptions/public/t/token-id/token-value?format=clash');
        assert.equal(urls.subscriptionUrlSingbox, 'https://new.example.com/api/subscriptions/public/t/token-id/token-value?format=singbox');
    });
});

describe('mihomo config generation', () => {
    it('builds a minimal provider-based mihomo config from a subscription url', () => {
        const yaml = buildMihomoConfigFromSubscriptionUrl('https://sub.example.com/base?format=raw');

        assert.match(yaml, /proxy-providers:/);
        assert.match(yaml, /url: "https:\/\/sub\.example\.com\/base\?format=raw"/);
        assert.match(yaml, /name: PROXY/);
        assert.match(yaml, /name: AUTO/);
        assert.match(yaml, /DOMAIN-SUFFIX,cn,DIRECT/);
        assert.match(yaml, /GEOIP,CN,DIRECT/);
        assert.match(yaml, /MATCH,PROXY/);
    });

    it('returns an empty payload when no clash-compatible links exist', () => {
        assert.equal(buildMihomoConfigFromSubscriptionUrl(''), '');
    });
});

describe('sing-box config generation', () => {
    it('builds a minimal sing-box remote profile from supported links', () => {
        const vmessPayload = Buffer.from(JSON.stringify({
            v: '2',
            ps: 'NODE-A',
            add: 'edge.example.com',
            port: '443',
            id: '11111111-1111-1111-1111-111111111111',
            aid: '0',
            scy: 'auto',
            net: 'ws',
            host: 'cdn.example.com',
            path: '/ws',
            tls: 'tls',
            sni: 'sni.example.com',
        })).toString('base64');
        const vlessLink = 'vless://22222222-2222-2222-2222-222222222222@reality.example.com:443?type=ws&security=reality&encryption=none&path=%2Fvless&host=cdn.example.com&sni=target.example.com&pbk=public-key-123&fp=chrome&sid=abcd#NODE-B';

        const profile = buildSingboxConfigFromLinks([
            `vmess://${vmessPayload}`,
            vlessLink,
            'hy2://unsupported.example.com',
        ]);
        const parsed = JSON.parse(profile);

        assert.match(profile, /"type": "vmess"/);
        assert.match(profile, /"type": "vless"/);
        assert.match(profile, /"tag": "NODE-A"/);
        assert.match(profile, /"tag": "NODE-B"/);
        assert.match(profile, /"type": "tun"/);
        assert.match(profile, /"type": "selector"/);
        assert.match(profile, /"domain_suffix": \[/);
        assert.match(profile, /"url": "https:\/\/cdn\.jsdelivr\.net\/gh\/Loyalsoldier\/geoip@release\/srs\/cn\.srs"/);
        assert.doesNotMatch(profile, /unsupported\.example\.com/);
        assert.equal(parsed.inbounds[0].type, 'tun');
        assert.equal(parsed.outbounds[0].type, 'vmess');
        assert.equal(parsed.outbounds[1].type, 'vless');
        assert.equal(parsed.route.final, 'proxy');
        assert.equal(parsed.route.rule_set[0].tag, 'geoip-cn');
    });

    it('returns an empty payload when no sing-box-compatible links exist', () => {
        assert.equal(buildSingboxConfigFromLinks(['hy2://unsupported.example.com']), '');
    });
});
