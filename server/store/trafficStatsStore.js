import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import serverStore from './serverStore.js';
import userStore from './userStore.js';
import { parseJsonObjectLike } from '../lib/normalize.js';
import { getServerPanelSnapshot } from '../lib/serverPanelSnapshotService.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const TRAFFIC_SAMPLES_FILE = path.join(config.dataDir, 'traffic_samples.json');
const TRAFFIC_COUNTERS_FILE = path.join(config.dataDir, 'traffic_counters.json');
const TRAFFIC_META_FILE = path.join(config.dataDir, 'traffic_meta.json');
const DEFAULT_WARM_LOOP_MIN_INTERVAL_MS = 30_000;
const DEFAULT_OVERVIEW_CACHE_LIMIT = 48;

let trafficWarmLoopTimer = null;
let trafficWarmLoopInFlight = null;

function ensureDataDir() {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function loadArray(file) {
    try {
        if (!fs.existsSync(file)) return [];
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function loadObject(file, fallback = {}) {
    try {
        if (!fs.existsSync(file)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
        return parsed;
    } catch {
        return fallback;
    }
}

function saveJson(file, data) {
    saveObjectAtomic(file, data);
}

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function toNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.floor(parsed);
}

function normalizeDateInput(value, fallback = null) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toISOString();
}

function normalizeReferenceDate(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return new Date();
    return date;
}

function buildCalendarTrafficWindowRange(windowKey, reference = new Date()) {
    const now = normalizeReferenceDate(reference);
    const key = String(windowKey || '').trim().toLowerCase();
    const start = new Date(now);

    if (key === 'today' || key === 'day') {
        start.setHours(0, 0, 0, 0);
    } else if (key === 'this_week' || key === 'week') {
        start.setHours(0, 0, 0, 0);
        const weekday = start.getDay();
        const offset = weekday === 0 ? 6 : (weekday - 1);
        start.setDate(start.getDate() - offset);
    } else if (key === 'this_month' || key === 'month') {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
    } else {
        return null;
    }

    return {
        fromTs: start.getTime(),
        toTs: now.getTime(),
        from: start.toISOString(),
        to: now.toISOString(),
    };
}

function hasPositiveRegisteredTrafficTotals(value) {
    const totals = normalizeRegisteredTotals(value);
    return Number(totals.upBytes || 0) > 0
        || Number(totals.downBytes || 0) > 0
        || Number(totals.totalBytes || 0) > 0;
}

function hasPositiveServerTrafficTotals(value) {
    return normalizeServerTotals(value).some((item) => Number(item.totalBytes || 0) > 0);
}

function resolveTrafficBaselineStatus(meta = {}) {
    const currentTotalsAt = normalizeDateInput(meta?.currentTotalsAt, null);
    const hasRegisteredSnapshot = hasRegisteredTotalsSnapshot(meta);
    const hasServerSnapshot = hasServerTotalsSnapshot(meta);
    const baselineReady = Boolean(currentTotalsAt && hasRegisteredSnapshot && hasServerSnapshot);
    return {
        currentTotalsAt,
        baselineReady,
        registeredTotalsReady: baselineReady && hasRegisteredSnapshot,
        serverTotalsReady: baselineReady && hasServerSnapshot,
    };
}

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeClientId(value) {
    return String(value || '').trim();
}

function normalizeClientEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function hashMaskedEmailCandidate(text) {
    return crypto.createHash('sha256').update(String(text || '').trim().toLowerCase()).digest('hex').slice(0, 16);
}

function maskEmail(value) {
    const normalized = normalizeClientEmail(value);
    if (!normalized) return '';
    return `${hashMaskedEmailCandidate(normalized)}@masked.local`;
}

function buildTrafficUserDirectoryVersion(users = []) {
    return crypto.createHash('sha1').update(
        (Array.isArray(users) ? users : [])
            .filter((user) => user?.role !== 'admin')
            .map((user) => [
                String(user?.id || '').trim(),
                String(user?.username || '').trim(),
                normalizeClientEmail(user?.email),
                normalizeClientEmail(user?.subscriptionEmail || user?.email),
                user?.enabled === false ? '0' : '1',
            ].join(':'))
            .join('|')
    ).digest('hex');
}

function buildResolvedTrafficUserDirectory(users = []) {
    const aliasMap = new Map();
    const registeredUsers = (Array.isArray(users) ? users : []).filter((user) => user?.role !== 'admin');

    registeredUsers.forEach((user) => {
        const loginEmail = normalizeClientEmail(user?.email);
        const subscriptionEmail = normalizeClientEmail(user?.subscriptionEmail || user?.email);
        const canonicalEmail = subscriptionEmail || loginEmail;
        if (!canonicalEmail) return;

        const username = String(user?.username || '').trim();
        const userId = String(user?.id || '').trim();
        const aliases = new Set([loginEmail, subscriptionEmail].filter(Boolean));
        const resolvedAliases = new Set();

        aliases.forEach((alias) => {
            resolvedAliases.add(alias);
            const maskedAlias = maskEmail(alias);
            if (maskedAlias) resolvedAliases.add(maskedAlias);
        });

        const entry = {
            userId,
            username,
            email: canonicalEmail,
            displayLabel: username
                ? `${username} · ${canonicalEmail}`
                : canonicalEmail,
            aliases: resolvedAliases,
        };

        resolvedAliases.forEach((alias) => aliasMap.set(alias, entry));
    });

    return {
        aliasMap,
        totalUsers: registeredUsers.length,
        versionToken: buildTrafficUserDirectoryVersion(registeredUsers),
    };
}

function resolveMaskedEmail(email) {
    const value = normalizeClientEmail(email);
    if (!value.endsWith('@masked.local')) return value;
    const hash = value.slice(0, value.indexOf('@masked.local'));
    if (!hash) return value;

    const candidates = new Set();
    userStore.getAll().forEach((user) => {
        const emailValue = normalizeClientEmail(user?.email);
        const subscriptionEmail = normalizeClientEmail(user?.subscriptionEmail);
        if (emailValue) candidates.add(emailValue);
        if (subscriptionEmail) candidates.add(subscriptionEmail);
    });

    for (const candidate of candidates) {
        if (hashMaskedEmailCandidate(candidate) === hash) {
            return candidate;
        }
    }

    return value;
}

function resolveTrafficUserInfo(email, directory = null) {
    const normalizedInput = normalizeClientEmail(email);
    if (directory?.aliasMap instanceof Map) {
        return directory.aliasMap.get(normalizedInput) || null;
    }
    const resolvedEmail = resolveMaskedEmail(normalizedInput);
    const user = userStore.getBySubscriptionEmail(resolvedEmail)
        || userStore.getByEmail(resolvedEmail)
        || null;

    if (!user) return null;

    const loginEmail = normalizeClientEmail(user?.email);
    const subscriptionEmail = normalizeClientEmail(user?.subscriptionEmail || user?.email);
    const canonicalEmail = subscriptionEmail || loginEmail || resolvedEmail;
    const username = String(user?.username || '').trim();
    const aliases = new Set(
        [normalizedInput, resolvedEmail, loginEmail, subscriptionEmail]
            .filter(Boolean)
            .flatMap((value) => {
                const masked = maskEmail(value);
                return masked ? [value, masked] : [value];
            })
    );

    return {
        userId: String(user?.id || '').trim(),
        username,
        email: canonicalEmail,
        displayLabel: username
            ? `${username} · ${canonicalEmail || resolvedEmail || normalizedInput}`
            : (canonicalEmail || resolvedEmail || normalizedInput),
        aliases,
    };
}

function collectStatsCandidates(inbound) {
    const candidates = [
        inbound?.clientStats,
        inbound?.clientTraffic,
        inbound?.clientTraffics,
        inbound?.clientTrafficsList,
    ];
    return candidates.find((item) => Array.isArray(item)) || [];
}

function resolveClientMergeKeys(client = {}) {
    const keys = new Set();
    const email = normalizeClientEmail(client.email);
    const id = normalizeClientId(client.id);
    const password = normalizeClientId(client.password);

    if (email) keys.add(`email:${email}`);
    if (id) keys.add(`id:${id}`);
    if (password) keys.add(`password:${password}`);
    return Array.from(keys);
}

function extractInboundClients(inbound) {
    const settings = parseJsonObjectLike(inbound?.settings, {});
    const baseClients = Array.isArray(settings.clients) ? settings.clients : [];
    const statsCandidates = collectStatsCandidates(inbound);
    const statsByKey = new Map();
    let hasExplicitClientTraffic = false;

    statsCandidates.forEach((entry) => {
        const row = entry && typeof entry === 'object' ? entry : {};
        const keys = resolveClientMergeKeys(row);
        if (keys.length === 0) return;
        if (hasOwn(row, 'up') || hasOwn(row, 'down')) {
            hasExplicitClientTraffic = true;
        }
        keys.forEach((key) => {
            if (!statsByKey.has(key)) {
                statsByKey.set(key, row);
            }
        });
    });

    const merged = baseClients.map((client) => {
        const row = client && typeof client === 'object' ? client : {};
        const stats = resolveClientMergeKeys(row)
            .map((key) => statsByKey.get(key))
            .find(Boolean);
        if (hasOwn(row, 'up') || hasOwn(row, 'down')) {
            hasExplicitClientTraffic = true;
        }
        return stats ? { ...stats, ...row } : row;
    });

    return {
        clients: merged,
        hasClientTraffic: hasExplicitClientTraffic,
    };
}

function shouldUseInboundTotalFallback(hasClientTraffic, clientTrafficCaptured) {
    return !hasClientTraffic || !clientTrafficCaptured;
}

const SAMPLE_KIND_CLIENT_DELTA = 'client_delta';
const SAMPLE_KIND_SERVER_SNAPSHOT = 'server_snapshot';

const REGISTERED_TRAFFIC_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);

function createRegisteredTotals(totalUsers = 0) {
    return {
        totalUsers: toNonNegativeInt(totalUsers, 0),
        activeUsers: 0,
        upBytes: 0,
        downBytes: 0,
        totalBytes: 0,
    };
}

function normalizeRegisteredTotals(value, fallbackTotalUsers = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createRegisteredTotals(fallbackTotalUsers);
    }
    return {
        totalUsers: toNonNegativeInt(value.totalUsers, fallbackTotalUsers),
        activeUsers: toNonNegativeInt(value.activeUsers, 0),
        upBytes: toNonNegativeInt(value.upBytes, 0),
        downBytes: toNonNegativeInt(value.downBytes, 0),
        totalBytes: toNonNegativeInt(value.totalBytes, toNonNegativeInt(value.upBytes, 0) + toNonNegativeInt(value.downBytes, 0)),
    };
}

