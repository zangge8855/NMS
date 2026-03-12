import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from '../../client/node_modules/js-yaml/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join('/tmp', 'nms-subscriptions-route-test');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-subscription-routes';

const {
    buildMihomoConfigFromLinks,
    buildSurgeConfigFromLinks,
    buildSingboxConfigFromLinks,
    buildSubscriptionUrls,
    normalizeSubscriptionFormat,
    selectNativeSubIds,
} = await import('../routes/subscriptions.js');

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

const vmessLink = `vmess://${vmessPayload}`;
const vlessLink = 'vless://22222222-2222-2222-2222-222222222222@reality.example.com:443?type=ws&security=reality&encryption=none&path=%2Fvless&host=cdn.example.com&sni=target.example.com&pbk=public-key-123&fp=chrome&sid=abcd#NODE-B';
const trojanLink = 'trojan://trojan-pass@trojan.example.com:443?type=ws&security=tls&path=%2Ftr&host=cdn.example.com&sni=trojan.example.com#NODE-T';
const hy2Link = 'hy2://hy2-secret@hy2.example.com:8443?alpn=h3&sni=hy2.example.com#NODE-C';
const tuicLink = 'tuic://33333333-3333-3333-3333-333333333333:tuic-pass@tuic.example.com:443?congestion_control=bbr&sni=tuic.example.com&alpn=h3&udp-relay-mode=native#NODE-D';

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
    it('normalizes supported output formats', () => {
        assert.equal(normalizeSubscriptionFormat('clash'), 'clash');
        assert.equal(normalizeSubscriptionFormat('mihomo'), 'clash');
        assert.equal(normalizeSubscriptionFormat('singbox'), 'singbox');
        assert.equal(normalizeSubscriptionFormat('surge'), 'surge');
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
        assert.equal(urls.subscriptionUrlSurge, 'https://new.example.com/api/subscriptions/public/t/token-id/token-value?format=surge');
    });
});

describe('mihomo config generation', () => {
    it('builds a managed clash yaml with inline proxies for clash/mihomo/stash clients', () => {
        const yamlText = buildMihomoConfigFromLinks(
            [vmessLink, vlessLink, hy2Link, tuicLink, 'socks://unsupported.example.com'],
            'https://sub.example.com/base?format=clash'
        );
        const parsed = yaml.load(yamlText);

        assert.ok(yamlText.startsWith('#SUBSCRIBED https://sub.example.com/base?format=clash\n'));
        assert.equal(parsed.mode, 'rule');
        assert.equal(parsed['proxy-groups'][0].name, 'PROXY');
        assert.ok(parsed['proxy-groups'][0].proxies.includes('DIRECT'));
        assert.deepEqual(
            parsed.proxies.map((item) => item.type),
            ['vmess', 'vless', 'hysteria2', 'tuic']
        );
        assert.ok(parsed.rules.includes('DOMAIN-SUFFIX,cn,DIRECT'));
        assert.ok(parsed.rules.includes('GEOIP,CN,DIRECT'));
        assert.ok(parsed.rules.includes('MATCH,PROXY'));
    });

    it('returns an empty payload when no clash-compatible links exist', () => {
        assert.equal(buildMihomoConfigFromLinks(['socks://unsupported.example.com']), '');
    });
});

describe('surge config generation', () => {
    it('builds a managed surge profile for supported surge protocols only', () => {
        const profile = buildSurgeConfigFromLinks(
            [vmessLink, trojanLink, hy2Link, tuicLink, vlessLink],
            'https://sub.example.com/base?format=surge'
        );

        assert.ok(profile.startsWith('#!MANAGED-CONFIG https://sub.example.com/base?format=surge interval=43200 strict=false'));
        assert.match(profile, /\[General\]/);
        assert.match(profile, /\[Proxy\]/);
        assert.match(profile, /\[Proxy Group\]/);
        assert.match(profile, /\[Rule\]/);
        assert.match(profile, /NODE-A = vmess,/);
        assert.match(profile, /NODE-T = trojan,/);
        assert.match(profile, /NODE-C = hysteria2,/);
        assert.match(profile, /NODE-D = tuic,/);
        assert.doesNotMatch(profile, /reality\.example\.com/);
        assert.match(profile, /FINAL,PROXY/);
    });

    it('returns an empty payload when no surge-compatible links exist', () => {
        assert.equal(buildSurgeConfigFromLinks([vlessLink]), '');
    });
});

describe('sing-box config generation', () => {
    it('builds a remote profile with supported proxies and a minimal cn/non-cn split', () => {
        const profile = buildSingboxConfigFromLinks([
            vmessLink,
            vlessLink,
            hy2Link,
            tuicLink,
            'socks://unsupported.example.com',
        ]);
        const parsed = JSON.parse(profile);

        assert.equal(parsed.inbounds[0].type, 'mixed');
        assert.equal(parsed.inbounds[1].type, 'tun');
        assert.deepEqual(
            parsed.outbounds.filter((item) => item.server).map((item) => item.type),
            ['vmess', 'vless', 'hysteria2', 'tuic']
        );
        assert.equal(parsed.outbounds[0].tag, 'REJECT');
        assert.equal(parsed.outbounds[1].tag, 'DIRECT');
        assert.ok(parsed.outbounds.some((item) => item.tag === 'AUTO' && item.type === 'urltest'));
        assert.ok(parsed.outbounds.some((item) => item.tag === 'PROXY' && item.type === 'selector'));
        assert.equal(parsed.route.final, 'PROXY');
        assert.equal(parsed.route.rule_set[0].tag, 'geoip-cn');
        assert.ok(parsed.route.rules.some((item) => item.domain_suffix?.includes('.cn')));
        assert.ok(parsed.dns.rules.some((item) => item.server === 'dns_fakeip'));
        assert.doesNotMatch(profile, /unsupported\.example\.com/);
    });

    it('returns an empty payload when no sing-box-compatible links exist', () => {
        assert.equal(buildSingboxConfigFromLinks(['socks://unsupported.example.com']), '');
    });
});
