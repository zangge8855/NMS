import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import systemSettingsStore from './systemSettingsStore.js';
import { mirrorStoreSnapshot, shouldWriteFile } from './dbMirror.js';
import { resolveClientIp } from '../lib/requestIp.js';

const AUDIT_EVENTS_FILE = path.join(config.dataDir, 'audit_events.json');
const SUB_ACCESS_FILE = path.join(config.dataDir, 'subscription_access_logs.json');

const REDACTED_KEYS = new Set([
    'password',
    'token',
    'authorization',
    'cookie',
    'secret',
    'tokensecret',
    'tokensecretenc',
    'tokensecrethash',
]);

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

function saveArray(file, data) {
    if (!shouldWriteFile()) return;
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeDateInput(value, fallback = null) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toISOString();
}

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
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
        if (REDACTED_KEYS.has(String(key).toLowerCase())) {
            output[key] = '[REDACTED]';
            continue;
        }
        output[key] = redactSensitive(raw);
    }
    return output;
}

function deriveOutcome(eventType, provided) {
    if (provided) return provided;
    const text = String(eventType || '').toLowerCase();
    if (text.includes('failed') || text.includes('denied') || text.includes('revoked') || text.includes('expired')) {
        return 'failed';
    }
    if (text.includes('started')) return 'info';
    return 'success';
}

class AuditStore {
    constructor() {
        ensureDataDir();
        this.events = loadArray(AUDIT_EVENTS_FILE);
        this.subscriptionAccess = loadArray(SUB_ACCESS_FILE);
        this._pruneExpired();
    }

    _retentionMs() {
        const days = toPositiveInt(systemSettingsStore.getAudit().retentionDays, toPositiveInt(config.audit?.retentionDays, 365));
        return days * 24 * 60 * 60 * 1000;
    }

    _maxPageSize() {
        return toPositiveInt(systemSettingsStore.getAudit().maxPageSize, toPositiveInt(config.audit?.maxPageSize, 200));
    }

    _mirrorSnapshot() {
        mirrorStoreSnapshot('audit', this.exportState(), { redact: true });
    }

    _pruneExpired() {
        const cutoff = Date.now() - this._retentionMs();

        const oldEventLen = this.events.length;
        this.events = this.events.filter((item) => {
            const ts = new Date(item?.ts || 0).getTime();
            return Number.isFinite(ts) && ts >= cutoff;
        });
        if (this.events.length !== oldEventLen) {
            saveArray(AUDIT_EVENTS_FILE, this.events);
            this._mirrorSnapshot();
        }

        const oldAccessLen = this.subscriptionAccess.length;
        this.subscriptionAccess = this.subscriptionAccess.filter((item) => {
            const ts = new Date(item?.ts || 0).getTime();
            return Number.isFinite(ts) && ts >= cutoff;
        });
        if (this.subscriptionAccess.length !== oldAccessLen) {
            saveArray(SUB_ACCESS_FILE, this.subscriptionAccess);
            this._mirrorSnapshot();
        }
    }

    appendEvent({
        event,
        req,
        details = {},
        outcome = '',
        resourceType = '',
        resourceId = '',
        serverId = '',
        targetEmail = '',
        beforeSnapshot = null,
        afterSnapshot = null,
    }) {
        this._pruneExpired();
        const safeDetails = redactSensitive(details);

        const derivedServerId = String(
            serverId
            || safeDetails?.serverId
            || req?.params?.serverId
            || req?.params?.id
            || ''
        ).trim();

        const derivedTargetEmail = String(
            targetEmail
            || safeDetails?.email
            || req?.params?.email
            || ''
        ).trim().toLowerCase();

        const entry = {
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            eventType: String(event || 'unknown'),
            actor: req?.user?.role || 'anonymous',
            actorRole: req?.user?.role || 'anonymous',
            ip: resolveClientIp(req),
            method: req?.method || null,
            path: req?.originalUrl || null,
            outcome: deriveOutcome(event, outcome),
            resourceType: String(resourceType || '').trim(),
            resourceId: String(resourceId || '').trim(),
            serverId: derivedServerId,
            targetEmail: derivedTargetEmail,
            beforeSnapshot: redactSensitive(beforeSnapshot),
            afterSnapshot: redactSensitive(afterSnapshot),
            details: safeDetails,
        };

        this.events.unshift(entry);
        saveArray(AUDIT_EVENTS_FILE, this.events);
        this._mirrorSnapshot();
        return entry;
    }

