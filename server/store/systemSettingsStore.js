import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const SETTINGS_FILE = path.join(config.dataDir, 'system_settings.json');

const ALLOWED_KEYS = {
    site: new Set([
        'accessPath',
        'camouflageEnabled',
    ]),
    registration: new Set([
        'inviteOnlyEnabled',
    ]),
    security: new Set([
        'requireHighRiskConfirmation',
        'mediumRiskMinTargets',
        'highRiskMinTargets',
        'riskTokenTtlSeconds',
    ]),
    jobs: new Set([
        'retentionDays',
        'maxPageSize',
        'maxRecords',
        'maxConcurrency',
        'defaultConcurrency',
    ]),
    audit: new Set([
        'retentionDays',
        'maxPageSize',
    ]),
    subscription: new Set([
        'publicBaseUrl',
        'converterBaseUrl',
    ]),
    auditIpGeo: new Set([
        'enabled',
        'provider',
        'endpoint',
        'timeoutMs',
        'cacheTtlSeconds',
    ]),
};

const GEO_PROVIDERS = new Set(['ip_api', 'ipip_myip']);
const RESERVED_SITE_ACCESS_PATHS = ['/api', '/assets', '/ws'];
const LEGACY_AUDIT_IP_GEO_PROVIDER = 'ipip_myip';
const LEGACY_AUDIT_IP_GEO_ENDPOINT = 'http://myip.ipip.net/?ip={ip}';
const MODERN_AUDIT_IP_GEO_PROVIDER = GEO_PROVIDERS.has(String(config.audit?.ipGeo?.provider || '').trim().toLowerCase())
    ? String(config.audit?.ipGeo?.provider || '').trim().toLowerCase()
    : 'ip_api';
const MODERN_AUDIT_IP_GEO_ENDPOINT = String(
    config.audit?.ipGeo?.endpoint || 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN'
).trim() || 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN';

function normalizeId(value) {
    return String(value || '').trim();
}

function compareInboundFallback(a, b) {
    const portDiff = Number(a?.port || 0) - Number(b?.port || 0);
    if (portDiff !== 0) return portDiff;

    const remarkDiff = String(a?.remark || '').localeCompare(String(b?.remark || ''));
    if (remarkDiff !== 0) return remarkDiff;

    const protocolDiff = String(a?.protocol || '').localeCompare(String(b?.protocol || ''));
    if (protocolDiff !== 0) return protocolDiff;

    return normalizeId(a?.id).localeCompare(normalizeId(b?.id));
}

function normalizeInboundOrderMap(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

    const output = {};
    for (const [rawServerId, rawInboundIds] of Object.entries(input)) {
        const serverId = normalizeId(rawServerId);
        if (!serverId || !Array.isArray(rawInboundIds)) continue;

        const inboundIds = Array.from(new Set(
            rawInboundIds
                .map((item) => normalizeId(item))
                .filter(Boolean)
        ));

        if (inboundIds.length > 0) {
            output[serverId] = inboundIds;
        }
    }

    return output;
}

function normalizeIdList(input = []) {
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(
        input
            .map((item) => normalizeId(item))
            .filter(Boolean)
    ));
}

