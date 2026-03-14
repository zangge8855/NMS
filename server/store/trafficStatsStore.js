import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import serverStore from './serverStore.js';
import userStore from './userStore.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { parseJsonObjectLike } from '../lib/normalize.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const TRAFFIC_SAMPLES_FILE = path.join(config.dataDir, 'traffic_samples.json');
const TRAFFIC_COUNTERS_FILE = path.join(config.dataDir, 'traffic_counters.json');
const TRAFFIC_META_FILE = path.join(config.dataDir, 'traffic_meta.json');

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

function resolveTrafficUserInfo(email) {
    const normalizedInput = normalizeClientEmail(email);
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

function shouldTrackRegisteredTrafficInbound(inbound) {
    const protocol = String(inbound?.protocol || '').trim().toLowerCase();
    return REGISTERED_TRAFFIC_PROTOCOLS.has(protocol) && inbound?.enable !== false;
}

function buildTrafficUserDirectory(users = []) {
    const aliasMap = new Map();
    const registeredUsers = (Array.isArray(users) ? users : []).filter((user) => user?.role !== 'admin');

    registeredUsers.forEach((user) => {
        const loginEmail = normalizeClientEmail(user?.email);
        const subscriptionEmail = normalizeClientEmail(user?.subscriptionEmail || user?.email);
        const canonicalEmail = subscriptionEmail || loginEmail;
        if (!canonicalEmail) return;

        const entry = {
            userId: String(user?.id || '').trim(),
            username: String(user?.username || '').trim(),
            email: canonicalEmail,
        };
        const aliases = new Set([loginEmail, subscriptionEmail].filter(Boolean));
        aliases.forEach((alias) => {
            aliasMap.set(alias, entry);
            aliasMap.set(maskEmail(alias), entry);
        });
    });

    return {
        aliasMap,
        totalUsers: registeredUsers.length,
    };
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
        const loadedMeta = loadObject(TRAFFIC_META_FILE, { lastCollectionAt: null, registeredTotals: createRegisteredTotals() });
        this.meta = {
            ...loadedMeta,
            registeredTotals: hasOwn(loadedMeta, 'registeredTotals')
                ? normalizeRegisteredTotals(loadedMeta.registeredTotals)
                : null,
        };
        this.collectingPromise = null;
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

    _filterSamples({ fromTs, toTs, email = '', serverId = '' }) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedServerId = String(serverId || '').trim();

        return this.samples.filter((item) => {
            const ts = new Date(item.ts).getTime();
            if (!Number.isFinite(ts) || ts < fromTs || ts > toTs) return false;
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

    async _collectFromServer(serverMeta, collectedAtIso) {
        const result = { samples: [], warning: null, inbounds: [] };
        try {
            const client = await ensureAuthenticated(serverMeta.id);
            const listRes = await client.get('/panel/api/inbounds/list');
            const inbounds = Array.isArray(listRes.data?.obj) ? listRes.data.obj : [];
            result.inbounds = inbounds;

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
        if (!force
            && hasRegisteredTotalsSnapshot(this.meta)
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
        this.collectingPromise = this._collectNow().finally(() => {
            this.collectingPromise = null;
        });
        return this.collectingPromise;
    }

    async _collectNow() {
        const collectedAtIso = new Date().toISOString();
        const servers = serverStore.getAll();
        const users = userStore.getAll();
        const warnings = [];
        const newSamples = [];
        const serverPayloads = [];

        await runWithConcurrency(
            servers,
            async (serverMeta) => {
                const result = await this._collectFromServer(serverMeta, collectedAtIso);
                if (Array.isArray(result.samples) && result.samples.length > 0) {
                    newSamples.push(...result.samples);
                }
                if (Array.isArray(result.inbounds)) {
                    serverPayloads.push({ inbounds: result.inbounds });
                }
                if (result.warning) warnings.push(result.warning);
            },
            this._collectorConcurrency()
        );

        if (newSamples.length > 0) {
            this.samples.push(...newSamples);
        }
        this.meta.lastCollectionAt = collectedAtIso;
        this.meta.registeredTotals = summarizeRegisteredTrafficTotals(users, serverPayloads);
        this._prune();
        this._persist();

        return {
            collected: true,
            lastCollectionAt: collectedAtIso,
            samplesAdded: newSamples.length,
            warnings,
        };
    }

    getOverview(options = {}) {
        const range = this._buildTimeRange(options, { defaultDays: 30 });
        const top = toPositiveInt(options.top, 10);
        const samples = this._filterSamples({ fromTs: range.fromTs, toTs: range.toTs });

        const totals = { upBytes: 0, downBytes: 0, totalBytes: 0 };
        const users = new Map();
        const servers = new Map();

        for (const item of samples) {
            totals.upBytes += toNonNegativeInt(item.upBytes, 0);
            totals.downBytes += toNonNegativeInt(item.downBytes, 0);
            totals.totalBytes += toNonNegativeInt(item.totalBytes, 0);

            const email = String(item.email || '').trim().toLowerCase();
            if (email) {
                const userInfo = resolveTrafficUserInfo(email);
                if (userInfo?.email) {
                    const current = users.get(userInfo.email) || {
                        userId: userInfo.userId,
                        username: userInfo.username,
                        email: userInfo.email,
                        displayLabel: userInfo.displayLabel,
                        totalBytes: 0,
                    };
                    current.totalBytes += toNonNegativeInt(item.totalBytes, 0);
                    users.set(userInfo.email, current);
                }
            }
            const serverId = String(item.serverId || '');
            if (serverId) {
                const current = servers.get(serverId) || {
                    serverId,
                    serverName: item.serverName || serverId,
                    totalBytes: 0,
                };
                current.totalBytes += toNonNegativeInt(item.totalBytes, 0);
                servers.set(serverId, current);
            }
        }

        const topUsers = Array.from(users.values())
            .sort((a, b) => b.totalBytes - a.totalBytes)
            .slice(0, top);

        const topServers = Array.from(servers.values())
            .sort((a, b) => b.totalBytes - a.totalBytes)
            .slice(0, top);

        return {
            from: range.from,
            to: range.to,
            sampleCount: samples.length,
            activeUsers: users.size,
            userLevelSupported: samples.some((item) => Boolean(String(item.email || '').trim())),
            totals,
            registeredTotals: normalizeRegisteredTotals(this.meta?.registeredTotals),
            topUsers,
            topServers,
            lastCollectionAt: this.meta.lastCollectionAt || null,
        };
    }

    getUserTrend(email, options = {}) {
        const userInfo = resolveTrafficUserInfo(email);
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
        const range = this._buildTimeRange(options, { defaultDays: 14 });
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
        const range = this._buildTimeRange(options, { defaultDays: 14 });
        const selectedGranularity = String(options.granularity || 'auto').toLowerCase();
        const granularity = selectedGranularity === 'auto'
            ? chooseAutoGranularity(range.fromTs, range.toTs)
            : (selectedGranularity === 'day' ? 'day' : 'hour');

        const samples = this._filterSamples({
            fromTs: range.fromTs,
            toTs: range.toTs,
            serverId: normalizedServerId,
        });
        const points = this._aggregateTrend(samples, granularity);
        const totals = points.reduce((acc, item) => {
            acc.upBytes += item.upBytes;
            acc.downBytes += item.downBytes;
            acc.totalBytes += item.totalBytes;
            return acc;
        }, { upBytes: 0, downBytes: 0, totalBytes: 0 });

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
                registeredTotals: hasOwn(snapshot.meta, 'registeredTotals')
                    ? normalizeRegisteredTotals(snapshot?.meta?.registeredTotals)
                    : null,
            }
            : { lastCollectionAt: null, registeredTotals: createRegisteredTotals() };
        this._prune();
    }
}

const trafficStatsStore = new TrafficStatsStore();
export default trafficStatsStore;
export {
    TrafficStatsStore,
    calculateTrafficDelta,
    extractInboundClients,
    resolveTrafficUserInfo,
    shouldUseInboundTotalFallback,
    summarizeRegisteredTrafficTotals,
};
