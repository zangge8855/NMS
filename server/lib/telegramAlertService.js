import config from '../config.js';
import systemSettingsStore from '../store/systemSettingsStore.js';

const DEFAULT_ALERT_SEVERITIES = new Set(['warning', 'critical']);
const DEFAULT_AUDIT_EVENT_RULES = {
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

function formatNotificationMessage(notification = {}) {
    const lines = [
        '[NMS 系统告警]',
        `级别: ${severityLabel(notification.severity)}`,
        `标题: ${truncateLine(notification.title, 120) || '-'}`,
        `类型: ${notification.type || 'system'}`,
        `时间: ${formatDateTime(notification.createdAt || new Date().toISOString())}`,
    ];

    if (notification.body) {
        lines.push(`内容: ${truncateLine(notification.body, 800)}`);
    }
    if (notification.meta?.serverId) {
        lines.push(`节点: ${notification.meta.serverId}`);
    }
    if (notification.meta?.reasonCode) {
        lines.push(`原因: ${notification.meta.reasonCode}`);
    }
    return lines.join('\n');
}

function formatAuditMessage(entry = {}, rule = {}) {
    const lines = [
        '[NMS 安全审计告警]',
        `级别: ${severityLabel(rule.severity || 'warning')}`,
        `事件: ${rule.label || entry.eventType || entry.event || 'audit_event'}`,
        `编码: ${entry.eventType || entry.event || 'audit_event'}`,
        `时间: ${formatDateTime(entry.ts || new Date().toISOString())}`,
        `操作者: ${entry.actor || 'anonymous'}`,
    ];

    if (entry.ip) {
        lines.push(`IP: ${entry.ip}`);
    }
    if (entry.method || entry.path) {
        lines.push(`请求: ${entry.method || '-'} ${entry.path || '-'}`);
    }
    if (entry.targetEmail) {
        lines.push(`目标: ${entry.targetEmail}`);
    }

    const detailText = stringifyDetails(entry.details);
    if (detailText) {
        lines.push(`详情: ${detailText}`);
    }
    return lines.join('\n');
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
    };
    let running = false;
    let timer = null;
    let lastUpdateId = 0;
    let initializedOffset = false;

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
            await fetcher({
                url: `${settings.apiBaseUrl.replace(/\/$/, '')}/bot${settings.botToken}/sendMessage`,
                body: {
                    chat_id: String(overrides.chatId || settings.chatId),
                    text: truncateLine(text, 3900),
                    disable_web_page_preview: true,
                },
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
        });
    }

    async function sendTestMessage(actor = 'admin') {
        const settings = resolveSettings();
        return sendMessage(trimLines([
            '[NMS Telegram 测试通知]',
            `目标: ${settings.chatId || '未配置'}`,
            `时间: ${formatDateTime(new Date().toISOString())}`,
            `触发人: ${actor}`,
            '可用命令: /help /status /online /traffic /alerts /monitor',
        ]), '', { kind: 'test' });
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
        const [{ collectClusterStatusSnapshot }, serverHealthMonitor] = await Promise.all([
            import('./serverStatusService.js'),
            import('./serverHealthMonitor.js').then((module) => module.default),
        ]);
        const snapshot = await collectClusterStatusSnapshot({
            includeDetails: true,
            maxAgeMs: 30_000,
        });
        const summary = snapshot?.summary || {};
        return trimLines([
            '[NMS 状态总览]',
            `节点: ${summary.total || 0} 台 · 正常 ${summary.healthy || 0} · 降级 ${summary.degraded || 0} · 离线 ${summary.unreachable || 0} · 维护 ${summary.maintenance || 0}`,
            `在线用户: ${summary.totalOnline || 0} · 活跃入站 ${summary.activeInbounds || 0}/${summary.totalInbounds || 0}`,
            `总流量: ↑ ${formatBytesHuman(summary.totalUp || 0)} / ↓ ${formatBytesHuman(summary.totalDown || 0)}`,
            `最近巡检: ${formatDateTime(summary.checkedAt || serverHealthMonitor.getStatus()?.lastRunAt)}`,
        ]);
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
            .map((item) => `${item.name || item.serverId}: ${item.onlineCount || 0} 在线`);

        return trimLines([
            '[NMS 在线概览]',
            `总在线用户: ${snapshot?.summary?.totalOnline || 0}`,
            topNodes.length > 0 ? `节点分布:\n- ${topNodes.join('\n- ')}` : '节点分布: 暂无在线用户',
        ]);
    }

    async function buildTrafficDigest() {
        const trafficStatsStore = (await import('../store/trafficStatsStore.js')).default;
        await trafficStatsStore.collectIfStale(false);
        const overview = trafficStatsStore.getOverview({ days: 1, top: 5 });
        const topUsers = Array.isArray(overview?.topUsers)
            ? overview.topUsers.slice(0, 5).map((item) => `${item.username || item.email}: ${formatBytesHuman(item.totalBytes)}`)
            : [];
        const topServers = Array.isArray(overview?.topServers)
            ? overview.topServers.slice(0, 5).map((item) => `${item.serverName || item.serverId}: ${formatBytesHuman(item.totalBytes)}`)
            : [];

        return trimLines([
            '[NMS 24h 流量]',
            `注册用户活跃数: ${overview?.registeredTotals?.activeUsers || 0}/${overview?.registeredTotals?.totalUsers || 0}`,
            `上行: ${formatBytesHuman(overview?.totals?.upBytes || 0)} · 下行: ${formatBytesHuman(overview?.totals?.downBytes || 0)} · 合计: ${formatBytesHuman(overview?.totals?.totalBytes || 0)}`,
            topUsers.length > 0 ? `Top 用户:\n- ${topUsers.join('\n- ')}` : '',
            topServers.length > 0 ? `Top 节点:\n- ${topServers.join('\n- ')}` : '',
            overview?.lastCollectionAt ? `最近采集: ${formatDateTime(overview.lastCollectionAt)}` : '',
        ]);
    }

    async function buildAlertsDigest() {
        const notificationService = (await import('./notifications.js')).default;
        const items = notificationService.getUnread(5);
        if (!Array.isArray(items) || items.length === 0) {
            return '[NMS 告警] 当前没有未读通知';
        }
        return trimLines([
            '[NMS 最近告警]',
            ...items.map((item) => `- [${severityLabel(item.severity)}] ${item.title}`),
        ]);
    }

    async function runMonitorDigest(actor = 'telegram') {
        const serverHealthMonitor = (await import('./serverHealthMonitor.js')).default;
        const result = await serverHealthMonitor.runOnce({ force: true });
        const summary = result?.summary || {};
        return trimLines([
            '[NMS 手动巡检完成]',
            `触发人: ${actor}`,
            `节点: ${summary.total || 0} 台 · 正常 ${summary.healthy || 0} · 降级 ${summary.degraded || 0} · 离线 ${summary.unreachable || 0} · 维护 ${summary.maintenance || 0}`,
            `异常分布: ${Object.entries(summary.byReason || {}).filter(([, count]) => Number(count || 0) > 0).map(([key, count]) => `${key} ${count}`).join(' · ') || '无'}`,
            `时间: ${formatDateTime(summary.checkedAt)}`,
        ]);
    }

    async function handleCommand(message) {
        const chatId = String(message?.chat?.id || '').trim();
        const command = normalizeCommand(message?.text || '');

        runtimeStatus.lastCommandAt = new Date().toISOString();
        runtimeStatus.lastCommand = command || String(message?.text || '').trim();

        if (command === '/start' || command === '/help') {
            await sendMessage(trimLines([
                '[NMS Telegram 控制台]',
                '/status 查看系统状态摘要',
                '/online 查看节点在线人数',
                '/traffic 查看最近 24h 流量',
                '/alerts 查看最近未读告警',
                '/monitor 立即执行节点巡检',
            ]), '', { chatId, kind: 'command' });
            return;
        }

        if (command === '/status') {
            await sendMessage(await buildStatusDigest(), '', { chatId, kind: 'command' });
            return;
        }

        if (command === '/online') {
            await sendMessage(await buildOnlineDigest(), '', { chatId, kind: 'command' });
            return;
        }

        if (command === '/traffic') {
            await sendMessage(await buildTrafficDigest(), '', { chatId, kind: 'command' });
            return;
        }

        if (command === '/alerts') {
            await sendMessage(await buildAlertsDigest(), '', { chatId, kind: 'command' });
            return;
        }

        if (command === '/monitor') {
            await sendMessage(await runMonitorDigest(message?.from?.username || 'telegram'), '', { chatId, kind: 'command' });
            return;
        }

        await sendMessage('未识别命令。发送 /help 查看可用命令。', '', { chatId, kind: 'command' });
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
                await sendMessage(`命令执行失败: ${error.message || 'unknown error'}`, '', {
                    chatId: String(message?.chat?.id || '').trim(),
                    kind: 'command_error',
                });
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
        start,
        stop,
        resetForTests,
    };
}

const telegramAlertService = createTelegramAlertService();

export default telegramAlertService;
