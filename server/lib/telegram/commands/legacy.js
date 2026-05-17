/**
 * Registers the 12 legacy Telegram commands against a registry.
 *
 * Each handler closes over `ctx` — the digest builders, formatters, and
 * the manual-action callbacks (sendBackupArchive, runMonitorDigest) provided
 * by the telegramAlertService closure. This keeps the existing closure-based
 * architecture in one piece while moving the dispatch table out of the
 * if-else chain.
 */

export function registerLegacyCommands(registry, ctx) {
    if (!registry || typeof registry.register !== 'function') {
        throw new Error('registerLegacyCommands requires a registry');
    }
    if (!ctx || typeof ctx !== 'object') {
        throw new Error('registerLegacyCommands requires a ctx');
    }

    const required = [
        'buildStatusDigest',
        'buildOnlineDigest',
        'buildTrafficDigest',
        'buildAlertsDigest',
        'buildSecurityDigest',
        'buildNodeIssuesDigest',
        'buildAccessDigest',
        'buildExpiryDigest',
        'runMonitorDigest',
        'sendBackupArchive',
        'formatCommandCatalogMessage',
        'joinHtmlMessage',
        'sectionHeader',
        'formatHtmlKeyValueRow',
        'trimLines',
        'formatBytesHuman',
        'formatDateTime',
    ];
    for (const key of required) {
        if (typeof ctx[key] !== 'function') {
            throw new Error(`registerLegacyCommands ctx is missing helper: ${key}`);
        }
    }

    const queryHandler = (kind, builder) => async () => ({
        text: await builder(),
        kind,
    });

    registry.register({
        name: '/start',
        aliases: ['/help'],
        level: 'query',
        summary: '查看可用命令',
        handler: async () => ({
            text: ctx.formatCommandCatalogMessage(),
            kind: 'command_help',
        }),
    });

    registry.register({
        name: '/status',
        level: 'query',
        summary: '系统状态总览',
        handler: queryHandler('status_digest', ctx.buildStatusDigest),
    });

    registry.register({
        name: '/online',
        level: 'query',
        summary: '在线人数与节点分布',
        handler: queryHandler('online_digest', ctx.buildOnlineDigest),
    });

    registry.register({
        name: '/traffic',
        level: 'query',
        summary: '最近 24h 流量摘要',
        handler: queryHandler('traffic_digest', ctx.buildTrafficDigest),
    });

    registry.register({
        name: '/alerts',
        level: 'query',
        summary: '最近未读告警摘要',
        handler: queryHandler('alerts_digest', ctx.buildAlertsDigest),
    });

    registry.register({
        name: '/security',
        level: 'query',
        summary: '最近安全事件汇总',
        handler: queryHandler('security_digest', ctx.buildSecurityDigest),
    });

    registry.register({
        name: '/nodes',
        level: 'query',
        summary: '异常节点摘要',
        handler: queryHandler('node_digest', ctx.buildNodeIssuesDigest),
    });

    registry.register({
        name: '/access',
        level: 'query',
        summary: '最近被拒绝的公开订阅访问',
        handler: queryHandler('access_digest', ctx.buildAccessDigest),
    });

    registry.register({
        name: '/expiry',
        level: 'query',
        summary: '用户到期提醒摘要',
        handler: queryHandler('expiry_digest', ctx.buildExpiryDigest),
    });

    // /monitor and /backup have side effects (run inspection / send backup)
    // but they're long-standing low-risk one-shots, so they stay 'query' for
    // backward compatibility. Step 4+ may revisit /backup if needed.
    registry.register({
        name: '/monitor',
        level: 'query',
        summary: '立即执行节点巡检',
        handler: async ({ ctx: invokeCtx }) => ({
            text: await ctx.runMonitorDigest(invokeCtx?.actor || 'telegram'),
            kind: 'monitor_digest',
        }),
    });

    registry.register({
        name: '/backup',
        level: 'query',
        summary: '立即发送一次加密备份',
        handler: async ({ ctx: invokeCtx }) => {
            const result = await ctx.sendBackupArchive(invokeCtx?.actor || 'telegram', { reason: 'manual' });
            return {
                text: ctx.joinHtmlMessage('NMS Telegram 控制台', [
                    `${ctx.sectionHeader('运维动作')}\n• 已发送加密备份到当前会话`,
                    `${ctx.sectionHeader('关键信息')}\n${ctx.trimLines([
                        ctx.formatHtmlKeyValueRow('文件', result?.archive?.filename || result?.filename || '-'),
                        ctx.formatHtmlKeyValueRow('大小', ctx.formatBytesHuman(result?.archive?.bytes || result?.bytes || 0)),
                        ctx.formatHtmlKeyValueRow('时间', ctx.formatDateTime(result?.ts || result?.sentAt || new Date().toISOString())),
                    ])}`,
                ], {
                    subtitle: '手动备份执行结果',
                }),
                kind: 'backup_manual_result',
            };
        },
    });
}
