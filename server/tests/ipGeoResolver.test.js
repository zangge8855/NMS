import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createIpGeoResolver,
    isPrivateOrLocalIp,
    normalizeIpAddress,
    parseIpipMyIpResponse,
} from '../lib/ipGeoResolver.js';

describe('ip geo resolver helpers', () => {
    it('normalizes ip addresses from common proxy formats', () => {
        assert.equal(normalizeIpAddress('::ffff:203.0.113.9'), '203.0.113.9');
        assert.equal(normalizeIpAddress('203.0.113.9:12345'), '203.0.113.9');
        assert.equal(normalizeIpAddress('[2001:db8::1]:443'), '2001:db8::1');
        assert.equal(normalizeIpAddress('unknown'), '');
    });

    it('detects private/local ip ranges', () => {
        assert.equal(isPrivateOrLocalIp('10.0.0.3'), true);
        assert.equal(isPrivateOrLocalIp('192.168.1.8'), true);
        assert.equal(isPrivateOrLocalIp('::1'), true);
        assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
    });

    it('parses ipip response location text', () => {
        const location = parseIpipMyIpResponse('当前 IP：8.8.8.8 来自于：美国 加利福尼亚州');
        assert.equal(location, '美国 加利福尼亚州');
    });
});

describe('ip geo resolver runtime behavior', () => {
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

    it('uses ipip endpoint as-is when no {ip} template is provided', async () => {
        let capturedUrl = '';
        const resolver = createIpGeoResolver({
            enabled: true,
            endpoint: 'http://myip.ipip.net',
            fetcher: async ({ url }) => {
                capturedUrl = url;
                return '当前 IP：8.8.8.8 来自于：美国';
            },
        });
        const result = await resolver.lookup('8.8.8.8');
        assert.equal(capturedUrl, 'http://myip.ipip.net');
        assert.equal(result, '美国');
    });

    it('still supports explicit {ip} endpoint template replacement', async () => {
        let capturedUrl = '';
        const resolver = createIpGeoResolver({
            enabled: true,
            endpoint: 'http://myip.ipip.net/?ip={ip}',
            fetcher: async ({ url }) => {
                capturedUrl = url;
                return '当前 IP：8.8.8.8 来自于：美国';
            },
        });
        await resolver.lookup('8.8.8.8');
        assert.equal(capturedUrl, 'http://myip.ipip.net/?ip=8.8.8.8');
    });
});
