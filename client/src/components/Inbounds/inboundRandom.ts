// Random values for inbound defaults: client credentials, keys and secrets.

export const LOWER_NUM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ALPHA_NUM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const HEX_CHARS = '0123456789abcdef';
export const DEFAULT_MTPROTO_FAKE_TLS_DOMAIN = 'www.cloudflare.com';

export function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(Math.max(0, length));
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}

export function randomString(length: number, charset: string = ALPHA_NUM_CHARS): string {
    const size = Math.max(0, Number(length) || 0);
    if (size === 0) return '';
    const chars = charset || ALPHA_NUM_CHARS;
    const bytes = randomBytes(size);
    let result = '';
    for (let i = 0; i < size; i += 1) result += chars[bytes[i] % chars.length];
    return result;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export function randomBase64(byteLength = 32): string {
    return bytesToBase64(randomBytes(byteLength));
}

/** A WireGuard private key: 32 random bytes clamped for X25519, standard base64. */
export function randomWireguardPrivateKey(): string {
    const bytes = randomBytes(32);
    bytes[0] &= 248;
    bytes[31] &= 127;
    bytes[31] |= 64;
    return bytesToBase64(bytes);
}

export function randomUuid(): string {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    const raw = randomString(32, HEX_CHARS).split('');
    raw[12] = '4';
    raw[16] = HEX_CHARS[(parseInt(raw[16], 16) & 0x3) | 0x8];
    return `${raw.slice(0, 8).join('')}-${raw.slice(8, 12).join('')}-${raw.slice(12, 16).join('')}-${raw.slice(16, 20).join('')}-${raw.slice(20, 32).join('')}`;
}

export function randomShadowsocksPassword(method = '2022-blake3-aes-256-gcm'): string {
    const normalizedMethod = String(method || '').toLowerCase();
    if (normalizedMethod.includes('128-gcm')) return randomBase64(16);
    if (normalizedMethod.includes('2022')) return randomBase64(32);
    return randomString(32, `${ALPHA_NUM_CHARS}_-`);
}

export function stringToUtf8Hex(value: unknown): string {
    const text = String(value || '');
    if (typeof TextEncoder !== 'undefined') {
        return Array.from(new TextEncoder().encode(text))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }
    return Array.from(text)
        .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
}

/** FakeTLS secret: "ee" + 16 random bytes in hex + the camouflage domain in hex. */
export function randomMtprotoSecret(domain: string = DEFAULT_MTPROTO_FAKE_TLS_DOMAIN): string {
    return `ee${randomString(32, HEX_CHARS)}${stringToUtf8Hex(domain || DEFAULT_MTPROTO_FAKE_TLS_DOMAIN)}`;
}

/** Keep a FakeTLS secret's random part and point it at a new domain. */
export function retargetMtprotoSecret(secret: unknown, domain: string): string {
    const match = /^ee([0-9a-f]{32})/i.exec(String(secret || ''));
    if (!match) return randomMtprotoSecret(domain);
    return `ee${match[1].toLowerCase()}${stringToUtf8Hex(domain || DEFAULT_MTPROTO_FAKE_TLS_DOMAIN)}`;
}
