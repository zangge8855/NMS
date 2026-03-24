import notificationService from './notifications.js';
import { getCachedClusterStatusSnapshot } from './serverStatusService.js';
import { getCachedServerPanelSnapshots } from './serverPanelSnapshotService.js';
import { buildDashboardPresenceFromPanelSnapshots } from './dashboardSnapshotService.js';
import alertEngine from './alertEngine.js';
import serverHealthMonitor from './serverHealthMonitor.js';
import telegramAlertService from './telegramAlertService.js';
import { getEmailStatus } from './mailer.js';
import { getBackupStatus } from './systemBackup.js';
import auditStore from '../store/auditStore.js';
import config from '../config.js';
import { getSnapshotStatus, listSnapshotsMeta } from '../db/snapshots.js';
import { getStoreModes, getSupportedModes } from '../db/runtimeModes.js';
import { isDbEnabled, isDbReady } from '../db/client.js';
import inviteCodeStore from '../store/inviteCodeStore.js';
import jobStore from '../store/jobStore.js';
import serverStore from '../store/serverStore.js';
import serverTelemetryStore from '../store/serverTelemetryStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import trafficStatsStore from '../store/trafficStatsStore.js';
import userStore from '../store/userStore.js';
import { listStoreKeys } from '../store/storeRegistry.js';

const INITIAL_NOTIFICATION_LIMIT = 1;
const INITIAL_AUDIT_EVENTS_PAGE_SIZE = 20;
const INITIAL_ACCESS_PAGE_SIZE = 30;
const INITIAL_TASK_HISTORY_PAGE_SIZE = 100;
const AUDIT_TRAFFIC_WEEK_DAYS = 7;
const AUDIT_TRAFFIC_MONTH_DAYS = 30;

function buildTodayRange() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
        from: start.toISOString(),
        to: now.toISOString(),
    };
}

function buildDashboardAccountSummary() {
    const rows = userStore.getAll().filter((item) => item?.role !== 'admin');
    return {
        totalUsers: rows.length,
        pendingUsers: rows.filter((item) => item?.enabled === false).length,
    };
}

function buildManagedUsersBootstrap() {
    return userStore.getAll().filter((item) => item?.role !== 'admin');
}

function buildRegistrationRuntimeSnapshot() {
    return {
        enabled: config.registration.enabled === true,
        inviteOnlyEnabled: systemSettingsStore.getRegistration().inviteOnlyEnabled === true,
        passwordResetEnabled: config.registration.passwordResetEnabled !== false,
    };
}

function buildDashboardTrafficWindows() {
    const readWindow = (options = {}) => {
        const overview = trafficStatsStore.getOverview(options);
        const totals = overview?.managedTotals || overview?.totals || { upBytes: 0, downBytes: 0 };
        return {
            totalUp: Number(totals?.upBytes || 0),
            totalDown: Number(totals?.downBytes || 0),
            ready: true,
        };
    };

    return {
        day: readWindow(buildTodayRange()),
        week: readWindow({ days: 7 }),
        month: readWindow({ days: 30 }),
    };
}

function buildRollingWindowRange(days) {
    const windowDays = Math.max(1, Number(days || 1));
    const to = new Date();
    const from = new Date(to.getTime() - (windowDays * 24 * 60 * 60 * 1000));
    return {
        from: from.toISOString(),
        to: to.toISOString(),
    };
}

function buildAuditEventsBootstrap() {
    return {
        eventsData: auditStore.queryEvents({
            page: 1,
            pageSize: INITIAL_AUDIT_EVENTS_PAGE_SIZE,
        }),
    };
}

function buildAuditTrafficBootstrap() {
    const trafficOverview = trafficStatsStore.getOverview({
        days: AUDIT_TRAFFIC_MONTH_DAYS,
    });
    const trafficWeek = trafficStatsStore.getOverview({
        days: AUDIT_TRAFFIC_WEEK_DAYS,
    });

    return {
        trafficOverview,
        trafficWindows: {
            week: trafficWeek,
            month: trafficOverview,
        },
    };
}

function buildAuditAccessBootstrap() {
    const accessData = auditStore.querySubscriptionAccess({
        page: 1,
        pageSize: INITIAL_ACCESS_PAGE_SIZE,
    });
    const accessSummary = auditStore.summarizeSubscriptionAccess({});
    const weekRange = buildRollingWindowRange(AUDIT_TRAFFIC_WEEK_DAYS);
    const monthRange = buildRollingWindowRange(AUDIT_TRAFFIC_MONTH_DAYS);

    return {
        accessData,
        accessSummary,
        accessUserWindows: {
            week: auditStore.summarizeSubscriptionAccess(weekRange),
            month: auditStore.summarizeSubscriptionAccess(monthRange),
        },
    };
}

function buildAuditBootstrap() {
    return {
        events: buildAuditEventsBootstrap(),
        traffic: buildAuditTrafficBootstrap(),
        access: buildAuditAccessBootstrap(),
    };
}

async function buildDbStatusBootstrap() {
    const supportedModes = getSupportedModes();
    const status = getSnapshotStatus();
    let snapshots = [];

    if (isDbEnabled() && isDbReady()) {
        try {
            snapshots = await listSnapshotsMeta();
        } catch {
            snapshots = [];
        }
    }

    return {
        ...status,
        supportedModes,
        currentModes: getStoreModes(),
        snapshots,
        storeKeys: listStoreKeys(),
        defaults: {
            dryRun: config.db?.backfillDryRunDefault !== false,
            redact: config.db?.backfillRedact !== false,
        },
    };
}

