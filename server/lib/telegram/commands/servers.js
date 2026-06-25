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
    const { helpers, services, listSessions } = ctx;

    registry.register({
        name: '/servers',
        level: 'query',
        summary: '列出节点状态',
        handler: async ({ args }) => {
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
            const servers = Array.isArray(snapshot?.items) ? snapshot.items : [];
            if (servers.length === 0) {
                return {
                    text: notFound(helpers, '节点'),
                    kind: 'servers_empty',
                };
            }
            const { items, page, totalPages, total } = paginate({
                items: servers,
                page: Number(args?.page || 1),
                pageSize: PAGE_SIZE,
            });
            const lines = items.map((s) => {
                const name = helpers.escapeTelegramHtml(s.name || s.id);
                const health = healthLabel(s.health || s.status);
                const rawOnline = s.onlineUsers ?? s.onlineCount ?? s.summary?.onlineUsers;
                const parsedOnline = Number(rawOnline);
                const onlineUsers = Number.isFinite(parsedOnline) ? parsedOnline : 0;
                const cpuValue = s.cpu ?? s.status?.cpu;
                const memValue = s.mem ?? s.status?.mem;
                const cpu = cpuValue != null ? `${Number(cpuValue).toFixed(0)}%` : '-';
                const mem = typeof memValue === 'object' && memValue
                    ? `${Math.round((Number(memValue.current || 0) / Math.max(1, Number(memValue.total || 1))) * 100)}%`
                    : memValue != null
                        ? `${Number(memValue).toFixed(0)}%`
                        : '-';
                return `• <b>${name}</b> · ${health} · 在线 ${onlineUsers} · CPU ${cpu} · MEM ${mem}`;
            });
            const summaryLine = (snapshot?.summary)
                ? `共 <b>${snapshot.summary.total ?? total}</b> 台 · 正常 ${snapshot.summary.healthy ?? '-'} · 降级 ${snapshot.summary.degraded ?? '-'} · 离线 ${snapshot.summary.unreachable ?? '-'}`
                : `共 <b>${total}</b> 台`;
            const text = helpers.joinHtmlMessage('NMS 节点列表', [
                `${helpers.sectionHeader('节点状态')}\n${lines.join('\n')}`,
                `${helpers.sectionHeader('概览')}\n${summaryLine}`,
            ], { subtitle: '集群快照' });
            let replyMarkup;
            if (totalPages > 1) {
                const session = listSessions.create({
                    command: '/servers',
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
                kind: 'servers_list',
                extras: replyMarkup ? { replyMarkup } : undefined,
            };
        },
    });
}
