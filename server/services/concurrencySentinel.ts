import serverStore from '../store/serverStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { getClientIpsCompat, clearClientIpsCompat } from '../lib/panelApiCompat.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import notificationService, { SEVERITY } from '../lib/notifications.js';

export interface ConcurrencySession {
    serverId: string;
    serverName: string;
    ips: string[];
}

export interface UserConcurrencyRecord {
    email: string;
    limitIp: number;
    uniqueIps: string[];
    sessions: ConcurrencySession[];
    isViolating: boolean;
    excessCount: number;
    lastCheckedAt: string;
}

export interface ConcurrencyReport {
    timestamp: string;
    totalMonitoredUsers: number;
    totalActiveUsers: number;
    totalViolations: number;
    violations: UserConcurrencyRecord[];
    records: UserConcurrencyRecord[];
}

interface SentinelCache {
    report: ConcurrencyReport | null;
    timestamp: number;
}

const cache: SentinelCache = {
    report: null,
    timestamp: 0,
};

const CACHE_TTL_MS = 15_000;

function normalizeEmail(email: unknown): string {
    return String(email || '').trim().toLowerCase();
}

function extractIpList(response: any): string[] {
    if (!response) return [];
    const data = response.data !== undefined ? response.data : response;
    const list = Array.isArray(data?.obj) ? data.obj : Array.isArray(data) ? data : [];
    const ips: string[] = [];

    for (const item of list) {
        if (typeof item === 'string') {
            const trimmed = item.trim();
            if (trimmed) ips.push(trimmed);
        } else if (item && typeof item === 'object') {
            const ip = String(item.ip || item.clientIp || item.address || item.value || '').trim();
            if (ip) ips.push(ip);
        }
    }
    return Array.from(new Set(ips));
}

/**
 * Sweeps the entire cluster to inspect cross-node client IP presence.
 */
