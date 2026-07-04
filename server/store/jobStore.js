import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import systemSettingsStore from './systemSettingsStore.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const JOBS_FILE = path.join(config.dataDir, 'jobs.json');
const REDACTED_KEYS = new Set([
    'password',
    'token',
    'tokensecret',
    'authorization',
    'cookie',
    'secret',
    'apikey',
    'accesskey',
    'privatekey',
    'sshpassword',
    'sshprivatekey',
]);

const REDACTED_SENTINEL = '[REDACTED]';

// In-memory-only (never persisted) cache of UNREDACTED request snapshots, keyed by job id.
// Job history persisted to disk/DB and returned to the UI is redacted, but retry needs the
// real credentials. Keeping them here — and only here — lets same-session retry replay the
// true request without ever writing plaintext secrets to disk. Cleared on restart, so
// post-restart retries fall back to the redacted snapshot (and are guarded against replaying
// the [REDACTED] sentinel as a real value).
const retryRequestCache = new Map();

function ensureDataDir() {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function loadArray(file) {
    if (!fs.existsSync(file)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(parsed)) {
            throw new Error(`Data in ${file} is not a JSON array`);
        }
        return parsed;
    } catch (error) {
        console.error(`Failed to load ${file}:`, error.message);
        throw error;
    }
}

function saveArrayAtomic(file, data) {
    saveObjectAtomic(file, data);
}

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function toString(value) {
    if (value === undefined || value === null) return '';
    return String(value);
}

