import crypto from 'crypto';

// RFC 6238 TOTP with HMAC-SHA1, 6 digits, 30s step.
// Pure built-in crypto: no third-party dependency.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_WINDOW = 1; // accept current ± 1 step (~90s drift)

function base32Encode(buffer) {
    const bytes = Buffer.from(buffer);
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
}

function base32Decode(input) {
    const cleaned = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    if (!cleaned) return Buffer.alloc(0);
    let bits = 0;
    let value = 0;
    const output = [];
    for (const char of cleaned) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index < 0) continue;
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(output);
}

export function generateTotpSecret(byteLength = 20) {
    return base32Encode(crypto.randomBytes(Math.max(10, Number(byteLength) || 20)));
}

function hotp(secretBuffer, counter, digits = DEFAULT_DIGITS) {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24)
        | ((hmac[offset + 1] & 0xff) << 16)
        | ((hmac[offset + 2] & 0xff) << 8)
        | (hmac[offset + 3] & 0xff);
    const modulus = 10 ** digits;
    return String(binary % modulus).padStart(digits, '0');
}

function counterForTime(unixSeconds, stepSeconds = DEFAULT_STEP_SECONDS) {
    return Math.floor(Number(unixSeconds || 0) / Math.max(1, Number(stepSeconds) || DEFAULT_STEP_SECONDS));
}

export function generateTotp(secretBase32, atTimestampMs = Date.now(), options = {}) {
    const secretBuffer = base32Decode(secretBase32);
    if (secretBuffer.length === 0) {
        throw new Error('Invalid TOTP secret');
    }
    const stepSeconds = Number(options.stepSeconds) || DEFAULT_STEP_SECONDS;
    const digits = Number(options.digits) || DEFAULT_DIGITS;
    const counter = counterForTime(Math.floor(atTimestampMs / 1000), stepSeconds);
    return hotp(secretBuffer, counter, digits);
}

export function verifyTotp(token, secretBase32, atTimestampMs = Date.now(), options = {}) {
    const cleaned = String(token || '').trim().replace(/\s+/g, '');
    if (!/^\d+$/.test(cleaned)) return false;
    const secretBuffer = base32Decode(secretBase32);
    if (secretBuffer.length === 0) return false;
    const stepSeconds = Number(options.stepSeconds) || DEFAULT_STEP_SECONDS;
    const digits = Number(options.digits) || DEFAULT_DIGITS;
    const window = Number.isFinite(Number(options.window)) ? Number(options.window) : DEFAULT_WINDOW;
    const baseCounter = counterForTime(Math.floor(atTimestampMs / 1000), stepSeconds);

    for (let drift = -window; drift <= window; drift += 1) {
        const expected = hotp(secretBuffer, baseCounter + drift, digits);
        if (expected.length === cleaned.length
            && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) {
            return true;
        }
    }
    return false;
}

export function buildTotpUri({
    secret,
    accountName,
    issuer = 'NMS',
    digits = DEFAULT_DIGITS,
    period = DEFAULT_STEP_SECONDS,
}) {
    const safeIssuer = encodeURIComponent(String(issuer || 'NMS'));
    const safeAccount = encodeURIComponent(String(accountName || ''));
    const params = new URLSearchParams({
        secret: String(secret || ''),
        issuer: String(issuer || 'NMS'),
        algorithm: 'SHA1',
        digits: String(digits),
        period: String(period),
    });
    return `otpauth://totp/${safeIssuer}:${safeAccount}?${params.toString()}`;
}

export function generateBackupCodes(count = 10) {
    const codes = [];
    for (let i = 0; i < count; i += 1) {
        const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
        codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
    }
    return codes;
}

export function hashBackupCode(code) {
    return crypto.createHash('sha256').update(String(code || '').toUpperCase().replace(/\s+/g, '')).digest('hex');
}

export function verifyBackupCode(code, hashedCodes = []) {
    if (!Array.isArray(hashedCodes) || hashedCodes.length === 0) return { match: false, remaining: hashedCodes };
    const candidate = hashBackupCode(code);
    if (!candidate || candidate.length !== 64) return { match: false, remaining: hashedCodes };
    const index = hashedCodes.findIndex((stored) => (
        typeof stored === 'string'
        && stored.length === candidate.length
        && crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(candidate, 'hex'))
    ));
    if (index < 0) return { match: false, remaining: hashedCodes };
    const remaining = hashedCodes.slice();
    remaining.splice(index, 1);
    return { match: true, remaining };
}
