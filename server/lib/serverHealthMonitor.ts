import notificationService, { SEVERITY } from './notifications.js';
import serverStore from '../store/serverStore.js';
import { isEnglishLocale, resolveNotificationLocale, type AppLocale } from './requestLocale.js';
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
const DEFAULT_RETRYABLE_FAILURE_CONFIRMATIONS = 2;
const TRANSIENT_FAILURE_REASONS = new Set<string>([
    STATUS_REASON.DNS_ERROR,
    STATUS_REASON.CONNECT_TIMEOUT,
    STATUS_REASON.CONNECTION_REFUSED,
    STATUS_REASON.NETWORK_ERROR,
    STATUS_REASON.PANEL_REQUEST_FAILED,
]);

function startBackgroundInterval(fn: () => void, delayMs: number): NodeJS.Timeout {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function formatDurationHuman(value: unknown = 0, locale: AppLocale = 'zh-CN'): string {
    const isEn = isEnglishLocale(locale);
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return isEn ? '< 1 min' : '不足 1 分钟';
    const minutes = Math.max(1, Math.round(ms / 60000));
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const remainMinutes = minutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(isEn ? `${days}d` : `${days} 天`);
    if (hours > 0) parts.push(isEn ? `${hours}h` : `${hours} 小时`);
    if (remainMinutes > 0) parts.push(isEn ? `${remainMinutes}m` : `${remainMinutes} 分钟`);
    return parts.slice(0, 3).join(' ') || (isEn ? '< 1 min' : '不足 1 分钟');
}

interface LocalizedCopy {
    title: string;
    body: string;
}

function buildHealthCopy(
    template: { zh: LocalizedCopy; en: LocalizedCopy },
    locale: AppLocale
) {
    const selected = isEnglishLocale(locale) ? template.en : template.zh;
    return {
        title: selected.title,
        body: selected.body,
        localized: {
            'zh-CN': template.zh,
            'en-US': template.en,
        },
    };
}

function buildNotificationForState(previous: any, next: any, explicitLocale?: unknown) {
    const locale = resolveNotificationLocale(explicitLocale);

    if (next.health === HEALTHY && previous.health !== HEALTHY) {
        const outageStartedAt = previous.outageStartedAt || previous.checkedAt;
        const outageDurationMs = outageStartedAt && next.checkedAt
            ? Math.max(0, new Date(next.checkedAt).getTime() - new Date(outageStartedAt).getTime())
            : 0;
        const copy = buildHealthCopy({
            zh: {
                title: `节点已恢复: ${next.name}`,
                body: `节点 ${next.name} 已恢复可用状态${outageDurationMs > 0 ? `，本次异常持续约 ${formatDurationHuman(outageDurationMs, 'zh-CN')}` : ''}`,
            },
            en: {
                title: `Node recovered: ${next.name}`,
                body: `Node ${next.name} is back online${outageDurationMs > 0 ? ` (downtime ~${formatDurationHuman(outageDurationMs, 'en-US')})` : ''}`,
            },
        }, locale);
        return {
            type: 'server_health_recovered',
            severity: SEVERITY.INFO,
            title: copy.title,
            body: copy.body,
            dedupKey: `server_health:${next.serverId}:healthy`,
            meta: {
                telegramTopics: ['system_status', 'recovery_notice'],
                outageDurationMs,
                recoveredAt: next.checkedAt || new Date().toISOString(),
                previousReasonCode: previous.reasonCode || '',
                previousCheckedAt: previous.checkedAt || '',
                localized: copy.localized,
            },
        };
    }

    if (next.health === DEGRADED && previous.reasonCode === next.reasonCode && previous.health === DEGRADED) {
        return null;
    }

    if (next.health === DEGRADED) {
        const degradedTemplates: Record<string, { type: string; dedupSuffix: string; zh: LocalizedCopy; en: LocalizedCopy }> = {
            [STATUS_REASON.CREDENTIALS_MISSING]: {
                type: 'server_health_credentials_missing',
                dedupSuffix: 'credentials_missing',
                zh: {
                    title: `节点凭据缺失: ${next.name}`,
                    body: `节点 ${next.name} 缺少可用的面板账号或密码，请补全后再巡检: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node credentials missing: ${next.name}`,
                    body: `Node ${next.name} is missing panel credentials. Complete username/password before probing: ${next.reasonMessage}`,
                },
            },
            [STATUS_REASON.CREDENTIALS_UNREADABLE]: {
                type: 'server_health_credentials_unreadable',
                dedupSuffix: 'credentials_unreadable',
                zh: {
                    title: `节点凭据不可解密: ${next.name}`,
                    body: `节点 ${next.name} 的面板凭据无法解密，请确认 CREDENTIALS_SECRET 未变更并重新保存节点凭据: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node credentials unreadable: ${next.name}`,
                    body: `Node ${next.name} panel credentials cannot be decrypted. Verify CREDENTIALS_SECRET and re-save credentials: ${next.reasonMessage}`,
                },
            },
            [STATUS_REASON.AUTH_FAILED]: {
                type: 'server_health_auth_failed',
                dedupSuffix: 'auth_failed',
                zh: {
                    title: `节点认证失败: ${next.name}`,
                    body: `节点 ${next.name} 无法通过当前凭据登录 3x-ui: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node authentication failed: ${next.name}`,
                    body: `Node ${next.name} could not sign in with current credentials: ${next.reasonMessage}`,
                },
            },
            [STATUS_REASON.STATUS_UNSUPPORTED]: {
                type: 'server_health_status_unsupported',
                dedupSuffix: 'status_unsupported',
                zh: {
                    title: `节点接口不兼容: ${next.name}`,
                    body: `节点 ${next.name} 当前 3x-ui 版本不支持兼容的状态接口，请检查面板版本或 BasePath: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node API incompatible: ${next.name}`,
                    body: `Node ${next.name} panel does not support a compatible status API. Check panel version or BasePath: ${next.reasonMessage}`,
                },
            },
            [STATUS_REASON.XRAY_NOT_RUNNING]: {
                type: 'server_health_xray_not_running',
                dedupSuffix: 'xray_not_running',
                zh: {
                    title: `节点状态异常: ${next.name}`,
                    body: `节点 ${next.name} 返回异常状态: ${next.reasonMessage || 'xray not running'}`,
                },
                en: {
                    title: `Node service abnormal: ${next.name}`,
                    body: `Node ${next.name} reported an abnormal service status: ${next.reasonMessage || 'xray not running'}`,
                },
            },
        };

        const matched = degradedTemplates[next.reasonCode];
        if (matched) {
            const copy = buildHealthCopy(matched, locale);
            return {
                type: matched.type,
                severity: SEVERITY.WARNING,
                title: copy.title,
                body: copy.body,
                dedupKey: `server_health:${next.serverId}:${matched.dedupSuffix}`,
                meta: {
                    localized: copy.localized,
                },
            };
        }

        const copy = buildHealthCopy({
            zh: {
                title: `节点检查失败: ${next.name}`,
                body: `节点 ${next.name} 状态检查失败: ${next.reasonMessage}`,
            },
            en: {
                title: `Node check failed: ${next.name}`,
                body: `Node ${next.name} status check failed: ${next.reasonMessage}`,
            },
        }, locale);
        return {
            type: 'server_health_request_failed',
            severity: SEVERITY.WARNING,
            title: copy.title,
            body: copy.body,
            dedupKey: `server_health:${next.serverId}:${next.reasonCode || 'panel_request_failed'}`,
            meta: {
                telegramTopics: ['system_status'],
                localized: copy.localized,
            },
        };
    }

    if (next.health === UNREACHABLE && (previous.health !== UNREACHABLE || previous.reasonCode !== next.reasonCode)) {
        const unreachableTemplates: Record<string, { type: string; dedupSuffix: string; zh: LocalizedCopy; en: LocalizedCopy }> = {
            [STATUS_REASON.DNS_ERROR]: {
                type: 'server_health_dns_error',
                dedupSuffix: 'dns_error',
                zh: {
                    title: `节点域名解析失败: ${next.name}`,
                    body: `节点 ${next.name} 的面板地址无法完成 DNS 解析，请检查节点 URL 或 DNS 配置: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node DNS resolution failed: ${next.name}`,
                    body: `Node ${next.name} hostname failed DNS resolution. Check the node URL or DNS config: ${next.reasonMessage}`,
                },
            },
            [STATUS_REASON.CONNECT_TIMEOUT]: {
                type: 'server_health_connect_timeout',
                dedupSuffix: 'connect_timeout',
                zh: {
                    title: `节点连接超时: ${next.name}`,
                    body: `节点 ${next.name} 连接 3x-ui 超时，请检查网络路径、防火墙或面板负载: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node connection timed out: ${next.name}`,
                    body: `Node ${next.name} timed out connecting to the panel. Check network path, firewall, or load: ${next.reasonMessage}`,
                },
            },
            [STATUS_REASON.CONNECTION_REFUSED]: {
                type: 'server_health_connection_refused',
                dedupSuffix: 'connection_refused',
                zh: {
                    title: `节点拒绝连接: ${next.name}`,
                    body: `节点 ${next.name} 拒绝了 3x-ui 连接，请确认面板端口和服务进程是否正常监听: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node connection refused: ${next.name}`,
                    body: `Node ${next.name} refused the panel connection. Verify the port and panel process: ${next.reasonMessage}`,
                },
            },
            [STATUS_REASON.NETWORK_ERROR]: {
                type: 'server_health_network_error',
                dedupSuffix: 'network_error',
                zh: {
                    title: `节点网络异常: ${next.name}`,
                    body: `节点 ${next.name} 与 3x-ui 的网络链路异常，请检查路由、主机连通性或中间代理: ${next.reasonMessage}`,
                },
                en: {
                    title: `Node network error: ${next.name}`,
                    body: `Node ${next.name} encountered a panel network error. Check routing, host reachability, or proxy path: ${next.reasonMessage}`,
                },
            },
        };

        const matched = unreachableTemplates[next.reasonCode];
        if (matched) {
            const copy = buildHealthCopy(matched, locale);
            return {
                type: matched.type,
                severity: SEVERITY.CRITICAL,
                title: copy.title,
                body: copy.body,
                dedupKey: `server_health:${next.serverId}:${matched.dedupSuffix}`,
                meta: {
                    localized: copy.localized,
                },
            };
        }

        const copy = buildHealthCopy({
            zh: {
                title: `节点连接失败: ${next.name}`,
                body: `节点 ${next.name} 无法连接到 3x-ui: ${next.reasonMessage}`,
            },
            en: {
                title: `Node unreachable: ${next.name}`,
                body: `Node ${next.name} could not reach the panel: ${next.reasonMessage}`,
            },
        }, locale);
        return {
            type: 'server_health_unreachable',
            severity: SEVERITY.CRITICAL,
            title: copy.title,
            body: copy.body,
            dedupKey: `server_health:${next.serverId}:${next.reasonCode || 'unreachable'}`,
            meta: {
                telegramTopics: ['system_status', 'emergency_alert'],
                localized: copy.localized,
            },
        };
    }

    return null;
}

function isTransientPanelFailure(result: any = {}): boolean {
    return result.retryable === true
        && result.health !== HEALTHY
        && result.health !== MAINTENANCE
        && TRANSIENT_FAILURE_REASONS.has(String(result.reasonCode || ''));
}

function shouldConfirmTransientFailure(previous: any = {}, result: any = {}): boolean {
    if (!isTransientPanelFailure(result)) return false;
    const previousHealth = String(previous.health || '').trim().toLowerCase();
    return !previousHealth || previousHealth === 'unknown' || previousHealth === HEALTHY;
}

function buildPendingStableResult(previous: any = {}, result: any = {}, pending: any = {}) {
    const previousHealth = String(previous.health || '').trim().toLowerCase() || 'unknown';
    return {
        ...previous,
        serverId: result.serverId,
        name: result.name,
        health: previousHealth,
        online: previousHealth === HEALTHY ? true : previous.online === true,
        checkedAt: result.checkedAt || previous.checkedAt || new Date().toISOString(),
        transientFailure: {
            count: pending.count || 1,
            reasonCode: result.reasonCode || '',
            reasonMessage: result.reasonMessage || '',
            firstSeenAt: pending.firstSeenAt || result.checkedAt || new Date().toISOString(),
            checkedAt: result.checkedAt || new Date().toISOString(),
        },
    };
}

function buildMonitorSummary(items: any[] = []) {
    const summary: any = {
        total: items.length,
        healthy: 0,
        degraded: 0,
        unreachable: 0,
        maintenance: 0,
        onlineServers: 0,
        checkedAt: new Date().toISOString(),
        byReason: {},
    };

    for (const item of items) {
        const health = String(item?.health || '').trim().toLowerCase();
        if (health === HEALTHY) summary.healthy += 1;
        if (health === DEGRADED) summary.degraded += 1;
        if (health === UNREACHABLE) summary.unreachable += 1;
        if (health === MAINTENANCE) summary.maintenance += 1;
        if (item?.online === true) summary.onlineServers += 1;
        const reasonCode = String(item?.reasonCode || STATUS_REASON.NONE);
        summary.byReason[reasonCode] = (summary.byReason[reasonCode] || 0) + 1;
        if (item?.checkedAt) summary.checkedAt = item.checkedAt;
    }
    summary.reasonCounts = summary.byReason;
    return summary;
}

class ServerHealthMonitor {
    timer: NodeJS.Timeout | null;
    running: boolean;
    intervalMs: number;
    retryableFailureConfirmationCount: number;
    lastRunAt: string | null;
    lastSummary: any;
    serverStates: Map<string, any>;
    pendingFailures: Map<string, any>;

    constructor() {
        this.timer = null;
        this.running = false;
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.retryableFailureConfirmationCount = DEFAULT_RETRYABLE_FAILURE_CONFIRMATIONS;
        this.lastRunAt = null;
        this.lastSummary = null;
        this.serverStates = new Map();
        this.pendingFailures = new Map();
    }

    configure(options: any = {}): void {
        const intervalMs = Number(options.intervalMs || 0);
        if (Number.isFinite(intervalMs) && intervalMs >= 30_000) {
            this.intervalMs = intervalMs;
        }
        const retryableFailureConfirmationCount = Number(options.retryableFailureConfirmationCount || 0);
        if (Number.isFinite(retryableFailureConfirmationCount) && retryableFailureConfirmationCount >= 1) {
            this.retryableFailureConfirmationCount = Math.floor(retryableFailureConfirmationCount);
        }
    }

    resolveEffectiveResult(server: any, previous: any, result: any) {
        if (!shouldConfirmTransientFailure(previous, result)) {
            this.pendingFailures.delete(server.id);
            return result;
        }

        const signature = `${result.health}:${result.reasonCode || ''}`;
        const existing = this.pendingFailures.get(server.id);
        const nextPending = existing?.signature === signature
            ? {
                ...existing,
                count: existing.count + 1,
                latest: result,
            }
            : {
                signature,
                count: 1,
                firstSeenAt: result.checkedAt || new Date().toISOString(),
                latest: result,
            };
        this.pendingFailures.set(server.id, nextPending);

        if (nextPending.count < this.retryableFailureConfirmationCount) {
            return buildPendingStableResult(previous, result, nextPending);
        }

        this.pendingFailures.delete(server.id);
        return result;
    }

    start(options: any = {}): void {
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

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async runOnce(deps: any = {}): Promise<any> {
        const serverList = typeof deps.listServers === 'function'
            ? await deps.listServers()
            : serverStore.getAll();
        const notify = deps.notify || ((payload: any) => notificationService.notify(payload));
        const updater = deps.updateServer || ((serverId: string, patch: any) => serverStore.update(serverId, patch));
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
        const fallbackSummary = snapshot?.summary || {
            total: 0,
            healthy: 0,
            degraded: 0,
            unreachable: 0,
            maintenance: 0,
            checkedAt: new Date().toISOString(),
            byReason: {},
        };
        const effectiveResults: any[] = [];

        for (const result of results) {
            const server = serverList.find((item: any) => item.id === result.serverId) || { id: result.serverId, name: result.name };
            const previous = this.serverStates.get(server.id) || {
                serverId: server.id,
                name: server.name,
                health: String(server.health || 'unknown').trim().toLowerCase() || 'unknown',
                online: String(server.health || '').trim().toLowerCase() === HEALTHY,
                reasonCode: '',
                reasonMessage: '',
                error: '',
                checkedAt: null,
            };
            const effectiveResult = this.resolveEffectiveResult(server, previous, result);
            if (effectiveResult.health !== HEALTHY) {
                effectiveResult.outageStartedAt = (previous.health === HEALTHY || !previous.outageStartedAt)
                    ? (effectiveResult.checkedAt || new Date().toISOString())
                    : previous.outageStartedAt;
            } else {
                effectiveResult.outageStartedAt = null;
            }
            this.serverStates.set(server.id, effectiveResult);
            effectiveResults.push(effectiveResult);

            const notification = buildNotificationForState(previous, effectiveResult, deps.locale);
            if (notification) {
                const notificationMeta: any = notification.meta || {};
                const defaultTopics = new Set(Array.isArray(notificationMeta.telegramTopics) ? notificationMeta.telegramTopics : []);
                defaultTopics.add('system_status');
                if (notification.severity === SEVERITY.CRITICAL) {
                    defaultTopics.add('emergency_alert');
                }
                notify({
                    ...notification,
                    meta: {
                        ...notificationMeta,
                        serverId: effectiveResult.serverId,
                        previousHealth: previous.health,
                        currentHealth: effectiveResult.health,
                        reasonCode: effectiveResult.reasonCode,
                        reasonMessage: effectiveResult.reasonMessage,
                        retryable: effectiveResult.retryable,
                        telegramTopics: [...defaultTopics],
                    },
                });
            }

            if (effectiveResult.health !== previous.health) {
                updater(server.id, { health: effectiveResult.health });
            }
        }

        const summary = results.length > 0 ? buildMonitorSummary(effectiveResults) : fallbackSummary;
        this.lastRunAt = summary.checkedAt;
        this.lastSummary = summary;

        return {
            summary,
            items: effectiveResults,
        };
    }

    getStatus(): any {
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

    resetForTests(): void {
        this.stop();
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.retryableFailureConfirmationCount = DEFAULT_RETRYABLE_FAILURE_CONFIRMATIONS;
        this.lastRunAt = null;
        this.lastSummary = null;
        this.serverStates.clear();
        this.pendingFailures.clear();
        resetClusterStatusSnapshotCache();
    }
}

const serverHealthMonitor = new ServerHealthMonitor();

export { ServerHealthMonitor, buildNotificationForState, formatDurationHuman };
export default serverHealthMonitor;
