import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { saveObjectAtomic } from './fileUtils.js';

const TELEMETRY_FILE = path.join(config.dataDir, 'server_telemetry.json');
const RETENTION_WINDOW_HOURS = 48;
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_POINT_COUNT = 24;
const MIN_SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const FORCE_SAMPLE_INTERVAL_MS = 60 * 1000;
const LATENCY_CHANGE_THRESHOLD_MS = 40;

function ensureDataDir() {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function loadTelemetry() {
    try {
        if (!fs.existsSync(TELEMETRY_FILE)) return {};
        const parsed = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return parsed;
    } catch {
        return {};
    }
}

function toIsoTime(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
}

function normalizeLatency(value) {
    const latency = Number(value);
    if (!Number.isFinite(latency) || latency < 0) return null;
    return Math.round(latency);
}

function normalizePoints(value, fallback = DEFAULT_POINT_COUNT) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 1) return fallback;
    return Math.max(2, Math.min(96, Math.floor(parsed)));
}

function normalizeHours(value, fallback = DEFAULT_WINDOW_HOURS) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(1, Math.min(72, Math.floor(parsed)));
}

function normalizeSample(sample = {}) {
    return {
        ts: toIsoTime(sample.ts),
        serverName: String(sample.serverName || '').trim(),
        online: sample.online === true,
        latencyMs: normalizeLatency(sample.latencyMs),
        health: String(sample.health || '').trim(),
        reasonCode: String(sample.reasonCode || '').trim(),
    };
}

function pruneSamples(list = [], minTimeMs = 0) {
    return list
        .map((item) => normalizeSample(item))
        .filter((item) => Date.parse(item.ts) >= minTimeMs);
}

function sampleStateChanged(previous = null, next = null) {
    if (!previous || !next) return true;
    if (previous.online !== next.online) return true;
    if (previous.health !== next.health) return true;
    if (previous.reasonCode !== next.reasonCode) return true;
    const previousLatency = previous.latencyMs;
    const nextLatency = next.latencyMs;
    if (previousLatency === null || nextLatency === null) return previousLatency !== nextLatency;
    return Math.abs(previousLatency - nextLatency) >= LATENCY_CHANGE_THRESHOLD_MS;
}

function bucketSamples(list = [], pointCount = DEFAULT_POINT_COUNT) {
    if (!Array.isArray(list) || list.length === 0) return [];
    if (list.length <= pointCount) return list;

    const buckets = [];
    const size = list.length / pointCount;
    for (let index = 0; index < pointCount; index += 1) {
        const start = Math.floor(index * size);
        const end = Math.min(list.length, Math.floor((index + 1) * size));
        const group = list.slice(start, Math.max(start + 1, end));
        const onlineSamples = group.filter((item) => item.online === true);
        const latencyCandidates = onlineSamples
            .map((item) => item.latencyMs)
            .filter((value) => Number.isFinite(value));
        const last = group[group.length - 1] || group[0];
        const avgLatency = latencyCandidates.length > 0
            ? Math.round(latencyCandidates.reduce((sum, value) => sum + value, 0) / latencyCandidates.length)
            : null;
        buckets.push({
            ts: last?.ts || new Date().toISOString(),
            online: onlineSamples.length >= Math.ceil(group.length / 2),
            latencyMs: avgLatency,
            health: String(last?.health || '').trim(),
        });
    }
    return buckets;
}

function createEmptyOverview(server = {}) {
    return {
        serverId: String(server.id || '').trim(),
        serverName: String(server.name || '').trim(),
        checkedAt: '',
        uptimePercent: null,
        current: {
            online: false,
            latencyMs: null,
            health: '',
            reasonCode: '',
        },
        latencyTrend: [],
        availabilityTrend: [],
    };
}

class ServerTelemetryStore {
    constructor() {
        ensureDataDir();
        this.samplesByServerId = loadTelemetry();
        this.prune();
    }

    persist() {
        ensureDataDir();
        saveObjectAtomic(TELEMETRY_FILE, this.samplesByServerId);
    }

    prune() {
        const minTimeMs = Date.now() - (RETENTION_WINDOW_HOURS * 60 * 60 * 1000);
        const next = {};
        Object.entries(this.samplesByServerId || {}).forEach(([serverId, samples]) => {
            const pruned = pruneSamples(Array.isArray(samples) ? samples : [], minTimeMs);
            if (pruned.length > 0) {
                next[serverId] = pruned;
            }
        });
        this.samplesByServerId = next;
    }

