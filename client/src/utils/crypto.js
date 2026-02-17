/**
 * Shared cryptographic utilities for generating secure passwords and tokens.
 */

const UUID_HEX = '0123456789abcdef';

/**
 * Generate a cryptographically secure password that meets the password policy
 * (at least 8 chars, containing uppercase + lowercase + digits + symbols = 3+ types).
 */
export function generateSecurePassword(length = 16) {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const groups = [upper, lower, digits, symbols];
    const allChars = groups.join('');
    const size = Math.max(8, Number(length) || 16);

    const bytes = crypto.getRandomValues(new Uint8Array(size + 8));
    // Ensure at least one char from each of the first 3 required groups
    const requiredGroups = [upper, lower, digits];
    const chars = requiredGroups.map((group, index) => group[bytes[index] % group.length]);

    for (let i = chars.length; i < size; i++) {
        chars.push(allChars[bytes[i] % allChars.length]);
    }

    // Fisher-Yates shuffle
    for (let i = chars.length - 1; i > 0; i--) {
        const j = bytes[i % bytes.length] % (i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
}

/**
 * Generate a UUID v4 locally using the Web Crypto API.
 */
export function generateUuidLocal() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    const raw = Array.from({ length: 32 }, () => UUID_HEX[Math.floor(Math.random() * UUID_HEX.length)]);
    raw[12] = '4';
    raw[16] = UUID_HEX[(parseInt(raw[16], 16) & 0x3) | 0x8];
    return `${raw.slice(0, 8).join('')}-${raw.slice(8, 12).join('')}-${raw.slice(12, 16).join('')}-${raw.slice(16, 20).join('')}-${raw.slice(20, 32).join('')}`;
}

/**
 * Generate a hex token of the specified byte length.
 */
export function generateHexToken(byteLength = 8) {
    const size = Math.max(1, Number(byteLength) || 8);
    if (globalThis.crypto?.getRandomValues) {
        return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(size)))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }
    return Array.from({ length: size * 2 }, () => UUID_HEX[Math.floor(Math.random() * UUID_HEX.length)]).join('');
}
