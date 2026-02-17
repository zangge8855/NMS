/**
 * Shared protocol-related constants and helpers used across multiple components.
 */

export const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
export const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

export const PROTOCOL_OPTIONS = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
];
export const PROTOCOL_KEY_SET = new Set(PROTOCOL_OPTIONS.map((item) => item.key));

export function normalizeProtocol(value) {
    return String(value || '').trim().toLowerCase();
}

export function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

export function normalizeScopeMode(mode, selectedItems = []) {
    const hasSelected = Array.isArray(selectedItems) && selectedItems.length > 0;
    const fallback = hasSelected ? 'selected' : 'all';
    const text = String(mode || '').trim().toLowerCase();
    if (!text) return fallback;
    if (!['all', 'selected', 'none'].includes(text)) return fallback;
    if (text === 'selected' && !hasSelected) return 'none';
    return text;
}

export function getClientIdentifier(client, protocol) {
    const normalizedProtocol = normalizeProtocol(protocol || client?.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return client.password || client.id || client.email || '';
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return client.id || client.password || client.email || '';
    }
    return client.id || client.password || client.email || '';
}
