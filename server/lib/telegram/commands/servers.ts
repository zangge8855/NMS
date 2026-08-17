import { paginate, notFound } from '../commandHelpers.js';
import { buildPaginationKeyboard } from '../inlineKeyboards.js';
import type { CommandRegistry } from '../commandRegistry.js';

const PAGE_SIZE = 8;

function healthLabel(status: string = ''): string {
    const text = String(status || '').toLowerCase();
    if (text === 'healthy' || text === 'ok' || text === 'online') return '✅ 正常';
    if (text === 'degraded' || text === 'slow') return '🟡 降级';
    if (text === 'unreachable' || text === 'offline') return '🔴 离线';
    if (text === 'maintenance') return '🛠 维护';
    return text || '-';
}

export function registerServerCommands(registry: CommandRegistry, ctx: any): void {
    const { helpers, services, listSessions } = ctx;

    registry.register({
        name: '/servers',
        level: 'query',
        summary: '列出节点状态',
        handler: async ({ args }: { args: any }) => {
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
            const lines = items.map((s: any) => {
                const name = helpers.escapeTelegramHtml(s.name || s.id);
                const health = healthLabel(s.health || s.status);
                const rawOnline = s.onlineUsers ?? s.onlineCount ?? s.summary?.onlineUsers;
                const parsedOnline = Number(rawOnline);
                const onlineUsers = Number.isFinite(parsedOnline) ? parsedOnline : 0;
                const cpuValue = s.cpu ?? s.status?.cpu;
                const memValue = s.mem ?? s.status?.mem;
                const asFinite = (value: unknown) => {
                    const parsed = Number(value);
                    return Number.isFinite(parsed) ? parsed : null;
                };
                const parsedCpu = asFinite(cpuValue);
                const cpu = parsedCpu != null ? `${parsedCpu.toFixed(0)}%` : '-';
                let mem = '-';
                if (typeof memValue === 'object' && memValue) {
                    const current = asFinite(memValue.current) ?? 0;
                    const totalMem = asFinite(memValue.total);
                    mem = totalMem > 0 ? `${Math.round((current / totalMem) * 100)}%` : '-';
                } else {
                    const parsedMem = asFinite(memValue);
                    if (parsedMem != null) mem = `${parsedMem.toFixed(0)}%`;
                }
                return `• <b>${name}</b> · ${health} · 在线 ${onlineUsers} · CPU ${cpu} · MEM ${mem}`;
            });
            const summaryLine = (snapshot?.summary)
                ? `共 <b>${snapshot.summary.total ?? total}</b> 台 · 正常 ${snapshot.summary.healthy ?? '-'} · 降级 ${snapshot.summary.degraded ?? '-'} · 离线 ${snapshot.summary.unreachable ?? '-'}`
                : `共 <b>${total}</b> 台`;
            const text = helpers.joinHtmlMessage('NMS 节点列表', [
                `${helpers.sectionHeader('节点状态')}\n${lines.join('\n')}`,
                `${helpers.sectionHeader('概览')}\n${summaryLine}`,
            ], { subtitle: '集群快照' });
            let replyMarkup: any;
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
