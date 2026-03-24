import { writeSessionSnapshot } from './sessionSnapshot.js';

const SERVER_CONTEXT_SNAPSHOT_KEY = 'server_context_bootstrap_v1';
const MANAGED_USERS_SNAPSHOT_KEY = 'managed_users_v1';
const NOTIFICATION_SNAPSHOT_KEY = 'notification_center_bootstrap_v1';
const DASHBOARD_SNAPSHOT_KEY = 'dashboard_global_v1';
const AUDIT_EVENTS_SNAPSHOT_KEY = 'audit_events_v1';
const AUDIT_TRAFFIC_SNAPSHOT_KEY = 'audit_traffic_v1';
const AUDIT_ACCESS_SNAPSHOT_KEY = 'audit_access_v1';
const SYSTEM_SETTINGS_SNAPSHOT_KEY = 'system_settings_bootstrap_v1';
const TASKS_SNAPSHOT_KEY = 'tasks_page_bootstrap_v1';
const APP_BOOTSTRAP_SOURCE = 'app-bootstrap';

function buildTelemetrySnapshotKey(hours = 24, points = 24) {
    return `server_telemetry_overview_v1:${Number(hours || 24)}:${Number(points || 24)}`;
}

export function applyAppBootstrapSnapshots(payload = {}) {
    if (!payload || typeof payload !== 'object') return;
    const issuedAt = String(payload?.issuedAt || '').trim();
    const withIssuedAt = (value) => (issuedAt ? { ...value, issuedAt } : value);

    const serverContext = payload?.serverContext;
    if (serverContext && Array.isArray(serverContext.servers)) {
        const nextActiveServerId = String(serverContext.activeServerId || '').trim()
            || (serverContext.servers.length > 0 ? 'global' : '');
        writeSessionSnapshot(SERVER_CONTEXT_SNAPSHOT_KEY, withIssuedAt({
            servers: serverContext.servers,
            activeServerId: nextActiveServerId,
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    const notifications = payload?.notifications;
    if (notifications && Array.isArray(notifications.notifications)) {
        writeSessionSnapshot(NOTIFICATION_SNAPSHOT_KEY, withIssuedAt({
            notifications: notifications.notifications,
            unreadCount: Number(notifications.unreadCount || 0),
            loadedLimit: Number(notifications.loadedLimit || notifications.notifications.length || 0),
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    if (Array.isArray(payload.managedUsers)) {
        writeSessionSnapshot(MANAGED_USERS_SNAPSHOT_KEY, payload.managedUsers, { source: APP_BOOTSTRAP_SOURCE });
    }

    const telemetryOverview = payload?.telemetryOverview;
    if (telemetryOverview && Array.isArray(telemetryOverview.items)) {
        writeSessionSnapshot(buildTelemetrySnapshotKey(24, 24), withIssuedAt({
            items: telemetryOverview.items,
            byServerId: telemetryOverview.byServerId && typeof telemetryOverview.byServerId === 'object'
                ? telemetryOverview.byServerId
                : {},
            generatedAt: String(telemetryOverview.generatedAt || '').trim(),
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    const dashboard = payload?.dashboard;
    if (dashboard && typeof dashboard === 'object') {
        writeSessionSnapshot(DASHBOARD_SNAPSHOT_KEY, withIssuedAt({
            serverStatuses: dashboard.serverStatuses && typeof dashboard.serverStatuses === 'object'
                ? dashboard.serverStatuses
                : {},
            globalStats: dashboard.globalStats && typeof dashboard.globalStats === 'object'
                ? dashboard.globalStats
                : {},
            globalOnlineUsers: Array.isArray(dashboard.globalOnlineUsers)
                ? dashboard.globalOnlineUsers
                : [],
            globalManagedOnlineCount: Number.isFinite(Number(dashboard.globalManagedOnlineCount))
                ? Number(dashboard.globalManagedOnlineCount)
                : null,
            globalOnlineSessionCount: Number(dashboard.globalOnlineSessionCount || 0),
            globalAccountSummary: dashboard.globalAccountSummary && typeof dashboard.globalAccountSummary === 'object'
                ? dashboard.globalAccountSummary
                : {},
            throughputSummary: dashboard.throughputSummary && typeof dashboard.throughputSummary === 'object'
                ? dashboard.throughputSummary
                : null,
            trafficWindowTotals: dashboard.trafficWindowTotals && typeof dashboard.trafficWindowTotals === 'object'
                ? dashboard.trafficWindowTotals
                : {},
            globalPresenceReady: dashboard.globalPresenceReady === true,
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    const audit = payload?.audit;
    if (audit?.events && typeof audit.events === 'object') {
        writeSessionSnapshot(AUDIT_EVENTS_SNAPSHOT_KEY, withIssuedAt({
            eventsData: audit.events.eventsData && typeof audit.events.eventsData === 'object'
                ? audit.events.eventsData
                : { items: [], total: 0, page: 1, totalPages: 1 },
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    if (audit?.traffic && typeof audit.traffic === 'object') {
        writeSessionSnapshot(AUDIT_TRAFFIC_SNAPSHOT_KEY, withIssuedAt({
            trafficOverview: audit.traffic.trafficOverview && typeof audit.traffic.trafficOverview === 'object'
                ? audit.traffic.trafficOverview
                : null,
            trafficWindows: audit.traffic.trafficWindows && typeof audit.traffic.trafficWindows === 'object'
                ? audit.traffic.trafficWindows
                : { week: null, month: null },
            trafficStatus: audit.traffic.trafficStatus && typeof audit.traffic.trafficStatus === 'object'
                ? audit.traffic.trafficStatus
                : null,
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    if (audit?.access && typeof audit.access === 'object') {
        writeSessionSnapshot(AUDIT_ACCESS_SNAPSHOT_KEY, withIssuedAt({
            accessData: audit.access.accessData && typeof audit.access.accessData === 'object'
                ? audit.access.accessData
                : { items: [], total: 0, page: 1, totalPages: 1, statusBreakdown: {} },
            accessSummary: audit.access.accessSummary && typeof audit.access.accessSummary === 'object'
                ? audit.access.accessSummary
                : { total: 0, uniqueIpCount: 0, uniqueUsers: 0, statusBreakdown: {}, topIps: [], from: '', to: '' },
            accessUserWindows: audit.access.accessUserWindows && typeof audit.access.accessUserWindows === 'object'
                ? audit.access.accessUserWindows
                : {
                    week: { total: 0, uniqueIpCount: 0, uniqueUsers: 0, statusBreakdown: {}, topIps: [], from: '', to: '' },
                    month: { total: 0, uniqueIpCount: 0, uniqueUsers: 0, statusBreakdown: {}, topIps: [], from: '', to: '' },
                },
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    const systemSettings = payload?.systemSettings;
    if (systemSettings && typeof systemSettings === 'object') {
        writeSessionSnapshot(SYSTEM_SETTINGS_SNAPSHOT_KEY, withIssuedAt({
            settings: systemSettings.settings || null,
            dbStatus: systemSettings.dbStatus || null,
            emailStatus: systemSettings.emailStatus || null,
            backupStatus: systemSettings.backupStatus || null,
            monitorStatus: systemSettings.monitorStatus || null,
            registrationRuntime: systemSettings.registrationRuntime || null,
            inviteCodes: Array.isArray(systemSettings.inviteCodes) ? systemSettings.inviteCodes : [],
        }), { source: APP_BOOTSTRAP_SOURCE });
    }

    const tasks = payload?.tasks;
    if (tasks && Array.isArray(tasks.tasks)) {
        writeSessionSnapshot(TASKS_SNAPSHOT_KEY, withIssuedAt({
            tasks: tasks.tasks,
        }), { source: APP_BOOTSTRAP_SOURCE });
    }
}