function hasRegisteredTotalsSnapshot(meta) {
    return !!meta && typeof meta === 'object' && !Array.isArray(meta) && !!meta.registeredTotals;
}

function createServerTotalEntry(entry = {}) {
    const upBytes = toNonNegativeInt(entry.upBytes, 0);
    const downBytes = toNonNegativeInt(entry.downBytes, 0);
    return {
        serverId: String(entry.serverId || '').trim(),
        serverName: String(entry.serverName || '').trim(),
        upBytes,
        downBytes,
        totalBytes: toNonNegativeInt(entry.totalBytes, upBytes + downBytes),
    };
}

function normalizeServerTotals(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => createServerTotalEntry(item))
        .filter((item) => item.serverId);
}

function hasServerTotalsSnapshot(meta) {
    return !!meta && typeof meta === 'object' && !Array.isArray(meta) && Array.isArray(meta.serverTotals);
}

function normalizeSampleKind(value) {
    return String(value || '').trim() === SAMPLE_KIND_SERVER_SNAPSHOT
        ? SAMPLE_KIND_SERVER_SNAPSHOT
        : SAMPLE_KIND_CLIENT_DELTA;
}

function resolveInboundTrafficSummary(inbound) {
    const { clients } = extractInboundClients(inbound);
    const hasPerClientTraffic = clients.some((client) => (
        hasOwn(client, 'up') || hasOwn(client, 'down')
    ));

    if (hasPerClientTraffic) {
        return clients.reduce((acc, client) => {
            acc.upBytes += toNonNegativeInt(client?.up, 0);
            acc.downBytes += toNonNegativeInt(client?.down, 0);
            acc.totalBytes += toNonNegativeInt(client?.up, 0) + toNonNegativeInt(client?.down, 0);
            return acc;
        }, { upBytes: 0, downBytes: 0, totalBytes: 0 });
    }

    const upBytes = toNonNegativeInt(inbound?.up, 0);
    const downBytes = toNonNegativeInt(inbound?.down, 0);
    return {
        upBytes,
        downBytes,
        totalBytes: upBytes + downBytes,
    };
}

