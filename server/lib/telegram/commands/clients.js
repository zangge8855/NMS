import { findUserByIdOrEmail, paginate, missingArgs, notFound, compactDate, inlineCode } from '../commandHelpers.js';
import { buildPaginationKeyboard } from '../inlineKeyboards.js';

const PAGE_SIZE = 8;

function formatTrafficUsage(helpers, user) {
    const used = Number(user.trafficUsedBytes || user.usedBytes || 0);
    const limit = Number(user.trafficLimitBytes || user.totalBytes || 0);
    if (limit > 0) {
        const percent = Math.min(100, Math.round((used / limit) * 100));
        return `${helpers.formatBytesHuman(used)} / ${helpers.formatBytesHuman(limit)} (${percent}%)`;
    }
    return `${helpers.formatBytesHuman(used)} / 不限`;
}

function summarizeUserLine(helpers, user) {
    const ident = user.email || user.username || user.id;
    const status = user.enabled === false ? '🚫 停用' : '✅ 启用';
    const expiry = user.expiryTime ? compactDate(user.expiryTime) : '永久';
    return `• <b>${helpers.escapeTelegramHtml(ident)}</b> · ${status} · 到期 ${helpers.escapeTelegramHtml(expiry)}`;
}

export function registerClientCommands(registry, ctx) {
    const { helpers, services, listSessions } = ctx;

    registry.register({
        name: '/clients',
        level: 'query',
        summary: '列出客户（可加搜索关键词）',
        handler: async ({ args }) => {
            const keyword = String(args?.positional?.[0] || '').trim().toLowerCase();
            const userAdmin = await services.userAdmin();
            const users = userAdmin.listUsers().filter((u) =>
                u.role !== 'admin'
                && (!keyword
                    || String(u.email || '').toLowerCase().includes(keyword)
                    || String(u.username || '').toLowerCase().includes(keyword)
                    || String(u.id || '').toLowerCase().includes(keyword))
            );
            if (users.length === 0) {
                return {
                    text: notFound(helpers, '客户'),
                    kind: 'clients_empty',
                };
            }
            const { items, page, totalPages, total } = paginate({
                items: users,
                page: Number(args?.page || 1),
                pageSize: PAGE_SIZE,
            });
            const lines = items.map((u) => summarizeUserLine(helpers, u));
            const text = helpers.joinHtmlMessage('NMS 客户列表', [
                `${helpers.sectionHeader('结果')}\n${lines.join('\n')}`,
                `${helpers.sectionHeader('提示')}\n• 共 <b>${total}</b> 位\n• 使用 <code>/client &lt;email&gt;</code> 查看详情`,
            ], { subtitle: keyword ? `关键词: ${keyword}` : '全部客户' });

            let replyMarkup;
            if (totalPages > 1) {
                const session = listSessions.create({
                    command: '/clients',
                    positional: keyword ? [keyword] : [],
                });
                replyMarkup = buildPaginationKeyboard({
                    listKey: session.id,
                    page,
                    totalPages,
                });
            }
            return {
                text,
                kind: 'clients_list',
                extras: replyMarkup ? { replyMarkup } : undefined,
            };
        },
    });

    registry.register({
        name: '/client',
        level: 'query',
        summary: '查看客户详情',
        handler: async ({ args }) => {
            const target = args?.positional?.[0];
            if (!target) {
                return { text: missingArgs(helpers, '/client <id 或 email>'), kind: 'client_missing_args' };
            }
            const userAdmin = await services.userAdmin();
            const users = userAdmin.listUsers();
            const user = findUserByIdOrEmail(users, target);
            if (!user) {
                return { text: notFound(helpers, '客户'), kind: 'client_not_found' };
            }

            const rows = [
                helpers.formatHtmlKeyValueRow('ID', user.id),
                helpers.formatHtmlKeyValueRow('用户名', user.username || '-'),
                helpers.formatHtmlKeyValueRow('邮箱', user.email || '-'),
                helpers.formatHtmlKeyValueRow('订阅邮箱', user.subscriptionEmail || '-'),
                helpers.formatHtmlKeyValueRow('状态', user.enabled === false ? '🚫 停用' : '✅ 启用'),
                helpers.formatHtmlKeyValueRow('到期', user.expiryTime ? compactDate(user.expiryTime) : '永久'),
                helpers.formatHtmlKeyValueRow('流量', formatTrafficUsage(helpers, user)),
                helpers.formatHtmlKeyValueRow('IP 限', user.limitIp ?? '-'),
            ];

            return {
                text: helpers.joinHtmlMessage('NMS 客户详情', [
                    `${helpers.sectionHeader('关键信息')}\n${helpers.trimLines(rows)}`,
                    `${helpers.sectionHeader('快捷操作')}\n• <code>/sub ${user.email || user.id}</code> 取订阅 URL`,
                ], { subtitle: user.email || user.id }),
                kind: 'client_detail',
            };
        },
    });

    registry.register({
        name: '/sub',
        level: 'query',
        summary: '取订阅链接',
        handler: async ({ args }) => {
            const target = args?.positional?.[0];
            if (!target) {
                return { text: missingArgs(helpers, '/sub <id 或 email>'), kind: 'sub_missing_args' };
            }
            const userAdmin = await services.userAdmin();
            const users = userAdmin.listUsers();
            const user = findUserByIdOrEmail(users, target);
            if (!user) {
                return { text: notFound(helpers, '客户'), kind: 'sub_not_found' };
            }

            // Show whatever profile / token info is already on the user
            // record. Don't trigger token issuance from a read-only command.
            const tokens = Array.isArray(user.subscriptionTokens) ? user.subscriptionTokens : [];
            const rows = [
                helpers.formatHtmlKeyValueRow('客户', user.email || user.username || user.id),
                helpers.formatHtmlKeyValueRow('订阅邮箱', user.subscriptionEmail || '-'),
                helpers.formatHtmlKeyValueRow('Token 数', tokens.length || 0),
            ];
            const tokenLines = tokens.slice(0, 3).map((t) => {
                const id = String(t.id || '').slice(0, 8);
                const profile = String(t.profile || 'default');
                return `• ${inlineCode(helpers, profile)} · token ${inlineCode(helpers, id || '-')}`;
            });
            const blocks = [`${helpers.sectionHeader('关键信息')}\n${helpers.trimLines(rows)}`];
            if (tokenLines.length > 0) {
                blocks.push(`${helpers.sectionHeader('Token 列表')}\n${tokenLines.join('\n')}`);
            } else {
                blocks.push(`${helpers.sectionHeader('提示')}\n• 该客户暂无订阅 Token；请在管理后台 Issue 一个`);
            }
            return {
                text: helpers.joinHtmlMessage('NMS 订阅信息', blocks, { subtitle: user.email || user.id }),
                kind: 'sub_detail',
            };
        },
    });
}