function ensureDataDir() {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function loadObject(file) {
    try {
        if (!fs.existsSync(file)) return {};
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function safeClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function normalizeBoolean(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function normalizeInt(value, fallback, options = {}) {
    const parsed = Number.parseInt(String(value), 10);
    let out = Number.isInteger(parsed) ? parsed : fallback;
    if (Number.isInteger(options.min)) out = Math.max(options.min, out);
    if (Number.isInteger(options.max)) out = Math.min(options.max, out);
    return out;
}

function normalizeSiteAccessPath(value, fallback = '/') {
    const fallbackValue = String(fallback || '/').trim() || '/';
    const text = String(value || '').trim();
    if (!text) return fallbackValue;
    if (/[\s?#]/.test(text)) return fallbackValue;

    const segments = text
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean);

    if (segments.some((item) => item === '.' || item === '..')) {
        return fallbackValue;
    }

    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function isReservedSiteAccessPath(value = '') {
    return RESERVED_SITE_ACCESS_PATHS.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}

function normalizeHttpUrl(value, fallback = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const parsed = new URL(text);
        if (!['http:', 'https:'].includes(parsed.protocol)) return fallback;
        return text;
    } catch {
        const fb = String(fallback || '').trim();
        if (!fb) return '';
        try {
            const parsedFallback = new URL(fb);
            return ['http:', 'https:'].includes(parsedFallback.protocol) ? fb : '';
        } catch {
            return '';
        }
    }
}

function normalizeHttpTemplateUrl(value, fallback = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const probe = text.replaceAll('{ip}', '1.1.1.1');
        const parsed = new URL(probe);
        if (!['http:', 'https:'].includes(parsed.protocol)) return fallback;
        return text;
    } catch {
        const fb = String(fallback || '').trim();
        if (!fb) return '';
        try {
            const probeFallback = fb.replaceAll('{ip}', '1.1.1.1');
            const parsedFallback = new URL(probeFallback);
            return ['http:', 'https:'].includes(parsedFallback.protocol) ? fb : '';
        } catch {
            return '';
        }
    }
}

function mergeSection(base, patch) {
    const next = { ...base };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return next;
    }
    for (const [key, value] of Object.entries(patch)) {
        next[key] = value;
    }
    return next;
}

function shouldUpgradeLegacyAuditIpGeo(provider, endpoint) {
    return String(provider || '').trim().toLowerCase() === LEGACY_AUDIT_IP_GEO_PROVIDER
        && String(endpoint || '').trim() === LEGACY_AUDIT_IP_GEO_ENDPOINT;
}

class SystemSettingsStore {
    constructor() {
        ensureDataDir();
        this.settings = this._normalizeSettings(loadObject(SETTINGS_FILE));
        try {
            this._save();
        } catch (error) {
            console.warn('Failed to persist system settings at startup:', error.message);
        }
    }

    _defaults() {
        const maxConcurrency = Math.max(1, Number(config.jobs?.maxConcurrency || 10));
        const defaultConcurrency = Math.min(5, maxConcurrency);
        return {
            site: {
                accessPath: '/',
                camouflageEnabled: false,
            },
            registration: {
                inviteOnlyEnabled: false,
            },
            security: {
                requireHighRiskConfirmation: true,
                mediumRiskMinTargets: 20,
                highRiskMinTargets: 100,
                riskTokenTtlSeconds: 180,
            },
            jobs: {
                retentionDays: Math.max(1, Number(config.jobs?.retentionDays || 90)),
                maxPageSize: Math.max(20, Number(config.jobs?.maxPageSize || 200)),
                maxRecords: Math.max(100, Number(config.jobs?.maxRecords || 2000)),
                maxConcurrency,
                defaultConcurrency,
            },
            audit: {
                retentionDays: Math.max(1, Number(config.audit?.retentionDays || 365)),
                maxPageSize: Math.max(20, Number(config.audit?.maxPageSize || 200)),
            },
            subscription: {
                publicBaseUrl: String(config.subscription?.publicBaseUrl || '').trim(),
                converterBaseUrl: String(config.subscription?.converter?.baseUrl || '').trim(),
            },
            auditIpGeo: {
                enabled: true,
                provider: MODERN_AUDIT_IP_GEO_PROVIDER,
                endpoint: MODERN_AUDIT_IP_GEO_ENDPOINT,
                timeoutMs: Math.max(200, Number(config.audit?.ipGeo?.timeoutMs || 3000)),
                cacheTtlSeconds: Math.max(30, Number(config.audit?.ipGeo?.cacheTtlSeconds || 21600)),
            },
            serverOrder: [],
            inboundOrder: {},
            userOrder: [],
        };
    }

    _normalizeSecurity(input = {}, fallback) {
        const security = {
            requireHighRiskConfirmation: normalizeBoolean(
                input.requireHighRiskConfirmation,
                fallback.requireHighRiskConfirmation
            ),
            mediumRiskMinTargets: normalizeInt(input.mediumRiskMinTargets, fallback.mediumRiskMinTargets, { min: 2, max: 10000 }),
            highRiskMinTargets: normalizeInt(input.highRiskMinTargets, fallback.highRiskMinTargets, { min: 2, max: 20000 }),
            riskTokenTtlSeconds: normalizeInt(input.riskTokenTtlSeconds, fallback.riskTokenTtlSeconds, { min: 30, max: 1800 }),
        };
        if (security.highRiskMinTargets < security.mediumRiskMinTargets) {
            security.highRiskMinTargets = security.mediumRiskMinTargets;
        }
        return security;
    }

    _normalizeRegistration(input = {}, fallback) {
        return {
            inviteOnlyEnabled: normalizeBoolean(input.inviteOnlyEnabled, fallback.inviteOnlyEnabled),
        };
    }

    _normalizeSite(input = {}, fallback) {
        const accessPath = normalizeSiteAccessPath(input.accessPath, fallback.accessPath);
        return {
            accessPath: isReservedSiteAccessPath(accessPath) ? fallback.accessPath : accessPath,
            camouflageEnabled: normalizeBoolean(input.camouflageEnabled, fallback.camouflageEnabled),
        };
    }

    _normalizeJobs(input = {}, fallback) {
        const jobs = {
            retentionDays: normalizeInt(input.retentionDays, fallback.retentionDays, { min: 1, max: 3650 }),
            maxPageSize: normalizeInt(input.maxPageSize, fallback.maxPageSize, { min: 20, max: 1000 }),
            maxRecords: normalizeInt(input.maxRecords, fallback.maxRecords, { min: 100, max: 50000 }),
            maxConcurrency: normalizeInt(input.maxConcurrency, fallback.maxConcurrency, { min: 1, max: 200 }),
            defaultConcurrency: normalizeInt(input.defaultConcurrency, fallback.defaultConcurrency, { min: 1, max: 200 }),
        };
        if (jobs.defaultConcurrency > jobs.maxConcurrency) {
            jobs.defaultConcurrency = jobs.maxConcurrency;
        }
        return jobs;
    }

    _normalizeAudit(input = {}, fallback) {
        return {
            retentionDays: normalizeInt(input.retentionDays, fallback.retentionDays, { min: 1, max: 3650 }),
            maxPageSize: normalizeInt(input.maxPageSize, fallback.maxPageSize, { min: 20, max: 1000 }),
        };
    }

    _normalizeSubscription(input = {}, fallback) {
        return {
            publicBaseUrl: normalizeHttpUrl(input.publicBaseUrl, fallback.publicBaseUrl),
            converterBaseUrl: normalizeHttpUrl(input.converterBaseUrl, fallback.converterBaseUrl),
        };
    }

    _normalizeAuditIpGeo(input = {}, fallback) {
        let provider = String(input.provider || '').trim().toLowerCase();
        let endpoint = normalizeHttpTemplateUrl(input.endpoint, fallback.endpoint);
        if (shouldUpgradeLegacyAuditIpGeo(provider, endpoint)) {
            provider = MODERN_AUDIT_IP_GEO_PROVIDER;
            endpoint = MODERN_AUDIT_IP_GEO_ENDPOINT;
        }
        return {
            enabled: normalizeBoolean(input.enabled, fallback.enabled),
            provider: GEO_PROVIDERS.has(provider) ? provider : fallback.provider,
            endpoint,
            timeoutMs: normalizeInt(input.timeoutMs, fallback.timeoutMs, { min: 200, max: 10000 }),
            cacheTtlSeconds: normalizeInt(input.cacheTtlSeconds, fallback.cacheTtlSeconds, { min: 30, max: 604800 }),
        };
    }

    _normalizeSettings(input = {}, fallbackSettings = null) {
        const defaults = this._defaults();
        const fallbackRoot = fallbackSettings && typeof fallbackSettings === 'object' && !Array.isArray(fallbackSettings)
            ? fallbackSettings
            : defaults;
        const siteFallback = mergeSection(defaults.site, fallbackRoot.site);
        const registrationFallback = mergeSection(defaults.registration, fallbackRoot.registration);
        const securityFallback = mergeSection(defaults.security, fallbackRoot.security);
        const jobsFallback = mergeSection(defaults.jobs, fallbackRoot.jobs);
        const auditFallback = mergeSection(defaults.audit, fallbackRoot.audit);
        const subscriptionFallback = mergeSection(defaults.subscription, fallbackRoot.subscription);
        const auditIpGeoFallback = mergeSection(defaults.auditIpGeo, fallbackRoot.auditIpGeo);
        const serverOrderFallback = normalizeIdList(fallbackRoot.serverOrder);
        const inboundOrderFallback = normalizeInboundOrderMap(fallbackRoot.inboundOrder);
        const userOrderFallback = normalizeIdList(fallbackRoot.userOrder);

        const siteInput = mergeSection(defaults.site, input.site);
        const registrationInput = mergeSection(defaults.registration, input.registration);
        const securityInput = mergeSection(defaults.security, input.security);
        const jobsInput = mergeSection(defaults.jobs, input.jobs);
        const auditInput = mergeSection(defaults.audit, input.audit);
        const subscriptionInput = mergeSection(defaults.subscription, input.subscription);
        const auditIpGeoInput = mergeSection(defaults.auditIpGeo, input.auditIpGeo);
        const serverOrderInput = normalizeIdList(input.serverOrder);
        const inboundOrderInput = normalizeInboundOrderMap(input.inboundOrder);
        const userOrderInput = normalizeIdList(input.userOrder);

        return {
            site: this._normalizeSite(siteInput, siteFallback),
            registration: this._normalizeRegistration(registrationInput, registrationFallback),
            security: this._normalizeSecurity(securityInput, securityFallback),
            jobs: this._normalizeJobs(jobsInput, jobsFallback),
            audit: this._normalizeAudit(auditInput, auditFallback),
            subscription: this._normalizeSubscription(subscriptionInput, subscriptionFallback),
            auditIpGeo: this._normalizeAuditIpGeo(auditIpGeoInput, auditIpGeoFallback),
            serverOrder: serverOrderInput.length > 0 ? serverOrderInput : serverOrderFallback,
            inboundOrder: Object.keys(inboundOrderInput).length > 0 ? inboundOrderInput : inboundOrderFallback,
            userOrder: userOrderInput.length > 0 ? userOrderInput : userOrderFallback,
            updatedAt: String(input.updatedAt || '').trim() || new Date().toISOString(),
        };
    }

    _save() {
        saveObjectAtomic(SETTINGS_FILE, this.settings);
        mirrorStoreSnapshot('system_settings', this.exportState());
    }

    _assertAllowedPayload(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new Error('settings payload must be an object');
        }

        for (const [section, sectionValue] of Object.entries(patch)) {
            if (!ALLOWED_KEYS[section]) {
                throw new Error(`Unsupported settings section: ${section}`);
            }
            if (!sectionValue || typeof sectionValue !== 'object' || Array.isArray(sectionValue)) {
                throw new Error(`Section "${section}" must be an object`);
            }
            const allowed = ALLOWED_KEYS[section];
            for (const key of Object.keys(sectionValue)) {
                if (!allowed.has(key)) {
                    throw new Error(`Unsupported settings key: ${section}.${key}`);
                }
            }
        }
    }

    getAll() {
        return safeClone(this.settings) || this._normalizeSettings();
    }

    getSecurity() {
        return this.getAll().security;
    }

    getSite() {
        return this.getAll().site;
    }

    getRegistration() {
        return this.getAll().registration;
    }

    getJobs() {
        return this.getAll().jobs;
    }

    getAudit() {
        return this.getAll().audit;
    }

    getSubscription() {
        return this.getAll().subscription;
    }

    getAuditIpGeo() {
        return this.getAll().auditIpGeo;
    }

    getInboundOrder(serverId = '') {
        const all = this.getAll().inboundOrder || {};
        const normalizedServerId = normalizeId(serverId);
        if (!normalizedServerId) return all;
        return Array.isArray(all[normalizedServerId]) ? [...all[normalizedServerId]] : [];
    }

    getServerOrder() {
        return [...(this.getAll().serverOrder || [])];
    }

    getUserOrder() {
        return [...(this.getAll().userOrder || [])];
    }

    sortInboundList(serverId, inbounds = []) {
        const rows = Array.isArray(inbounds) ? [...inbounds] : [];
        const order = this.getInboundOrder(serverId);
        const orderIndex = new Map(order.map((id, index) => [normalizeId(id), index]));

        return rows.sort((left, right) => {
            const leftIndex = orderIndex.get(normalizeId(left?.id));
            const rightIndex = orderIndex.get(normalizeId(right?.id));
            const leftKnown = Number.isInteger(leftIndex);
            const rightKnown = Number.isInteger(rightIndex);

            if (leftKnown && rightKnown) return leftIndex - rightIndex;
            if (leftKnown) return -1;
            if (rightKnown) return 1;
            return compareInboundFallback(left, right);
        });
    }

    setInboundOrder(serverId, inboundIds = []) {
        const normalizedServerId = normalizeId(serverId);
        if (!normalizedServerId) {
            throw new Error('serverId is required');
        }
        if (!Array.isArray(inboundIds)) {
            throw new Error('inboundIds must be an array');
        }

        const nextOrder = Array.from(new Set(
            inboundIds
                .map((item) => normalizeId(item))
                .filter(Boolean)
        ));
        const nextInboundOrder = {
            ...(this.settings.inboundOrder || {}),
        };

        if (nextOrder.length > 0) {
            nextInboundOrder[normalizedServerId] = nextOrder;
        } else {
            delete nextInboundOrder[normalizedServerId];
        }

        this.settings = this._normalizeSettings({
            ...this.settings,
            inboundOrder: nextInboundOrder,
            updatedAt: new Date().toISOString(),
        }, this.settings);
        this._save();
        return this.getInboundOrder(normalizedServerId);
    }

    setUserOrder(userIds = []) {
        if (!Array.isArray(userIds)) {
            throw new Error('userIds must be an array');
        }

        this.settings = this._normalizeSettings({
            ...this.settings,
            userOrder: normalizeIdList(userIds),
            updatedAt: new Date().toISOString(),
        }, this.settings);
        this._save();
        return this.getUserOrder();
    }

    setServerOrder(serverIds = []) {
        if (!Array.isArray(serverIds)) {
            throw new Error('serverIds must be an array');
        }

        this.settings = this._normalizeSettings({
            ...this.settings,
            serverOrder: normalizeIdList(serverIds),
            updatedAt: new Date().toISOString(),
        }, this.settings);
        this._save();
        return this.getServerOrder();
    }

    update(patch = {}) {
        this._assertAllowedPayload(patch);
        if (patch.site && Object.prototype.hasOwnProperty.call(patch.site, 'accessPath')) {
            const normalizedAccessPath = normalizeSiteAccessPath(patch.site.accessPath, '');
            if (!normalizedAccessPath) {
                throw new Error('site.accessPath must be a valid path');
            }
            if (isReservedSiteAccessPath(normalizedAccessPath)) {
                throw new Error('site.accessPath cannot use /api, /assets or /ws');
            }
        }
        const candidate = {
            site: mergeSection(this.settings.site, patch.site),
            registration: mergeSection(this.settings.registration, patch.registration),
            security: mergeSection(this.settings.security, patch.security),
            jobs: mergeSection(this.settings.jobs, patch.jobs),
            audit: mergeSection(this.settings.audit, patch.audit),
            subscription: mergeSection(this.settings.subscription, patch.subscription),
            auditIpGeo: mergeSection(this.settings.auditIpGeo, patch.auditIpGeo),
            serverOrder: this.settings.serverOrder,
            inboundOrder: this.settings.inboundOrder,
            userOrder: this.settings.userOrder,
            updatedAt: new Date().toISOString(),
        };
        this.settings = this._normalizeSettings(candidate, this.settings);
        this._save();
        return this.getAll();
    }

    exportState() {
        return {
            settings: this.settings,
        };
    }

    importState(snapshot = {}) {
        this.settings = this._normalizeSettings(snapshot?.settings || {}, this.settings);
    }
}

const systemSettingsStore = new SystemSettingsStore();
export default systemSettingsStore;