function summarizeServerTrafficTotals(serverPayloads = []) {
    const totals = new Map();

    (Array.isArray(serverPayloads) ? serverPayloads : []).forEach((payload) => {
        const serverId = String(payload?.serverId || '').trim();
        if (!serverId) return;

        const current = totals.get(serverId) || createServerTotalEntry({
            serverId,
            serverName: payload?.serverName || serverId,
        });
        const inbounds = Array.isArray(payload?.inbounds) ? payload.inbounds : [];

        inbounds.forEach((inbound) => {
            const summary = resolveInboundTrafficSummary(inbound);
            current.upBytes += summary.upBytes;
            current.downBytes += summary.downBytes;
            current.totalBytes += summary.totalBytes;
        });

        if (!current.serverName) {
            current.serverName = String(payload?.serverName || serverId).trim();
        }
        totals.set(serverId, current);
    });

    return Array.from(totals.values());
}

function shouldTrackRegisteredTrafficInbound(inbound) {
    const protocol = String(inbound?.protocol || '').trim().toLowerCase();
    return REGISTERED_TRAFFIC_PROTOCOLS.has(protocol) && inbound?.enable !== false;
}

function buildTrafficUserDirectory(users = []) {
    return buildResolvedTrafficUserDirectory(users);
}

function summarizeRegisteredTrafficTotals(users = [], serverPayloads = []) {
    const { aliasMap, totalUsers } = buildTrafficUserDirectory(users);
    const totals = createRegisteredTotals(totalUsers);
    const activeUsers = new Set();

    (Array.isArray(serverPayloads) ? serverPayloads : []).forEach((payload) => {
        const inbounds = Array.isArray(payload?.inbounds) ? payload.inbounds : [];
        inbounds.forEach((inbound) => {
            if (!shouldTrackRegisteredTrafficInbound(inbound)) return;
            const { clients } = extractInboundClients(inbound);
            clients.forEach((client) => {
                const email = normalizeClientEmail(client?.email);
                if (!email) return;
                const userInfo = aliasMap.get(email);
                if (!userInfo) return;

                const up = toNonNegativeInt(client?.up, 0);
                const down = toNonNegativeInt(client?.down, 0);
                totals.upBytes += up;
                totals.downBytes += down;
                totals.totalBytes += up + down;
                if ((up + down) > 0) {
                    activeUsers.add(userInfo.userId || userInfo.email);
                }
            });
        });
    });

    totals.activeUsers = activeUsers.size;
    return totals;
}

function calculateTrafficDelta(currentValue, previousValue) {
    const current = toNonNegativeInt(currentValue, 0);
    // First observation establishes the baseline only; otherwise the overview
    // backfills each user's historical cumulative traffic into the recent window.
    if (previousValue === undefined || previousValue === null) return 0;
    const previous = toNonNegativeInt(previousValue, 0);
    return current >= previous ? (current - previous) : current;
}

