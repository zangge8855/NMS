import { createHttpError } from './httpError.js';
import { collectClusterStatusSnapshot } from './serverStatusService.js';
import { getServerPanelSnapshot } from './serverPanelSnapshotService.js';
import serverStore from '../store/serverStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';

const DEFAULT_STATUS_MAX_AGE_MS = 20_000;

function normalizeOnlineEntries(items = []) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            if (typeof item === 'string') {
                return String(item || '').trim();
            }
            return String(
                item?.email
                || item?.user
                || item?.username
                || item?.clientEmail
                || ''
            ).trim();
        })
        .filter(Boolean);
}

function buildStatusMeta(item = null) {
    if (!item || typeof item !== 'object') {
        return {
            online: false,
            health: '',
            reasonCode: '',
            reasonMessage: '',
            checkedAt: '',
            latencyMs: 0,
        };
    }

    return {
        online: item.online === true,
        health: String(item.health || '').trim(),
        reasonCode: String(item.reasonCode || '').trim(),
        reasonMessage: String(item.reasonMessage || '').trim(),
        checkedAt: String(item.checkedAt || '').trim(),
        latencyMs: Number(item.latencyMs || 0),
    };
}

async function buildServerDetailSnapshot(serverId, options = {}, deps = {}) {
    const servers = deps.serverStore || serverStore;
    const settings = deps.systemSettingsStore || systemSettingsStore;
    const collectStatusSnapshot = deps.collectClusterStatusSnapshot || collectClusterStatusSnapshot;
    const readServerPanelSnapshot = deps.getServerPanelSnapshot || getServerPanelSnapshot;
    const normalizedServerId = String(serverId || '').trim();
    const server = typeof servers.getById === 'function'
        ? servers.getById(normalizedServerId)
        : null;

    if (!server) {
        throw createHttpError(404, 'Server not found');
    }

    const force = options.force === true;
    const maxAgeMs = force
        ? 0
        : Math.max(0, Number(options.maxAgeMs || DEFAULT_STATUS_MAX_AGE_MS));

    const [clusterSnapshot, panelSnapshot] = await Promise.all([
        collectStatusSnapshot({
            servers: [server],
            includeDetails: false,
            force,
            maxAgeMs,
        }).catch(() => null),
        readServerPanelSnapshot(server, {
            includeOnlines: true,
            force,
        }).catch((error) => ({
            server: {
                id: server.id,
                name: server.name,
            },
            inbounds: [],
            onlines: [],
            inboundsError: error || null,
            onlinesError: error || null,
            checkedAt: new Date().toISOString(),
        })),
    ]);

    const statusItem = Array.isArray(clusterSnapshot?.items)
        ? clusterSnapshot.items.find((item) => String(item?.serverId || '').trim() === normalizedServerId) || null
        : null;
    const inbounds = Array.isArray(panelSnapshot?.inbounds) ? panelSnapshot.inbounds : [];

    return {
        server,
        status: statusItem?.status && typeof statusItem.status === 'object' ? statusItem.status : null,
        statusMeta: buildStatusMeta(statusItem),
        inbounds: typeof settings.sortInboundList === 'function'
            ? settings.sortInboundList(normalizedServerId, inbounds)
            : inbounds,
        onlines: normalizeOnlineEntries(panelSnapshot?.onlines),
        warnings: {
            inbounds: String(panelSnapshot?.inboundsError?.message || '').trim(),
            onlines: String(panelSnapshot?.onlinesError?.message || '').trim(),
        },
        fetchedAt: new Date().toISOString(),
    };
}

export { buildServerDetailSnapshot };