    appendSubscriptionAccess({
        email = '',
        tokenId = '',
        ip = '',
        userAgent = '',
        status = 'denied',
        reason = '',
        serverId = '',
        mode = 'auto',
        format = 'encoded',
    }) {
        this._pruneExpired();
        const entry = {
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            email: String(email || '').trim().toLowerCase(),
            tokenId: String(tokenId || '').trim(),
            ip: String(ip || 'unknown').trim(),
            userAgent: String(userAgent || '').trim(),
            status: String(status || 'denied').trim().toLowerCase(),
            reason: String(reason || '').trim(),
            serverId: String(serverId || '').trim(),
            mode: String(mode || 'auto').trim().toLowerCase(),
            format: String(format || 'encoded').trim().toLowerCase(),
        };
        this.subscriptionAccess.unshift(entry);
        saveArray(SUB_ACCESS_FILE, this.subscriptionAccess);
        this._mirrorSnapshot();
        return entry;
    }

    queryEvents(filters = {}) {
        const page = toPositiveInt(filters.page, 1);
        const pageSize = Math.min(toPositiveInt(filters.pageSize, 20), this._maxPageSize());
        const fromIso = normalizeDateInput(filters.from);
        const toIso = normalizeDateInput(filters.to);
        const eventType = String(filters.eventType || '').trim().toLowerCase();
        const actor = String(filters.actor || '').trim().toLowerCase();
        const serverId = String(filters.serverId || '').trim();
        const targetEmail = String(filters.targetEmail || '').trim().toLowerCase();
        const outcome = String(filters.outcome || '').trim().toLowerCase();
        const q = String(filters.q || '').trim().toLowerCase();

        let rows = this.events;

        if (fromIso) {
            const fromTs = new Date(fromIso).getTime();
            rows = rows.filter((item) => new Date(item.ts).getTime() >= fromTs);
        }
        if (toIso) {
            const toTs = new Date(toIso).getTime();
            rows = rows.filter((item) => new Date(item.ts).getTime() <= toTs);
        }
        if (eventType) {
            rows = rows.filter((item) => String(item.eventType || '').toLowerCase().includes(eventType));
        }
        if (actor) {
            rows = rows.filter((item) => String(item.actor || '').toLowerCase().includes(actor));
        }
        if (serverId) {
            rows = rows.filter((item) => String(item.serverId || '') === serverId);
        }
        if (targetEmail) {
            rows = rows.filter((item) => String(item.targetEmail || '').toLowerCase().includes(targetEmail));
        }
        if (outcome) {
            rows = rows.filter((item) => String(item.outcome || '').toLowerCase() === outcome);
        }
        if (q) {
            rows = rows.filter((item) => {
                const payload = JSON.stringify(item.details || {}).toLowerCase();
                return String(item.eventType || '').toLowerCase().includes(q)
                    || String(item.path || '').toLowerCase().includes(q)
                    || String(item.resourceType || '').toLowerCase().includes(q)
                    || payload.includes(q);
            });
        }

        const total = rows.length;
        const start = (page - 1) * pageSize;
        const items = rows.slice(start, start + pageSize);

        return {
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            items,
        };
    }

    getEventById(id) {
        return this.events.find((item) => item.id === id) || null;
    }

    _normalizeSubscriptionRange(filters = {}) {
        const oneYearMs = 365 * 24 * 60 * 60 * 1000;
        const now = new Date();
        const explicitFrom = normalizeDateInput(filters.from);
        const explicitTo = normalizeDateInput(filters.to);

        if (explicitFrom || explicitTo) {
            return {
                fromIso: explicitFrom,
                toIso: explicitTo,
            };
        }

        return {
            fromIso: new Date(now.getTime() - oneYearMs).toISOString(),
            toIso: now.toISOString(),
        };
    }

