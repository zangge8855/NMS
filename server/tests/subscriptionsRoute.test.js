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
    resolveSingboxConfigVersion,
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
const ssObfsLink = 'ss://YWVzLTEyOC1nY206dGVzdC1wYXNzd29yZC0xMjM0@test.example.com:8388/?plugin=simple-obfs%3Bobfs%3Dhttp%3Bobfs-host%3Dcdn.example.com#NODE-SS';
const ssV2rayLink = 'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTp0ZXN0LXBhc3N3b3Jk@example.com:443/?plugin=v2ray-plugin%3Bmode%3Dwebsocket%3Bhost%3Dexample.com%3Bpath%3D%2Fv2ray%3Btls#NODE-SS2';
const hy2Link = 'hy2://hy2-secret@hy2.example.com:8443?alpn=h3&sni=hy2.example.com&ports=8443,8444&hop-interval=120&upmbps=50&downmbps=100#NODE-C';
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

    it('wraps client-specific subscription links with an external converter when configured', () => {
        const urls = buildSubscriptionUrls(
            'https://new.example.com/api/subscriptions/public/t/token-id/token-value',
            'auto',
            '',
            { converterBaseUrl: 'https://converter.example.com/' }
        );

        assert.equal(urls.subscriptionUrlRaw, 'https://new.example.com/api/subscriptions/public/t/token-id/token-value?format=raw');
        assert.equal(
            urls.subscriptionUrlClash,
            'https://converter.example.com/clash?config=https%3A%2F%2Fnew.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-value%3Fformat%3Draw'
        );
        assert.equal(
            urls.subscriptionUrlSingbox,
            'https://converter.example.com/singbox?config=https%3A%2F%2Fnew.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-value%3Fformat%3Draw'
        );
        assert.equal(
            urls.subscriptionUrlSurge,
            'https://converter.example.com/surge?config=https%3A%2F%2Fnew.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-value%3Fformat%3Draw'
        );
        assert.equal(urls.subscriptionConverterConfigured, true);
    });
});

describe('mihomo config generation', () => {
    it('builds a managed clash yaml with inline proxies for clash/mihomo/stash clients', () => {
        const yamlText = buildMihomoConfigFromLinks(
            [vmessLink, vlessLink, trojanLink, ssObfsLink, hy2Link, tuicLink, 'socks://unsupported.example.com'],
            'https://sub.example.com/base?format=clash'
        );
        const parsed = yaml.load(yamlText);

        assert.ok(yamlText.startsWith('#SUBSCRIBED https://sub.example.com/base?format=clash\n'));
        assert.equal(parsed.mode, 'rule');
        assert.equal(parsed['proxy-groups'][0].name, 'PROXY');
        assert.ok(parsed['proxy-groups'][0].proxies.includes('DIRECT'));
        assert.deepEqual(
            parsed.proxies.map((item) => item.type),
            ['vmess', 'vless', 'trojan', 'ss', 'hysteria2', 'tuic']
        );
        assert.equal(parsed.proxies.find((item) => item.type === 'trojan')?.tls, true);
        assert.deepEqual(parsed.proxies.find((item) => item.name === 'NODE-SS')?.['plugin-opts'], {
            mode: 'http',
            host: 'cdn.example.com',
        });
        assert.equal(parsed.proxies.find((item) => item.name === 'NODE-SS')?.plugin, 'obfs');
        assert.equal(parsed.proxies.find((item) => item.name === 'NODE-C')?.ports, '8443,8444');
        assert.equal(parsed.proxies.find((item) => item.name === 'NODE-C')?.up, 50);
        assert.equal(parsed.proxies.find((item) => item.name === 'NODE-C')?.down, 100);
        assert.equal(parsed.proxies.find((item) => item.name === 'NODE-C')?.['hop-interval'], 120);
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
            [vmessLink, trojanLink, hy2Link, tuicLink, vlessLink, ssObfsLink],
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
        assert.match(profile, /NODE-SS = ss,/);
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
            trojanLink,
            ssObfsLink,
            ssV2rayLink,
            hy2Link,
            tuicLink,
            'socks://unsupported.example.com',
        ]);
        const parsed = JSON.parse(profile);

        assert.equal(parsed.inbounds[0].type, 'mixed');
        assert.equal(parsed.inbounds[1].type, 'tun');
        assert.deepEqual(
            parsed.outbounds.filter((item) => item.server).map((item) => item.type),
            ['vmess', 'vless', 'trojan', 'shadowsocks', 'shadowsocks', 'hysteria2', 'tuic']
        );
        assert.equal(parsed.outbounds[0].tag, 'REJECT');
        assert.equal(parsed.outbounds[1].tag, 'DIRECT');
        assert.ok(parsed.outbounds.some((item) => item.tag === 'AUTO' && item.type === 'urltest'));
        assert.ok(parsed.outbounds.some((item) => item.tag === 'PROXY' && item.type === 'selector'));
        assert.equal(parsed.route.final, 'PROXY');
        assert.equal(parsed.route.rule_set[0].tag, 'geoip-cn');
        assert.ok(parsed.route.rules.some((item) => item.domain_suffix?.includes('.cn')));
        assert.ok(parsed.dns.rules.some((item) => item.server === 'dns_fakeip'));
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-T')?.tls?.enabled, true);
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-SS')?.plugin, 'obfs-local');
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-SS')?.plugin_opts, 'obfs=http;obfs-host=cdn.example.com');
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-SS2')?.plugin, 'v2ray-plugin');
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-SS2')?.plugin_opts, 'mode=websocket;host=example.com;path=/v2ray;tls');
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-C')?.server_ports, '8443,8444');
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-C')?.up_mbps, 50);
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-C')?.down_mbps, 100);
        assert.equal(parsed.outbounds.find((item) => item.tag === 'NODE-C')?.hop_interval, '120s');
        assert.doesNotMatch(profile, /unsupported\.example\.com/);
    });

    it('returns a legacy-compatible config for sing-box 1.11 user agents', () => {
        const profile = buildSingboxConfigFromLinks([vmessLink], {
            userAgent: 'SFI/1.12.2 (Build 2; sing-box 1.11.4; language zh_CN)',
        });
        const parsed = JSON.parse(profile);

        assert.equal(resolveSingboxConfigVersion('', 'SFI/1.12.2 (Build 2; sing-box 1.11.4; language zh_CN)'), '1.11');
        assert.equal(parsed.dns.servers[0].address, 'tls://1.1.1.1');
        assert.equal(parsed.dns.servers[0].type, undefined);
        assert.equal(parsed.route.default_domain_resolver, undefined);
        assert.deepEqual(parsed.dns.fakeip, {
            enabled: true,
            inet4_range: '198.18.0.0/15',
            inet6_range: 'fc00::/18',
        });
    });

    it('returns the 1.12+ config shape for newer sing-box user agents', () => {
        const profile = buildSingboxConfigFromLinks([vmessLink], {
            userAgent: 'SFA/1.12.12 (587; sing-box 1.12.12; language zh_Hans_CN)',
        });
        const parsed = JSON.parse(profile);

        assert.equal(resolveSingboxConfigVersion('', 'SFA/1.12.12 (587; sing-box 1.12.12; language zh_Hans_CN)'), '1.12');
        assert.equal(parsed.dns.servers[0].type, 'tcp');
        assert.equal(parsed.dns.servers[0].server, '1.1.1.1');
        assert.equal(parsed.route.default_domain_resolver, 'dns_resolver');
    });

    it('returns an empty payload when no sing-box-compatible links exist', () => {
        assert.equal(buildSingboxConfigFromLinks(['socks://unsupported.example.com']), '');
    });
});