function safeClone(value) {
    if (value === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function redactSensitive(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value.map((item) => redactSensitive(item));
    }

    const output = {};
    for (const [key, raw] of Object.entries(value)) {
        if (REDACTED_KEYS.has(String(key || '').trim().toLowerCase())) {
            output[key] = '[REDACTED]';
            continue;
        }
        output[key] = redactSensitive(raw);
    }
    return output;
}

function deriveStatus(summary = {}) {
    const total = Number(summary.total || 0);
    const success = Number(summary.success || 0);
    const failed = Number(summary.failed || 0);
    if (total <= 0) return 'failed';
    if (failed <= 0) return 'success';
    if (success <= 0) return 'failed';
    return 'partial_success';
}

function deriveFailureGroups(results = [], maxGroups = 30) {
    const failedItems = Array.isArray(results)
        ? results.filter((item) => item && item.success === false)
        : [];
    const groups = new Map();
    failedItems.forEach((item) => {
        const serverId = toString(item.serverId || '');
        const error = toString(item.msg || 'unknown-error');
        const key = `${serverId}|${error}`;
        const current = groups.get(key) || {
            key,
            serverId,
            serverName: toString(item.serverName || ''),
            error,
            count: 0,
        };
        current.count += 1;
        groups.set(key, current);
    });

    return Array.from(groups.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, maxGroups);
}

class JobStore {
    constructor() {
        ensureDataDir();
        this.jobs = loadArray(JOBS_FILE);
        this._migrateSensitiveFields();
        this._prune();
    }

    _retentionMs() {
        const days = toPositiveInt(systemSettingsStore.getJobs().retentionDays, toPositiveInt(config.jobs?.retentionDays, 90));
        return days * 24 * 60 * 60 * 1000;
    }

    _maxPageSize() {
        return toPositiveInt(systemSettingsStore.getJobs().maxPageSize, toPositiveInt(config.jobs?.maxPageSize, 200));
    }

    _maxRecords() {
        return toPositiveInt(systemSettingsStore.getJobs().maxRecords, toPositiveInt(config.jobs?.maxRecords, 2000));
    }

    _save() {
        saveArrayAtomic(JOBS_FILE, this.jobs);
        mirrorStoreSnapshot('jobs', this.exportState());
    }

    _sanitizeEntry(entry) {
        const cloned = safeClone(entry) || {};
        cloned.request = redactSensitive(cloned.request || {});
        cloned.results = redactSensitive(cloned.results || []);
        return cloned;
    }

    _migrateSensitiveFields() {
        let changed = false;
        this.jobs = this.jobs.map((entry) => {
            const sanitized = this._sanitizeEntry(entry);
            const before = JSON.stringify(entry);
            const after = JSON.stringify(sanitized);
            if (before !== after) changed = true;
            return sanitized;
        });
        if (changed) {
            this._save();
        }
    }

    _prune() {
        const cutoff = Date.now() - this._retentionMs();
        const oldLen = this.jobs.length;
        this.jobs = this.jobs.filter((item) => {
            const ts = new Date(item?.createdAt || 0).getTime();
            return Number.isFinite(ts) && ts >= cutoff;
        });

        const maxRecords = this._maxRecords();
        if (this.jobs.length > maxRecords) {
            this.jobs = this.jobs.slice(0, maxRecords);
        }

        if (this.jobs.length !== oldLen) {
            this._syncRetryCache();
            this._save();
        }
    }

    appendBatch({
        type,
        action,
        output,
        actor,
        requestSnapshot,
        retryOf = null,
        risk = null,
        retryStrategy = null,
    }) {
        const nowIso = new Date().toISOString();
        const summary = safeClone(output?.summary || {}) || {};
        const sanitizedResults = redactSensitive(safeClone(output?.results || []) || []);
        const sanitizedRequest = redactSensitive(safeClone(requestSnapshot || {}) || {});
        const entry = {
            id: crypto.randomUUID(),
            type: toString(type),
            action: toString(action),
            status: deriveStatus(summary),
            createdAt: nowIso,
            updatedAt: nowIso,
            actor: toString(actor || 'unknown') || 'unknown',
            summary,
            results: sanitizedResults,
            request: sanitizedRequest,
            retryOf: retryOf ? toString(retryOf) : null,
            canceledAt: null,
            risk: safeClone(risk),
            retryStrategy: safeClone(retryStrategy),
            failureGroups: deriveFailureGroups(sanitizedResults),
        };

        this.jobs.unshift(entry);
        if (this.jobs.length > this._maxRecords()) {
            this.jobs.length = this._maxRecords();
        }
        // Stash the unredacted request for in-session retry (never persisted).
        if (requestSnapshot && typeof requestSnapshot === 'object') {
            retryRequestCache.set(entry.id, safeClone(requestSnapshot) || {});
        }
        this._syncRetryCache();
        this._save();
        return this._sanitizeEntry(entry);
    }

    // Returns the unredacted request snapshot for a job, if still cached this session.
    getUnredactedRequest(id) {
        const cached = retryRequestCache.get(id);
        return cached ? safeClone(cached) : null;
    }

    // Drop cached retry requests for jobs no longer retained in memory.
    _syncRetryCache() {
        if (retryRequestCache.size === 0) return;
        const liveIds = new Set(this.jobs.map((item) => item.id));
        for (const id of retryRequestCache.keys()) {
            if (!liveIds.has(id)) retryRequestCache.delete(id);
        }
    }

    list(filters = {}) {
        this._prune();
        const page = toPositiveInt(filters.page, 1);
        const pageSize = Math.min(
            toPositiveInt(filters.pageSize, toPositiveInt(filters.limit, 50)),
            this._maxPageSize()
        );
        const type = toString(filters.type).trim();
        const action = toString(filters.action).trim();
        const status = toString(filters.status).trim().toLowerCase();

        let rows = this.jobs;
        if (type) rows = rows.filter((item) => item.type === type);
        if (action) rows = rows.filter((item) => item.action === action);
        if (status) rows = rows.filter((item) => toString(item.status).toLowerCase() === status);

        const total = rows.length;
        const start = (page - 1) * pageSize;
        const items = rows.slice(start, start + pageSize);
        return {
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            items: items.map((item) => this._sanitizeEntry(item)),
        };
    }

    getById(id) {
        const target = this.jobs.find((item) => item.id === id);
        return target ? this._sanitizeEntry(target) : null;
    }

    clear() {
        const cleared = this.jobs.length;
        this.jobs = [];
        retryRequestCache.clear();
        this._save();
        return cleared;
    }

    markCanceled(id) {
        const idx = this.jobs.findIndex((item) => item.id === id);
        if (idx === -1) return null;
        const target = this.jobs[idx];
        if (target.status === 'success' || target.status === 'failed' || target.status === 'partial_success') {
            return null;
        }
        target.status = 'canceled';
        target.canceledAt = new Date().toISOString();
        target.updatedAt = target.canceledAt;
        this._save();
        return this._sanitizeEntry(target);
    }

    exportState() {
        return {
            jobs: this.jobs,
        };
    }

    importState(snapshot = {}) {
        this.jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
        this._migrateSensitiveFields();
        this._prune();
    }
}

const jobStore = new JobStore();
export default jobStore;
