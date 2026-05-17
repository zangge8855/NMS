import { paginate, notFound } from '../commandHelpers.js';
import { buildPaginationKeyboard } from '../inlineKeyboards.js';

const PAGE_SIZE = 8;

function healthLabel(status = '') {
    const text = String(status || '').toLowerCase();
    if (text === 'healthy' || text === 'ok' || text === 'online') return '✅ 正常';
    if (text === 'degraded' || text === 'slow') return '🟡 降级';
    if (text === 'unreachable' || text === 'offline') return '🔴 离线';
    if (text === 'maintenance') return '🛠 维护';
    return text || '-';
}

export function registerServerCommands(registry, ctx) {
    const { helpers, services } = ctx;

    registry.register({
        name: '/servers',
        level: 'query',
        summary: '列出节点状态',
        handler: async () => {
            const statusModule = await services.serverStatus();
            const collect = statusModule.collectClusterStatusSnapshot
                || statusModule.default?.collectClusterStatusSnapshot;
            if (typeof collect !== 'function') {
                return {
                    text: notFound(helpers, '节点'),
                    kind: 'servers_unavailable',
                };
            }
            const snapshot = await collect({ includeDetails: true, maxAgeMs: 30_000 });
            const servers = Array.isArray(snapshot?.servers) ? snapshot.servers : [];
            if (servers.length === 0) {
                return {
                    text: notFound(helpers, '节点'),
                    kind: 'servers_empty',
                };
            }
            const { items, page, totalPages, total } = paginate({ items: servers, pageSize: PAGE_SIZE });
            const lines = items.map((s) => {
                const name = helpers.escapeTelegramHtml(s.name || s.id);
                const health = healthLabel(s.health || s.status);
                const onlineUsers = Number(s.onlineUsers ?? s.summary?.onlineUsers ?? 0);
                const cpu = s.cpu != null ? `${Number(s.cpu).toFixed(0)}%` : '-';
                const mem = s.mem != null ? `${Number(s.mem).toFixed(0)}%` : '-';
                return `• <b>${name}</b> · ${health} · 在线 ${onlineUsers} · CPU ${cpu} · MEM ${mem}`;
            });
            const summaryLine = (snapshot?.summary)
                ? `共 <b>${snapshot.summary.total ?? total}</b> 台 · 正常 ${snapshot.summary.healthy ?? '-'} · 降级 ${snapshot.summary.degraded ?? '-'} · 离线 ${snapshot.summary.unreachable ?? '-'}`
                : `共 <b>${total}</b> 台`;
            const text = helpers.joinHtmlMessage('NMS 节点列表', [
                `${helpers.sectionHeader('节点状态')}\n${lines.join('\n')}`,
                `${helpers.sectionHeader('概览')}\n${summaryLine}`,
            ], { subtitle: '集群快照' });
            return {
                text,
                kind: 'servers_list',
                extras: totalPages > 1
                    ? { replyMarkup: buildPaginationKeyboard({ listKey: 'srv', page, totalPages }) }
                    : undefined,
            };
        },
    });
}
