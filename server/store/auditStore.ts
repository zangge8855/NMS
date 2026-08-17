import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import systemSettingsStore from './systemSettingsStore.js';
import userStore from './userStore.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic, saveObjectAtomicAsync } from './fileUtils.js';
import { resolveClientIp } from '../lib/requestIp.js';

const AUDIT_EVENTS_FILE = path.join(config.dataDir, 'audit_events.json');
const SUB_ACCESS_FILE = path.join(config.dataDir, 'subscription_access_logs.json');

const REDACTED_KEYS = new Set<string>([
    'password',
    'token',
    'authorization',
    'cookie',
    'secret',
    'tokensecret',
    'tokensecretenc',
    'tokensecrethash',
]);
const MASKED_IP_PATTERN = /^ip_[0-9a-f]{16}$/i;
const MASKED_UA_PATTERN = /^ua_[0-9a-f]{16}$/i;
const MASKED_EMAIL_SUFFIX = '@masked.local';

function ensureDataDir(): void {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function loadArray(file: string): any[] {
    if (!fs.existsSync(file)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
        console.error(`CRITICAL: Failed to load ${file}:`, e.message);
        throw e;
    }
}

// Serialize async saves per file. Without this, two fire-and-forget saves of the same
// audit file (e.g. an append that also prunes) race: their renames can land out of order
// so an older snapshot wins, dropping the newest entries, and interleaved writes can
// corrupt the file (which then loads as [] on restart, wiping audit history).
const saveChains = new Map<string, Promise<void>>();

function saveArray(file: string, data: any): Promise<void> {
    // Snapshot the content synchronously so a later mutation of `data` can't change what
    // this particular save was asked to persist.
    const content = Array.isArray(data) ? data.slice() : data;
    const prev = saveChains.get(file) || Promise.resolve();
    const next = prev
        .catch(() => {})
        .then(() => saveObjectAtomicAsync(file, content))
        .catch((err: any) => {
            console.error(`[AuditStore Error] Failed async save to ${file}:`, err);
        });
    saveChains.set(file, next);
    // Avoid unbounded chain growth: once this link settles and is still the tail, drop it.
    next.finally(() => {
        if (saveChains.get(file) === next) saveChains.delete(file);
    });
    return next;
}

function normalizeDateInput(value: unknown, fallback: string | null = null): string | null {
    if (!value) return fallback;
    const date = new Date(value as any);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toISOString();
}

function toPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function redactSensitive(value: any, visited: Set<any> = new Set()): any {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return value;

    if (visited.has(value)) {
        return '[CIRCULAR]';
    }
    visited.add(value);

    if (Array.isArray(value)) {
        const result = value.map((item) => redactSensitive(item, visited));
        visited.delete(value);
        return result;
    }

    const output: Record<string, any> = {};
    for (const [key, raw] of Object.entries(value)) {
        if (REDACTED_KEYS.has(String(key).toLowerCase())) {
            output[key] = '[REDACTED]';
            continue;
        }
        output[key] = redactSensitive(raw, visited);
    }
    visited.delete(value);
    return output;
}

function deriveOutcome(eventType: unknown, provided?: unknown): string {
    if (provided) return String(provided);
    const text = String(eventType || '').toLowerCase();
    if (text.includes('failed') || text.includes('denied') || text.includes('revoked') || text.includes('expired')) {
        return 'failed';
    }
    if (text.includes('started')) return 'info';
    return 'success';
}

function hashMaskedEmailCandidate(text: unknown): string {
    return crypto.createHash('sha256').update(String(text || '').trim().toLowerCase()).digest('hex').slice(0, 16);
}

function isMaskedEmail(value: unknown): boolean {
    return String(value || '').trim().toLowerCase().endsWith(MASKED_EMAIL_SUFFIX);
}

function isMaskedIp(value: unknown): boolean {
    return MASKED_IP_PATTERN.test(String(value || '').trim());
}

function isMaskedUserAgent(value: unknown): boolean {
    return MASKED_UA_PATTERN.test(String(value || '').trim());
}

function resolveMaskedEmail(email: unknown): string {
    const value = String(email || '').trim().toLowerCase();
    if (!isMaskedEmail(value)) return value;
    const hash = value.slice(0, value.indexOf(MASKED_EMAIL_SUFFIX));
    if (!hash) return value;

    const candidates = new Set<string>();
    userStore.getAll().forEach((user: any) => {
        const emailValue = String(user?.email || '').trim().toLowerCase();
        const subscriptionEmail = String(user?.subscriptionEmail || '').trim().toLowerCase();
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

function resolveAccessUserInfo(email: unknown): { subscriptionEmail: string; userEmail: string; username: string; userLabel: string; userKey: string } {
    const subscriptionEmail = resolveMaskedEmail(email);
    const user = userStore.getBySubscriptionEmail(subscriptionEmail)
        || userStore.getByEmail(subscriptionEmail)
        || null;
    const username = String(user?.username || '').trim();
    const userEmail = String(user?.email || user?.subscriptionEmail || subscriptionEmail).trim().toLowerCase();
    const userLabel = username || userEmail || subscriptionEmail;
    const userKey = String(user?.id || '').trim() || username.toLowerCase() || userEmail || subscriptionEmail;

    return {
        subscriptionEmail,
        userEmail,
        username,
        userLabel,
        userKey,
    };
}

class AuditStore {
    events: any[];
    subscriptionAccess: any[];

    constructor() {
        ensureDataDir();
        this.events = loadArray(AUDIT_EVENTS_FILE);
        this.subscriptionAccess = loadArray(SUB_ACCESS_FILE);
        this._pruneExpired();
    }

    _retentionMs(): number {
        const days = toPositiveInt(systemSettingsStore.getAudit().retentionDays, toPositiveInt(config.audit?.retentionDays, 365));
        return days * 24 * 60 * 60 * 1000;
    }

    _maxPageSize(): number {
        return toPositiveInt(systemSettingsStore.getAudit().maxPageSize, toPositiveInt(config.audit?.maxPageSize, 200));
    }

    _mirrorSnapshot(): void {
        mirrorStoreSnapshot('audit', this.exportState(), { redact: false });
    }

    _pruneExpired(): void {
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
    }: any): any {
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
            || safeDetails?.subscriptionEmail
            || req?.params?.email
            || ''
        ).trim().toLowerCase();

        const entry = {
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            eventType: String(event || 'unknown'),
            actor: req?.user?.username || req?.user?.userId || 'anonymous',
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
        clientIp = '',
        proxyIp = '',
        ipSource = '',
        cfCountry = '',
        userAgent = '',
        status = 'denied',
        reason = '',
        serverId = '',
        mode = 'auto',
        format = 'encoded',
    }: any = {}): any {
        this._pruneExpired();
        const entry = {
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            email: String(email || '').trim().toLowerCase(),
            tokenId: String(tokenId || '').trim(),
            clientIp: String(clientIp || ip || 'unknown').trim(),
            proxyIp: String(proxyIp || '').trim(),
            ipSource: String(ipSource || '').trim(),
            cfCountry: String(cfCountry || '').trim().toUpperCase(),
            ip: String(clientIp || ip || 'unknown').trim(),
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

    queryEvents(filters: any = {}): any {
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

    getEventById(id: string): any {
        return this.events.find((item) => item.id === id) || null;
    }

    _normalizeSubscriptionRange(filters: any = {}): { fromIso: string | null; toIso: string | null } {
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

    _filterSubscriptionAccess(filters: any = {}): { rows: any[]; fromIso: string | null; toIso: string | null } {
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
            rows = rows.filter((item) => {
                const identity = resolveAccessUserInfo(item.email);
                return [
                    identity.userLabel,
                    identity.username,
                    identity.userEmail,
                    identity.subscriptionEmail,
                ].some((candidate) => String(candidate || '').toLowerCase().includes(email));
            });
        }
        if (tokenId) {
            rows = rows.filter((item) => String(item.tokenId || '').includes(tokenId));
        }
        if (status) {
            rows = rows.filter((item) => String(item.status || '').toLowerCase() === status);
        }
        if (ip) {
            rows = rows.filter((item) => {
                const candidateIp = String(item.clientIp || item.ip || '');
                return candidateIp.includes(ip);
            });
        }
        if (serverId) {
            rows = rows.filter((item) => String(item.serverId || '') === serverId);
        }

        return { rows, fromIso, toIso };
    }

    querySubscriptionAccess(filters: any = {}): any {
        const page = toPositiveInt(filters.page, 1);
        const pageSize = Math.min(toPositiveInt(filters.pageSize, 50), this._maxPageSize());
        const { rows, fromIso, toIso } = this._filterSubscriptionAccess(filters);

        const statusBreakdown = rows.reduce((acc, item) => {
            const key = String(item.status || 'unknown');
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const ipCounter = rows.reduce((acc, item) => {
            const key = String(item.clientIp || item.ip || 'unknown').trim() || 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const uniqueIpCount = Object.keys(ipCounter).length;
        const topIps = Object.entries(ipCounter)
            .map(([entryIp, count]) => ({ ip: entryIp, count: count as number }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const total = rows.length;
        const start = (page - 1) * pageSize;
        const items = rows.slice(start, start + pageSize).map((item) => {
            const identity = resolveAccessUserInfo(item.email);
            const rawClientIp = String(item.clientIp || '').trim();
            const rawIp = String(item.ip || '').trim();
            const rawUserAgent = String(item.userAgent || '').trim();
            const clientIpMasked = isMaskedIp(rawClientIp);
            const ipMasked = isMaskedIp(rawIp);
            const userAgentMasked = isMaskedUserAgent(rawUserAgent);
            const emailMasked = isMaskedEmail(item.email);
            return {
                ...item,
                email: identity.subscriptionEmail,
                username: identity.username,
                userEmail: identity.userEmail,
                userLabel: identity.userLabel,
                clientIp: clientIpMasked ? '' : rawClientIp,
                ip: ipMasked ? '' : rawIp,
                ipMasked: clientIpMasked || ipMasked,
                userAgent: userAgentMasked ? '' : rawUserAgent,
                userAgentMasked,
                emailMasked,
                legacyRedacted: clientIpMasked || ipMasked || userAgentMasked || emailMasked,
            };
        });

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

    summarizeSubscriptionAccess(filters: any = {}): any {
        const { rows, fromIso, toIso } = this._filterSubscriptionAccess(filters);
        const total = rows.length;
        const uniqueTokens = new Set(rows.map((item) => String(item.tokenId || '').trim()).filter(Boolean)).size;
        const uniqueUsers = new Set(rows.map((item) => resolveAccessUserInfo(item.email).userKey).filter(Boolean)).size;
        const ipCounter = rows.reduce((acc, item) => {
            const key = String(item.clientIp || item.ip || 'unknown').trim() || 'unknown';
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
                .map(([ip, count]) => ({ ip, count: count as number }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
        };
    }

    exportState(): any {
        return {
            events: this.events,
            subscriptionAccess: this.subscriptionAccess,
        };
    }

    clearEvents(): void {
        this.events = [];
        saveArray(AUDIT_EVENTS_FILE, this.events);
        this._mirrorSnapshot();
    }

    clearSubscriptionAccess(): void {
        this.subscriptionAccess = [];
        saveArray(SUB_ACCESS_FILE, this.subscriptionAccess);
        this._mirrorSnapshot();
    }

    importState(snapshot: any = {}): void {
        if (!snapshot || !Array.isArray(snapshot?.events) || !Array.isArray(snapshot?.subscriptionAccess)) {
            throw new Error('Invalid snapshot format for AuditStore: events or subscriptionAccess array is missing');
        }
        this.events = snapshot.events;
        this.subscriptionAccess = snapshot.subscriptionAccess;
        this._pruneExpired();
    }

    _save(): Promise<[void, void]> {
        const p1 = saveArray(AUDIT_EVENTS_FILE, this.events);
        const p2 = saveArray(SUB_ACCESS_FILE, this.subscriptionAccess);
        this._mirrorSnapshot();
        return Promise.all([p1, p2]);
    }
}

const auditStore = new AuditStore();
export default auditStore;
