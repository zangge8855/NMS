import { compactDate, paginate } from '../commandHelpers.js';
import { buildPaginationKeyboard } from '../inlineKeyboards.js';

const PAGE_SIZE = 8;

function severityIcon(severity = '') {
    const text = String(severity || '').toLowerCase();
    if (text === 'critical') return '🔴';
    if (text === 'warning') return '🟡';
    return '🔵';
}

export function registerAuditCommands(registry, ctx) {
    const { helpers, services, listSessions } = ctx;

    registry.register({
        name: '/audit',
        level: 'query',
        summary: '查询审计事件',
        handler: async ({ args }) => {
            const eventType = String(args?.positional?.[0] || '').trim();
            const requested = Number(args?.positional?.[1]) || 10;
            const limit = Math.min(50, Math.max(1, requested));

            const auditStore = await services.auditRepository();
            const query = typeof auditStore.queryEvents === 'function'
                ? auditStore.queryEvents.bind(auditStore)
                : null;
            if (!query) {
                return {
                    text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                        `${helpers.sectionHeader('提示')}\n• 审计查询接口未就绪`,
                    ], { subtitle: '查询失败' }),
                    kind: 'audit_unavailable',
                };
            }
            const result = query({ eventType, page: 1, pageSize: limit });
            const events = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
            if (events.length === 0) {
                return {
                    text: helpers.joinHtmlMessage('NMS 审计', [
                        `${helpers.sectionHeader('提示')}\n• 暂无匹配审计事件`,
                    ], { subtitle: eventType ? `类型: ${eventType}` : '最近事件' }),
                    kind: 'audit_empty',
                };
            }
            const { items, page, totalPages, total } = paginate({
                items: events,
                page: Number(args?.page || 1),
                pageSize: PAGE_SIZE,
            });
            const lines = items.map((e) => {
                const ts = compactDate(e.ts || e.timestamp);
                const icon = severityIcon(e.severity);
                const type = helpers.escapeTelegramHtml(e.eventType || e.type || '-');
                const actor = helpers.escapeTelegramHtml(e.actor || '-');
                const target = e.targetEmail || e.target || '';
                const targetSuffix = target ? ` · ${helpers.escapeTelegramHtml(target)}` : '';
                return `• ${icon} ${ts} · <b>${type}</b> · ${actor}${targetSuffix}`;
            });
            let replyMarkup;
            if (totalPages > 1) {
                const session = listSessions.create({
                    command: '/audit',
                    positional: [
                        ...(eventType ? [eventType] : []),
                        String(limit),
                    ],
                });
                replyMarkup = buildPaginationKeyboard({
                    listKey: session.id,
                    page,
                    totalPages,
                });
            }
            return {
                text: helpers.joinHtmlMessage('NMS 审计事件', [
                    `${helpers.sectionHeader('最近事件')}\n${lines.join('\n')}`,
                    `${helpers.sectionHeader('概览')}\n共 <b>${total}</b> 条`,
                ], { subtitle: eventType ? `类型: ${eventType}` : '最近事件' }),
                kind: 'audit_list',
                extras: replyMarkup ? { replyMarkup } : undefined,
            };
        },
    });
}
