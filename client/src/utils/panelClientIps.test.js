import { isUnsupportedPanelClientIpsError, normalizePanelClientIps } from './panelClientIps.js';

describe('panel client ip helpers', () => {
    it('normalizes string arrays into unique IP rows', () => {
        expect(normalizePanelClientIps([
            '198.51.100.10',
            '198.51.100.10',
            '2001:db8::1',
        ])).toEqual([
            {
                ip: '198.51.100.10',
                count: 0,
                lastSeen: '',
                source: '',
                note: '',
            },
            {
                ip: '2001:db8::1',
                count: 0,
                lastSeen: '',
                source: '',
                note: '',
            },
        ]);
    });

    it('normalizes object arrays with metadata', () => {
        expect(normalizePanelClientIps([
            {
                clientIp: '203.0.113.9',
                count: 3,
                lastSeen: '2026-03-10T10:00:00Z',
                source: 'access.log',
            },
        ])).toEqual([
            {
                ip: '203.0.113.9',
                count: 3,
                lastSeen: '2026-03-10T10:00:00.000Z',
                source: 'access.log',
                note: '',
            },
        ]);
    });

    it('supports plain object maps keyed by IP address', () => {
        expect(normalizePanelClientIps({
            '198.51.100.11': 2,
            '2001:db8::7': { lastSeen: '2026-03-08T08:00:00Z', note: 'recent' },
        })).toEqual([
            {
                ip: '198.51.100.11',
                count: 2,
                lastSeen: '',
                source: '',
                note: '',
            },
            {
                ip: '2001:db8::7',
                count: 0,
                lastSeen: '2026-03-08T08:00:00.000Z',
                source: '',
                note: 'recent',
            },
        ]);
    });

    it('detects missing clientIps endpoints on old panels', () => {
        expect(isUnsupportedPanelClientIpsError({
            response: {
                status: 404,
                data: { msg: 'route not found' },
            },
        })).toBe(true);

        expect(isUnsupportedPanelClientIpsError({
            response: {
                data: { msg: '3x-ui 旧版本不支持该接口' },
            },
        })).toBe(true);

        expect(isUnsupportedPanelClientIpsError({
            response: {
                status: 500,
                data: { msg: 'upstream timeout' },
            },
        })).toBe(false);
    });
});
