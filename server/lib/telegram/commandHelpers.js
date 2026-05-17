/**
 * Shared rendering / lookup helpers for Telegram commands.
 *
 * Helpers here intentionally take an explicit `helpers` bag from the
 * telegramServiceContext so they remain decoupled from the closure inside
 * telegramAlertService.js. This keeps the command modules testable in
 * isolation.
 */

export function escapeText(helpers, value = '') {
    return helpers.escapeTelegramHtml(value);
}

export function inlineCode(helpers, value = '') {
    return `<code>${helpers.escapeTelegramHtml(String(value ?? ''))}</code>`;
}

export function unknownCommand(helpers, hint = '') {
    return helpers.joinHtmlMessage('NMS Telegram 控制台', [
        `${helpers.sectionHeader('提示')}\n• ${hint || '未识别命令，请使用 <code>/help</code> 查看可用命令'}`,
    ], { subtitle: '命令入口' });
}

export function missingArgs(helpers, usageExample = '') {
    return helpers.joinHtmlMessage('NMS Telegram 控制台', [
        `${helpers.sectionHeader('提示')}\n• 参数不完整${usageExample ? `\n• 用法：${inlineCode(helpers, usageExample)}` : ''}`,
    ], { subtitle: '命令参数' });
}

export function notFound(helpers, what = '记录') {
    return helpers.joinHtmlMessage('NMS Telegram 控制台', [
        `${helpers.sectionHeader('提示')}\n• 未找到对应${what}`,
    ], { subtitle: '查询结果' });
}

export function findUserByIdOrEmail(users = [], needle = '') {
    const text = String(needle || '').trim().toLowerCase();
    if (!text) return null;
    return users.find((u) =>
        String(u.id || '').toLowerCase() === text
        || String(u.email || '').toLowerCase() === text
        || String(u.subscriptionEmail || '').toLowerCase() === text
        || String(u.username || '').toLowerCase() === text
    ) || null;
}

export function paginate({ items = [], page = 1, pageSize = 8 }) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return {
        items: items.slice(start, start + pageSize),
        page: safePage,
        totalPages,
        total,
    };
}

export function compactDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