export async function sweepClusterConcurrency(options: {
    targetEmail?: string;
    autoKick?: boolean;
    force?: boolean;
} = {}): Promise<ConcurrencyReport> {
    const now = Date.now();
    if (!options.force && cache.report && (now - cache.timestamp < CACHE_TTL_MS) && !options.targetEmail) {
        return cache.report;
    }

    const targetEmail = options.targetEmail ? normalizeEmail(options.targetEmail) : null;
    const policies = userPolicyStore.getAll ? userPolicyStore.getAll() : [];
    
    // Map email -> limitIp
    const limitMap = new Map<string, number>();
    for (const pol of policies) {
        const email = normalizeEmail(pol.email);
        if (!email) continue;
        const limit = Number(pol.limitIp || pol.ipLimit || 0);
        if (limit > 0) {
            limitMap.set(email, limit);
        }
    }

    // List of emails to check
    const emailsToCheck = targetEmail
        ? [targetEmail]
        : Array.from(limitMap.keys());

    if (emailsToCheck.length === 0) {
        const emptyReport: ConcurrencyReport = {
            timestamp: new Date().toISOString(),
            totalMonitoredUsers: 0,
            totalActiveUsers: 0,
            totalViolations: 0,
            violations: [],
            records: [],
        };
        if (!targetEmail) {
            cache.report = emptyReport;
            cache.timestamp = now;
        }
        return emptyReport;
    }

    const enabledServers = (serverStore.getAll() || []).filter((s: any) => s.enabled !== false);
    const userSessionMap = new Map<string, ConcurrencySession[]>();

    // Query servers concurrently
    await Promise.allSettled(
        enabledServers.map(async (server: any) => {
            try {
                const client = await ensureAuthenticated(server.id);
                for (const email of emailsToCheck) {
                    try {
                        const res = await getClientIpsCompat(client, email);
                        const ips = extractIpList(res);
                        if (ips.length > 0) {
                            const existing = userSessionMap.get(email) || [];
                            existing.push({
                                serverId: server.id,
                                serverName: server.name || server.url,
                                ips,
                            });
                            userSessionMap.set(email, existing);
                        }
                    } catch {
                        // Skip if node does not support clientIps or client is not on this node
                    }
                }
            } catch {
                // Skip unreachable server
            }
        })
    );

    const records: UserConcurrencyRecord[] = [];
    const violations: UserConcurrencyRecord[] = [];
    const reportTime = new Date().toISOString();

    for (const email of emailsToCheck) {
        const sessions = userSessionMap.get(email) || [];
        const uniqueIps = Array.from(new Set(sessions.flatMap((s) => s.ips)));
        const limitIp = limitMap.get(email) || 0;
        const isViolating = limitIp > 0 && uniqueIps.length > limitIp;
        const excessCount = isViolating ? uniqueIps.length - limitIp : 0;

        const record: UserConcurrencyRecord = {
            email,
            limitIp,
            uniqueIps,
            sessions,
            isViolating,
            excessCount,
            lastCheckedAt: reportTime,
        };

        records.push(record);

        if (isViolating) {
            violations.push(record);
            appendSecurityAudit('concurrency_violation', null, {
                email,
                limitIp,
                currentIps: uniqueIps.length,
                ips: uniqueIps,
                servers: sessions.map((s) => s.serverName),
            });

            notificationService.notify({
                type: 'concurrency_violation',
                severity: SEVERITY.WARNING,
                title: `IP并发超限告警: ${email}`,
                body: `用户 ${email} 当前跨 ${sessions.length} 个节点连接了 ${uniqueIps.length} 个独立IP (上限: ${limitIp})`,
                meta: {
                    email,
                    limitIp,
                    currentIps: uniqueIps.length,
                    ips: uniqueIps,
                    nodeCount: sessions.length,
                },
                dedupKey: `concurrency_violation:${email}`,
            });

            // Auto-mitigation: kick excess sessions if requested
            if (options.autoKick) {
                // Clear sessions on excess servers
                let allowedCount = 0;
                for (const session of sessions) {
                    allowedCount += session.ips.length;
                    if (allowedCount > limitIp) {
                        try {
                            const client = await ensureAuthenticated(session.serverId);
                            await clearClientIpsCompat(client, email);
                            appendSecurityAudit('concurrency_auto_mitigated', null, {
                                email,
                                serverId: session.serverId,
                                serverName: session.serverName,
                            });
                        } catch {
                            // ignore auto-mitigate individual server error
                        }
                    }
                }
            }
        }
    }

    const report: ConcurrencyReport = {
        timestamp: reportTime,
        totalMonitoredUsers: emailsToCheck.length,
        totalActiveUsers: records.filter((r) => r.uniqueIps.length > 0).length,
        totalViolations: violations.length,
        violations,
        records,
    };

    if (!targetEmail) {
        cache.report = report;
        cache.timestamp = now;
    }

    return report;
}

/**
 * Kicks active client IP sessions for a specific user on selected (or all) servers.
 */
export async function kickUserSessions(email: string, serverIds?: string[]): Promise<{
    success: boolean;
    kickedServers: string[];
    failedServers: string[];
}> {
    const normalized = normalizeEmail(email);
    const enabledServers = (serverStore.getAll() || []).filter((s: any) => s.enabled !== false);
    const targets = Array.isArray(serverIds) && serverIds.length > 0
        ? enabledServers.filter((s: any) => serverIds.includes(s.id))
        : enabledServers;

    const kickedServers: string[] = [];
    const failedServers: string[] = [];

    await Promise.allSettled(
        targets.map(async (server: any) => {
            try {
                const client = await ensureAuthenticated(server.id);
                await clearClientIpsCompat(client, normalized);
                kickedServers.push(server.name || server.id);
            } catch {
                failedServers.push(server.name || server.id);
            }
        })
    );

    appendSecurityAudit('concurrency_kick_manual', null, {
        email: normalized,
        kickedServers,
        failedServers,
    });

    // Invalidate cache
    cache.report = null;

    return {
        success: kickedServers.length > 0,
        kickedServers,
        failedServers,
    };
}
