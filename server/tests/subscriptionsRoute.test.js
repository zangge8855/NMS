import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join(__dirname, '.test_data');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-subscription-routes';

const {
    buildMihomoConfigFromLinks,
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
    });
});

describe('mihomo config generation', () => {
    it('builds a rule-based mihomo config from supported subscription links', () => {
        const vmessPayload = Buffer.from(JSON.stringify({
            v: '2',
            ps: 'NODE-A',
            add: 'edge.example.com',
            port: '443',
            id: '11111111-1111-1111-1111-111111111111',
            aid: '0',
            scy: 'auto',
            net: 'ws',
            type: 'none',
            host: 'cdn.example.com',
            path: '/ws',
            tls: 'tls',
            sni: 'sni.example.com',
            alpn: 'h2,http/1.1',
        })).toString('base64');
        const vlessLink = 'vless://22222222-2222-2222-2222-222222222222@reality.example.com:443?type=ws&security=reality&encryption=none&path=%2Fvless&host=cdn.example.com&sni=target.example.com&pbk=public-key-123&fp=chrome&sid=abcd#NODE-B';
        const ssLink = `ss://${Buffer.from('aes-128-gcm:test-pass').toString('base64')}@ss.example.com:8443#NODE-C`;

        const yaml = buildMihomoConfigFromLinks([
            `vmess://${vmessPayload}`,
            vlessLink,
            ssLink,
            'hy2://unsupported.example.com',
        ]);

        assert.match(yaml, /type: vmess/);
        assert.match(yaml, /type: vless/);
        assert.match(yaml, /type: ss/);
        assert.match(yaml, /name: NODE-A/);
        assert.match(yaml, /name: NODE-B/);
        assert.match(yaml, /name: NODE-C/);
        assert.match(yaml, /reality-opts:/);
        assert.match(yaml, /public-key: public-key-123/);
        assert.match(yaml, /ws-opts:/);
        assert.match(yaml, /rule-providers:/);
        assert.match(yaml, /private-domain:/);
        assert.match(yaml, /cn-domain:/);
        assert.match(yaml, /format: mrs/);
        assert.match(yaml, /global-client-fingerprint: chrome/);
        assert.match(yaml, /store-selected: true/);
        assert.match(yaml, /name: GLOBAL/);
        assert.match(yaml, /name: TELEGRAM/);
        assert.match(yaml, /name: DOMESTIC/);
        assert.match(yaml, /MATCH,GLOBAL/);
        assert.doesNotMatch(yaml, /\.txt/);
        assert.doesNotMatch(yaml, /unsupported\.example\.com/);
    });

    it('returns an empty payload when no clash-compatible links exist', () => {
        assert.equal(buildMihomoConfigFromLinks(['hy2://unsupported.example.com']), '');
    });
});
