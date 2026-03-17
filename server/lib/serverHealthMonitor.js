import notificationService, { SEVERITY } from './notifications.js';
import serverStore from '../store/serverStore.js';
import {
    collectClusterStatusSnapshot,
    HEALTHY,
    DEGRADED,
    UNREACHABLE,
    MAINTENANCE,
    STATUS_REASON,
    getCachedClusterStatusSnapshot,
    resetClusterStatusSnapshotCache,
} from './serverStatusService.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function startBackgroundInterval(fn, delayMs) {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function formatDurationHuman(value = 0) {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return '不足 1 分钟';
    const minutes = Math.max(1, Math.round(ms / 60000));
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const remainMinutes = minutes % 60;
    const parts = [];
    if (days > 0) parts.push(`${days} 天`);
    if (hours > 0) parts.push(`${hours} 小时`);
    if (remainMinutes > 0) parts.push(`${remainMinutes} 分钟`);
    return parts.slice(0, 3).join(' ') || '不足 1 分钟';
}

function buildNotificationForState(previous, next) {
    if (next.health === HEALTHY && previous.health !== HEALTHY) {
        const outageDurationMs = previous.checkedAt && next.checkedAt
            ? Math.max(0, new Date(next.checkedAt).getTime() - new Date(previous.checkedAt).getTime())
            : 0;
        return {
            type: 'server_health_recovered',
            severity: SEVERITY.INFO,
            title: `节点已恢复: ${next.name}`,
            body: `节点 ${next.name} 已恢复可用状态${outageDurationMs > 0 ? `，本次异常持续约 ${formatDurationHuman(outageDurationMs)}` : ''}`,
            dedupKey: `server_health:${next.serverId}:healthy`,
            meta: {
                telegramTopics: ['system_status', 'recovery_notice'],
                outageDurationMs,
                recoveredAt: next.checkedAt || new Date().toISOString(),
                previousReasonCode: previous.reasonCode || '',
                previousCheckedAt: previous.checkedAt || '',
            },
        };
    }

    if (next.health === DEGRADED && previous.reasonCode === next.reasonCode && previous.health === DEGRADED) {
        return null;
    }

    if (next.health === DEGRADED) {
        if (next.reasonCode === STATUS_REASON.CREDENTIALS_MISSING) {
            return {
                type: 'server_health_credentials_missing',
                severity: SEVERITY.WARNING,
                title: `节点凭据缺失: ${next.name}`,
                body: `节点 ${next.name} 缺少可用的面板账号或密码，请补全后再巡检: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:credentials_missing`,
            };
        }
        if (next.reasonCode === STATUS_REASON.CREDENTIALS_UNREADABLE) {
            return {
                type: 'server_health_credentials_unreadable',
                severity: SEVERITY.WARNING,
                title: `节点凭据不可解密: ${next.name}`,
                body: `节点 ${next.name} 的面板凭据无法解密，请确认 CREDENTIALS_SECRET 未变更并重新保存节点凭据: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:credentials_unreadable`,
            };
        }
        if (next.reasonCode === STATUS_REASON.AUTH_FAILED) {
            return {
                type: 'server_health_auth_failed',
                severity: SEVERITY.WARNING,
                title: `节点认证失败: ${next.name}`,
                body: `节点 ${next.name} 无法通过当前凭据登录 3x-ui: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:auth_failed`,
            };
        }
        if (next.reasonCode === STATUS_REASON.STATUS_UNSUPPORTED) {
            return {
                type: 'server_health_status_unsupported',
                severity: SEVERITY.WARNING,
                title: `节点接口不兼容: ${next.name}`,
                body: `节点 ${next.name} 当前 3x-ui 版本不支持兼容的状态接口，请检查面板版本或 BasePath: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:status_unsupported`,
            };
        }
        if (next.reasonCode === STATUS_REASON.XRAY_NOT_RUNNING) {
            return {
                type: 'server_health_xray_not_running',
                severity: SEVERITY.WARNING,
                title: `节点状态异常: ${next.name}`,
                body: `节点 ${next.name} 返回异常状态: ${next.reasonMessage || 'xray not running'}`,
                dedupKey: `server_health:${next.serverId}:xray_not_running`,
            };
        }
        return {
            type: 'server_health_request_failed',
            severity: SEVERITY.WARNING,
            title: `节点检查失败: ${next.name}`,
            body: `节点 ${next.name} 状态检查失败: ${next.reasonMessage}`,
            dedupKey: `server_health:${next.serverId}:${next.reasonCode || 'panel_request_failed'}`,
            meta: {
                telegramTopics: ['system_status'],
            },
        };
    }

    if (next.health === UNREACHABLE && (previous.health !== UNREACHABLE || previous.reasonCode !== next.reasonCode)) {
        if (next.reasonCode === STATUS_REASON.DNS_ERROR) {
            return {
                type: 'server_health_dns_error',
                severity: SEVERITY.CRITICAL,
                title: `节点域名解析失败: ${next.name}`,
                body: `节点 ${next.name} 的面板地址无法完成 DNS 解析，请检查节点 URL 或 DNS 配置: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:dns_error`,
            };
        }
        if (next.reasonCode === STATUS_REASON.CONNECT_TIMEOUT) {
            return {
                type: 'server_health_connect_timeout',
                severity: SEVERITY.CRITICAL,
                title: `节点连接超时: ${next.name}`,
                body: `节点 ${next.name} 连接 3x-ui 超时，请检查网络路径、防火墙或面板负载: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:connect_timeout`,
            };
        }
        if (next.reasonCode === STATUS_REASON.CONNECTION_REFUSED) {
            return {
                type: 'server_health_connection_refused',
                severity: SEVERITY.CRITICAL,
                title: `节点拒绝连接: ${next.name}`,
                body: `节点 ${next.name} 拒绝了 3x-ui 连接，请确认面板端口和服务进程是否正常监听: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:connection_refused`,
            };
        }
        if (next.reasonCode === STATUS_REASON.NETWORK_ERROR) {
            return {
                type: 'server_health_network_error',
                severity: SEVERITY.CRITICAL,
                title: `节点网络异常: ${next.name}`,
                body: `节点 ${next.name} 与 3x-ui 的网络链路异常，请检查路由、主机连通性或中间代理: ${next.reasonMessage}`,
                dedupKey: `server_health:${next.serverId}:network_error`,
            };
        }
        return {
            type: 'server_health_unreachable',
            severity: SEVERITY.CRITICAL,
            title: `节点连接失败: ${next.name}`,
            body: `节点 ${next.name} 无法连接到 3x-ui: ${next.reasonMessage}`,
            dedupKey: `server_health:${next.serverId}:${next.reasonCode || 'unreachable'}`,
            meta: {
                telegramTopics: ['system_status', 'emergency_alert'],
            },
        };
    }

    return null;
}