async function runWithConcurrency(items, worker, concurrency = 3) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];
    const size = Math.max(1, Math.min(concurrency, list.length));
    const results = new Array(list.length);
    let cursor = 0;
    const runners = Array.from({ length: size }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= list.length) break;
            results[index] = await worker(list[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

function floorToHour(inputDate) {
    const date = new Date(inputDate);
    date.setMinutes(0, 0, 0);
    return date;
}

function floorToDay(inputDate) {
    const date = new Date(inputDate);
    date.setHours(0, 0, 0, 0);
    return date;
}

function chooseAutoGranularity(fromTs, toTs) {
    const diffMs = Math.max(0, toTs - fromTs);
    const hours = diffMs / (60 * 60 * 1000);
    return hours <= 72 ? 'hour' : 'day';
}

class TrafficStatsStore {
    constructor() {
        ensureDataDir();
        this.samples = loadArray(TRAFFIC_SAMPLES_FILE);
        this.counters = loadObject(TRAFFIC_COUNTERS_FILE, {});
        const loadedMeta = loadObject(TRAFFIC_META_FILE, {
            lastCollectionAt: null,
            currentTotalsAt: null,
            registeredTotals: createRegisteredTotals(),
            serverTotals: [],
        });
        this.meta = {
            ...loadedMeta,
            currentTotalsAt: normalizeDateInput(loadedMeta.currentTotalsAt, null),
            registeredTotals: hasOwn(loadedMeta, 'registeredTotals')
                ? normalizeRegisteredTotals(loadedMeta.registeredTotals)
                : null,
            serverTotals: hasOwn(loadedMeta, 'serverTotals')
                ? normalizeServerTotals(loadedMeta.serverTotals)
                : null,
        };
        this.collectingPromise = null;
        this.stateVersion = 0;
        this.overviewCache = new Map();
        this._prune();
    }

    _retentionMs() {
        const days = toPositiveInt(config.traffic?.retentionDays, 365);
        return days * 24 * 60 * 60 * 1000;
    }

    _sampleIntervalMs() {
        const seconds = toPositiveInt(config.traffic?.sampleIntervalSeconds, 300);
        return seconds * 1000;
    }

    _collectorConcurrency() {
        return toPositiveInt(config.traffic?.collectorConcurrency, 3);
    }

    _overviewCacheTtlMs() {
        return Math.max(1_000, toPositiveInt(config.performance?.trafficOverviewCacheTtlMs, 5_000));
    }

    _touchState() {
        this.stateVersion += 1;
        this.overviewCache.clear();
    }

    _persist() {
        saveJson(TRAFFIC_SAMPLES_FILE, this.samples);
        saveJson(TRAFFIC_COUNTERS_FILE, this.counters);
        saveJson(TRAFFIC_META_FILE, this.meta);
        mirrorStoreSnapshot('traffic', this.exportState(), { redact: false });
    }

    _prune() {
        const now = Date.now();
        const cutoff = now - this._retentionMs();
        const oldSamplesLen = this.samples.length;
        this.samples = this.samples.filter((item) => {
            const ts = new Date(item?.ts || 0).getTime();
            return Number.isFinite(ts) && ts >= cutoff;
        });

        let countersChanged = false;
        for (const [key, item] of Object.entries(this.counters)) {
            const ts = new Date(item?.lastSeenAt || 0).getTime();
            if (!Number.isFinite(ts) || ts < cutoff) {
                delete this.counters[key];
                countersChanged = true;
            }
        }

        if (oldSamplesLen !== this.samples.length || countersChanged) {
            this._touchState();
            this._persist();
        }
    }

    _buildTimeRange(options = {}, defaults = {}) {
        const now = Date.now();
        const defaultDays = toPositiveInt(defaults.defaultDays, 30);
        const fromIso = normalizeDateInput(options.from);
        const toIso = normalizeDateInput(options.to) || new Date(now).toISOString();
        const days = toPositiveInt(options.days, defaultDays);

        const toTs = new Date(toIso).getTime();
        const fromTs = fromIso
            ? new Date(fromIso).getTime()
            : (toTs - (days * 24 * 60 * 60 * 1000));

        return {
            fromTs: Math.min(fromTs, toTs),
            toTs: Math.max(fromTs, toTs),
            from: new Date(Math.min(fromTs, toTs)).toISOString(),
            to: new Date(Math.max(fromTs, toTs)).toISOString(),
        };
    }

    _filterSamples({ fromTs, toTs, email = '', serverId = '', kind = SAMPLE_KIND_CLIENT_DELTA }) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedServerId = String(serverId || '').trim();
        const normalizedKind = normalizeSampleKind(kind);

        return this.samples.filter((item) => {
            const ts = new Date(item.ts).getTime();
            if (!Number.isFinite(ts) || ts < fromTs || ts > toTs) return false;
            if (normalizeSampleKind(item?.kind) !== normalizedKind) return false;
            if (normalizedEmail && String(item.email || '').toLowerCase() !== normalizedEmail) return false;
            if (normalizedServerId && String(item.serverId || '') !== normalizedServerId) return false;
            return true;
        });
    }

    _aggregateTrend(samples, granularity) {
        const bucketMap = new Map();
        for (const sample of samples) {
            const sourceDate = new Date(sample.ts);
            const bucketDate = granularity === 'day'
                ? floorToDay(sourceDate)
                : floorToHour(sourceDate);
            const bucket = bucketDate.toISOString();
            const current = bucketMap.get(bucket) || {
                ts: bucket,
                upBytes: 0,
                downBytes: 0,
                totalBytes: 0,
            };
            current.upBytes += toNonNegativeInt(sample.upBytes, 0);
            current.downBytes += toNonNegativeInt(sample.downBytes, 0);
            current.totalBytes += toNonNegativeInt(sample.totalBytes, 0);
            bucketMap.set(bucket, current);
        }
        return Array.from(bucketMap.values()).sort((a, b) => (
            new Date(a.ts).getTime() - new Date(b.ts).getTime()
        ));
    }

    _aggregateSnapshotDeltaTrend(samples, granularity, range = {}) {
        const bucketMap = new Map();
        const fromTs = Number.isFinite(range.fromTs) ? range.fromTs : Number.NEGATIVE_INFINITY;
        const toTs = Number.isFinite(range.toTs) ? range.toTs : Number.POSITIVE_INFINITY;
        const orderedSamples = Array.isArray(samples)
            ? [...samples]
                .map((item) => {
                    const sampleTs = new Date(item.ts).getTime();
                    return Number.isFinite(sampleTs) ? { ...item, _sampleTs: sampleTs } : null;
                })
                .filter(Boolean)
                .sort((a, b) => a._sampleTs - b._sampleTs)
            : [];

        let previousSample = null;
        for (const sample of orderedSamples) {
            const sampleTs = sample._sampleTs;
            const deltaUp = calculateTrafficDelta(sample.upBytes, previousSample?.upBytes);
            const deltaDown = calculateTrafficDelta(sample.downBytes, previousSample?.downBytes);
            const deltaTotal = deltaUp + deltaDown;
            previousSample = sample;

            if (sampleTs < fromTs || sampleTs > toTs) continue;

            const bucketDate = granularity === 'day'
                ? floorToDay(new Date(sampleTs))
                : floorToHour(new Date(sampleTs));
            const bucket = bucketDate.toISOString();
            const current = bucketMap.get(bucket) || {
                ts: bucket,
                upBytes: 0,
                downBytes: 0,
                totalBytes: 0,
            };
            current.upBytes += deltaUp;
            current.downBytes += deltaDown;
            current.totalBytes += deltaTotal;
            bucketMap.set(bucket, current);
        }
        return Array.from(bucketMap.values()).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    }

    _normalizeOverviewRequests(requests = [], defaults = {}) {
        return (Array.isArray(requests) ? requests : []).map((request, index) => {
            const range = this._buildTimeRange(request, { defaultDays: defaults.defaultDays || 30 });
            return {
                key: String(request?.key || index),
                from: range.from,
                to: range.to,
                fromTs: range.fromTs,
                toTs: range.toTs,
                top: Math.min(10, toPositiveInt(request?.top, defaults.top || 10)),
            };
        });
    }

    _buildOverviewBatchCacheKey(requests = [], userDirectory = null) {
        const requestToken = requests
            .map((request) => [request.key, request.from, request.to, request.top].join(':'))
            .join('|');
        const directoryToken = String(userDirectory?.versionToken || '');
        return `${this.stateVersion}:${directoryToken}:${requestToken}`;
    }

    _setOverviewCache(cacheKey, value) {
        if (this.overviewCache.has(cacheKey)) {
            this.overviewCache.delete(cacheKey);
        }
        this.overviewCache.set(cacheKey, {
            checkedAtMs: Date.now(),
            value,
        });
        while (this.overviewCache.size > DEFAULT_OVERVIEW_CACHE_LIMIT) {
            const oldestKey = this.overviewCache.keys().next().value;
            this.overviewCache.delete(oldestKey);
        }
    }

    _computeOverviewBatch(requests = [], userDirectory = null) {
        const requestList = Array.isArray(requests) ? requests : [];
        const baselineStatus = resolveTrafficBaselineStatus(this.meta);
        const serverTotals = normalizeServerTotals(this.meta?.serverTotals);
        const registeredTotals = normalizeRegisteredTotals(this.meta?.registeredTotals);
        const requestStateList = requestList.map((request) => ({
            request,
            state: {
                totals: { upBytes: 0, downBytes: 0, totalBytes: 0 },
                managedTotals: { upBytes: 0, downBytes: 0, totalBytes: 0 },
                unattributedTotals: { upBytes: 0, downBytes: 0, totalBytes: 0 },
                users: new Map(),
                sampleCount: 0,
                hasUnattributedTraffic: false,
                topServers: [],
                topServersReady: false,
            },
        }));
        const serverSnapshotBuckets = new Map();

        for (const item of this.samples) {
            const sampleTs = new Date(item?.ts || 0).getTime();
            if (!Number.isFinite(sampleTs)) continue;

            if (normalizeSampleKind(item?.kind) === SAMPLE_KIND_SERVER_SNAPSHOT) {
                const serverId = String(item?.serverId || '').trim();
                if (!serverId) continue;
                if (!serverSnapshotBuckets.has(serverId)) {
                    serverSnapshotBuckets.set(serverId, {
                        serverId,
                        serverName: String(item?.serverName || serverId).trim(),
                        samples: [],
                    });
                }
                const bucket = serverSnapshotBuckets.get(serverId);
                if (bucket.serverName === '' && item?.serverName) {
                    bucket.serverName = String(item.serverName).trim();
                }
                bucket.samples.push({
                    sampleTs,
                    upBytes: toNonNegativeInt(item?.upBytes, 0),
                    downBytes: toNonNegativeInt(item?.downBytes, 0),
                });
                continue;
            }

            const upBytes = toNonNegativeInt(item?.upBytes, 0);
            const downBytes = toNonNegativeInt(item?.downBytes, 0);
            const totalBytes = toNonNegativeInt(item?.totalBytes, upBytes + downBytes);
            const email = normalizeClientEmail(item?.email);
            const userInfo = email
                ? resolveTrafficUserInfo(email, userDirectory)
                : null;

            requestStateList.forEach(({ request, state }) => {
                if (sampleTs < request.fromTs || sampleTs > request.toTs) return;
                state.sampleCount += 1;
                state.totals.upBytes += upBytes;
                state.totals.downBytes += downBytes;
                state.totals.totalBytes += totalBytes;

                if (email) {
                    if (!userInfo?.email) return;
                    state.managedTotals.upBytes += upBytes;
                    state.managedTotals.downBytes += downBytes;
                    state.managedTotals.totalBytes += totalBytes;
                    const current = state.users.get(userInfo.email) || {
                        userId: userInfo.userId,
                        username: userInfo.username,
                        email: userInfo.email,
                        displayLabel: userInfo.displayLabel,
                        totalBytes: 0,
                    };
                    current.totalBytes += totalBytes;
                    state.users.set(userInfo.email, current);
                    return;
                }

                if (totalBytes <= 0) return;
                state.hasUnattributedTraffic = true;
                state.unattributedTotals.upBytes += upBytes;
                state.unattributedTotals.downBytes += downBytes;
                state.unattributedTotals.totalBytes += totalBytes;
            });
        }

        if (serverSnapshotBuckets.size > 0) {
            requestStateList.forEach(({ state }) => {
                state.serverEntries = [];
            });

            serverSnapshotBuckets.forEach((bucket) => {
                bucket.samples.sort((left, right) => left.sampleTs - right.sampleTs);
                const perRequestTotals = new Map(
                    requestStateList.map(({ request }) => [request.key, {
                        upBytes: 0,
                        downBytes: 0,
                        totalBytes: 0,
                        seenInRange: false,
                    }])
                );
                let previousSample = null;

                bucket.samples.forEach((sample) => {
                    const deltaUp = calculateTrafficDelta(sample.upBytes, previousSample?.upBytes);
                    const deltaDown = calculateTrafficDelta(sample.downBytes, previousSample?.downBytes);
                    previousSample = sample;

                    requestStateList.forEach(({ request }) => {
                        if (sample.sampleTs < request.fromTs || sample.sampleTs > request.toTs) return;
                        const current = perRequestTotals.get(request.key);
                        current.seenInRange = true;
                        current.upBytes += deltaUp;
                        current.downBytes += deltaDown;
                        current.totalBytes += deltaUp + deltaDown;
                    });
                });

                requestStateList.forEach(({ request, state }) => {
                    const current = perRequestTotals.get(request.key);
                    if (current.seenInRange) {
                        state.topServersReady = true;
                    }
                    if (current.totalBytes <= 0) return;
                    state.serverEntries.push(createServerTotalEntry({
                        serverId: bucket.serverId,
                        serverName: bucket.serverName,
                        ...current,
                    }));
                });
            });
        }

        return Object.fromEntries(requestStateList.map(({ request, state }) => {
            const topUsers = Array.from(state.users.values())
                .sort((left, right) => right.totalBytes - left.totalBytes)
                .slice(0, request.top);
            const topServers = Array.isArray(state.serverEntries)
                ? state.serverEntries
                    .sort((left, right) => right.totalBytes - left.totalBytes)
                    .slice(0, request.top)
                : [];

            return [request.key, {
                from: request.from,
                to: request.to,
                sampleCount: state.sampleCount,
                activeUsers: state.users.size,
                userLevelSupported: state.hasUnattributedTraffic !== true,
                unattributedTotals: state.unattributedTotals,
                totals: state.totals,
                managedTotals: state.managedTotals,
                currentTotalsAt: baselineStatus.currentTotalsAt,
                baselineReady: baselineStatus.baselineReady,
                registeredTotalsReady: baselineStatus.registeredTotalsReady,
                serverTotalsReady: baselineStatus.serverTotalsReady,
                registeredTotals,
                serverTotals,
                topUsers,
                topServers,
                topServersReady: state.topServersReady,
                lastCollectionAt: this.meta.lastCollectionAt || null,
            }];
        }));
    }

    getOverviewBatch(requests = [], options = {}) {
        const requestList = this._normalizeOverviewRequests(requests, {
            defaultDays: options.defaultDays || 30,
            top: options.top,
        });
        if (requestList.length === 0) return {};

        const users = Array.isArray(options.users) ? options.users : userStore.getAll();
        const userDirectory = buildResolvedTrafficUserDirectory(users);
        const cacheKey = this._buildOverviewBatchCacheKey(requestList, userDirectory);
        const cached = this.overviewCache.get(cacheKey);
        if (cached && (Date.now() - Number(cached.checkedAtMs || 0)) <= this._overviewCacheTtlMs()) {
            return cached.value;
        }

        const result = this._computeOverviewBatch(requestList, userDirectory);
        this._setOverviewCache(cacheKey, result);
        return result;
    }

    async _collectFromServer(serverMeta, collectedAtIso, options = {}) {
        const result = { samples: [], warning: null, inbounds: [] };
        try {
            const panelSnapshot = await getServerPanelSnapshot(serverMeta, {
                includeOnlines: false,
                force: options.force === true,
            });
            const inbounds = Array.isArray(panelSnapshot?.inbounds) ? panelSnapshot.inbounds : [];
            result.inbounds = inbounds;
            if (panelSnapshot?.inboundsError) {
                result.warning = {
                    serverId: serverMeta.id,
                    server: serverMeta.name,
                    reason: panelSnapshot.inboundsError.message || 'panel inbounds unavailable',
                };
            }

            for (const inbound of inbounds) {
                const { clients, hasClientTraffic } = extractInboundClients(inbound);
                let clientTrafficCaptured = false;
                for (let i = 0; i < clients.length; i += 1) {
                    const cl = clients[i] || {};
                    const email = String(cl.email || '').trim().toLowerCase();
                    const identifier = String(
                        cl.id || cl.password || cl.email || `${inbound.id || 'inbound'}-${i}`
                    );
                    const up = toNonNegativeInt(cl.up, 0);
                    const down = toNonNegativeInt(cl.down, 0);
                    const total = up + down;
                    const counterKey = `${serverMeta.id}|${String(inbound.id || '')}|${identifier}`;
                    const prev = this.counters[counterKey];
                    const deltaUp = calculateTrafficDelta(up, prev?.up);
                    const deltaDown = calculateTrafficDelta(down, prev?.down);
                    const deltaTotal = deltaUp + deltaDown;

                    this.counters[counterKey] = {
                        up,
                        down,
                        total,
                        serverId: serverMeta.id,
                        inboundId: String(inbound.id || ''),
                        email,
                        lastSeenAt: collectedAtIso,
                    };

                    if (deltaTotal <= 0) continue;
                    clientTrafficCaptured = true;
                    result.samples.push({
                        id: crypto.randomUUID(),
                        kind: SAMPLE_KIND_CLIENT_DELTA,
                        ts: collectedAtIso,
                        granularity: 'raw',
                        serverId: serverMeta.id,
                        serverName: serverMeta.name,
                        inboundId: String(inbound.id || ''),
                        inboundRemark: inbound.remark || '',
                        email,
                        clientIdentifier: identifier,
                        upBytes: deltaUp,
                        downBytes: deltaDown,
                        totalBytes: deltaTotal,
                    });
                }

                if (!shouldUseInboundTotalFallback(hasClientTraffic, clientTrafficCaptured)) {
                    continue;
                }

                const inboundUp = toNonNegativeInt(inbound?.up, 0);
                const inboundDown = toNonNegativeInt(inbound?.down, 0);
                const inboundTotal = inboundUp + inboundDown;
                const inboundCounterKey = `${serverMeta.id}|${String(inbound.id || '')}|__inbound_total__`;
                const prevInbound = this.counters[inboundCounterKey];
                const deltaInboundUp = calculateTrafficDelta(inboundUp, prevInbound?.up);
                const deltaInboundDown = calculateTrafficDelta(inboundDown, prevInbound?.down);
                const deltaInboundTotal = deltaInboundUp + deltaInboundDown;

                this.counters[inboundCounterKey] = {
                    up: inboundUp,
                    down: inboundDown,
                    total: inboundTotal,
                    serverId: serverMeta.id,
                    inboundId: String(inbound.id || ''),
                    email: '',
                    lastSeenAt: collectedAtIso,
                };

                if (deltaInboundTotal <= 0) continue;
                result.samples.push({
                    id: crypto.randomUUID(),
                    kind: SAMPLE_KIND_CLIENT_DELTA,
                    ts: collectedAtIso,
                    granularity: 'raw',
                    serverId: serverMeta.id,
                    serverName: serverMeta.name,
                    inboundId: String(inbound.id || ''),
                    inboundRemark: inbound.remark || '',
                    email: '',
                    clientIdentifier: '__inbound_total__',
                    upBytes: deltaInboundUp,
                    downBytes: deltaInboundDown,
                    totalBytes: deltaInboundTotal,
                });
            }
        } catch (error) {
            result.warning = {
                serverId: serverMeta.id,
                server: serverMeta.name,
                reason: error.message,
            };
        }
        return result;
    }

    async collectIfStale(force = false) {
        const lastCollectionTs = this.meta?.lastCollectionAt
            ? new Date(this.meta.lastCollectionAt).getTime()
            : 0;
        const baselineStatus = resolveTrafficBaselineStatus(this.meta);
        if (!force
            && baselineStatus.registeredTotalsReady
            && baselineStatus.serverTotalsReady
            && lastCollectionTs
            && (Date.now() - lastCollectionTs) < this._sampleIntervalMs()) {
            return {
                collected: false,
                lastCollectionAt: this.meta.lastCollectionAt,
                samplesAdded: 0,
                warnings: [],
            };
        }

        if (this.collectingPromise) return this.collectingPromise;
        this.collectingPromise = this._collectNow({ force }).finally(() => {
            this.collectingPromise = null;
        });
        return this.collectingPromise;
    }

    async _collectNow(options = {}) {
        const collectedAtIso = new Date().toISOString();
        const servers = serverStore.getAll();
        const users = userStore.getAll();
        const warnings = [];
        const newSamples = [];
        const serverPayloads = [];
        const previousRegisteredTotals = normalizeRegisteredTotals(this.meta?.registeredTotals, buildTrafficUserDirectory(users).totalUsers);
        const previousServerTotals = normalizeServerTotals(this.meta?.serverTotals);
        const previousCurrentTotalsAt = normalizeDateInput(this.meta?.currentTotalsAt, null);

        await runWithConcurrency(
            servers,
            async (serverMeta) => {
                const result = await this._collectFromServer(serverMeta, collectedAtIso, options);
                if (Array.isArray(result.samples) && result.samples.length > 0) {
                    newSamples.push(...result.samples);
                }
                if (Array.isArray(result.inbounds)) {
                    serverPayloads.push({
                        serverId: serverMeta.id,
                        serverName: serverMeta.name,
                        inbounds: result.inbounds,
                    });
                }
                if (result.warning) warnings.push(result.warning);
            },
            this._collectorConcurrency()
        );

        const serverTotals = summarizeServerTrafficTotals(serverPayloads);
        if (serverTotals.length > 0) {
            newSamples.push(...serverTotals.map((item) => ({
                id: crypto.randomUUID(),
                kind: SAMPLE_KIND_SERVER_SNAPSHOT,
                ts: collectedAtIso,
                granularity: 'raw',
                serverId: item.serverId,
                serverName: item.serverName,
                inboundId: '',
                inboundRemark: '',
                email: '',
                clientIdentifier: '__server_total__',
                upBytes: item.upBytes,
                downBytes: item.downBytes,
                totalBytes: item.totalBytes,
            })));
        }

        if (newSamples.length > 0) {
            this.samples.push(...newSamples);
        }
        this.meta.lastCollectionAt = collectedAtIso;
        const hasLiveTotalsSnapshot = servers.length === 0 || serverPayloads.length > 0;
        if (hasLiveTotalsSnapshot) {
            this.meta.registeredTotals = summarizeRegisteredTrafficTotals(users, serverPayloads);
            this.meta.serverTotals = serverTotals;
            this.meta.currentTotalsAt = collectedAtIso;
        } else {
            this.meta.registeredTotals = hasPositiveRegisteredTrafficTotals(previousRegisteredTotals)
                ? previousRegisteredTotals
                : normalizeRegisteredTotals(previousRegisteredTotals, buildTrafficUserDirectory(users).totalUsers);
            this.meta.serverTotals = hasPositiveServerTrafficTotals(previousServerTotals)
                ? previousServerTotals
                : normalizeServerTotals(previousServerTotals);
            this.meta.currentTotalsAt = previousCurrentTotalsAt;
        }
        this._touchState();
        this._prune();
        this._persist();

        return {
            collected: true,
            lastCollectionAt: collectedAtIso,
            samplesAdded: newSamples.length,
            warnings,
        };
    }

    getCollectionStatus() {
        const baselineStatus = resolveTrafficBaselineStatus(this.meta);
        return {
            lastCollectionAt: this.meta?.lastCollectionAt || null,
            currentTotalsAt: baselineStatus.currentTotalsAt,
            baselineReady: baselineStatus.baselineReady,
            registeredTotalsReady: baselineStatus.registeredTotalsReady,
            serverTotalsReady: baselineStatus.serverTotalsReady,
            sampleCount: Array.isArray(this.samples) ? this.samples.length : 0,
            collecting: Boolean(this.collectingPromise),
        };
    }

    getOverview(options = {}) {
        return this.getOverviewBatch([
            {
                key: 'overview',
                ...options,
            },
        ], options).overview;
    }

    getUserTrend(email, options = {}) {
        const userDirectory = buildResolvedTrafficUserDirectory(userStore.getAll());
        const userInfo = resolveTrafficUserInfo(email, userDirectory);
        const normalizedEmail = String(userInfo?.email || '').trim().toLowerCase();
        if (!normalizedEmail || !userInfo) {
            return {
                email: normalizedEmail,
                username: '',
                displayLabel: normalizedEmail || '-',
                granularity: 'hour',
                from: null,
                to: null,
                points: [],
                totals: { upBytes: 0, downBytes: 0, totalBytes: 0 },
            };
        }
        const range = this._buildTimeRange(options, { defaultDays: 30 });
        const selectedGranularity = String(options.granularity || 'auto').toLowerCase();
        const granularity = selectedGranularity === 'auto'
            ? chooseAutoGranularity(range.fromTs, range.toTs)
            : (selectedGranularity === 'day' ? 'day' : 'hour');

        const samples = this._filterSamples({
            fromTs: range.fromTs,
            toTs: range.toTs,
        }).filter((item) => userInfo.aliases.has(normalizeClientEmail(item.email)));
        const points = this._aggregateTrend(samples, granularity);
        const totals = points.reduce((acc, item) => {
            acc.upBytes += item.upBytes;
            acc.downBytes += item.downBytes;
            acc.totalBytes += item.totalBytes;
            return acc;
        }, { upBytes: 0, downBytes: 0, totalBytes: 0 });

        return {
            email: normalizedEmail,
            username: userInfo.username,
            displayLabel: userInfo.displayLabel,
            granularity,
            from: range.from,
            to: range.to,
            points,
            totals,
        };
    }

    getServerTrend(serverId, options = {}) {
        const normalizedServerId = String(serverId || '').trim();
        const range = this._buildTimeRange(options, { defaultDays: 30 });
        const selectedGranularity = String(options.granularity || 'auto').toLowerCase();
        const granularity = selectedGranularity === 'auto'
            ? chooseAutoGranularity(range.fromTs, range.toTs)
            : (selectedGranularity === 'day' ? 'day' : 'hour');

        const samples = this.samples.filter((item) => (
            normalizeSampleKind(item?.kind) === SAMPLE_KIND_SERVER_SNAPSHOT
            && String(item?.serverId || '').trim() === normalizedServerId
        ));
        const points = this._aggregateSnapshotDeltaTrend(samples, granularity, {
            fromTs: range.fromTs,
            toTs: range.toTs,
        });
        const totals = points.reduce((acc, item) => {
            acc.upBytes += item.upBytes;
            acc.downBytes += item.downBytes;
            acc.totalBytes += item.totalBytes;
            return acc;
        }, {
            upBytes: 0,
            downBytes: 0,
            totalBytes: 0,
        });

        return {
            serverId: normalizedServerId,
            granularity,
            from: range.from,
            to: range.to,
            points,
            totals,
        };
    }

    exportState() {
        return {
            samples: this.samples,
            counters: this.counters,
            meta: this.meta,
        };
    }

    importState(snapshot = {}) {
        this.samples = Array.isArray(snapshot?.samples) ? snapshot.samples : [];
        this.counters = snapshot?.counters && typeof snapshot.counters === 'object' && !Array.isArray(snapshot.counters)
            ? snapshot.counters
            : {};
        this.meta = snapshot?.meta && typeof snapshot.meta === 'object' && !Array.isArray(snapshot.meta)
            ? {
                ...snapshot.meta,
                currentTotalsAt: normalizeDateInput(snapshot?.meta?.currentTotalsAt, null),
                registeredTotals: hasOwn(snapshot.meta, 'registeredTotals')
                    ? normalizeRegisteredTotals(snapshot?.meta?.registeredTotals)
                    : null,
                serverTotals: hasOwn(snapshot.meta, 'serverTotals')
                    ? normalizeServerTotals(snapshot?.meta?.serverTotals)
                    : null,
            }
            : {
                lastCollectionAt: null,
                currentTotalsAt: null,
                registeredTotals: createRegisteredTotals(),
                serverTotals: [],
            };
        this._touchState();
        this._prune();
    }
}

const trafficStatsStore = new TrafficStatsStore();

function runTrafficWarmCycle() {
    if (trafficWarmLoopInFlight) return trafficWarmLoopInFlight;
    trafficWarmLoopInFlight = Promise.resolve()
        .then(() => trafficStatsStore.collectIfStale(false))
        .catch((error) => {
            console.error('Failed to warm traffic stats:', error?.message || error);
            return null;
        })
        .finally(() => {
            trafficWarmLoopInFlight = null;
        });
    return trafficWarmLoopInFlight;
}

function startTrafficStatsWarmLoop(options = {}) {
    if (trafficWarmLoopTimer) return;
    const intervalMs = Math.max(
        DEFAULT_WARM_LOOP_MIN_INTERVAL_MS,
        Number(options.intervalMs || trafficStatsStore._sampleIntervalMs())
    );

    const initialTimer = setTimeout(() => {
        runTrafficWarmCycle();
    }, 0);
    if (typeof initialTimer?.unref === 'function') {
        initialTimer.unref();
    }

    trafficWarmLoopTimer = setInterval(() => {
        runTrafficWarmCycle();
    }, intervalMs);
    if (typeof trafficWarmLoopTimer?.unref === 'function') {
        trafficWarmLoopTimer.unref();
    }
}

function stopTrafficStatsWarmLoop() {
    if (trafficWarmLoopTimer) {
        clearInterval(trafficWarmLoopTimer);
        trafficWarmLoopTimer = null;
    }
    trafficWarmLoopInFlight = null;
}

export default trafficStatsStore;
export {
    TrafficStatsStore,
    buildCalendarTrafficWindowRange,
    calculateTrafficDelta,
    extractInboundClients,
    resolveTrafficUserInfo,
    shouldUseInboundTotalFallback,
    startTrafficStatsWarmLoop,
    stopTrafficStatsWarmLoop,
    summarizeRegisteredTrafficTotals,
    summarizeServerTrafficTotals,
};
