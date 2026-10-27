/**
 * Shared protocol-related constants and helpers used across multiple components.
 */

export const UUID_PROTOCOLS: Set<string> = new Set(['vmess', 'vless', 'tuic']);
// naive, anytls, shadowtls, snell and the mixed/socks/http proxies are s-ui inbound types.
export const PASSWORD_PROTOCOLS: Set<string> = new Set([
    'trojan', 'shadowsocks', 'hysteria', 'hysteria2', 'hy2',
    'naive', 'anytls', 'shadowtls', 'snell', 'mixed', 'socks', 'http',
]);

export interface ProtocolOption {
    key: string;
    label: string;
}

export const PROTOCOL_OPTIONS: ProtocolOption[] = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
    { key: 'hysteria', label: 'Hysteria' },
    { key: 'hysteria2', label: 'Hysteria2' },
    { key: 'tuic', label: 'TUIC' },
    { key: 'wireguard', label: 'WireGuard' },
];

/**
 * Protocols a user policy can allow. Mirrors server/lib/clientProtocols.ts:
 * the 3x-ui client protocols first, then the extra s-ui inbound types.
 */
export const POLICY_PROTOCOL_OPTIONS: ProtocolOption[] = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
    { key: 'hysteria', label: 'Hysteria' },
    { key: 'hysteria2', label: 'Hysteria2' },
    { key: 'tuic', label: 'TUIC' },
    { key: 'naive', label: 'Naive' },
    { key: 'anytls', label: 'AnyTLS' },
    { key: 'shadowtls', label: 'ShadowTLS' },
    { key: 'snell', label: 'Snell' },
    { key: 'mixed', label: 'Mixed' },
    { key: 'socks', label: 'SOCKS' },
    { key: 'http', label: 'HTTP' },
];

export const PROTOCOL_KEY_SET: Set<string> = new Set(PROTOCOL_OPTIONS.map((item) => item.key));

export function normalizeProtocol(value?: string | null): string {
    return String(value || '').trim().toLowerCase();
}

export function normalizeEmail(value?: string | null): string {
    return String(value || '').trim().toLowerCase();
}

export function normalizeScopeMode(mode?: string | null, selectedItems: any[] = []): 'all' | 'selected' | 'none' {
    const hasSelected = Array.isArray(selectedItems) && selectedItems.length > 0;
    const fallback = hasSelected ? 'selected' : 'all';
    const text = String(mode || '').trim().toLowerCase();
    if (!text) return fallback;
    if (!['all', 'selected', 'none'].includes(text)) return fallback;
    if (text === 'selected' && !hasSelected) return 'none';
    return text as 'all' | 'selected' | 'none';
}

export function getClientIdentifier(client?: { password?: string; id?: string; email?: string; protocol?: string } | null, protocol?: string): string {
    const normalizedProtocol = normalizeProtocol(protocol || client?.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return client?.password || client?.id || client?.email || '';
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return client?.id || client?.password || client?.email || '';
    }
    return client?.id || client?.password || client?.email || '';
}
