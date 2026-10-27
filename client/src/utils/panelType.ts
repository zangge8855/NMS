export const PANEL_TYPE_3XUI = '3x-ui';
export const PANEL_TYPE_SUI = 's-ui';
export const PANEL_TYPES = [PANEL_TYPE_3XUI, PANEL_TYPE_SUI] as const;

export type PanelType = typeof PANEL_TYPES[number];

const SUI_ALIASES = new Set(['s-ui', 'sui', 's_ui', 'singbox', 'sing-box']);

/** Mirrors server/lib/panelType.ts: anything that is not an s-ui alias is 3x-ui. */
export function normalizePanelType(value: unknown): PanelType {
    const key = String(value || '').trim().toLowerCase();
    return SUI_ALIASES.has(key) ? PANEL_TYPE_SUI : PANEL_TYPE_3XUI;
}

export function isSuiServer(server: unknown): boolean {
    if (!server || typeof server !== 'object') return false;
    return normalizePanelType((server as { panelType?: unknown }).panelType) === PANEL_TYPE_SUI;
}

export function getPanelTypeLabel(value: unknown): string {
    return normalizePanelType(value);
}
