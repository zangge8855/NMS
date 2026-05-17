import { paginate, notFound } from '../commandHelpers.js';
import { buildPaginationKeyboard } from '../inlineKeyboards.js';

const PAGE_SIZE = 8;

function formatInboundLine(helpers, item) {
    const name = helpers.escapeTelegramHtml(item.remark || item.name || `入站 ${item.id ?? '-'}`);
    const protocol = helpers.escapeTelegramHtml(String(item.protocol || '-').toUpperCase());
    const port = item.port == null ? '-' : String(item.port);
    const status = item.enable ? '✅ 启用' : '⏸ 停用';
    return `• <b>${name}</b> · ${protocol} · ${port} · ${status}`;
}

function collectInboundRows(snapshot = {}) {
    const snapshots = Array.isArray(snapshot?.panelSnapshots) ? snapshot.panelSnapshots : [];
    return snapshots.flatMap((panelSnapshot) => {
        const inbounds = Array.isArray(panelSnapshot?.inbounds) ? panelSnapshot.inbounds : [];
        return inbounds.map((inbound) => ({
            ...inbound,
            serverId: panelSnapshot?.server?.id || '',
            serverName: panelSnapshot?.server?.name || panelSnapshot?.server?.id || '-',
        }));
    });
}

export function registerInboundCommands(registry, ctx) {
    const { helpers, services, listSessions } = ctx;

    registry.register({
        name: '/inbounds',
        level: 'query',
        summary: '列出入站摘要',
        handler: async ({ args }) => {
            const statusModule = await services.serverStatus();
            const collect = statusModule.collectClusterStatusSnapshot
                || statusModule.default?.collectClusterStatusSnapshot;
            if (typeof collect !== 'function') {
                return {
                    text: notFound(helpers, '入站'),
                    kind: 'inbounds_unavailable',
                };
            }

            const snapshot = await collect({ includeDetails: true, maxAgeMs: 30_000 });
            const inbounds = collectInboundRows(snapshot);
            if (inbounds.length === 0) {
                return {
                    text: notFound(helpers, '入站'),
                    kind: 'inbounds_empty',
                };
            }

            const { items, page, totalPages, total } = paginate({
                items: inbounds,
                page: Number(args?.page || 1),
                pageSize: PAGE_SIZE,
            });
            const lines = items.map((item) => {
                const serverName = helpers.escapeTelegramHtml(item.serverName || item.serverId || '-');
                return `${formatInboundLine(helpers, item)}\n  节点：${serverName}`;
            });
            const enabledCount = inbounds.filter((item) => item.enable).length;
            const text = helpers.joinHtmlMessage('NMS 入站列表', [
                `${helpers.sectionHeader('入站')}\n${lines.join('\n')}`,
                `${helpers.sectionHeader('概览')}\n共 <b>${total}</b> 个 · 已启用 <b>${enabledCount}</b> 个`,
            ], { subtitle: '集群快照' });

            let replyMarkup;
            if (totalPages > 1) {
                const session = listSessions.create({
                    command: '/inbounds',
                    positional: [],
                });
                replyMarkup = buildPaginationKeyboard({
                    listKey: session.id,
                    page,
                    totalPages,
                });
            }

            return {
                text,
                kind: 'inbounds_list',
                extras: replyMarkup ? { replyMarkup } : undefined,
            };
        },
    });
}

export const __testing = {
    collectInboundRows,
};
