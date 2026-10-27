import { PANEL_TYPE_SUI, normalizePanelType } from './panelType.js';

/**
 * 3x-ui inbound protocols whose `settings.clients` NMS manages. 3x-ui v3 stores
 * Hysteria2 as `hysteria` (settings.version 2, per-client `auth`) and TUIC
 * clients as uuid + password; `hysteria2`/`hy2` cover older catalog rows.
 */
export const XUI_CLIENT_PROTOCOLS = new Set<string>([
    'vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria', 'hysteria2', 'hy2', 'tuic',
]);

/** s-ui inbound types whose users come from s-ui clients (the adapter lists them as `settings.clients`). */
export const SUI_CLIENT_PROTOCOLS = new Set<string>([
    'mixed', 'socks', 'http', 'shadowsocks', 'vmess', 'trojan', 'naive', 'hysteria',
    'shadowtls', 'tuic', 'hysteria2', 'vless', 'anytls', 'snell',
]);

/** Every protocol a user policy or traffic view may refer to, across panel types. */
export const ALL_CLIENT_PROTOCOLS = new Set<string>([...XUI_CLIENT_PROTOCOLS, ...SUI_CLIENT_PROTOCOLS]);

/**
 * True for s-ui inbounds, panel clients and server records. The s-ui adapter
 * marks inbounds with `panelType` and its axios facade with `nmsPanelType`.
 */
export function isSuiPanelContext(context: any): boolean {
    if (!context) return false;
    if (typeof context === 'string') return normalizePanelType(context) === PANEL_TYPE_SUI;
    return normalizePanelType(context.panelType || context.nmsPanelType) === PANEL_TYPE_SUI;
}

export function isManagedClientProtocol(protocol: unknown, context: any = null): boolean {
    const key = String(protocol || '').trim().toLowerCase();
    if (!key) return false;
    return (isSuiPanelContext(context) ? SUI_CLIENT_PROTOCOLS : XUI_CLIENT_PROTOCOLS).has(key);
}
