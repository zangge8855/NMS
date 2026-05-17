/**
 * Inline keyboard builders for the Telegram bot.
 *
 * Telegram's `callback_data` field is capped at 64 bytes. We use a 2-char
 * prefix + an 8-hex pendingActions id, plus optional short suffix — well
 * under the limit.
 *
 * Conventions:
 *   c:<pendingId>      confirm the pending action
 *   x:<pendingId>      cancel the pending action
 *   pg:<key>:<page>    paginate a list (key is short identifier registered
 *                      separately for the list source)
 *   m:<menuItemKey>    main-menu navigation
 */

const MAX_CALLBACK_DATA_BYTES = 64;

function assertCallbackData(value) {
    const text = String(value || '');
    if (Buffer.byteLength(text, 'utf8') > MAX_CALLBACK_DATA_BYTES) {
        throw new Error(`callback_data exceeds 64 bytes: ${text}`);
    }
    return text;
}

export function buildConfirmKeyboard({ pendingId, confirmLabel = '✅ 确认', cancelLabel = '❌ 取消' } = {}) {
    if (!pendingId) throw new Error('buildConfirmKeyboard requires pendingId');
    return {
        inline_keyboard: [
            [
                { text: confirmLabel, callback_data: assertCallbackData(`c:${pendingId}`) },
                { text: cancelLabel, callback_data: assertCallbackData(`x:${pendingId}`) },
            ],
        ],
    };
}

export function buildHighRiskKeyboard({ pendingId, confirmLabel = '🔴 执行', cancelLabel = '取消' } = {}) {
    if (!pendingId) throw new Error('buildHighRiskKeyboard requires pendingId');
    return {
        inline_keyboard: [
            [
                { text: confirmLabel, callback_data: assertCallbackData(`c:${pendingId}`) },
                { text: cancelLabel, callback_data: assertCallbackData(`x:${pendingId}`) },
            ],
        ],
    };
}

export function buildPaginationKeyboard({ listKey, page, totalPages, extraRows = [] }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeTotal = Math.max(1, Number(totalPages) || 1);
    const navRow = [];
    if (safePage > 1) {
        navRow.push({
            text: '« 上一页',
            callback_data: assertCallbackData(`pg:${listKey}:${safePage - 1}`),
        });
    }
    navRow.push({
        text: `${safePage} / ${safeTotal}`,
        callback_data: assertCallbackData(`pg:${listKey}:${safePage}`),
    });
    if (safePage < safeTotal) {
        navRow.push({
            text: '下一页 »',
            callback_data: assertCallbackData(`pg:${listKey}:${safePage + 1}`),
        });
    }
    const rows = [];
    for (const row of extraRows) {
        if (Array.isArray(row) && row.length > 0) rows.push(row);
    }
    rows.push(navRow);
    return { inline_keyboard: rows };
}

export function buildMenuKeyboard(items = []) {
    const rows = [];
    let currentRow = [];
    for (const item of items) {
        if (!item || !item.label || !item.key) continue;
        currentRow.push({
            text: item.label,
            callback_data: assertCallbackData(`m:${item.key}`),
        });
        if (currentRow.length >= (item.rowSize || 2)) {
            rows.push(currentRow);
            currentRow = [];
        }
    }
    if (currentRow.length > 0) rows.push(currentRow);
    return { inline_keyboard: rows };
}

export function parseCallbackData(data = '') {
    const text = String(data || '').trim();
    if (!text) return null;
    if (text.startsWith('c:')) return { kind: 'confirm', id: text.slice(2) };
    if (text.startsWith('x:')) return { kind: 'cancel', id: text.slice(2) };
    if (text.startsWith('pg:')) {
        const parts = text.split(':');
        if (parts.length < 3) return null;
        return { kind: 'paginate', listKey: parts[1], page: Number(parts[2]) || 1 };
    }
    if (text.startsWith('m:')) return { kind: 'menu', key: text.slice(2) };
    return { kind: 'unknown', raw: text };
}

export const __testing = { MAX_CALLBACK_DATA_BYTES, assertCallbackData };
