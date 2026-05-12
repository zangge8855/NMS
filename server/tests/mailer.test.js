import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateVerifyCode } from '../lib/mailer.js';

describe('generateVerifyCode', () => {
    it('returns a 6-digit numeric string', () => {
        for (let i = 0; i < 200; i += 1) {
            const code = generateVerifyCode();
            assert.equal(typeof code, 'string');
            assert.match(code, /^\d{6}$/, `expected 6-digit code, got ${code}`);
            const value = Number(code);
            assert.ok(value >= 100000 && value <= 999999, `out of range: ${code}`);
        }
    });

    it('produces varied codes (not constant)', () => {
        const seen = new Set();
        for (let i = 0; i < 50; i += 1) {
            seen.add(generateVerifyCode());
        }
        assert.ok(seen.size > 1, 'expected verification codes to vary across calls');
    });
});
