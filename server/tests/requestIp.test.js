import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIp } from '../lib/requestIp.js';

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
