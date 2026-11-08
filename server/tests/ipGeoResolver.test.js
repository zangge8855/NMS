import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createIpGeoResolver,
    formatHostHeaderWithPort,
    isPrivateOrLocalIp,
    normalizeIpAddress,
    parseIpipMyIpResponse,
} from '../lib/ipGeoResolver.js';

describe('ip geo resolver helpers', () => {
    it('normalizes ip addresses from common proxy formats including canonical ipv6', () => {
        assert.equal(normalizeIpAddress('::ffff:203.0.113.9'), '203.0.113.9');
        assert.equal(normalizeIpAddress('::ffff:cb00:7109'), '203.0.113.9');
        assert.equal(normalizeIpAddress('203.0.113.9:12345'), '203.0.113.9');
        assert.equal(normalizeIpAddress('[2001:db8::1]:443'), '2001:db8::1');
        assert.equal(normalizeIpAddress('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
        assert.equal(normalizeIpAddress('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
        assert.equal(normalizeIpAddress('fe80::1%eth0'), 'fe80::1');
        assert.equal(normalizeIpAddress('[2001:db8::1]garbage'), '');
        assert.equal(normalizeIpAddress('foo:bar'), '');
        assert.equal(normalizeIpAddress('unknown'), '');
    });

    it('formats Host header values safely for IPv6, IPv4, and ports', () => {
        assert.equal(formatHostHeaderWithPort('2001:db8::1', '8443'), '[2001:db8::1]:8443');
        assert.equal(formatHostHeaderWithPort('[2001:db8::1]', '8443'), '[2001:db8::1]:8443');
        assert.equal(formatHostHeaderWithPort('[2001:db8::1]:9443', '8443'), '[2001:db8::1]:9443');
        assert.equal(formatHostHeaderWithPort('::1'), '[::1]');
        assert.equal(formatHostHeaderWithPort('panel.example.com', '8443'), 'panel.example.com:8443');
        assert.equal(formatHostHeaderWithPort('panel.example.com:8443', '9000'), 'panel.example.com:8443');
        assert.equal(formatHostHeaderWithPort('panel.example.com', 'invalid'), 'panel.example.com');
    });

    it('detects private/local ip ranges accurately without prefix false positives', () => {
        assert.equal(isPrivateOrLocalIp('10.0.0.3'), true);
        assert.equal(isPrivateOrLocalIp('192.168.1.8'), true);
        assert.equal(isPrivateOrLocalIp('::'), true);
        assert.equal(isPrivateOrLocalIp('0:0:0:0:0:0:0:1'), true);
        assert.equal(isPrivateOrLocalIp('::1'), true);
        assert.equal(isPrivateOrLocalIp('::ffff:7f00:1'), true);
        assert.equal(isPrivateOrLocalIp('fc00::1'), true);
        assert.equal(isPrivateOrLocalIp('fd12:3456:789a::1'), true);
        assert.equal(isPrivateOrLocalIp('febf::1'), true);
        assert.equal(isPrivateOrLocalIp('ff02::1'), true);
        assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
        assert.equal(isPrivateOrLocalIp('fd0::1'), false);
        assert.equal(isPrivateOrLocalIp('fe8::1'), false);
        assert.equal(isPrivateOrLocalIp('2001:4860:4860::8888'), false);
    });

    it('parses ipip response location text', () => {
        const location = parseIpipMyIpResponse('当前 IP：8.8.8.8 来自于：美国 加利福尼亚州');
        assert.equal(location, '美国 加利福尼亚州');
    });
});

describe('ip geo resolver runtime behavior', () => {
    it('defaults to ip-api provider and city-level endpoint', () => {
        const resolver = createIpGeoResolver();
        const meta = resolver.metadata();
        assert.equal(meta.provider, 'ip_api');
        assert.equal(meta.endpoint, 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN');
    });

    it('skips external lookup for private ip', async () => {
        let called = 0;
        const resolver = createIpGeoResolver({
            enabled: true,
            fetcher: async () => {
                called += 1;
                return '当前 IP：1.1.1.1 来自于：澳大利亚';
            },
        });
        const result = await resolver.lookup('192.168.10.9');
        assert.equal(result, '内网/本地');
        assert.equal(called, 0);
    });

    it('uses cache for repeated public ip lookups', async () => {
        let called = 0;
        const resolver = createIpGeoResolver({
            enabled: true,
            provider: 'ipip_myip',
            cacheTtlSeconds: 3600,
            fetcher: async () => {
                called += 1;
                return '当前 IP：8.8.8.8 来自于：美国 Google';
            },
        });
        const first = await resolver.lookup('8.8.8.8');
        const second = await resolver.lookup('8.8.8.8');
        assert.equal(first, '美国 Google');
        assert.equal(second, '美国 Google');
        assert.equal(called, 1);
    });

    it('returns empty location when disabled', async () => {
        const resolver = createIpGeoResolver({
            enabled: false,
            fetcher: async () => '当前 IP：8.8.8.8 来自于：美国',
        });
        const result = await resolver.lookup('8.8.8.8');
        assert.equal(result, '');
    });

    it('appends ip query to ipip endpoint when no {ip} template is provided', async () => {
        let capturedUrl = '';
        const resolver = createIpGeoResolver({
            enabled: true,
            provider: 'ipip_myip',
            endpoint: 'http://myip.ipip.net',
            fetcher: async ({ url }) => {
                capturedUrl = url;
                return '当前 IP：8.8.8.8 来自于：美国';
            },
        });
        const result = await resolver.lookup('8.8.8.8');
        assert.equal(capturedUrl, 'http://myip.ipip.net?ip=8.8.8.8');
        assert.equal(result, '美国');
    });

    it('still supports explicit {ip} endpoint template replacement', async () => {
        let capturedUrl = '';
        const resolver = createIpGeoResolver({
            enabled: true,
            provider: 'ipip_myip',
            endpoint: 'http://myip.ipip.net/?ip={ip}',
            fetcher: async ({ url }) => {
                capturedUrl = url;
                return '当前 IP：8.8.8.8 来自于：美国';
            },
        });
        await resolver.lookup('8.8.8.8');
        assert.equal(capturedUrl, 'http://myip.ipip.net/?ip=8.8.8.8');
    });

    it('keeps explicit ip query endpoint untouched', async () => {
        let capturedUrl = '';
        const resolver = createIpGeoResolver({
            enabled: true,
            provider: 'ipip_myip',
            endpoint: 'http://myip.ipip.net/?ip=1.1.1.1',
            fetcher: async ({ url }) => {
                capturedUrl = url;
                return '当前 IP：1.1.1.1 来自于：澳大利亚';
            },
        });
        await resolver.lookup('8.8.8.8');
        assert.equal(capturedUrl, 'http://myip.ipip.net/?ip=1.1.1.1');
    });
});
