import config from '../config.js';
import systemSettingsStore from '../store/systemSettingsStore.js';

const DEFAULT_ALERT_SEVERITIES = new Set(['warning', 'critical']);
const DEFAULT_AUDIT_EVENT_RULES = {
    login_failed: { severity: 'warning', label: '登录失败' },
    login_denied_email_unverified: { severity: 'warning', label: '未验证邮箱尝试登录' },
    login_denied_user_disabled: { severity: 'warning', label: '停用账号尝试登录' },
    login_rate_limited: { severity: 'critical', label: '登录频率限制' },
    password_reset_request_rate_limited: { severity: 'critical', label: '重置密码请求频率限制' },
    register_rate_limited: { severity: 'critical', label: '注册频率限制' },
    subscription_public_denied: { severity: 'warning', label: '公开订阅访问被拒绝' },
    subscription_public_denied_legacy: { severity: 'warning', label: '旧版订阅访问被拒绝' },
    batch_clients_high_risk_action: { severity: 'warning', label: '高风险批量客户端操作' },
    batch_inbounds_high_risk_action: { severity: 'warning', label: '高风险批量入站操作' },
    batch_high_risk_retry: { severity: 'warning', label: '高风险批量任务重试' },
};
const DEFAULT_DEDUP_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_API_BASE_URL = 'https://api.telegram.org';
const POLL_INTERVAL_MS = 5000;
const OPS_DIGEST_INTERVAL_MS = 30 * 60 * 1000;
const DAILY_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUERY_COMMANDS = [
    { command: '/status', description: '系统状态总览' },
    { command: '/online', description: '在线人数与节点分布' },
    { command: '/traffic', description: '最近 24h 流量摘要' },
    { command: '/alerts', description: '最近未读告警摘要' },
    { command: '/security', description: '最近安全事件汇总' },
    { command: '/nodes', description: '异常节点摘要' },
    { command: '/access', description: '最近被拒绝的公开订阅访问' },
    { command: '/expiry', description: '用户到期提醒摘要' },
];
const DEFAULT_OPERATION_COMMANDS = [
    { command: '/monitor', description: '立即执行节点巡检' },
];
const AGGREGATE_SAMPLE_LIMIT = 5;

function normalizeStringArray(input = []) {
    return Array.from(new Set(
        (Array.isArray(input) ? input : [])
            .map((item) => String(item || '').trim().toLowerCase())
            .filter(Boolean)
    ));
}

