import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildTotpUri,
    generateBackupCodes,
    generateTotp,
    generateTotpSecret,
    hashBackupCode,
    verifyBackupCode,
    verifyTotp,
} from '../lib/totp.js';

describe('totp', () => {
    it('generates and verifies a TOTP within the same step', () => {
        const secret = generateTotpSecret();
        const now = Date.now();
        const code = generateTotp(secret, now);
        assert.match(code, /^\d{6}$/);
        assert.equal(verifyTotp(code, secret, now), true);
    });

    it('accepts a code from one step ago within the default ± 1 window', () => {
        const secret = generateTotpSecret();
        const now = Date.now();
        const previousStep = now - 30_000;
        const code = generateTotp(secret, previousStep);
        assert.equal(verifyTotp(code, secret, now), true);
    });

    it('rejects codes outside the drift window', () => {
        const secret = generateTotpSecret();
        const now = Date.now();
        const farPast = now - 5 * 60_000;
        const code = generateTotp(secret, farPast);
        assert.equal(verifyTotp(code, secret, now), false);
    });

    it('rejects malformed tokens (non-digit / wrong length)', () => {
        const secret = generateTotpSecret();
        assert.equal(verifyTotp('', secret), false);
        assert.equal(verifyTotp('abcdef', secret), false);
        assert.equal(verifyTotp('12', secret), false);
    });

    it('rejects when the secret is empty', () => {
        const code = generateTotp(generateTotpSecret(), Date.now());
        assert.equal(verifyTotp(code, ''), false);
    });

    it('builds an otpauth uri with issuer and account name', () => {
        const uri = buildTotpUri({ secret: 'JBSWY3DPEHPK3PXP', accountName: 'admin@example.com' });
        assert.ok(uri.startsWith('otpauth://totp/NMS:admin%40example.com?'));
        assert.ok(uri.includes('secret=JBSWY3DPEHPK3PXP'));
        assert.ok(uri.includes('algorithm=SHA1'));
        assert.ok(uri.includes('digits=6'));
        assert.ok(uri.includes('period=30'));
    });

    it('generates and verifies single-use backup codes', () => {
        const codes = generateBackupCodes(4);
        assert.equal(codes.length, 4);
        const hashed = codes.map((value) => hashBackupCode(value));
        const result = verifyBackupCode(codes[2], hashed);
        assert.equal(result.match, true);
        assert.equal(result.remaining.length, hashed.length - 1);

        const reused = verifyBackupCode(codes[2], result.remaining);
        assert.equal(reused.match, false);
    });
});
