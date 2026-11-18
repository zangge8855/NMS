import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIp, resolveClientIpDetails } from '../lib/requestIp.js';

describe('resolveClientIp', () => {
    it('returns req.ip when it is already a public address', () => {
        const ip = resolveClientIp({
            ip: '203.0.113.20',
            headers: {},
            socket: { remoteAddress: '127.0.0.1' },
        });
        assert.equal(ip, '203.0.113.20');
    });

    it('prefers forwarded public address when upstream is private', () => {
        const ip = resolveClientIp({
            ip: '::1',
            headers: {
                'x-forwarded-for': '198.51.100.66, 10.0.0.2',
            },
            socket: { remoteAddress: '::1' },
        });
        assert.equal(ip, '198.51.100.66');
    });

    it('uses req.ips when express trust proxy provided chain', () => {
        const ip = resolveClientIp({
            ip: '::1',
            ips: ['198.51.100.88', '10.0.0.3'],
            headers: {},
            socket: { remoteAddress: '::1' },
        });
        assert.equal(ip, '198.51.100.88');
    });

    it('falls back to first forwarded private address when no public address exists', () => {
        const ip = resolveClientIp({
            ip: '127.0.0.1',
            headers: {
                'x-forwarded-for': '10.0.0.9, 192.168.1.10',
            },
            socket: { remoteAddress: '127.0.0.1' },
        });
        assert.equal(ip, '10.0.0.9');
    });

    it('returns unknown when no usable source exists', () => {
        const ip = resolveClientIp({
            headers: {},
            socket: {},
        });
        assert.equal(ip, 'unknown');
    });
});

describe('resolveClientIpDetails', () => {
    it('prefers cloudflare real visitor ip over edge proxy address when trusted proxy chain applies', () => {
        const details = resolveClientIpDetails({
            ip: '162.158.10.20',
            ips: ['162.158.10.20'],
            headers: {
                'cf-connecting-ip': '198.51.100.77',
                'cf-ipcountry': 'US',
            },
            socket: { remoteAddress: '162.158.10.20' },
        });
        assert.equal(details.clientIp, '198.51.100.77');
        assert.equal(details.proxyIp, '162.158.10.20');
        assert.equal(details.ipSource, 'cf-connecting-ip');
        assert.equal(details.cfCountry, 'US');
    });

    it('prefers cloudflare ipv6 header when connecting ip is pseudo ipv4 behind trusted proxy', () => {
        const details = resolveClientIpDetails({
            ip: '172.68.1.2',
            ips: ['172.68.1.2'],
            headers: {
                'cf-connecting-ip': '192.0.2.10',
                'cf-connecting-ipv6': '2001:db8::8',
            },
            socket: { remoteAddress: '172.68.1.2' },
        });
        assert.equal(details.clientIp, '2001:db8::8');
        assert.equal(details.ipSource, 'cf-connecting-ipv6');
    });

    it('ignores spoofed cloudflare and forwarded headers from untrusted public sockets', () => {
        const details = resolveClientIpDetails({
            ip: '203.0.113.50',
            ips: [],
            headers: {
                'cf-connecting-ip': '127.0.0.1',
                'true-client-ip': '10.0.0.1',
                'x-forwarded-for': '8.8.8.8',
                'cf-ipcountry': 'XX',
            },
            socket: { remoteAddress: '203.0.113.50' },
        });
        assert.equal(details.clientIp, '203.0.113.50');
        assert.equal(details.ipSource, 'req.ip');
        assert.equal(details.cfCountry, '');
    });

    it('rejects spoofed cloudflare headers behind private reverse proxy by default and allows opt-in via env', () => {
        const req = {
            ip: '127.0.0.1',
            headers: {
                'cf-connecting-ip': '1.2.3.4',
                'true-client-ip': '5.6.7.8',
                'cf-ipcountry': 'ZZ',
                'x-forwarded-for': '9.9.9.9, 198.51.100.42',
            },
            socket: { remoteAddress: '127.0.0.1' },
        };

        const prev = process.env.TRUST_CLOUDFLARE_HEADERS;
        delete process.env.TRUST_CLOUDFLARE_HEADERS;
        try {
            const details = resolveClientIpDetails(req);
            assert.equal(details.clientIp, '198.51.100.42');
            assert.equal(details.ipSource, 'x-forwarded-for');
            assert.equal(details.cfCountry, '');

            process.env.TRUST_CLOUDFLARE_HEADERS = 'true';
            const trustedDetails = resolveClientIpDetails(req);
            assert.equal(trustedDetails.clientIp, '1.2.3.4');
            assert.equal(trustedDetails.ipSource, 'cf-connecting-ip');
            assert.equal(trustedDetails.cfCountry, 'ZZ');
        } finally {
            if (prev === undefined) {
                delete process.env.TRUST_CLOUDFLARE_HEADERS;
            } else {
                process.env.TRUST_CLOUDFLARE_HEADERS = prev;
            }
        }
    });

    it('picks rightmost non-private x-forwarded-for address to defeat leftmost client spoofing', () => {
        const ip = resolveClientIp({
            ip: '127.0.0.1',
            headers: {
                'x-forwarded-for': '8.8.8.8, 198.51.100.99, 10.0.0.2',
            },
            socket: { remoteAddress: '127.0.0.1' },
        });
        assert.equal(ip, '198.51.100.99');
    });
});