    recordSnapshot(snapshot = {}) {
        const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
        if (items.length === 0) return;

        let changed = false;
        items.forEach((item) => {
            const serverId = String(item?.serverId || '').trim();
            if (!serverId) return;
            const sample = normalizeSample({
                ts: item?.checkedAt,
                serverName: item?.name,
                online: item?.online,
                latencyMs: item?.latencyMs,
                health: item?.health,
                reasonCode: item?.reasonCode,
            });
            changed = this.recordSample(serverId, sample) || changed;
        });

        if (changed) {
            this.prune();
            this.persist();
        }
    }

    recordSample(serverId, sample) {
        const id = String(serverId || '').trim();
        if (!id) return false;

        const normalized = normalizeSample(sample);
        const list = Array.isArray(this.samplesByServerId[id]) ? [...this.samplesByServerId[id]] : [];
        const last = list[list.length - 1] || null;
        const nowMs = Date.parse(normalized.ts);
        const lastMs = last ? Date.parse(last.ts) : 0;
        const elapsed = Math.max(0, nowMs - lastMs);

        if (last) {
            const changedEnough = sampleStateChanged(last, normalized);
            const shouldAppend = changedEnough
                ? elapsed >= FORCE_SAMPLE_INTERVAL_MS
                : elapsed >= MIN_SAMPLE_INTERVAL_MS;

            if (!shouldAppend) {
                list[list.length - 1] = {
                    ...last,
                    ...normalized,
                };
                this.samplesByServerId[id] = list;
                return true;
            }
        }

        list.push(normalized);
        this.samplesByServerId[id] = list;
        return true;
    }

    buildOverviewForServer(server = {}, options = {}) {
        const hours = normalizeHours(options.hours, DEFAULT_WINDOW_HOURS);
        const points = normalizePoints(options.points, DEFAULT_POINT_COUNT);
        const serverId = String(server.id || '').trim();
        const list = Array.isArray(this.samplesByServerId[serverId]) ? this.samplesByServerId[serverId] : [];
        if (list.length === 0) {
            return createEmptyOverview(server);
        }

        const cutoffMs = Date.now() - (hours * 60 * 60 * 1000);
        const scoped = list.filter((item) => Date.parse(item.ts) >= cutoffMs);
        const source = scoped.length > 0 ? scoped : list;
        const trend = bucketSamples(source, points);
        const current = source[source.length - 1] || trend[trend.length - 1] || null;
        const scopedOnline = scoped.filter((item) => item.online === true).length;
        const uptimePercent = scoped.length > 0
            ? Number(((scopedOnline / scoped.length) * 100).toFixed(1))
            : null;

        return {
            serverId,
            serverName: String(current?.serverName || server.name || '').trim(),
            checkedAt: String(current?.ts || '').trim(),
            uptimePercent,
            current: {
                online: current?.online === true,
                latencyMs: normalizeLatency(current?.latencyMs),
                health: String(current?.health || '').trim(),
                reasonCode: String(current?.reasonCode || '').trim(),
            },
            latencyTrend: trend.map((item) => (item.online && Number.isFinite(item.latencyMs) ? item.latencyMs : null)),
            availabilityTrend: trend.map((item) => (item.online ? 1 : 0)),
        };
    }

    getOverview(options = {}) {
        const servers = Array.isArray(options.servers) ? options.servers : [];
        const points = normalizePoints(options.points, DEFAULT_POINT_COUNT);
        const hours = normalizeHours(options.hours, DEFAULT_WINDOW_HOURS);
        const targets = servers.length > 0
            ? servers
            : Object.keys(this.samplesByServerId).map((serverId) => ({ id: serverId, name: '' }));
        const items = targets.map((server) => this.buildOverviewForServer(server, { points, hours }));
        return {
            generatedAt: new Date().toISOString(),
            points,
            hours,
            items,
            byServerId: Object.fromEntries(items.map((item) => [item.serverId, item])),
        };
    }
}

const serverTelemetryStore = new ServerTelemetryStore();

export default serverTelemetryStore;