    _filterSubscriptionAccess(filters = {}) {
        const { fromIso, toIso } = this._normalizeSubscriptionRange(filters);
        const email = String(filters.email || '').trim().toLowerCase();
        const tokenId = String(filters.tokenId || '').trim();
        const status = String(filters.status || '').trim().toLowerCase();
        const ip = String(filters.ip || '').trim();
        const serverId = String(filters.serverId || '').trim();

        let rows = this.subscriptionAccess;
        if (fromIso) {
            const fromTs = new Date(fromIso).getTime();
            rows = rows.filter((item) => new Date(item.ts).getTime() >= fromTs);
        }
        if (toIso) {
            const toTs = new Date(toIso).getTime();
            rows = rows.filter((item) => new Date(item.ts).getTime() <= toTs);
        }
        if (email) {
            rows = rows.filter((item) => String(item.email || '').toLowerCase().includes(email));
        }
        if (tokenId) {
            rows = rows.filter((item) => String(item.tokenId || '').includes(tokenId));
        }
        if (status) {
            rows = rows.filter((item) => String(item.status || '').toLowerCase() === status);
        }
        if (ip) {
            rows = rows.filter((item) => String(item.ip || '').includes(ip));
        }
        if (serverId) {
            rows = rows.filter((item) => String(item.serverId || '') === serverId);
        }

        return { rows, fromIso, toIso };
    }

    querySubscriptionAccess(filters = {}) {
        const page = toPositiveInt(filters.page, 1);
        const pageSize = Math.min(toPositiveInt(filters.pageSize, 50), this._maxPageSize());
        const { rows, fromIso, toIso } = this._filterSubscriptionAccess(filters);

        const statusBreakdown = rows.reduce((acc, item) => {
            const key = String(item.status || 'unknown');
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const ipCounter = rows.reduce((acc, item) => {
            const key = String(item.ip || 'unknown').trim() || 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const uniqueIpCount = Object.keys(ipCounter).length;
        const topIps = Object.entries(ipCounter)
            .map(([entryIp, count]) => ({ ip: entryIp, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const total = rows.length;
        const start = (page - 1) * pageSize;
        const items = rows.slice(start, start + pageSize);

        return {
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            from: fromIso,
            to: toIso,
            statusBreakdown,
            uniqueIpCount,
            topIps,
            items,
        };
    }

    summarizeSubscriptionAccess(filters = {}) {
        const { rows, fromIso, toIso } = this._filterSubscriptionAccess(filters);
        const total = rows.length;
        const uniqueTokens = new Set(rows.map((item) => String(item.tokenId || '').trim()).filter(Boolean)).size;
        const uniqueUsers = new Set(rows.map((item) => String(item.email || '').trim().toLowerCase()).filter(Boolean)).size;
        const ipCounter = rows.reduce((acc, item) => {
            const key = String(item.ip || 'unknown').trim() || 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const statusBreakdown = rows.reduce((acc, item) => {
            const key = String(item.status || 'unknown');
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        return {
            from: fromIso,
            to: toIso,
            total,
            uniqueUsers,
            uniqueTokens,
            uniqueIpCount: Object.keys(ipCounter).length,
            statusBreakdown,
            topIps: Object.entries(ipCounter)
                .map(([ip, count]) => ({ ip, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
        };
    }

    exportState() {
        return {
            events: this.events,
            subscriptionAccess: this.subscriptionAccess,
        };
    }

    clearEvents() {
        this.events = [];
        saveArray(AUDIT_EVENTS_FILE, this.events);
        this._mirrorSnapshot();
    }

    clearSubscriptionAccess() {
        this.subscriptionAccess = [];
        saveArray(SUB_ACCESS_FILE, this.subscriptionAccess);
        this._mirrorSnapshot();
    }

    importState(snapshot = {}) {
        this.events = Array.isArray(snapshot?.events) ? snapshot.events : [];
        this.subscriptionAccess = Array.isArray(snapshot?.subscriptionAccess) ? snapshot.subscriptionAccess : [];
        this._pruneExpired();
    }
}

const auditStore = new AuditStore();
export default auditStore;
