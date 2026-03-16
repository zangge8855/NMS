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
const DEFAULT_SHORTCUT_ROWS = [
    ['/status', '/security', '/alerts'],
    ['/online', '/traffic', '/nodes'],
    ['/access', '/expiry', '/monitor'],
];

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

function buildCommandReplyMarkup() {
    return {
        keyboard: DEFAULT_SHORTCUT_ROWS.map((row) => row.map((command) => ({ text: command }))),
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: '选择命令或输入 /help',
    };
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
    const detailText = stringifyDetails(meta.details);
    const blocks = [];
    const expiryLabel = formatExpiryDateTime(meta.expiryTime);
    const targetUser = String(meta.targetUsername || meta.targetEmail || '').trim();
    const subscriptionEmail = String(meta.subscriptionEmail || '').trim();
    const stageLabel = formatStageLabel(meta.stage || meta.label);
    const userAgent = truncateLine(meta.userAgent || meta.ua || '', 200);

    appendHtmlSection(blocks, '概况', [
        formatHtmlKeyValueRow('级别', severityLabel(notification.severity)),
        formatHtmlKeyValueRow('标题', truncateLine(notification.title, 120) || '-'),
        formatHtmlKeyValueRow('类型', notification.type || 'system'),
        formatHtmlKeyValueRow('时间', formatDateTime(notification.createdAt || new Date().toISOString())),
        notification.body ? `摘要: ${escapeTelegramHtml(truncateLine(notification.body, 800))}` : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '影响', [
        meta.serverId ? formatHtmlKeyValueRow('节点', meta.serverId) : '',
        meta.reasonCode ? formatHtmlKeyValueRow('原因码', meta.reasonCode) : '',
        meta.event ? formatHtmlKeyValueRow('事件编码', meta.event) : '',
        targetUser ? formatHtmlKeyValueRow('目标账号', targetUser) : '',
        subscriptionEmail ? formatHtmlKeyValueRow('订阅邮箱', subscriptionEmail) : '',
        stageLabel ? formatHtmlKeyValueRow('阶段', stageLabel) : '',
        Number.isFinite(Number(meta.remainingDays)) && Number(meta.remainingDays) > 0
            ? formatHtmlKeyValueRow('剩余时间', `${Number(meta.remainingDays)} 天`)
            : '',
        expiryLabel ? formatHtmlKeyValueRow('到期时间', expiryLabel) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '来源', [
        meta.ip ? formatHtmlKeyValueRow('IP', meta.ip) : '',
        locationCarrier ? formatHtmlKeyValueRow('归属地 / 运营商', locationCarrier) : '',
        meta.method || meta.path ? formatHtmlKeyValueRow('请求', `${meta.method || '-'} ${meta.path || '-'}`) : '',
        userAgent ? formatHtmlKeyValueRow('UA', userAgent) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '补充', [
        detailText ? `上下文: <code>${escapeTelegramHtml(detailText)}</code>` : '',
    ], { rawRows: true });

    return joinHtmlMessage('NMS 系统告警摘要', blocks);
}

function formatAuditMessage(entry = {}, rule = {}) {
    const blocks = [];
    const locationCarrier = formatLocationCarrierText(entry.ipLocation, entry.ipCarrier);
    const detailText = stringifyDetails(entry.details);
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

    appendHtmlSection(blocks, '概况', [
        formatHtmlKeyValueRow('级别', severityLabel(rule.severity || 'warning')),
        formatHtmlKeyValueRow('事件', rule.label || entry.eventType || entry.event || 'audit_event'),
        formatHtmlKeyValueRow('编码', entry.eventType || entry.event || 'audit_event'),
        formatHtmlKeyValueRow('时间', formatDateTime(entry.ts || new Date().toISOString())),
        formatHtmlKeyValueRow('结果', formatAuditOutcome(entry.outcome)),
        formatHtmlKeyValueRow('操作者', entry.actor || 'anonymous'),
    ], { rawRows: true });

    appendHtmlSection(blocks, '目标', [
        entry.serverId ? formatHtmlKeyValueRow('节点', entry.serverId) : '',
        targetUser ? formatHtmlKeyValueRow('目标用户', targetUser) : '',
        tokenId ? formatHtmlKeyValueRow('Token', tokenId) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '来源', [
        entry.ip ? formatHtmlKeyValueRow('IP', entry.ip) : '',
        locationCarrier ? formatHtmlKeyValueRow('归属地 / 运营商', locationCarrier) : '',
        entry.method || entry.path ? formatHtmlKeyValueRow('请求', `${entry.method || '-'} ${entry.path || '-'}`) : '',
        userAgent ? formatHtmlKeyValueRow('UA', userAgent) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '细节', [
        detailText ? `上下文: <code>${escapeTelegramHtml(detailText)}</code>` : '',
    ], { rawRows: true });

    return joinHtmlMessage('NMS 安全审计摘要', blocks);
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

function joinHtmlMessage(title, blocks = []) {
    return [`<b>${escapeTelegramHtml(title)}</b>`, ...blocks].join('\n\n').trim();
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

export function formatCommandCatalogMessage(options = {}) {
    const title = String(options.title || 'NMS Telegram 控制台').trim() || 'NMS Telegram 控制台';
    const blocks = [];
    appendHtmlSection(blocks, '快捷方式', [
        '输入框输入 <code>/</code> 可直接选命令',
        '下方键盘已固定常用命令',
        '机器人启动后会自动同步命令菜单',
    ], { rawRows: true });
    appendHtmlSection(blocks, '查询命令', formatCommandHtmlRows(options.queryCommands || DEFAULT_QUERY_COMMANDS), { rawRows: true });
    appendHtmlSection(blocks, '运维命令', formatCommandHtmlRows(options.operationCommands || DEFAULT_OPERATION_COMMANDS), { rawRows: true });
    return joinHtmlMessage(title, blocks);
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
    appendHtmlSection(blocks, '集群概况', [
        formatHtmlKeyValueRow('节点规模', `${summary.total || 0} 台`),
        `节点状态: 正常 ${formatHtmlValue(summary.healthy || 0)} · 降级 ${formatHtmlValue(summary.degraded || 0)} · 离线 ${formatHtmlValue(summary.unreachable || 0)} · 维护 ${formatHtmlValue(summary.maintenance || 0)}`,
        `在线用户: ${formatHtmlValue(summary.totalOnline || 0)} · 活跃入站: ${formatHtmlValue(`${summary.activeInbounds || 0}/${summary.totalInbounds || 0}`)}`,
    ], { rawRows: true });

    appendHtmlSection(blocks, '流量窗口', [
        formatHtmlKeyValueRow('统计口径', traffic.source === 'traffic_store' ? '最近 24h 采样汇总' : '节点快照累计值'),
        `上行: ${formatHtmlValue(formatBytesHuman(traffic.upBytes || 0))} · 下行: ${formatHtmlValue(formatBytesHuman(traffic.downBytes || 0))}`,
        formatHtmlKeyValueRow('合计', formatBytesHuman(traffic.totalBytes || ((traffic.upBytes || 0) + (traffic.downBytes || 0)))),
        traffic.lastCollectionAt ? formatHtmlKeyValueRow('最近采集', formatDateTime(traffic.lastCollectionAt)) : '',
    ], { rawRows: true });

    appendHtmlSection(blocks, '巡检时间', [
        formatHtmlKeyValueRow('最近巡检', formatDateTime(checkedAt)),
    ], { rawRows: true });

    return joinHtmlMessage('NMS 状态总览', blocks);
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

export function createTelegramAlertService(options = {}) {
    const fetcher = typeof options.fetcher === 'function' ? options.fetcher : createDefaultFetcher();
    const overrideAlertSeverities = new Set(
        normalizeStringArray(options.alertSeverities).filter((item) => ['info', 'warning', 'critical'].includes(item))
    );
    const overrideAuditEvents = new Set(normalizeStringArray(options.auditEvents));
    const dedupWindowMs = Math.max(1_000, Number(options.dedupWindowMs || DEFAULT_DEDUP_WINDOW_MS));
    const dedupCache = new Map();
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
    };
    let running = false;
    let timer = null;
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
            replyMarkup: buildCommandReplyMarkup(),
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

        if (isSecurityAudit && settings.sendSecurityAudit) return true;
        if (isEmergency && settings.sendEmergencyAlerts) return true;
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
        return sendMessage(formatAuditMessage(entry, rule), dedupKey, {
            kind: entry.eventType || entry.event || 'audit',
            parseMode: 'HTML',
        });
    }

    async function sendTestMessage(actor = 'admin') {
        const settings = resolveSettings();
        const blocks = [];
        appendHtmlSection(blocks, '概况', [
            formatHtmlKeyValueRow('目标', settings.chatId || '未配置'),
            formatHtmlKeyValueRow('时间', formatDateTime(new Date().toISOString())),
            formatHtmlKeyValueRow('触发人', actor),
        ], { rawRows: true });
        appendHtmlSection(blocks, '快捷方式', [
            '命令菜单已同步后，可直接在输入框输入 <code>/</code> 选择命令',
            '下方聊天键盘会固定常用命令',
        ], { rawRows: true });
        appendHtmlSection(blocks, '查询命令', formatCommandHtmlRows(DEFAULT_QUERY_COMMANDS), { rawRows: true });
        appendHtmlSection(blocks, '运维命令', formatCommandHtmlRows(DEFAULT_OPERATION_COMMANDS), { rawRows: true });
        return sendCommandReply(joinHtmlMessage('NMS Telegram 测试通知', blocks), settings.chatId, 'test');
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
        appendHtmlSection(blocks, '概况', [
            formatHtmlKeyValueRow('总在线用户', snapshot?.summary?.totalOnline || 0),
            formatHtmlKeyValueRow('参与节点', items.filter((item) => Number(item?.onlineCount || 0) > 0).length),
        ], { rawRows: true });
        appendHtmlSection(blocks, '节点分布', topNodes, { rawRows: true });
        return joinHtmlMessage('NMS 在线概览', blocks);
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
        appendHtmlSection(blocks, '概况', [
            `活跃用户: ${formatHtmlValue(`${overview?.registeredTotals?.activeUsers || 0}/${overview?.registeredTotals?.totalUsers || 0}`)}`,
            `上行: ${formatHtmlValue(formatBytesHuman(overview?.totals?.upBytes || 0))} · 下行: ${formatHtmlValue(formatBytesHuman(overview?.totals?.downBytes || 0))}`,
            formatHtmlKeyValueRow('合计', formatBytesHuman(overview?.totals?.totalBytes || 0)),
            overview?.lastCollectionAt ? formatHtmlKeyValueRow('最近采集', formatDateTime(overview.lastCollectionAt)) : '',
        ], { rawRows: true });
        appendHtmlSection(blocks, 'Top 用户', topUsers, { rawRows: true });
        appendHtmlSection(blocks, 'Top 节点', topServers, { rawRows: true });
        return joinHtmlMessage('NMS 24h 流量摘要', blocks);
    }

    async function buildAlertsDigest() {
        const notificationService = (await import('./notifications.js')).default;
        const items = notificationService.getUnread(5);
        if (!Array.isArray(items) || items.length === 0) {
            return joinHtmlMessage('NMS 最近告警摘要', [
                `<b>概况</b>\n• 当前没有未读通知`,
            ]);
        }
        const severityCounter = new Map();
        items.forEach((item) => incrementCounter(severityCounter, severityLabel(item.severity)));
        const blocks = [];
        appendHtmlSection(blocks, '概况', [
            formatHtmlKeyValueRow('未读告警', items.length),
            formatCounterHtmlRows(severityCounter, { limit: 3, suffix: ' 条' }).join(' · '),
        ], { rawRows: true });
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
        return joinHtmlMessage('NMS 最近告警摘要', blocks);
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
                `<b>概况</b>\n• 最近没有新的高优先级安全审计事件`,
            ]);
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
        appendHtmlSection(blocks, '概况', [
            formatHtmlKeyValueRow('命中事件', enriched.length),
            `等级分布: 紧急 ${formatHtmlValue(criticalCount)} · 告警 ${formatHtmlValue(warningCount)}`,
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
        return joinHtmlMessage('NMS 安全事件摘要', blocks);
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
                `<b>概况</b>\n• 当前没有降级、离线或维护节点`,
            ]);
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
        appendHtmlSection(blocks, '概况', [
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
        return joinHtmlMessage('NMS 节点异常摘要', blocks);
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
                `<b>概况</b>\n• 最近 7 天没有被拒绝的公开订阅访问`,
            ]);
        }

        const blocks = [];
        appendHtmlSection(blocks, '概况', [
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
        return joinHtmlMessage('NMS 公开订阅异常访问摘要', blocks);
    }

    async function buildExpiryDigest() {
        const { collectSubscriptionExpirySnapshot } = await import('./subscriptionExpiryNotifier.js');
        const snapshot = collectSubscriptionExpirySnapshot({ limit: 6 });
        if ((snapshot?.total || 0) === 0) {
            return joinHtmlMessage('NMS 用户到期提醒摘要', [
                `<b>概况</b>\n• 最近 7 天没有即将到期或已到期的用户`,
            ]);
        }

        const stageCounter = new Map();
        (snapshot.items || []).forEach((item) => {
            incrementCounter(stageCounter, item.label || item.stage);
        });

        const blocks = [];
        appendHtmlSection(blocks, '概况', [
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
        return joinHtmlMessage('NMS 用户到期提醒摘要', blocks);
    }

    async function runMonitorDigest(actor = 'telegram') {
        const serverHealthMonitor = (await import('./serverHealthMonitor.js')).default;
        const result = await serverHealthMonitor.runOnce({ force: true });
        const summary = result?.summary || {};
        const blocks = [];
        appendHtmlSection(blocks, '概况', [
            formatHtmlKeyValueRow('触发人', actor),
            formatHtmlKeyValueRow('节点规模', `${summary.total || 0} 台`),
            `节点状态: 正常 ${formatHtmlValue(summary.healthy || 0)} · 降级 ${formatHtmlValue(summary.degraded || 0)} · 离线 ${formatHtmlValue(summary.unreachable || 0)} · 维护 ${formatHtmlValue(summary.maintenance || 0)}`,
            formatHtmlKeyValueRow('时间', formatDateTime(summary.checkedAt)),
        ], { rawRows: true });
        appendHtmlSection(blocks, '异常分布', [
            Object.entries(summary.byReason || {})
                .filter(([, count]) => Number(count || 0) > 0)
                .map(([key, count]) => `<b>${escapeTelegramHtml(key)}</b> · ${formatHtmlValue(count)}`)
                .join(' · ') || '无',
        ], { rawRows: true });
        return joinHtmlMessage('NMS 手动巡检完成', blocks);
    }

    async function handleCommand(message) {
        const chatId = String(message?.chat?.id || '').trim();
        const command = normalizeCommand(message?.text || '');

        runtimeStatus.lastCommandAt = new Date().toISOString();
        runtimeStatus.lastCommand = command || String(message?.text || '').trim();

        if (command === '/start' || command === '/help') {
            await sendCommandReply(formatCommandCatalogMessage(), chatId);
            return;
        }

        if (command === '/status') {
            await sendCommandReply(await buildStatusDigest(), chatId);
            return;
        }

        if (command === '/online') {
            await sendCommandReply(await buildOnlineDigest(), chatId);
            return;
        }

        if (command === '/traffic') {
            await sendCommandReply(await buildTrafficDigest(), chatId);
            return;
        }

        if (command === '/alerts') {
            await sendCommandReply(await buildAlertsDigest(), chatId);
            return;
        }

        if (command === '/security') {
            await sendCommandReply(await buildSecurityDigest(), chatId);
            return;
        }

        if (command === '/nodes') {
            await sendCommandReply(await buildNodeIssuesDigest(), chatId);
            return;
        }

        if (command === '/access') {
            await sendCommandReply(await buildAccessDigest(), chatId);
            return;
        }

        if (command === '/expiry') {
            await sendCommandReply(await buildExpiryDigest(), chatId);
            return;
        }

        if (command === '/monitor') {
            await sendCommandReply(await runMonitorDigest(message?.from?.username || 'telegram'), chatId);
            return;
        }

        await sendCommandReply(joinHtmlMessage('NMS Telegram 控制台', [
            `<b>概况</b>\n• 未识别命令，请使用 <code>/help</code> 查看可用命令`,
        ]), chatId, 'command');
    }

    async function processUpdates(updates = []) {
        const settings = resolveSettings();
        for (const update of Array.isArray(updates) ? updates : []) {
            lastUpdateId = Math.max(lastUpdateId, Number(update?.update_id || 0));
            const message = update?.message;
            if (!message?.text) continue;
            if (String(message?.chat?.id || '').trim() !== String(settings.chatId || '').trim()) continue;

            try {
                await handleCommand(message);
            } catch (error) {
                await sendCommandReply(joinHtmlMessage('NMS Telegram 控制台', [
                    `<b>执行失败</b>\n• ${escapeTelegramHtml(error.message || 'unknown error')}`,
                ]), String(message?.chat?.id || '').trim(), 'command_error');
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
    }

    function stop() {
        running = false;
        initializedOffset = false;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
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
        commandsSynced = false;
        commandSyncPromise = null;
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
        start,
        stop,
        resetForTests,
    };
}

const telegramAlertService = createTelegramAlertService();

export default telegramAlertService;
