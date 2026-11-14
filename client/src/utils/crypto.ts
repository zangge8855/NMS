/**
 * Shared cryptographic utilities for generating secure passwords and tokens.
 */

function requireWebCrypto(): Crypto {
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('Web Crypto API is unavailable');
    }
    return globalThis.crypto;
}

/**
 * Generate a cryptographically secure password that meets the password policy
 * (at least 8 chars, containing uppercase + lowercase + digits + symbols = 3+ types).
 */
export function generateSecurePassword(length: number = 16): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const groups = [upper, lower, digits, symbols];
    const allChars = groups.join('');
    const size = Math.max(8, Number(length) || 16);

    const bytes = requireWebCrypto().getRandomValues(new Uint8Array(size + 8));
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
export function generateUuidLocal(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) {
        return cryptoApi.randomUUID();
    }
    const bytes = requireWebCrypto().getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Generate a hex token of the specified byte length.
 */
export function generateHexToken(byteLength: number = 8): string {
    const size = Math.max(1, Number(byteLength) || 8);
    return Array.from(requireWebCrypto().getRandomValues(new Uint8Array(size)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
