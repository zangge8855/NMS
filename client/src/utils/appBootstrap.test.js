import { describe, expect, it, beforeEach } from 'vitest';
import { applyAppBootstrapSnapshots } from './appBootstrap.js';
import { readSessionSnapshot } from './sessionSnapshot.js';

describe('applyAppBootstrapSnapshots', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it('hydrates the shared bootstrap snapshot keys used by root contexts and dashboard views', () => {
        applyAppBootstrapSnapshots({
            serverContext: {
                servers: [{ id: 'server-a', name: 'Node A' }],
            },
            managedUsers: [
                { id: 'user-1', username: 'alice', email: 'alice@example.com', role: 'user' },
            ],
            notifications: {
                notifications: [{ id: 'n1', title: 'Notice' }],
                unreadCount: 2,
                loadedLimit: 1,
            },
            telemetryOverview: {
                items: [{ serverId: 'server-a', serverName: 'Node A' }],
                byServerId: {
                    'server-a': { serverId: 'server-a', serverName: 'Node A' },
                },
                generatedAt: '2026-03-24T00:00:00.000Z',
            },
            dashboard: {
                serverStatuses: {
                    'server-a': { serverId: 'server-a', name: 'Node A', online: true },
                },
                globalStats: {
                    serverCount: 1,
                    onlineServers: 1,
                },
                globalOnlineUsers: [
                    { userId: 'user-1', displayName: 'Alice', sessions: 2 },
                ],
                globalOnlineSessionCount: 2,
                globalAccountSummary: {
                    totalUsers: 12,
                    pendingUsers: 1,
                },
                trafficWindowTotals: {
                    day: { totalUp: 1, totalDown: 2, ready: true },
                    week: { totalUp: 3, totalDown: 4, ready: true },
                    month: { totalUp: 5, totalDown: 6, ready: true },
                },
                globalPresenceReady: true,
            },
            audit: {
                events: {
                    eventsData: {
                        items: [{ id: 'event-1', eventType: 'login_success' }],
                        total: 1,
                        page: 1,
                        totalPages: 1,
                    },
                },
                traffic: {
                    trafficOverview: {
                        totalSamples: 24,
                    },
                    trafficWindows: {
                        week: { activeUsers: 4 },
                        month: { activeUsers: 9 },
                    },
                },
                access: {
                    accessData: {
                        items: [{ id: 'access-1', email: 'alice@example.com' }],
                        total: 1,
                        page: 1,
                        totalPages: 1,
                        statusBreakdown: { success: 1 },
                    },
                    accessSummary: {
                        total: 1,
                        uniqueIpCount: 1,
                        uniqueUsers: 1,
                        statusBreakdown: { success: 1 },
                        topIps: [],
                        from: '',
                        to: '',
                    },
                    accessUserWindows: {
                        week: { uniqueUsers: 1 },
                        month: { uniqueUsers: 1 },
                    },
                },
            },
            systemSettings: {
                settings: {
                    site: {
                        accessPath: '/console',
                    },
                },
                dbStatus: {
                    healthy: true,
                },
                emailStatus: {
                    configured: true,
                },
                backupStatus: {
                    latestBackupAt: '2026-03-24T00:00:00.000Z',
                },
                monitorStatus: {
                    notifications: {
                        unreadCount: 2,
                    },
                },
                registrationRuntime: {
                    enabled: true,
                    inviteOnlyEnabled: false,
                    passwordResetEnabled: true,
                },
                inviteCodes: [
                    { id: 'invite-1', status: 'active' },
                ],
            },
            tasks: {
                tasks: [
                    {
                        id: 'task-1',
                        type: 'clients',
                        action: 'update',
                        summary: {
                            total: 2,
                            success: 2,
                            failed: 0,
                        },
                    },
                ],
            },
        });

        expect(readSessionSnapshot('server_context_bootstrap_v1')).toMatchObject({
            servers: [{ id: 'server-a', name: 'Node A' }],
            activeServerId: 'global',
        });
        expect(readSessionSnapshot('notification_center_bootstrap_v1')).toMatchObject({
            unreadCount: 2,
            notifications: [{ id: 'n1', title: 'Notice' }],
        });
        expect(readSessionSnapshot('managed_users_v1')).toEqual([
            { id: 'user-1', username: 'alice', email: 'alice@example.com', role: 'user' },
        ]);
        expect(readSessionSnapshot('server_telemetry_overview_v1:24:24')).toMatchObject({
            generatedAt: '2026-03-24T00:00:00.000Z',
        });
        expect(readSessionSnapshot('dashboard_global_v1')).toMatchObject({
            globalPresenceReady: true,
            globalStats: {
                serverCount: 1,
                onlineServers: 1,
            },
            globalOnlineUsers: [
                { userId: 'user-1', displayName: 'Alice', sessions: 2 },
            ],
            globalOnlineSessionCount: 2,
        });
        expect(readSessionSnapshot('audit_events_v1')).toMatchObject({
            eventsData: {
                total: 1,
            },
        });
        expect(readSessionSnapshot('audit_traffic_v1')).toMatchObject({
            trafficWindows: {
                week: { activeUsers: 4 },
                month: { activeUsers: 9 },
            },
        });
        expect(readSessionSnapshot('audit_access_v1')).toMatchObject({
            accessSummary: {
                uniqueUsers: 1,
            },
            accessUserWindows: {
                week: { uniqueUsers: 1 },
            },
        });
        expect(readSessionSnapshot('system_settings_bootstrap_v1')).toMatchObject({
            settings: {
                site: {
                    accessPath: '/console',
                },
            },
            emailStatus: {
                configured: true,
            },
            inviteCodes: [
                { id: 'invite-1', status: 'active' },
            ],
        });
        expect(readSessionSnapshot('tasks_page_bootstrap_v1')).toMatchObject({
            tasks: [
                {
                    id: 'task-1',
                    type: 'clients',
                },
            ],
        });
    });
});