function buildMonitorStatusBootstrap() {
    return {
        healthMonitor: serverHealthMonitor.getStatus(),
        dbAlerts: alertEngine.getStats(),
        telegram: telegramAlertService.getStatus(),
        notifications: {
            unreadCount: notificationService.unreadCount(),
        },
    };
}

async function buildSystemSettingsBootstrap() {
    return {
        settings: systemSettingsStore.getAll(),
        dbStatus: await buildDbStatusBootstrap(),
        emailStatus: getEmailStatus(),
        backupStatus: getBackupStatus(),
        monitorStatus: buildMonitorStatusBootstrap(),
        registrationRuntime: buildRegistrationRuntimeSnapshot(),
        inviteCodes: inviteCodeStore.list(),
    };
}

function buildTasksBootstrap() {
    const history = jobStore.list({
        page: 1,
        pageSize: INITIAL_TASK_HISTORY_PAGE_SIZE,
    });

    return {
        tasks: Array.isArray(history?.items) ? history.items : [],
    };
}

function buildFallbackServerStatuses(telemetryOverview = {}) {
    const items = Array.isArray(telemetryOverview?.items) ? telemetryOverview.items : [];
    return items.reduce((acc, item) => {
        const serverId = String(item?.serverId || '').trim();
        if (!serverId) return acc;
        acc[serverId] = {
            serverId,
            name: String(item?.serverName || '').trim(),
            online: item?.current?.online === true,
            error: '',
            inboundCount: 0,
            activeInbounds: 0,
            managedOnlineCount: 0,
            managedTrafficTotal: 0,
            managedTrafficReady: false,
            nodeRemarks: [],
            nodeRemarkPreview: [],
            nodeRemarkCount: 0,
            status: null,
        };
        return acc;
    }, {});
}

function buildDashboardSnapshot(telemetryOverview = {}) {
    const cachedSnapshot = getCachedClusterStatusSnapshot();
    const cachedPanelSnapshots = getCachedServerPanelSnapshots({
        includeOnlines: true,
    });
    const presence = cachedPanelSnapshots.length > 0
        ? buildDashboardPresenceFromPanelSnapshots(userStore.getAll(), cachedPanelSnapshots)
        : null;
    const summary = cachedSnapshot?.summary || {};
    const byServerId = cachedSnapshot?.byServerId && typeof cachedSnapshot.byServerId === 'object'
        ? cachedSnapshot.byServerId
        : {};

    const hasCachedClusterData = Object.keys(byServerId).length > 0;
    const serverStatuses = hasCachedClusterData
        ? Object.entries(byServerId).reduce((acc, [serverId, serverData]) => {
            acc[serverId] = {
                serverId: serverData?.serverId || serverId,
                name: String(serverData?.name || '').trim(),
                online: serverData?.online === true,
                error: String(serverData?.error || '').trim(),
                inboundCount: Number(serverData?.inboundCount || 0),
                activeInbounds: Number(serverData?.activeInbounds || 0),
                managedOnlineCount: 0,
                managedTrafficTotal: 0,
                managedTrafficReady: false,
                nodeRemarks: [],
                nodeRemarkPreview: [],
                nodeRemarkCount: 0,
                status: serverData?.status && typeof serverData.status === 'object'
                    ? serverData.status
                    : null,
            };
            return acc;
        }, {})
        : buildFallbackServerStatuses(telemetryOverview);

    const telemetryItems = Array.isArray(telemetryOverview?.items) ? telemetryOverview.items : [];
    const onlineServersFallback = telemetryItems.filter((item) => item?.current?.online === true).length;

    return {
        serverStatuses,
        globalStats: {
            totalUp: Number(summary?.totalUp || 0),
            totalDown: Number(summary?.totalDown || 0),
            totalOnline: presence ? presence.onlineRows.length : Number(summary?.totalOnline || 0),
            totalInbounds: Number(summary?.totalInbounds || 0),
            activeInbounds: Number(summary?.activeInbounds || 0),
            serverCount: Number(summary?.total || telemetryItems.length || 0),
            onlineServers: Number(summary?.onlineServers || onlineServersFallback || 0),
        },
        globalOnlineUsers: presence?.onlineRows || [],
        globalOnlineSessionCount: Number(presence?.onlineSessionCount || 0),
        globalAccountSummary: buildDashboardAccountSummary(),
        trafficWindowTotals: buildDashboardTrafficWindows(),
        globalPresenceReady: presence != null,
    };
}

export async function buildAppBootstrapPayload(user = null) {
    const role = String(user?.role || '').trim().toLowerCase();
    const payload = {
        issuedAt: new Date().toISOString(),
    };

    if (role !== 'admin') {
        return payload;
    }

    const servers = serverStore.getAll();
    const telemetryOverview = serverTelemetryStore.getOverview({
        servers,
        hours: 24,
        points: 24,
    });

    payload.serverContext = {
        servers,
        activeServerId: 'global',
    };
    payload.managedUsers = buildManagedUsersBootstrap();
    payload.telemetryOverview = telemetryOverview;
    payload.notifications = {
        notifications: notificationService.getAll({
            limit: INITIAL_NOTIFICATION_LIMIT,
            offset: 0,
        }).items,
        unreadCount: notificationService.unreadCount(),
        loadedLimit: INITIAL_NOTIFICATION_LIMIT,
    };
    payload.dashboard = buildDashboardSnapshot(telemetryOverview);
    payload.audit = buildAuditBootstrap();
    payload.systemSettings = await buildSystemSettingsBootstrap();
    payload.tasks = buildTasksBootstrap();

    return payload;
}
