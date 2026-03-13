import notificationService, { SEVERITY } from './notifications.js';
import serverStore from '../store/serverStore.js';
import { ensureAuthenticated, fetchPanelServerStatus } from './panelClient.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const HEALTHY = 'healthy';
const DEGRADED = 'degraded';
const UNREACHABLE = 'unreachable';
const MAINTENANCE = 'maintenance';

function startBackgroundInterval(fn, delayMs) {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function normalizeErrorMessage(error) {
    return String(
        error?.response?.data?.msg
        || error?.message
        || error
        || ''
    ).trim();
}

function deriveHealthFromStatus(statusPayload) {
    const xrayState = String(statusPayload?.obj?.xray?.state || '').trim().toLowerCase();
    if (!xrayState || xrayState === 'running') {
        return {
            health: HEALTHY,
            detail: '',
        };
    }
    return {
        health: DEGRADED,
        detail: statusPayload?.obj?.xray?.errorMsg || `xray=${xrayState}`,
    };
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
        const auth = deps.ensureAuthenticated || ensureAuthenticated;
        const notify = deps.notify || ((payload) => notificationService.notify(payload));
        const updater = deps.updateServer || ((serverId, patch) => serverStore.update(serverId, patch));
        const results = [];

        for (const server of serverList) {
            const previous = this.serverStates.get(server.id) || {
                health: String(server.health || 'unknown').trim().toLowerCase() || 'unknown',
                error: '',
                checkedAt: null,
            };

            if (previous.health === MAINTENANCE || String(server.health || '').trim().toLowerCase() === MAINTENANCE) {
                const maintenanceResult = {
                    serverId: server.id,
                    name: server.name,
                    health: MAINTENANCE,
                    error: '',
                    checkedAt: new Date().toISOString(),
                };
                this.serverStates.set(server.id, maintenanceResult);
                results.push(maintenanceResult);
                continue;
            }

            try {
                const client = await auth(server.id);
                const response = await fetchPanelServerStatus(client);
                const next = deriveHealthFromStatus(response?.data || response);
                const checkedAt = new Date().toISOString();
                const result = {
                    serverId: server.id,
                    name: server.name,
                    health: next.health,
                    error: next.detail,
                    checkedAt,
                };
                this.serverStates.set(server.id, result);
                results.push(result);

                if (next.health !== previous.health && next.health === HEALTHY) {
                    notify({
                        type: 'server_health_recovered',
                        severity: SEVERITY.INFO,
                        title: `节点已恢复: ${server.name}`,
                        body: `节点 ${server.name} 已恢复可用状态`,
                        meta: { serverId: server.id, previousHealth: previous.health, currentHealth: next.health },
                        dedupKey: `server_health:${server.id}:healthy`,
                    });
                } else if (next.health !== previous.health && next.health === DEGRADED) {
                    notify({
                        type: 'server_health_degraded',
                        severity: SEVERITY.WARNING,
                        title: `节点状态异常: ${server.name}`,
                        body: `节点 ${server.name} 返回异常状态: ${next.detail || 'xray not running'}`,
                        meta: { serverId: server.id, previousHealth: previous.health, currentHealth: next.health, error: next.detail || '' },
                        dedupKey: `server_health:${server.id}:degraded`,
                    });
                }

                if (next.health !== previous.health) {
                    updater(server.id, { health: next.health });
                }
            } catch (error) {
                const checkedAt = new Date().toISOString();
                const message = normalizeErrorMessage(error) || 'panel-unreachable';
                const result = {
                    serverId: server.id,
                    name: server.name,
                    health: UNREACHABLE,
                    error: message,
                    checkedAt,
                };
                this.serverStates.set(server.id, result);
                results.push(result);

                if (previous.health !== UNREACHABLE) {
                    notify({
                        type: 'server_health_unreachable',
                        severity: SEVERITY.CRITICAL,
                        title: `节点不可达: ${server.name}`,
                        body: `节点 ${server.name} 无法访问 3x-ui: ${message}`,
                        meta: { serverId: server.id, previousHealth: previous.health, currentHealth: UNREACHABLE, error: message },
                        dedupKey: `server_health:${server.id}:unreachable`,
                    });
                }

                if (previous.health !== UNREACHABLE) {
                    updater(server.id, { health: UNREACHABLE });
                }
            }
        }

        const summary = {
            total: results.length,
            healthy: results.filter((item) => item.health === HEALTHY).length,
            degraded: results.filter((item) => item.health === DEGRADED).length,
            unreachable: results.filter((item) => item.health === UNREACHABLE).length,
            maintenance: results.filter((item) => item.health === MAINTENANCE).length,
            checkedAt: new Date().toISOString(),
        };

        this.lastRunAt = summary.checkedAt;
        this.lastSummary = summary;

        return {
            summary,
            items: results,
        };
    }

    getStatus() {
        return {
            running: this.running,
            intervalMs: this.intervalMs,
            lastRunAt: this.lastRunAt,
            summary: this.lastSummary,
            items: Array.from(this.serverStates.values()),
        };
    }

    resetForTests() {
        this.stop();
        this.intervalMs = DEFAULT_INTERVAL_MS;
        this.lastRunAt = null;
        this.lastSummary = null;
        this.serverStates.clear();
    }
}

const serverHealthMonitor = new ServerHealthMonitor();

export { ServerHealthMonitor };
export default serverHealthMonitor;
