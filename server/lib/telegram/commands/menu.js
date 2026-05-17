import { buildMenuKeyboard } from '../inlineKeyboards.js';

const MENU_ITEMS = [
    { key: 'clients', label: '👥 客户管理' },
    { key: 'servers', label: '🖥 节点状态' },
    { key: 'inbounds', label: '🔌 入站' },
    { key: 'audit', label: '🛡 审计' },
    { key: 'traffic', label: '📶 流量' },
    { key: 'status', label: '📡 状态' },
    { key: 'help', label: '❓ 帮助' },
];

export function registerMenuCommands(registry, ctx) {
    const { helpers } = ctx;

    registry.register({
        name: '/menu',
        level: 'query',
        summary: '主菜单',
        handler: async () => ({
            text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                `${helpers.sectionHeader('快速开始')}\n• 点击下方按钮跳转，或直接发送 <code>/help</code> 看完整命令`,
            ], { subtitle: 'NMS 移动控制台主菜单' }),
            kind: 'menu',
            extras: {
                replyMarkup: buildMenuKeyboard(MENU_ITEMS),
            },
        }),
    });
}

export const __menuItems = MENU_ITEMS;
