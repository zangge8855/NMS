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
    it('prefers cloudflare real visitor ip over edge proxy address', () => {
        const details = resolveClientIpDetails({
            ip: '162.158.10.20',
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

    it('prefers cloudflare ipv6 header when connecting ip is pseudo ipv4', () => {
        const details = resolveClientIpDetails({
            ip: '172.68.1.2',
            headers: {
                'cf-connecting-ip': '192.0.2.10',
                'cf-connecting-ipv6': '2001:db8::8',
            },
            socket: { remoteAddress: '172.68.1.2' },
        });
        assert.equal(details.clientIp, '2001:db8::8');
        assert.equal(details.ipSource, 'cf-connecting-ipv6');
    });
});
