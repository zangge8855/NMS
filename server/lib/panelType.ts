export type PanelType = '3x-ui' | 's-ui';

export const PANEL_TYPE_3XUI: PanelType = '3x-ui';
export const PANEL_TYPE_SUI: PanelType = 's-ui';
export const PANEL_TYPES: PanelType[] = [PANEL_TYPE_3XUI, PANEL_TYPE_SUI];

const SUI_ALIASES = new Set(['s-ui', 'sui', 's_ui', 'singbox', 'sing-box']);

export function normalizePanelType(value: unknown): PanelType {
    const text = String(value || '').trim().toLowerCase();
    return SUI_ALIASES.has(text) ? PANEL_TYPE_SUI : PANEL_TYPE_3XUI;
}

export function isSuiPanelServer(server: any): boolean {
    return normalizePanelType(server?.panelType) === PANEL_TYPE_SUI;
}
