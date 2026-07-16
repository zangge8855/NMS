import { describe, expect, it } from 'vitest';
import {
    bytesPerSecondToKilobytesInput,
    bytesToGigabytesInput,
    gigabytesInputToBytes,
    kilobytesInputToBytesPerSecond,
    normalizeLimitIp,
} from './entitlements.js';

describe('entitlement units', () => {
    it('converts traffic limits between GB input and stored bytes', () => {
        expect(gigabytesInputToBytes('3')).toBe(3 * 1024 ** 3);
        expect(bytesToGigabytesInput(1.5 * 1024 ** 3)).toBe('1.5');
    });

    it('converts speed limits between KB/s input and stored B/s', () => {
        expect(kilobytesInputToBytesPerSecond('2')).toBe(2048);
        expect(bytesPerSecondToKilobytesInput(2048)).toBe('2');
    });

    it('normalizes invalid, negative and unlimited values', () => {
        expect(normalizeLimitIp(-1)).toBe(0);
        expect(gigabytesInputToBytes('invalid')).toBe(0);
        expect(kilobytesInputToBytesPerSecond('')).toBe(0);
        expect(bytesPerSecondToKilobytesInput(-1)).toBe('0');
    });
});