function maskToken(token = '') {
    const text = String(token || '').trim();
    if (!text) return '';
    if (text.length <= 8) return '***';
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function maskChatId(chatId = '') {
    const text = String(chatId || '').trim();
    if (!text) return '';
    if (text.length <= 4) return '***';
    return `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}

function stringifyDetails(value) {
    try {
        const text = JSON.stringify(value || {});
        if (!text || text === '{}') return '';
        return text.length > 800 ? `${text.slice(0, 800)}...` : text;
    } catch {
        return '';
    }
}

function stringifyResidualDetails(value, omittedKeys = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
    }
    const omitted = new Set((Array.isArray(omittedKeys) ? omittedKeys : []).map((item) => String(item || '').trim()).filter(Boolean));
    const residual = Object.fromEntries(
        Object.entries(value).filter(([key, entryValue]) => {
            if (omitted.has(key)) return false;
            if (entryValue === null || entryValue === undefined) return false;
            if (typeof entryValue === 'string' && !entryValue.trim()) return false;
            if (Array.isArray(entryValue) && entryValue.length === 0) return false;
            return true;
        })
    );
    return stringifyDetails(residual);
}

function truncateLine(value, limit = 400) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function truncateMessageText(value, limit = 3900) {
    const text = String(value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .trim();
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function startBackgroundInterval(fn, delayMs) {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function startBackgroundTimeout(fn, delayMs) {
    const timer = setTimeout(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function createDefaultFetcher() {
    return async ({ url, body }) => {
        if (typeof fetch !== 'function') {
            throw new Error('fetch-unavailable');
        }
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const payload = await response.text().catch(() => '');
            throw new Error(`telegram-http-${response.status}${payload ? `:${payload}` : ''}`);
        }
        return response.json().catch(() => ({}));
    };
}

function severityLabel(severity = 'info') {
    const normalized = String(severity || 'info').trim().toLowerCase();
    if (normalized === 'critical') return '紧急';
    if (normalized === 'warning') return '告警';
    return '信息';
}

function formatDateTime(value) {
    if (!value) return '暂无';
    try {
        return new Date(value).toLocaleString('zh-CN', { hour12: false });
    } catch {
        return String(value);
    }
}

function formatBytesHuman(value = 0) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size >= 100 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDurationHuman(value = 0) {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return '不足 1 分钟';
    const totalMinutes = Math.max(1, Math.round(ms / 60000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days > 0) parts.push(`${days} 天`);
    if (hours > 0) parts.push(`${hours} 小时`);
    if (minutes > 0) parts.push(`${minutes} 分钟`);
    return parts.slice(0, 3).join(' ') || '不足 1 分钟';
}

function formatWindowLabel(ms = 0) {
    const totalMinutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
    if (totalMinutes % (24 * 60) === 0) {
        return `最近 ${Math.max(1, totalMinutes / (24 * 60))} 天`;
    }
    if (totalMinutes % 60 === 0) {
        return `最近 ${Math.max(1, totalMinutes / 60)} 小时`;
    }
    return `最近 ${totalMinutes} 分钟`;
}

function formatLocationCarrierText(location = '', carrier = '') {
    const parts = [String(location || '').trim(), String(carrier || '').trim()].filter(Boolean);
    return parts.join(' · ');
}

function sumTrafficTotals(entries = []) {
    return (Array.isArray(entries) ? entries : []).reduce((totals, item) => {
        totals.upBytes += Number(item?.upBytes || 0);
        totals.downBytes += Number(item?.downBytes || 0);
        totals.totalBytes += Number(item?.totalBytes || 0);
        return totals;
    }, {
        upBytes: 0,
        downBytes: 0,
        totalBytes: 0,
    });
}

function escapeTelegramHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatExpiryDateTime(value) {
    const timestamp = Number(value || 0);
    if (!(timestamp > 0)) return '';
    return formatDateTime(timestamp);
}

function escapeTelegramCommand(command = '') {
    return escapeTelegramHtml(String(command || '').trim().replace(/^\//, ''));
}

function formatHtmlValue(value) {
    return `<b>${escapeTelegramHtml(value)}</b>`;
}

function formatHtmlKeyValueRow(label, value) {
    const normalizedValue = String(value ?? '').trim();
    if (!label || !normalizedValue) return '';
    return `${escapeTelegramHtml(label)}: ${formatHtmlValue(normalizedValue)}`;
}

function formatStageLabel(stage = '') {
    const normalized = String(stage || '').trim().toLowerCase();
    if (normalized === 'expired') return '已到期';
    if (normalized === '1d') return '1 天内到期';
    if (normalized === '3d') return '3 天内到期';
    if (normalized === '7d') return '7 天内到期';
    return normalized;
}

function formatHtmlDetailBlock(title, rows = [], { rawRows = false } = {}) {
    const normalizedRows = rows.filter(Boolean);
    const body = normalizedRows
        .map((row) => `  ${rawRows ? row : escapeTelegramHtml(row)}`)
        .join('\n');
    return `<b>${escapeTelegramHtml(title)}</b>${body ? `\n${body}` : ''}`;
}

function formatCounterHtmlRows(counter, { limit = 5, suffix = ' 次' } = {}) {
    return Array.from(counter.entries())
        .sort((left, right) => {
            if (right[1] !== left[1]) return right[1] - left[1];
            return left[0].localeCompare(right[0], 'zh-CN');
        })
        .slice(0, limit)
        .map(([label, count]) => `<b>${escapeTelegramHtml(label)}</b> · ${formatHtmlValue(`${count}${suffix}`)}`);
}

function buildTelegramCommandMenu(items = []) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const command = String(item?.command || '').trim().replace(/^\//, '');
            const description = String(item?.description || '').trim();
            if (!command || !description) return null;
            return {
                command,
                description,
            };
        })
        .filter(Boolean);
}

function formatNotificationMessage(notification = {}) {
    const meta = notification.meta || {};
    const locationCarrier = formatLocationCarrierText(meta.ipLocation, meta.ipCarrier);
    const detailText = stringifyResidualDetails(meta.details, [
        'serverId',
        'reasonCode',
        'event',
        'targetUsername',
        'targetEmail',
        'subscriptionEmail',
        'stage',
        'label',
        'remainingDays',
        'expiryTime',
        'outageDurationMs',
        'previousHealth',
        'recentAttempts',
        'distinctTargets',
        'suspectedBruteforce',
        'rateLimited',
        'recentDeniedCount',
        'distinctPaths',
        'ip',
        'ipLocation',
        'ipCarrier',
        'method',
        'path',
        'userAgent',
        'ua',
    ]);
    const blocks = [];
    const expiryLabel = formatExpiryDateTime(meta.expiryTime);
    const targetUser = String(meta.targetUsername || meta.targetEmail || '').trim();
    const subscriptionEmail = String(meta.subscriptionEmail || '').trim();
    const stageLabel = formatStageLabel(meta.stage || meta.label);
    const userAgent = truncateLine(meta.userAgent || meta.ua || '', 200);
    const repeatedLoginSummary = Number(meta.recentAttempts || 0) > 0
        ? `${Number(meta.recentAttempts || 0)} 次 · ${Number(meta.distinctTargets || 0)} 个账号`
        : '';
    const accessSummary = Number(meta.recentDeniedCount || 0) > 0
        ? `${Number(meta.recentDeniedCount || 0)} 次 · ${Number(meta.distinctPaths || 0) || 1} 个入口`
        : '';
    const recoveryDuration = Number(meta.outageDurationMs || 0) > 0
        ? formatDurationHuman(meta.outageDurationMs)
        : '';
    const notificationTitle = truncateLine(notification.title, 120) || '系统通知';

    appendHtmlSection(blocks, '关键信息', [
        formatHtmlKeyValueRow('级别', severityLabel(notification.severity)),
        formatHtmlKeyValueRow('类型', notification.type || 'system'),
        formatHtmlKeyValueRow('时间', formatDateTime(notification.createdAt || new Date().toISOString())),
    ], { rawRows: true });

    appendHtmlSection(blocks, '影响范围', [
        targetUser ? formatHtmlKeyValueRow('目标账号', targetUser) : '',
        subscriptionEmail ? formatHtmlKeyValueRow('订阅邮箱', subscriptionEmail) : '',
        meta.serverId ? formatHtmlKeyValueRow('节点', meta.serverId) : '',
        meta.reasonCode ? formatHtmlKeyValueRow('原因码', meta.reasonCode) : '',
        meta.event ? formatHtmlKeyValueRow('事件编码', meta.event) : '',
        stageLabel ? formatHtmlKeyValueRow('阶段', stageLabel) : '',
        Number.isFinite(Number(meta.remainingDays)) && Number(meta.remainingDays) > 0
            ? formatHtmlKeyValueRow('剩余时间', `${Number(meta.remainingDays)} 天`)
            : '',
        expiryLabel ? formatHtmlKeyValueRow('到期时间', expiryLabel) : '',
        recoveryDuration ? formatHtmlKeyValueRow('恢复耗时', recoveryDuration) : '',
        meta.previousHealth ? formatHtmlKeyValueRow('恢复前状态', formatHealthLabel(meta.previousHealth)) : '',
        repeatedLoginSummary ? formatHtmlKeyValueRow('近 5 分钟同源失败', repeatedLoginSummary) : '',
        meta.suspectedBruteforce ? formatHtmlKeyValueRow('风险判定', '疑似爆破') : '',
        meta.rateLimited ? formatHtmlKeyValueRow('限流状态', '已触发') : '',
        accessSummary ? formatHtmlKeyValueRow('近 10 分钟同源访问', accessSummary) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '来源线索', [
        meta.ip ? formatHtmlKeyValueRow('IP', meta.ip) : '',
        locationCarrier ? formatHtmlKeyValueRow('归属地 / 运营商', locationCarrier) : '',
        meta.method || meta.path ? formatHtmlKeyValueRow('请求', `${meta.method || '-'} ${meta.path || '-'}`) : '',
        userAgent ? formatHtmlKeyValueRow('UA', userAgent) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '事件摘要', [
        notification.body ? escapeTelegramHtml(truncateLine(notification.body, 800)) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '附加上下文', [
        detailText ? `上下文: <code>${escapeTelegramHtml(detailText)}</code>` : '',
    ], { rawRows: true });

    return joinHtmlMessage(`NMS 系统通知 · ${notificationTitle}`, blocks, {
        subtitle: '系统事件推送',
    });
}

function formatAuditMessage(entry = {}, rule = {}) {
    const blocks = [];
    const locationCarrier = formatLocationCarrierText(entry.ipLocation, entry.ipCarrier);
    const detailText = stringifyResidualDetails(entry.details, [
        'username',
        'email',
        'subscriptionEmail',
        'targetUsername',
        'targetEmail',
        'tokenId',
        'token',
        'recentAttempts',
        'distinctTargets',
        'recentDeniedCount',
        'suspectedBruteforce',
        'rateLimited',
        'userAgent',
        'serverId',
        'method',
        'path',
        'ip',
        'ipLocation',
        'ipCarrier',
    ]);
    const targetUser = String(
        entry.targetEmail
        || entry.subscriptionEmail
        || entry.email
        || entry.targetUsername
        || entry.details?.subscriptionEmail
        || entry.details?.email
        || entry.details?.username
        || ''
    ).trim();
    const userAgent = truncateLine(entry.userAgent || entry.details?.userAgent || '', 200);
    const tokenId = String(entry.tokenId || entry.details?.tokenId || entry.details?.token || '').trim();
    const recentAttempts = Number(entry.recentAttempts || entry.details?.recentAttempts || 0);
    const distinctTargets = Number(entry.distinctTargets || entry.details?.distinctTargets || 0);
    const recentDeniedCount = Number(entry.recentDeniedCount || entry.details?.recentDeniedCount || 0);
    const auditTitle = rule.label || entry.eventType || entry.event || '安全审计';

    appendHtmlSection(blocks, '关键信息', [
        formatHtmlKeyValueRow('级别', severityLabel(rule.severity || 'warning')),
        formatHtmlKeyValueRow('编码', entry.eventType || entry.event || 'audit_event'),
        formatHtmlKeyValueRow('时间', formatDateTime(entry.ts || new Date().toISOString())),
        formatHtmlKeyValueRow('结果', formatAuditOutcome(entry.outcome)),
        formatHtmlKeyValueRow('操作者', entry.actor || 'anonymous'),
        recentAttempts > 0 ? formatHtmlKeyValueRow('近 5 分钟同源失败', `${recentAttempts} 次 · ${distinctTargets} 个账号`) : '',
        entry.suspectedBruteforce || entry.details?.suspectedBruteforce ? formatHtmlKeyValueRow('风险判定', '疑似爆破') : '',
        entry.rateLimited || entry.details?.rateLimited ? formatHtmlKeyValueRow('限流状态', '已触发') : '',
        recentDeniedCount > 0 ? formatHtmlKeyValueRow('近 10 分钟同源访问', `${recentDeniedCount} 次`) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '操作目标', [
        entry.serverId ? formatHtmlKeyValueRow('节点', entry.serverId) : '',
        targetUser ? formatHtmlKeyValueRow('目标用户', targetUser) : '',
        tokenId ? formatHtmlKeyValueRow('Token', tokenId) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '来源线索', [
        entry.ip ? formatHtmlKeyValueRow('IP', entry.ip) : '',
        locationCarrier ? formatHtmlKeyValueRow('归属地 / 运营商', locationCarrier) : '',
        entry.method || entry.path ? formatHtmlKeyValueRow('请求', `${entry.method || '-'} ${entry.path || '-'}`) : '',
        userAgent ? formatHtmlKeyValueRow('UA', userAgent) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '附加上下文', [
        detailText ? `上下文: <code>${escapeTelegramHtml(detailText)}</code>` : '',
    ], { rawRows: true });

    return joinHtmlMessage(`NMS 安全审计 · ${auditTitle}`, blocks, {
        subtitle: '安全审计推送',
    });
}

function normalizeCommand(value) {
    return String(value || '').trim().split(/\s+/)[0].toLowerCase();
}

function isNumericChatId(value) {
    return /^-?\d+$/.test(String(value || '').trim());
}

function trimLines(lines = []) {
    return lines.filter(Boolean).join('\n').trim();
}

function appendSection(lines, title, rows = []) {
    const normalizedRows = rows.filter(Boolean);
    if (normalizedRows.length === 0) return;
    if (lines.length > 0) {
        lines.push('');
    }
    lines.push(title);
    normalizedRows.forEach((row) => {
        lines.push(`- ${row}`);
    });
}

function appendHtmlSection(blocks, title, rows = [], { rawRows = false } = {}) {
    const normalizedRows = rows.filter(Boolean);
    if (normalizedRows.length === 0) return;
    const sectionRows = normalizedRows.map((row) => `• ${rawRows ? row : escapeTelegramHtml(row)}`);
    blocks.push(`<b>${escapeTelegramHtml(title)}</b>\n${sectionRows.join('\n')}`);
}

function joinHtmlMessage(title, blocks = [], options = {}) {
    const parts = [`<b>${escapeTelegramHtml(title)}</b>`];
    if (options?.subtitle) {
        parts.push(`<i>${escapeTelegramHtml(options.subtitle)}</i>`);
    }
    parts.push(...blocks);
    return parts.join('\n\n').trim();
}

function formatCommandRows(items = []) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const command = String(item?.command || '').trim();
            const description = String(item?.description || '').trim();
            if (!command || !description) return '';
            return `${command} ${description}`;
        })
        .filter(Boolean);
}

function formatCommandHtmlRows(items = []) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const command = String(item?.command || '').trim();
            const description = String(item?.description || '').trim();
            if (!command || !description) return '';
            return `<code>${escapeTelegramHtml(command)}</code> ${escapeTelegramHtml(description)}`;
        })
        .filter(Boolean);
}

function formatCommandHtmlTable(items = []) {
    const rows = (Array.isArray(items) ? items : [])
        .map((item) => {
            const command = String(item?.command || '').trim();
            const description = String(item?.description || '').trim();
            if (!command || !description) return null;
            return { command, description };
        })
        .filter(Boolean);
    if (rows.length === 0) return '';
    const commandWidth = Math.max(...rows.map((item) => item.command.length), 8) + 2;
    return `<pre>${rows
        .map((item) => `${escapeTelegramHtml(item.command.padEnd(commandWidth, ' '))}${escapeTelegramHtml(item.description)}`)
        .join('\n')}</pre>`;
}

export function formatCommandCatalogMessage(options = {}) {
    const title = String(options.title || 'NMS Telegram 控制台').trim() || 'NMS Telegram 控制台';
    const blocks = [];
    appendHtmlSection(blocks, '快速开始', [
        '输入框输入 <code>/</code> 可直接选命令',
        '机器人启动后会自动同步命令菜单',
    ], { rawRows: true });
    const queryTable = formatCommandHtmlTable(options.queryCommands || DEFAULT_QUERY_COMMANDS);
    if (queryTable) {
        blocks.push(`<b>状态查询</b>\n${queryTable}`);
    }
    const operationTable = formatCommandHtmlTable(options.operationCommands || DEFAULT_OPERATION_COMMANDS);
    if (operationTable) {
        blocks.push(`<b>运维动作</b>\n${operationTable}`);
    }
    return joinHtmlMessage(title, blocks, {
        subtitle: '状态摘要查询与巡检触发入口',
    });
}

export async function collectStatusDigestContext(deps = {}) {
    const collectClusterStatusSnapshot = typeof deps.collectClusterStatusSnapshot === 'function'
        ? deps.collectClusterStatusSnapshot
        : (await import('./serverStatusService.js')).collectClusterStatusSnapshot;
    const serverHealthMonitor = deps.serverHealthMonitor
        || await import('./serverHealthMonitor.js').then((module) => module.default);

    const snapshot = await collectClusterStatusSnapshot({
        includeDetails: true,
        maxAgeMs: 30_000,
    });
    const summary = snapshot?.summary || {};
    const fallbackUpBytes = Number(summary.totalUp || 0);
    const fallbackDownBytes = Number(summary.totalDown || 0);
    let traffic = {
        upBytes: fallbackUpBytes,
        downBytes: fallbackDownBytes,
        totalBytes: fallbackUpBytes + fallbackDownBytes,
        lastCollectionAt: '',
        source: 'cluster_snapshot',
    };

    try {
        const trafficStatsStore = deps.trafficStatsStore || (await import('../store/trafficStatsStore.js')).default;
        if (trafficStatsStore?.collectIfStale && trafficStatsStore?.getOverview) {
            await trafficStatsStore.collectIfStale(false);
            const overview = trafficStatsStore.getOverview({ days: 1, top: 5 });
            const serverTotals = Array.isArray(overview?.serverTotals) ? overview.serverTotals : [];
            if (serverTotals.length > 0) {
                traffic = {
                    ...sumTrafficTotals(serverTotals),
                    lastCollectionAt: overview?.lastCollectionAt || '',
                    source: 'traffic_store',
                };
            }
        }
    } catch {
        // Fall back to the live cluster status snapshot when traffic samples are unavailable.
    }

    return {
        summary,
        traffic,
        checkedAt: summary.checkedAt || serverHealthMonitor?.getStatus?.()?.lastRunAt || '',
    };
}

export function formatStatusDigestMessage(context = {}) {
    const summary = context?.summary || {};
    const traffic = context?.traffic || {};
    const checkedAt = context?.checkedAt || '';
    const blocks = [];
    appendHtmlSection(blocks, '核心指标', [
        formatHtmlKeyValueRow('节点规模', `${summary.total || 0} 台`),
        formatHtmlKeyValueRow('在线用户', summary.totalOnline || 0),
        formatHtmlKeyValueRow('活跃入站', `${summary.activeInbounds || 0}/${summary.totalInbounds || 0}`),
    ], { rawRows: true });

    appendHtmlSection(blocks, '节点健康', [
        formatHtmlKeyValueRow('正常', summary.healthy || 0),
        formatHtmlKeyValueRow('降级', summary.degraded || 0),
        formatHtmlKeyValueRow('离线', summary.unreachable || 0),
        formatHtmlKeyValueRow('维护', summary.maintenance || 0),
    ], { rawRows: true });

    appendHtmlSection(blocks, '24h 流量', [
        formatHtmlKeyValueRow('统计口径', traffic.source === 'traffic_store' ? '最近 24h 采样汇总' : '当前节点快照累计值'),
        formatHtmlKeyValueRow('上行', formatBytesHuman(traffic.upBytes || 0)),
        formatHtmlKeyValueRow('下行', formatBytesHuman(traffic.downBytes || 0)),
        formatHtmlKeyValueRow('合计', formatBytesHuman(traffic.totalBytes || ((traffic.upBytes || 0) + (traffic.downBytes || 0)))),
    ], { rawRows: true });

    appendHtmlSection(blocks, '时间', [
        traffic.lastCollectionAt ? formatHtmlKeyValueRow('最近采集', formatDateTime(traffic.lastCollectionAt)) : '',
        formatHtmlKeyValueRow('最近巡检', formatDateTime(checkedAt)),
    ], { rawRows: true });

    return joinHtmlMessage('NMS 状态总览', blocks, {
        subtitle: '集群即时状态与最近 24h 流量',
    });
}

function formatDetailBlock(title, rows = []) {
    const normalizedRows = rows.filter(Boolean);
    if (normalizedRows.length === 0) return title;
    return `${title}\n  ${normalizedRows.join('\n  ')}`;
}

function incrementCounter(counter, key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    counter.set(normalizedKey, (counter.get(normalizedKey) || 0) + 1);
}

function formatCounterRows(counter, { limit = 5, suffix = ' 次' } = {}) {
    return Array.from(counter.entries())
        .sort((left, right) => {
            if (right[1] !== left[1]) return right[1] - left[1];
            return left[0].localeCompare(right[0], 'zh-CN');
        })
        .slice(0, limit)
        .map(([label, count]) => `${label} · ${count}${suffix}`);
}

function formatAuditOutcome(outcome = '') {
    const normalized = String(outcome || '').trim().toLowerCase();
    if (normalized === 'success') return '成功';
    if (normalized === 'failed') return '失败';
    if (normalized === 'info') return '信息';
    if (normalized === 'denied') return '已拒绝';
    return normalized || '未标记';
}

function formatHealthLabel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'healthy') return '正常';
    if (normalized === 'degraded') return '降级';
    if (normalized === 'unreachable') return '离线';
    if (normalized === 'maintenance') return '维护';
    return normalized || '未知';
}

function createAggregateBucket(key, payload = {}, windowMs = DEFAULT_DEDUP_WINDOW_MS) {
    const createdAt = String(payload.createdAt || new Date().toISOString()).trim() || new Date().toISOString();
    return {
        key,
        windowMs,
        type: String(payload.type || payload.eventType || payload.kind || 'notification').trim(),
        title: String(payload.title || payload.eventType || payload.kind || '重复事件').trim(),
        severity: String(payload.severity || 'info').trim().toLowerCase(),
        firstAt: createdAt,
        lastAt: createdAt,
        count: 0,
        suppressedCount: 0,
        summarySent: false,
        sourceCounter: new Map(),
        targetCounter: new Map(),
        nodeCounter: new Map(),
        pathCounter: new Map(),
        reasonCounter: new Map(),
        stageCounter: new Map(),
        samples: [],
    };
}

function updateAggregateBucket(bucket, payload = {}) {
    const meta = payload.meta || payload.details || {};
    const createdAt = String(payload.createdAt || new Date().toISOString()).trim() || new Date().toISOString();
    const ip = String(meta.ip || payload.ip || '').trim();
    const locationCarrier = formatLocationCarrierText(meta.ipLocation || payload.ipLocation, meta.ipCarrier || payload.ipCarrier);
    const sourceLabel = [ip, locationCarrier].filter(Boolean).join(' · ');
    const targetLabel = String(
        meta.targetUsername
        || meta.targetEmail
        || meta.subscriptionEmail
        || meta.email
        || payload.targetEmail
        || payload.actor
        || ''
    ).trim();
    const pathLabel = [String(meta.method || payload.method || '').trim(), String(meta.path || payload.path || '').trim()]
        .filter(Boolean)
        .join(' ');
    const reasonLabel = String(meta.reasonCode || meta.event || payload.eventType || payload.type || '').trim();
    const stageLabel = String(meta.stage || meta.label || '').trim();
    const nodeLabel = String(meta.serverId || payload.serverId || '').trim();
    const sampleLine = truncateLine(payload.body || payload.title || payload.eventType || '', 160);

    bucket.count += 1;
    bucket.lastAt = createdAt;
    if (payload.suppressed) {
        bucket.suppressedCount += 1;
    }
    if (sourceLabel) incrementCounter(bucket.sourceCounter, sourceLabel);
    if (targetLabel) incrementCounter(bucket.targetCounter, targetLabel);
    if (nodeLabel) incrementCounter(bucket.nodeCounter, nodeLabel);
    if (pathLabel) incrementCounter(bucket.pathCounter, pathLabel);
    if (reasonLabel) incrementCounter(bucket.reasonCounter, reasonLabel);
    if (stageLabel) incrementCounter(bucket.stageCounter, stageLabel);
    if (sampleLine) {
        bucket.samples.unshift(sampleLine);
        if (bucket.samples.length > AGGREGATE_SAMPLE_LIMIT) {
            bucket.samples.length = AGGREGATE_SAMPLE_LIMIT;
        }
    }
}

function formatAggregateDigestMessage(bucket = {}) {
    const blocks = [];
    appendHtmlSection(blocks, '关键信息', [
        formatHtmlKeyValueRow('级别', severityLabel(bucket.severity)),
        formatHtmlKeyValueRow('统计窗口', formatWindowLabel(bucket.windowMs)),
        formatHtmlKeyValueRow('累计命中', `${bucket.count || 0} 次`),
        bucket.suppressedCount > 0 ? formatHtmlKeyValueRow('聚合抑制', `${bucket.suppressedCount} 次`) : '',
        formatHtmlKeyValueRow('首次时间', formatDateTime(bucket.firstAt)),
        formatHtmlKeyValueRow('最近时间', formatDateTime(bucket.lastAt)),
    ], { rawRows: true });

    appendHtmlSection(blocks, '影响分布', [
        ...formatCounterHtmlRows(bucket.targetCounter, { limit: 4, suffix: ' 次' }),
        ...formatCounterHtmlRows(bucket.nodeCounter, { limit: 4, suffix: ' 次' }),
        ...formatCounterHtmlRows(bucket.stageCounter, { limit: 4, suffix: ' 次' }),
    ], { rawRows: true });

    appendHtmlSection(blocks, '来源分布', [
        ...formatCounterHtmlRows(bucket.sourceCounter, { limit: 4, suffix: ' 次' }),
        ...formatCounterHtmlRows(bucket.pathCounter, { limit: 4, suffix: ' 次' }),
        ...formatCounterHtmlRows(bucket.reasonCounter, { limit: 4, suffix: ' 次' }),
    ], { rawRows: true });

    appendHtmlSection(blocks, '最近摘要', bucket.samples
        .slice(0, AGGREGATE_SAMPLE_LIMIT)
        .map((item, index) => `${index + 1}. ${escapeTelegramHtml(item)}`), { rawRows: true });

    return joinHtmlMessage(`NMS 聚合告警 · ${bucket.title || bucket.type || '重复事件'}`, blocks, {
        subtitle: '重复事件自动聚合',
    });
}

function filterRecentItems(items = [], windowMs = 0, getTs) {
    const cutoff = Date.now() - Math.max(0, Number(windowMs || 0));
    return (Array.isArray(items) ? items : []).filter((item) => {
        const rawTs = typeof getTs === 'function' ? getTs(item) : item?.ts || item?.createdAt;
        const ts = new Date(rawTs || 0).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
    });
}

export function createTelegramAlertService(options = {}) {
    const fetcher = typeof options.fetcher === 'function' ? options.fetcher : createDefaultFetcher();
    const overrideAlertSeverities = new Set(
        normalizeStringArray(options.alertSeverities).filter((item) => ['info', 'warning', 'critical'].includes(item))
    );
    const overrideAuditEvents = new Set(normalizeStringArray(options.auditEvents));
    const dedupWindowMs = Math.max(1_000, Number(options.dedupWindowMs || DEFAULT_DEDUP_WINDOW_MS));
    const dedupCache = new Map();
    const aggregateBuckets = new Map();
    const aggregateTimers = new Map();
    const runtimeStatus = {
        lastSentAt: null,
        lastError: '',
        lastSentKind: '',
        lastPollAt: null,
        lastPollError: '',
        lastCommandAt: null,
        lastCommand: '',
        lastCommandSyncAt: null,
        lastCommandSyncError: '',
        lastDigestAt: null,
        lastDigestKind: '',
        lastDigestError: '',
    };
    let running = false;
    let timer = null;
    let opsDigestTimer = null;
    let dailyDigestTimer = null;
    let lastUpdateId = 0;
    let initializedOffset = false;
    let commandsSynced = false;
    let commandSyncPromise = null;

    function resolveSettings() {
        const stored = typeof options.getSettings === 'function'
            ? options.getSettings()
            : systemSettingsStore.getTelegram();
        const envDefaults = config.telegram || {};
        const botToken = String(options.botToken ?? stored?.botToken ?? envDefaults.botToken ?? '').trim();
        const chatId = String(options.chatId ?? stored?.chatId ?? envDefaults.chatId ?? '').trim();
        const enabled = options.enabled ?? stored?.enabled ?? envDefaults.enabled ?? false;

        return {
            enabled: enabled === true,
            botToken,
            chatId,
            configured: Boolean(botToken && chatId),
            botTokenPreview: botToken ? maskToken(botToken) : (stored?.botTokenPreview || ''),
            chatIdPreview: chatId ? maskChatId(chatId) : '',
            sendSystemStatus: options.sendSystemStatus ?? stored?.sendSystemStatus ?? true,
            sendSecurityAudit: options.sendSecurityAudit ?? stored?.sendSecurityAudit ?? true,
            sendEmergencyAlerts: options.sendEmergencyAlerts ?? stored?.sendEmergencyAlerts ?? true,
            apiBaseUrl: String(options.apiBaseUrl || envDefaults.apiBaseUrl || DEFAULT_API_BASE_URL).trim() || DEFAULT_API_BASE_URL,
            alertSeverities: overrideAlertSeverities.size > 0
                ? overrideAlertSeverities
                : new Set(normalizeStringArray(envDefaults.alertSeverities).filter((item) => ['info', 'warning', 'critical'].includes(item)).concat([...DEFAULT_ALERT_SEVERITIES])),
            auditEvents: overrideAuditEvents.size > 0 ? overrideAuditEvents : new Set(normalizeStringArray(envDefaults.auditEvents)),
        };
    }

    function isConfigured() {
        return resolveSettings().configured;
    }

    function isEnabled() {
        const settings = resolveSettings();
        return settings.enabled && settings.configured;
    }

    function shouldSkipDedup(key = '') {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) return false;
        const previous = dedupCache.get(normalizedKey);
        if (previous && Date.now() - previous < dedupWindowMs) {
            return true;
        }
        return false;
    }

    function clearAggregateTimer(key = '') {
        const timerRef = aggregateTimers.get(key);
        if (timerRef) {
            clearTimeout(timerRef);
            aggregateTimers.delete(key);
        }
    }

    async function flushAggregateBucket(key = '') {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) return false;
        clearAggregateTimer(normalizedKey);
        const bucket = aggregateBuckets.get(normalizedKey);
        if (!bucket) return false;
        aggregateBuckets.delete(normalizedKey);
        if (bucket.summarySent || (bucket.count || 0) <= 1 || (bucket.suppressedCount || 0) <= 0) {
            return false;
        }
        return sendMessage(formatAggregateDigestMessage(bucket), `aggregate:${normalizedKey}:${bucket.firstAt}`, {
            kind: 'aggregate_digest',
            parseMode: 'HTML',
        });
    }

    function noteNotificationOccurrence(payload = {}) {
        const normalizedKey = String(payload.dedupKey || payload.type || payload.eventType || '').trim();
        if (!normalizedKey) return;
        const windowMs = Math.max(1_000, Number(payload.dedupWindowMs || dedupWindowMs));
        let bucket = aggregateBuckets.get(normalizedKey);
        if (!bucket) {
            bucket = createAggregateBucket(normalizedKey, payload, windowMs);
            aggregateBuckets.set(normalizedKey, bucket);
            const timerRef = startBackgroundTimeout(() => {
                void flushAggregateBucket(normalizedKey);
            }, windowMs + 50);
            aggregateTimers.set(normalizedKey, timerRef);
        }
        updateAggregateBucket(bucket, payload);
        if (payload.suppressed && bucket.suppressedCount > 0 && !bucket.summarySent) {
            bucket.summarySent = true;
            void sendMessage(formatAggregateDigestMessage(bucket), `aggregate:${normalizedKey}:${bucket.firstAt}`, {
                kind: 'aggregate_digest',
                parseMode: 'HTML',
            });
        }
    }

    async function sendMessage(text, dedupKey = '', overrides = {}) {
        const settings = resolveSettings();
        if (!settings.enabled || !settings.configured) return false;
        if (shouldSkipDedup(dedupKey)) return false;

        try {
            const body = {
                chat_id: String(overrides.chatId || settings.chatId),
                text: truncateMessageText(text, 3900),
                disable_web_page_preview: true,
            };
            if (overrides.parseMode) {
                body.parse_mode = String(overrides.parseMode);
            }
            if (overrides.replyMarkup) {
                body.reply_markup = overrides.replyMarkup;
            }
            await fetcher({
                url: `${settings.apiBaseUrl.replace(/\/$/, '')}/bot${settings.botToken}/sendMessage`,
                body,
            });
            if (dedupKey) {
                dedupCache.set(String(dedupKey).trim(), Date.now());
            }
            runtimeStatus.lastSentAt = new Date().toISOString();
            runtimeStatus.lastError = '';
            runtimeStatus.lastSentKind = String(overrides.kind || 'message');
            return true;
        } catch (error) {
            if (dedupKey) {
                dedupCache.delete(String(dedupKey).trim());
            }
            runtimeStatus.lastError = error.message || 'telegram-send-failed';
            return false;
        }
    }

    async function syncCommands(force = false) {
        const settings = resolveSettings();
        if (!settings.enabled || !settings.configured) return false;
        if (commandsSynced && !force) return true;
        if (commandSyncPromise && !force) return commandSyncPromise;

        const commands = buildTelegramCommandMenu([
            ...DEFAULT_QUERY_COMMANDS,
            ...DEFAULT_OPERATION_COMMANDS,
        ]);

        commandSyncPromise = callTelegramApi('setMyCommands', { commands })
            .then(() => {
                commandsSynced = true;
                runtimeStatus.lastCommandSyncAt = new Date().toISOString();
                runtimeStatus.lastCommandSyncError = '';
                return true;
            })
            .catch((error) => {
                commandsSynced = false;
                runtimeStatus.lastCommandSyncError = error.message || 'telegram-command-sync-failed';
                return false;
            })
            .finally(() => {
                commandSyncPromise = null;
            });

        return commandSyncPromise;
    }

    async function sendCommandReply(text, chatId, kind = 'command') {
        await syncCommands();
        return sendMessage(text, '', {
            chatId,
            kind,
            parseMode: 'HTML',
        });
    }

    function shouldSendNotification(notification = {}) {
        const settings = resolveSettings();
        if (!settings.enabled || !settings.configured) return false;

        const severity = String(notification.severity || 'info').trim().toLowerCase();
        if (!settings.alertSeverities.has(severity)) return false;

        const topics = Array.isArray(notification?.meta?.telegramTopics)
            ? notification.meta.telegramTopics
            : [];
        const isEmergency = topics.includes('emergency_alert') || severity === 'critical';
        const isSystemStatus = topics.includes('system_status') || !topics.includes('security_audit');
        const isSecurityAudit = topics.includes('security_audit');
        const isRecoveryNotice = topics.includes('recovery_notice');

        if (isSecurityAudit && settings.sendSecurityAudit) return true;
        if (isEmergency && settings.sendEmergencyAlerts) return true;
        if (isRecoveryNotice && settings.sendSystemStatus) return true;
        if (isSystemStatus && settings.sendSystemStatus) return true;
        return false;
    }

    function getAuditRule(entry = {}) {
        const settings = resolveSettings();
        const eventKey = String(entry.eventType || entry.event || '').trim().toLowerCase();
        if (!eventKey || !settings.enabled || !settings.configured) return null;
        if (settings.auditEvents.size > 0 && !settings.auditEvents.has(eventKey)) return null;
        if (settings.auditEvents.size > 0) {
            return {
                severity: DEFAULT_AUDIT_EVENT_RULES[eventKey]?.severity || 'warning',
                label: DEFAULT_AUDIT_EVENT_RULES[eventKey]?.label || eventKey,
            };
        }
        return DEFAULT_AUDIT_EVENT_RULES[eventKey] || null;
    }

    async function notifyNotification(notification = {}) {
        if (!shouldSendNotification(notification)) return false;
        const meta = notification.meta || {};
        const dedupKey = `notification:${notification.type || 'system'}:${meta.serverId || ''}:${meta.reasonCode || ''}:${notification.severity || 'info'}`;
        return sendMessage(formatNotificationMessage(notification), dedupKey, {
            kind: notification.type || 'notification',
            parseMode: 'HTML',
        });
    }

    async function notifySecurityAudit(entry = {}) {
        const settings = resolveSettings();
        const rule = getAuditRule(entry);
        if (!rule) return false;

        const isEmergency = rule.severity === 'critical';
        if (!settings.sendSecurityAudit && !(isEmergency && settings.sendEmergencyAlerts)) {
            return false;
        }

        const dedupKey = `audit:${entry.eventType || entry.event || 'audit'}:${entry.actor || ''}:${entry.ip || ''}:${entry.path || ''}`;
        noteNotificationOccurrence({
            ...entry,
            title: rule.label || entry.eventType || entry.event || 'audit_event',
            severity: rule.severity || 'warning',
            dedupKey,
            suppressed: shouldSkipDedup(dedupKey),
        });
        return sendMessage(formatAuditMessage(entry, rule), dedupKey, {
            kind: entry.eventType || entry.event || 'audit',
            parseMode: 'HTML',
        });
    }

    async function sendTestMessage(actor = 'admin') {
        const settings = resolveSettings();
        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('目标', settings.chatId || '未配置'),
            formatHtmlKeyValueRow('时间', formatDateTime(new Date().toISOString())),
            formatHtmlKeyValueRow('触发人', actor),
        ], { rawRows: true });
        appendHtmlSection(blocks, '快速开始', [
            '命令菜单已同步后，可直接在输入框输入 <code>/</code> 选择命令',
        ], { rawRows: true });
        const queryTable = formatCommandHtmlTable(DEFAULT_QUERY_COMMANDS);
        if (queryTable) {
            blocks.push(`<b>状态查询</b>\n${queryTable}`);
        }
        const operationTable = formatCommandHtmlTable(DEFAULT_OPERATION_COMMANDS);
        if (operationTable) {
            blocks.push(`<b>运维动作</b>\n${operationTable}`);
        }
        return sendCommandReply(joinHtmlMessage('NMS Telegram 测试通知', blocks, {
            subtitle: '消息结构与命令菜单检查',
        }), settings.chatId, 'test');
    }

    async function callTelegramApi(method, body = {}) {
        const settings = resolveSettings();
        if (!settings.enabled || !settings.configured) {
            throw new Error('telegram-not-configured');
        }
        const result = await fetcher({
            url: `${settings.apiBaseUrl.replace(/\/$/, '')}/bot${settings.botToken}/${method}`,
            body,
        });
        return result?.result ?? result;
    }

    async function primeUpdates() {
        const result = await callTelegramApi('getUpdates', {
            timeout: 0,
            limit: 20,
            allowed_updates: ['message'],
        });
        const latest = Array.isArray(result) ? result[result.length - 1] : null;
        lastUpdateId = Number(latest?.update_id || 0);
        initializedOffset = true;
    }

    async function buildStatusDigest() {
        const context = await collectStatusDigestContext();
        return formatStatusDigestMessage(context);
    }

    async function buildOnlineDigest() {
        const { collectClusterStatusSnapshot } = await import('./serverStatusService.js');
        const snapshot = await collectClusterStatusSnapshot({
            includeDetails: true,
            maxAgeMs: 20_000,
        });
        const items = Array.isArray(snapshot?.items) ? [...snapshot.items] : [];
        const topNodes = items
            .sort((left, right) => Number(right.onlineCount || 0) - Number(left.onlineCount || 0))
            .slice(0, 5)
            .map((item, index) => `${index + 1}. <b>${escapeTelegramHtml(item.name || item.serverId || '-')}</b> · 在线 ${formatHtmlValue(item.onlineCount || 0)}`);

        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('总在线用户', snapshot?.summary?.totalOnline || 0),
            formatHtmlKeyValueRow('参与节点', items.filter((item) => Number(item?.onlineCount || 0) > 0).length),
            formatHtmlKeyValueRow('活跃入站', `${snapshot?.summary?.activeInbounds || 0}/${snapshot?.summary?.totalInbounds || 0}`),
        ], { rawRows: true });
        appendHtmlSection(blocks, '节点分布', topNodes, { rawRows: true });
        return joinHtmlMessage('NMS 在线概览', blocks, {
            subtitle: '当前在线用户与节点分布',
        });
    }

    async function buildTrafficDigest() {
        const trafficStatsStore = (await import('../store/trafficStatsStore.js')).default;
        await trafficStatsStore.collectIfStale(false);
        const overview = trafficStatsStore.getOverview({ days: 1, top: 5 });
        const topUsers = Array.isArray(overview?.topUsers)
            ? overview.topUsers.slice(0, 5).map((item, index) => `${index + 1}. <b>${escapeTelegramHtml(item.username || item.email || '-')}</b> · ${formatHtmlValue(formatBytesHuman(item.totalBytes))}`)
            : [];
        const topServers = Array.isArray(overview?.topServers)
            ? overview.topServers.slice(0, 5).map((item, index) => `${index + 1}. <b>${escapeTelegramHtml(item.serverName || item.serverId || '-')}</b> · ${formatHtmlValue(formatBytesHuman(item.totalBytes))}`)
            : [];

        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('活跃用户', `${overview?.registeredTotals?.activeUsers || 0}/${overview?.registeredTotals?.totalUsers || 0}`),
            formatHtmlKeyValueRow('上行', formatBytesHuman(overview?.totals?.upBytes || 0)),
            formatHtmlKeyValueRow('下行', formatBytesHuman(overview?.totals?.downBytes || 0)),
            formatHtmlKeyValueRow('合计', formatBytesHuman(overview?.totals?.totalBytes || 0)),
            overview?.lastCollectionAt ? formatHtmlKeyValueRow('最近采集', formatDateTime(overview.lastCollectionAt)) : '',
        ], { rawRows: true });
        appendHtmlSection(blocks, 'Top 用户', topUsers, { rawRows: true });
        appendHtmlSection(blocks, 'Top 节点', topServers, { rawRows: true });
        return joinHtmlMessage('NMS 24h 流量摘要', blocks, {
            subtitle: '最近 24h 采样汇总',
        });
    }

    async function buildAlertsDigest() {
        const notificationService = (await import('./notifications.js')).default;
        const items = notificationService.getUnread(5);
        if (!Array.isArray(items) || items.length === 0) {
            return joinHtmlMessage('NMS 最近告警摘要', [
                `<b>关键信息</b>\n• 当前没有未读通知`,
            ], {
                subtitle: '最近未读系统通知',
            });
        }
        const severityCounter = new Map();
        items.forEach((item) => incrementCounter(severityCounter, severityLabel(item.severity)));
        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('未读告警', items.length),
        ], { rawRows: true });
        appendHtmlSection(blocks, '级别分布', formatCounterHtmlRows(severityCounter, { limit: 3, suffix: ' 条' }), { rawRows: true });
        appendHtmlSection(blocks, '最近告警', items.map((item, index) => formatHtmlDetailBlock(
            `${index + 1}. [${severityLabel(item.severity)}] ${truncateLine(item.title, 120)}`,
            [
                item.body ? `摘要: ${escapeTelegramHtml(truncateLine(item.body, 220))}` : '',
                item?.meta?.serverId ? formatHtmlKeyValueRow('节点', item.meta.serverId) : '',
                item?.meta?.reasonCode ? formatHtmlKeyValueRow('原因码', item.meta.reasonCode) : '',
                formatHtmlKeyValueRow('时间', formatDateTime(item.createdAt)),
            ],
            { rawRows: true }
        )), { rawRows: true });
        return joinHtmlMessage('NMS 最近告警摘要', blocks, {
            subtitle: '最近未读系统通知',
        });
    }

    async function buildSecurityDigest() {
        const [{ default: auditStore }, { enrichAuditEvents }] = await Promise.all([
            import('../store/auditStore.js'),
            import('./auditEventEnrichment.js'),
        ]);
        const watchedEvents = new Set(Object.keys(DEFAULT_AUDIT_EVENT_RULES));
        const result = auditStore.queryEvents({ page: 1, pageSize: 80 });
        const filtered = (Array.isArray(result?.items) ? result.items : [])
            .filter((item) => watchedEvents.has(String(item?.eventType || '').trim().toLowerCase()));

        if (filtered.length === 0) {
            return joinHtmlMessage('NMS 安全事件摘要', [
                `<b>关键信息</b>\n• 最近没有新的高优先级安全审计事件`,
            ], {
                subtitle: '高优先级安全审计汇总',
            });
        }

        const enriched = await enrichAuditEvents(filtered);
        const eventCounter = new Map();
        const sourceCounter = new Map();
        let criticalCount = 0;
        let warningCount = 0;

        enriched.forEach((item) => {
            const eventKey = String(item?.eventType || '').trim().toLowerCase();
            const rule = DEFAULT_AUDIT_EVENT_RULES[eventKey] || { severity: 'warning', label: eventKey || 'audit_event' };
            incrementCounter(eventCounter, rule.label);
            incrementCounter(sourceCounter, [
                item?.ip || 'unknown',
                formatLocationCarrierText(item?.ipLocation, item?.ipCarrier),
            ].filter(Boolean).join(' · '));
            if (rule.severity === 'critical') {
                criticalCount += 1;
            } else {
                warningCount += 1;
            }
        });

        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('命中事件', enriched.length),
            formatHtmlKeyValueRow('紧急事件', criticalCount),
            formatHtmlKeyValueRow('告警事件', warningCount),
            formatHtmlKeyValueRow('最近时间', formatDateTime(enriched[0]?.ts)),
        ], { rawRows: true });
        appendHtmlSection(blocks, '事件分布', formatCounterHtmlRows(eventCounter, { limit: 4, suffix: ' 次' }), { rawRows: true });
        appendHtmlSection(blocks, '来源概览', formatCounterHtmlRows(sourceCounter, { limit: 4, suffix: ' 次' }), { rawRows: true });
        appendHtmlSection(blocks, '最近事件', enriched.slice(0, 4).map((item, index) => {
            const eventKey = String(item?.eventType || '').trim().toLowerCase();
            const rule = DEFAULT_AUDIT_EVENT_RULES[eventKey] || { severity: 'warning', label: eventKey || 'audit_event' };
            return formatHtmlDetailBlock(`${index + 1}. ${rule.label}`, [
                formatHtmlKeyValueRow('级别', severityLabel(rule.severity)),
                formatHtmlKeyValueRow('时间', formatDateTime(item?.ts)),
                formatHtmlKeyValueRow('IP', item?.ip || 'unknown'),
                formatLocationCarrierText(item?.ipLocation, item?.ipCarrier)
                    ? formatHtmlKeyValueRow('归属地 / 运营商', formatLocationCarrierText(item?.ipLocation, item?.ipCarrier))
                    : '',
                item?.method || item?.path ? formatHtmlKeyValueRow('请求', `${item?.method || '-'} ${item?.path || '-'}`) : '',
                item?.targetEmail ? formatHtmlKeyValueRow('目标用户', item.targetEmail) : '',
                item?.serverId ? formatHtmlKeyValueRow('节点', item.serverId) : '',
            ], { rawRows: true });
        }), { rawRows: true });
        return joinHtmlMessage('NMS 安全事件摘要', blocks, {
            subtitle: '高优先级安全审计汇总',
        });
    }

    async function buildNodeIssuesDigest() {
        const { collectClusterStatusSnapshot } = await import('./serverStatusService.js');
        const snapshot = await collectClusterStatusSnapshot({
            includeDetails: true,
            maxAgeMs: 20_000,
        });
        const degradedItems = (Array.isArray(snapshot?.items) ? snapshot.items : [])
            .filter((item) => item?.health && item.health !== 'healthy')
            .slice(0, 5);

        if (degradedItems.length === 0) {
            return joinHtmlMessage('NMS 节点异常摘要', [
                `<b>关键信息</b>\n• 当前没有降级、离线或维护节点`,
            ], {
                subtitle: '异常节点与原因分布',
            });
        }

        const problemItems = (Array.isArray(snapshot?.items) ? snapshot.items : [])
            .filter((item) => item?.health && item.health !== 'healthy');
        const healthCounter = new Map();
        const reasonCounter = new Map();
        problemItems.forEach((item) => {
            incrementCounter(healthCounter, formatHealthLabel(item?.health));
            incrementCounter(reasonCounter, item?.reasonCode || 'none');
        });

        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('异常节点', `${problemItems.length}/${snapshot?.summary?.total || 0}`),
            formatHtmlKeyValueRow('最近巡检', formatDateTime(snapshot?.summary?.checkedAt)),
        ], { rawRows: true });
        appendHtmlSection(blocks, '状态分布', formatCounterHtmlRows(healthCounter, { limit: 4, suffix: ' 台' }), { rawRows: true });
        appendHtmlSection(blocks, '原因分布', formatCounterHtmlRows(reasonCounter, { limit: 4, suffix: ' 台' }), { rawRows: true });
        appendHtmlSection(blocks, '节点明细', degradedItems.map((item, index) => (
            formatHtmlDetailBlock(`${index + 1}. ${item?.name || item?.serverId || '-'}`, [
                formatHtmlKeyValueRow('状态', formatHealthLabel(item?.health)),
                formatHtmlKeyValueRow('原因', item?.reasonCode || 'none'),
                formatHtmlKeyValueRow('在线用户', item?.onlineCount || 0),
                formatHtmlKeyValueRow('时间', formatDateTime(item?.checkedAt)),
            ], { rawRows: true })
        )), { rawRows: true });
        return joinHtmlMessage('NMS 节点异常摘要', blocks, {
            subtitle: '异常节点与原因分布',
        });
    }

    async function buildAccessDigest() {
        const { querySubscriptionAccess, summarizeSubscriptionAccess } = await import('../services/subscriptionAuditService.js');
        const now = Date.now();
        const weekAgo = new Date(now - (7 * 24 * 60 * 60 * 1000)).toISOString();
        const to = new Date(now).toISOString();
        const [summary, result] = await Promise.all([
            summarizeSubscriptionAccess({
                status: 'denied',
                from: weekAgo,
                to,
            }, {
                includeGeo: true,
            }),
            querySubscriptionAccess({
                page: 1,
                pageSize: 5,
                status: 'denied',
                from: weekAgo,
                to,
            }, {
                includeGeo: true,
            }),
        ]);
        const items = Array.isArray(result?.items) ? result.items : [];
        if ((summary?.total || 0) === 0 && items.length === 0) {
            return joinHtmlMessage('NMS 公开订阅异常访问摘要', [
                `<b>关键信息</b>\n• 最近 7 天没有被拒绝的公开订阅访问`,
            ], {
                subtitle: '最近 7 天拒绝访问摘要',
            });
        }

        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('统计周期', '最近 7 天'),
            formatHtmlKeyValueRow('拒绝请求', summary?.total || items.length),
            formatHtmlKeyValueRow('独立 IP', summary?.uniqueIpCount || 0),
            formatHtmlKeyValueRow('涉及用户', summary?.uniqueUsers || 0),
        ], { rawRows: true });
        appendHtmlSection(blocks, '高频来源', (summary?.topIps || []).slice(0, 4).map((item, index) => {
            const locationCarrier = formatLocationCarrierText(item?.ipLocation, item?.ipCarrier);
            return `${index + 1}. <b>${escapeTelegramHtml(item?.ip || 'unknown')}</b>${locationCarrier ? ` · ${escapeTelegramHtml(locationCarrier)}` : ''} · ${formatHtmlValue(`${item?.count || 0} 次`)}`;
        }), { rawRows: true });
        appendHtmlSection(blocks, '最近记录', items.slice(0, 4).map((item, index) => {
            const locationCarrier = formatLocationCarrierText(item?.ipLocation, item?.ipCarrier);
            return formatHtmlDetailBlock(`${index + 1}. ${item?.userLabel || item?.email || '-'}`, [
                formatHtmlKeyValueRow('时间', formatDateTime(item?.ts)),
                formatHtmlKeyValueRow('状态', item?.status || 'denied'),
                formatHtmlKeyValueRow('IP', item?.clientIp || item?.ip || 'unknown'),
                locationCarrier ? formatHtmlKeyValueRow('归属地 / 运营商', locationCarrier) : '',
                item?.userAgent ? formatHtmlKeyValueRow('UA', truncateLine(item.userAgent, 180)) : '',
            ], { rawRows: true });
        }), { rawRows: true });
        return joinHtmlMessage('NMS 公开订阅异常访问摘要', blocks, {
            subtitle: '最近 7 天拒绝访问摘要',
        });
    }

    async function buildExpiryDigest() {
        const { collectSubscriptionExpirySnapshot } = await import('./subscriptionExpiryNotifier.js');
        const snapshot = collectSubscriptionExpirySnapshot({ limit: 6 });
        if ((snapshot?.total || 0) === 0) {
            return joinHtmlMessage('NMS 用户到期提醒摘要', [
                `<b>关键信息</b>\n• 最近 7 天没有即将到期或已到期的用户`,
            ], {
                subtitle: '最近 7 天到期提醒汇总',
            });
        }

        const stageCounter = new Map();
        (snapshot.items || []).forEach((item) => {
            incrementCounter(stageCounter, item.label || item.stage);
        });

        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('命中用户', snapshot.total || 0),
            `已到期: ${formatHtmlValue(snapshot.expiredCount || 0)} · 即将到期: ${formatHtmlValue(snapshot.warningCount || 0)}`,
            formatHtmlKeyValueRow('最近生成', formatDateTime(snapshot.generatedAt)),
        ], { rawRows: true });
        appendHtmlSection(blocks, '阶段分布', formatCounterHtmlRows(stageCounter, { limit: 4, suffix: ' 人' }), { rawRows: true });
        appendHtmlSection(blocks, '用户明细', (snapshot.items || []).map((item, index) => formatHtmlDetailBlock(
            `${index + 1}. ${item.username || item.subscriptionEmail || item.email || '-'}`,
            [
                formatHtmlKeyValueRow('订阅邮箱', item.subscriptionEmail || item.email || '-'),
                formatHtmlKeyValueRow('阶段', item.label || item.stage),
                item.remainingDays > 0
                    ? formatHtmlKeyValueRow('剩余时间', `${item.remainingDays} 天`)
                    : formatHtmlKeyValueRow('状态', '已到期'),
                formatExpiryDateTime(item.expiryTime) ? formatHtmlKeyValueRow('到期时间', formatExpiryDateTime(item.expiryTime)) : '',
            ],
            { rawRows: true }
        )), { rawRows: true });
        return joinHtmlMessage('NMS 用户到期提醒摘要', blocks, {
            subtitle: '最近 7 天到期提醒汇总',
        });
    }

    async function collectRecentDigestWindow(windowMs = OPS_DIGEST_INTERVAL_MS) {
        const now = Date.now();
        const fromIso = new Date(now - windowMs).toISOString();
        const toIso = new Date(now).toISOString();
        const [
            notificationService,
            auditStore,
            trafficStatsStore,
            { summarizeSubscriptionAccess },
            { collectSubscriptionExpirySnapshot },
        ] = await Promise.all([
            import('./notifications.js').then((module) => module.default),
            import('../store/auditStore.js').then((module) => module.default),
            import('../store/trafficStatsStore.js').then((module) => module.default),
            import('../services/subscriptionAuditService.js'),
            import('./subscriptionExpiryNotifier.js'),
        ]);

        const notifications = filterRecentItems(
            notificationService.getAll({ limit: 200, offset: 0 }).items,
            windowMs,
            (item) => item?.createdAt
        );
        const auditItems = filterRecentItems(
            auditStore.queryEvents({ page: 1, pageSize: 200 }).items,
            windowMs,
            (item) => item?.ts
        );
        const securityItems = auditItems.filter((item) => DEFAULT_AUDIT_EVENT_RULES[String(item?.eventType || '').trim().toLowerCase()]);
        await trafficStatsStore.collectIfStale(false);
        const trafficOverview = trafficStatsStore.getOverview({ from: fromIso, to: toIso, top: 3 });
        const accessSummary = await summarizeSubscriptionAccess({ status: 'denied', from: fromIso, to: toIso }, { includeGeo: true });
        const expirySnapshot = collectSubscriptionExpirySnapshot({ limit: 6 });

        return {
            fromIso,
            toIso,
            notifications,
            auditItems,
            securityItems,
            trafficOverview,
            accessSummary,
            expirySnapshot,
        };
    }

    async function buildOperationsDigest(windowMs = OPS_DIGEST_INTERVAL_MS) {
        const [statusContext, digestWindow] = await Promise.all([
            collectStatusDigestContext(),
            collectRecentDigestWindow(windowMs),
        ]);
        const severityCounter = new Map();
        digestWindow.notifications.forEach((item) => incrementCounter(severityCounter, severityLabel(item?.severity)));
        const eventCounter = new Map();
        const sourceCounter = new Map();
        digestWindow.securityItems.forEach((item) => {
            const eventKey = String(item?.eventType || '').trim().toLowerCase();
            const rule = DEFAULT_AUDIT_EVENT_RULES[eventKey] || { label: eventKey || 'audit_event' };
            incrementCounter(eventCounter, rule.label);
            incrementCounter(sourceCounter, [item?.ip, formatLocationCarrierText(item?.ipLocation, item?.ipCarrier)].filter(Boolean).join(' · '));
        });

        const abnormalNodes = Number(statusContext?.summary?.degraded || 0) + Number(statusContext?.summary?.unreachable || 0);
        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('统计窗口', formatWindowLabel(windowMs)),
            formatHtmlKeyValueRow('系统通知', digestWindow.notifications.length),
            formatHtmlKeyValueRow('安全事件', digestWindow.securityItems.length),
            formatHtmlKeyValueRow('订阅拒绝', digestWindow.accessSummary?.total || 0),
            formatHtmlKeyValueRow('异常节点', abnormalNodes),
            formatHtmlKeyValueRow('生成时间', formatDateTime(digestWindow.toIso)),
        ], { rawRows: true });
        appendHtmlSection(blocks, '通知分布', formatCounterHtmlRows(severityCounter, { limit: 4, suffix: ' 条' }), { rawRows: true });
        appendHtmlSection(blocks, '安全热点', [
            ...formatCounterHtmlRows(eventCounter, { limit: 4, suffix: ' 次' }),
            ...formatCounterHtmlRows(sourceCounter, { limit: 4, suffix: ' 次' }),
        ], { rawRows: true });
        appendHtmlSection(blocks, '当前状态', [
            formatHtmlKeyValueRow('正常', statusContext?.summary?.healthy || 0),
            formatHtmlKeyValueRow('降级', statusContext?.summary?.degraded || 0),
            formatHtmlKeyValueRow('离线', statusContext?.summary?.unreachable || 0),
            formatHtmlKeyValueRow('维护', statusContext?.summary?.maintenance || 0),
            formatHtmlKeyValueRow('在线用户', statusContext?.summary?.totalOnline || 0),
            formatHtmlKeyValueRow('活跃入站', `${statusContext?.summary?.activeInbounds || 0}/${statusContext?.summary?.totalInbounds || 0}`),
        ], { rawRows: true });
        return joinHtmlMessage('NMS 运维汇总摘要', blocks, {
            subtitle: '自动周期运维摘要',
        });
    }

    async function buildDailyDigest(windowMs = DAILY_DIGEST_INTERVAL_MS) {
        const [statusContext, digestWindow] = await Promise.all([
            collectStatusDigestContext(),
            collectRecentDigestWindow(windowMs),
        ]);
        const topUsers = Array.isArray(digestWindow.trafficOverview?.topUsers)
            ? digestWindow.trafficOverview.topUsers.slice(0, 3).map((item, index) => `${index + 1}. <b>${escapeTelegramHtml(item.displayLabel || item.username || item.email || '-')}</b> · ${formatHtmlValue(formatBytesHuman(item.totalBytes || 0))}`)
            : [];
        const topServers = Array.isArray(digestWindow.trafficOverview?.topServers)
            ? digestWindow.trafficOverview.topServers.slice(0, 3).map((item, index) => `${index + 1}. <b>${escapeTelegramHtml(item.serverName || item.serverId || '-')}</b> · ${formatHtmlValue(formatBytesHuman(item.totalBytes || 0))}`)
            : [];
        const expiryStageCounter = new Map();
        (digestWindow.expirySnapshot?.items || []).forEach((item) => incrementCounter(expiryStageCounter, item.label || item.stage));

        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('统计窗口', formatWindowLabel(windowMs)),
            formatHtmlKeyValueRow('系统通知', digestWindow.notifications.length),
            formatHtmlKeyValueRow('安全事件', digestWindow.securityItems.length),
            formatHtmlKeyValueRow('在线用户', statusContext?.summary?.totalOnline || 0),
            formatHtmlKeyValueRow('异常节点', (statusContext?.summary?.degraded || 0) + (statusContext?.summary?.unreachable || 0)),
            formatHtmlKeyValueRow('生成时间', formatDateTime(digestWindow.toIso)),
        ], { rawRows: true });
        appendHtmlSection(blocks, '24h 流量', [
            formatHtmlKeyValueRow('上行', formatBytesHuman(digestWindow.trafficOverview?.totals?.upBytes || 0)),
            formatHtmlKeyValueRow('下行', formatBytesHuman(digestWindow.trafficOverview?.totals?.downBytes || 0)),
            formatHtmlKeyValueRow('合计', formatBytesHuman(digestWindow.trafficOverview?.totals?.totalBytes || 0)),
            formatHtmlKeyValueRow('活跃用户', `${digestWindow.trafficOverview?.activeUsers || 0}/${digestWindow.trafficOverview?.registeredTotals?.totalUsers || 0}`),
        ], { rawRows: true });
        appendHtmlSection(blocks, 'Top 用户', topUsers, { rawRows: true });
        appendHtmlSection(blocks, 'Top 节点', topServers, { rawRows: true });
        appendHtmlSection(blocks, '到期提醒', [
            `已到期: ${formatHtmlValue(digestWindow.expirySnapshot?.expiredCount || 0)} · 即将到期: ${formatHtmlValue(digestWindow.expirySnapshot?.warningCount || 0)}`,
            ...formatCounterHtmlRows(expiryStageCounter, { limit: 4, suffix: ' 人' }),
        ], { rawRows: true });
        return joinHtmlMessage('NMS 每日巡检摘要', blocks, {
            subtitle: '每日整体运行摘要',
        });
    }

    async function runMonitorDigest(actor = 'telegram') {
        const serverHealthMonitor = (await import('./serverHealthMonitor.js')).default;
        const result = await serverHealthMonitor.runOnce({ force: true });
        const summary = result?.summary || {};
        const blocks = [];
        appendHtmlSection(blocks, '关键信息', [
            formatHtmlKeyValueRow('触发人', actor),
            formatHtmlKeyValueRow('节点规模', `${summary.total || 0} 台`),
            formatHtmlKeyValueRow('时间', formatDateTime(summary.checkedAt)),
        ], { rawRows: true });
        appendHtmlSection(blocks, '节点状态', [
            formatHtmlKeyValueRow('正常', summary.healthy || 0),
            formatHtmlKeyValueRow('降级', summary.degraded || 0),
            formatHtmlKeyValueRow('离线', summary.unreachable || 0),
            formatHtmlKeyValueRow('维护', summary.maintenance || 0),
        ], { rawRows: true });
        appendHtmlSection(blocks, '异常分布', [
            Object.entries(summary.byReason || {})
                .filter(([, count]) => Number(count || 0) > 0)
                .map(([key, count]) => `<b>${escapeTelegramHtml(key)}</b> · ${formatHtmlValue(count)}`)
                .join(' · ') || '无',
        ], { rawRows: true });
        return joinHtmlMessage('NMS 手动巡检完成', blocks, {
            subtitle: '节点健康巡检结果',
        });
    }

    async function dispatchCommand(command = '', { actor = 'telegram', chatId = '' } = {}) {
        const normalized = normalizeCommand(command);
        if (normalized === '/start' || normalized === '/help') {
            return {
                text: formatCommandCatalogMessage(),
                kind: 'command_help',
            };
        }

        if (normalized === '/status') {
            return {
                text: await buildStatusDigest(),
                kind: 'status_digest',
            };
        }

        if (normalized === '/online') {
            return {
                text: await buildOnlineDigest(),
                kind: 'online_digest',
            };
        }

        if (normalized === '/traffic') {
            return {
                text: await buildTrafficDigest(),
                kind: 'traffic_digest',
            };
        }

        if (normalized === '/alerts') {
            return {
                text: await buildAlertsDigest(),
                kind: 'alerts_digest',
            };
        }

        if (normalized === '/security') {
            return {
                text: await buildSecurityDigest(),
                kind: 'security_digest',
            };
        }

        if (normalized === '/nodes') {
            return {
                text: await buildNodeIssuesDigest(),
                kind: 'node_digest',
            };
        }

        if (normalized === '/access') {
            return {
                text: await buildAccessDigest(),
                kind: 'access_digest',
            };
        }

        if (normalized === '/expiry') {
            return {
                text: await buildExpiryDigest(),
                kind: 'expiry_digest',
            };
        }

        if (normalized === '/monitor') {
            return {
                text: await runMonitorDigest(actor),
                kind: 'monitor_digest',
            };
        }

        return {
            text: joinHtmlMessage('NMS Telegram 控制台', [
                `<b>提示</b>\n• 未识别命令，请使用 <code>/help</code> 查看可用命令`,
            ], {
                subtitle: '命令入口',
            }),
            kind: 'command',
            chatId,
        };
    }

    async function handleCommand(message) {
        const chatId = String(message?.chat?.id || '').trim();
        const command = normalizeCommand(message?.text || '');

        runtimeStatus.lastCommandAt = new Date().toISOString();
        runtimeStatus.lastCommand = command || String(message?.text || '').trim();

        const reply = await dispatchCommand(command, {
            actor: message?.from?.username || 'telegram',
            chatId,
        });
        await sendCommandReply(reply.text, chatId, reply.kind);
    }

    async function sendPeriodicDigest(kind = 'ops') {
        const normalized = String(kind || '').trim().toLowerCase();
        let text = '';
        let intervalMs = OPS_DIGEST_INTERVAL_MS;

        if (normalized === 'daily') {
            text = typeof options.buildDailyDigest === 'function'
                ? await options.buildDailyDigest()
                : await buildDailyDigest();
            intervalMs = DAILY_DIGEST_INTERVAL_MS;
        } else {
            text = typeof options.buildOperationsDigest === 'function'
                ? await options.buildOperationsDigest()
                : await buildOperationsDigest();
        }

        const sent = await sendMessage(text, `digest:${normalized}:${Math.floor(Date.now() / intervalMs)}`, {
            kind: `digest_${normalized}`,
            parseMode: 'HTML',
        });
        if (sent) {
            runtimeStatus.lastDigestAt = new Date().toISOString();
            runtimeStatus.lastDigestKind = normalized;
            runtimeStatus.lastDigestError = '';
        }
        return sent;
    }

    function schedulePeriodicDigests() {
        if (opsDigestTimer) {
            clearInterval(opsDigestTimer);
            opsDigestTimer = null;
        }
        if (dailyDigestTimer) {
            clearInterval(dailyDigestTimer);
            dailyDigestTimer = null;
        }
        if (!running) return;

        opsDigestTimer = startBackgroundInterval(() => {
            sendPeriodicDigest('ops').catch((error) => {
                runtimeStatus.lastDigestError = error.message || 'telegram-ops-digest-failed';
            });
        }, OPS_DIGEST_INTERVAL_MS);

        dailyDigestTimer = startBackgroundInterval(() => {
            sendPeriodicDigest('daily').catch((error) => {
                runtimeStatus.lastDigestError = error.message || 'telegram-daily-digest-failed';
            });
        }, DAILY_DIGEST_INTERVAL_MS);
    }

    async function processUpdates(updates = []) {
        const settings = resolveSettings();
        for (const update of Array.isArray(updates) ? updates : []) {
            lastUpdateId = Math.max(lastUpdateId, Number(update?.update_id || 0));
            const message = update?.message;

            if (message?.text && String(message?.chat?.id || '').trim() === String(settings.chatId || '').trim()) {
                try {
                    await handleCommand(message);
                } catch (error) {
                    await sendCommandReply(joinHtmlMessage('NMS Telegram 控制台', [
                        `<b>执行失败</b>\n• ${escapeTelegramHtml(error.message || 'unknown error')}`,
                    ]), String(message?.chat?.id || '').trim(), 'command_error');
                }
            }
        }
    }

    async function pollOnce() {
        const settings = resolveSettings();
        if (!settings.enabled || !settings.configured || !isNumericChatId(settings.chatId)) {
            return;
        }

        if (!initializedOffset) {
            await primeUpdates();
        }

        const result = await callTelegramApi('getUpdates', {
            timeout: 15,
            offset: lastUpdateId + 1,
            allowed_updates: ['message'],
        });

        runtimeStatus.lastPollAt = new Date().toISOString();
        runtimeStatus.lastPollError = '';
        await processUpdates(result);
    }

    function scheduleNextPoll(delayMs = POLL_INTERVAL_MS) {
        if (!running) return;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        timer = startBackgroundTimeout(() => {
            pollOnce()
                .catch((error) => {
                    runtimeStatus.lastPollError = error.message || 'telegram-poll-failed';
                })
                .finally(() => {
                    scheduleNextPoll();
                });
        }, delayMs);
    }

    function start() {
        if (running) return;
        running = true;
        void syncCommands();
        scheduleNextPoll(2000);
        schedulePeriodicDigests();
    }

    function stop() {
        running = false;
        initializedOffset = false;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (opsDigestTimer) {
            clearInterval(opsDigestTimer);
            opsDigestTimer = null;
        }
        if (dailyDigestTimer) {
            clearInterval(dailyDigestTimer);
            dailyDigestTimer = null;
        }
        for (const key of aggregateTimers.keys()) {
            clearAggregateTimer(key);
        }
        aggregateBuckets.clear();
    }

    function getStatus() {
        const settings = resolveSettings();
        return {
            enabled: settings.enabled && settings.configured,
            configured: settings.configured,
            deliveryEnabled: settings.enabled,
            chatIdPreview: maskChatId(settings.chatId),
            botTokenPreview: settings.botTokenPreview || maskToken(settings.botToken),
            alertSeverities: [...settings.alertSeverities],
            watchedAuditEvents: settings.auditEvents.size > 0 ? [...settings.auditEvents] : Object.keys(DEFAULT_AUDIT_EVENT_RULES),
            sendSystemStatus: settings.sendSystemStatus,
            sendSecurityAudit: settings.sendSecurityAudit,
            sendEmergencyAlerts: settings.sendEmergencyAlerts,
            commandsEnabled: settings.enabled && settings.configured && isNumericChatId(settings.chatId),
            polling: running && settings.enabled && settings.configured && isNumericChatId(settings.chatId),
            lastSentAt: runtimeStatus.lastSentAt,
            lastError: runtimeStatus.lastError,
            lastSentKind: runtimeStatus.lastSentKind,
            lastPollAt: runtimeStatus.lastPollAt,
            lastPollError: runtimeStatus.lastPollError,
            lastCommandAt: runtimeStatus.lastCommandAt,
            lastCommand: runtimeStatus.lastCommand,
            lastCommandSyncAt: runtimeStatus.lastCommandSyncAt,
            lastCommandSyncError: runtimeStatus.lastCommandSyncError,
            lastDigestAt: runtimeStatus.lastDigestAt,
            lastDigestKind: runtimeStatus.lastDigestKind,
            lastDigestError: runtimeStatus.lastDigestError,
        };
    }

    function resetForTests() {
        stop();
        dedupCache.clear();
        lastUpdateId = 0;
        initializedOffset = false;
        runtimeStatus.lastSentAt = null;
        runtimeStatus.lastError = '';
        runtimeStatus.lastSentKind = '';
        runtimeStatus.lastPollAt = null;
        runtimeStatus.lastPollError = '';
        runtimeStatus.lastCommandAt = null;
        runtimeStatus.lastCommand = '';
        runtimeStatus.lastCommandSyncAt = null;
        runtimeStatus.lastCommandSyncError = '';
        runtimeStatus.lastDigestAt = null;
        runtimeStatus.lastDigestKind = '';
        runtimeStatus.lastDigestError = '';
        commandsSynced = false;
        commandSyncPromise = null;
        aggregateBuckets.clear();
        for (const key of aggregateTimers.keys()) {
            clearAggregateTimer(key);
        }
    }

    startBackgroundInterval(() => {
        const cutoff = Date.now() - (dedupWindowMs * 2);
        for (const [key, ts] of dedupCache.entries()) {
            if (ts < cutoff) dedupCache.delete(key);
        }
    }, 10 * 60 * 1000);

    return {
        isEnabled,
        isConfigured,
        getStatus,
        notifyNotification,
        notifySecurityAudit,
        sendTestMessage,
        syncCommands,
        noteNotificationOccurrence,
        sendPeriodicDigest,
        start,
        stop,
        resetForTests,
    };
}

const telegramAlertService = createTelegramAlertService();

export default telegramAlertService;