class ServerHealthMonitor {
    constructor() {
        this.timer = null;
        this.running = false;
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.lastRunAt = null;
        this.lastSummary = null;
        this.serverStates = new Map();
    }

    configure(options = {}) {
        const intervalMs = Number(options.intervalMs || 0);
        if (Number.isFinite(intervalMs) && intervalMs >= 30_000) {
            this.intervalMs = intervalMs;
        }
    }

    start(options = {}) {
        if (this.running) return;
        this.configure(options);
        this.running = true;
        // Run initial check immediately (like subscriptionExpiryNotifier)
        this.runOnce().catch(() => {});
        this.timer = startBackgroundInterval(() => {
            this.runOnce().catch(() => {
                // Swallow background errors and surface via status/notifications.
            });
        }, this.intervalMs);
    }

    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async runOnce(deps = {}) {
        const serverList = typeof deps.listServers === 'function'
            ? await deps.listServers()
            : serverStore.getAll();
        const notify = deps.notify || ((payload) => notificationService.notify(payload));
        const updater = deps.updateServer || ((serverId, patch) => serverStore.update(serverId, patch));
        const collector = deps.collectClusterStatusSnapshot || collectClusterStatusSnapshot;
        const forceRefresh = deps.force === true
            || typeof deps.listServers === 'function'
            || typeof deps.ensureAuthenticated === 'function'
            || typeof deps.collectClusterStatusSnapshot === 'function';
        const snapshot = await collector({
            servers: serverList,
            includeDetails: false,
            ensureAuthenticated: deps.ensureAuthenticated,
            force: forceRefresh,
            maxAgeMs: forceRefresh ? 0 : (Number(deps.maxAgeMs || 0) || 20_000),
        });
        const results = Array.isArray(snapshot?.items) ? snapshot.items : [];
        const summary = snapshot?.summary || {
            total: 0,
            healthy: 0,
            degraded: 0,
            unreachable: 0,
            maintenance: 0,
            checkedAt: new Date().toISOString(),
            byReason: {},
        };

        for (const result of results) {
            const server = serverList.find((item) => item.id === result.serverId) || { id: result.serverId, name: result.name };
            const previous = this.serverStates.get(server.id) || {
                health: String(server.health || 'unknown').trim().toLowerCase() || 'unknown',
                reasonCode: '',
                error: '',
                checkedAt: null,
            };
            this.serverStates.set(server.id, result);

            const notification = buildNotificationForState(previous, result);
            if (notification) {
                const notificationMeta = notification.meta || {};
                const defaultTopics = new Set(Array.isArray(notificationMeta.telegramTopics) ? notificationMeta.telegramTopics : []);
                defaultTopics.add('system_status');
                if (notification.severity === SEVERITY.CRITICAL) {
                    defaultTopics.add('emergency_alert');
                }
                notify({
                    ...notification,
                    meta: {
                        ...notificationMeta,
                        serverId: result.serverId,
                        previousHealth: previous.health,
                        currentHealth: result.health,
                        reasonCode: result.reasonCode,
                        reasonMessage: result.reasonMessage,
                        retryable: result.retryable,
                        telegramTopics: [...defaultTopics],
                    },
                });
            }

            if (result.health !== previous.health) {
                updater(server.id, { health: result.health });
            }
        }

        this.lastRunAt = summary.checkedAt;
        this.lastSummary = summary;

        return {
            summary,
            items: results,
        };
    }

    getStatus() {
        const cachedSnapshot = getCachedClusterStatusSnapshot();
        return {
            running: this.running,
            intervalMs: this.intervalMs,
            lastRunAt: this.lastRunAt || cachedSnapshot?.summary?.checkedAt || null,
            summary: this.lastSummary || cachedSnapshot?.summary || null,
            items: Array.from(this.serverStates.values()).length > 0
                ? Array.from(this.serverStates.values())
                : (cachedSnapshot?.items || []),
        };
    }

    resetForTests() {
        this.stop();
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.lastRunAt = null;
        this.lastSummary = null;
        this.serverStates.clear();
        resetClusterStatusSnapshotCache();
    }
}

const serverHealthMonitor = new ServerHealthMonitor();

export { ServerHealthMonitor };
export default serverHealthMonitor;
