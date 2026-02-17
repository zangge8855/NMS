import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { mirrorStoreSnapshot, shouldWriteFile } from './dbMirror.js';

const SETTINGS_FILE = path.join(config.dataDir, 'system_settings.json');

const ALLOWED_KEYS = {
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
        'converterClashConfigUrl',
        'converterSingboxConfigUrl',
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

function saveObjectAtomic(file, data) {
    const content = JSON.stringify(data, null, 2);
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    if (!shouldWriteFile()) return;
    try {
        fs.writeFileSync(tempFile, content, 'utf8');
        fs.renameSync(tempFile, file);
        return;
    } catch {
        // Fallback: renameSync may fail on Windows due to file locks;
        // fall back to direct write.
        fs.writeFileSync(file, content, 'utf8');
    } finally {
        if (fs.existsSync(tempFile)) {
            try {
                fs.rmSync(tempFile, { force: true });
            } catch {
                // Best-effort cleanup.
            }
        }
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
                converterClashConfigUrl: String(config.subscription?.converter?.clashConfigUrl || '').trim(),
                converterSingboxConfigUrl: String(config.subscription?.converter?.singboxConfigUrl || '').trim(),
            },
            auditIpGeo: {
                enabled: true,
                provider: GEO_PROVIDERS.has(String(config.audit?.ipGeo?.provider || '').trim().toLowerCase())
                    ? String(config.audit?.ipGeo?.provider || '').trim().toLowerCase()
                    : 'ip_api',
                endpoint: String(config.audit?.ipGeo?.endpoint || 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN').trim() || 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN',
                timeoutMs: Math.max(200, Number(config.audit?.ipGeo?.timeoutMs || 3000)),
                cacheTtlSeconds: Math.max(30, Number(config.audit?.ipGeo?.cacheTtlSeconds || 21600)),
            },
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
            converterClashConfigUrl: normalizeHttpUrl(input.converterClashConfigUrl, fallback.converterClashConfigUrl),
            converterSingboxConfigUrl: normalizeHttpUrl(input.converterSingboxConfigUrl, fallback.converterSingboxConfigUrl),
        };
    }

    _normalizeAuditIpGeo(input = {}, fallback) {
        const provider = String(input.provider || '').trim().toLowerCase();
        return {
            enabled: normalizeBoolean(input.enabled, fallback.enabled),
            provider: GEO_PROVIDERS.has(provider) ? provider : fallback.provider,
            endpoint: normalizeHttpTemplateUrl(input.endpoint, fallback.endpoint),
            timeoutMs: normalizeInt(input.timeoutMs, fallback.timeoutMs, { min: 200, max: 10000 }),
            cacheTtlSeconds: normalizeInt(input.cacheTtlSeconds, fallback.cacheTtlSeconds, { min: 30, max: 604800 }),
        };
    }

    _normalizeSettings(input = {}, fallbackSettings = null) {
        const defaults = this._defaults();
        const fallbackRoot = fallbackSettings && typeof fallbackSettings === 'object' && !Array.isArray(fallbackSettings)
            ? fallbackSettings
            : defaults;
        const securityFallback = mergeSection(defaults.security, fallbackRoot.security);
        const jobsFallback = mergeSection(defaults.jobs, fallbackRoot.jobs);
        const auditFallback = mergeSection(defaults.audit, fallbackRoot.audit);
        const subscriptionFallback = mergeSection(defaults.subscription, fallbackRoot.subscription);
        const auditIpGeoFallback = mergeSection(defaults.auditIpGeo, fallbackRoot.auditIpGeo);

        const securityInput = mergeSection(defaults.security, input.security);
        const jobsInput = mergeSection(defaults.jobs, input.jobs);
        const auditInput = mergeSection(defaults.audit, input.audit);
        const subscriptionInput = mergeSection(defaults.subscription, input.subscription);
        const auditIpGeoInput = mergeSection(defaults.auditIpGeo, input.auditIpGeo);

        return {
            security: this._normalizeSecurity(securityInput, securityFallback),
            jobs: this._normalizeJobs(jobsInput, jobsFallback),
            audit: this._normalizeAudit(auditInput, auditFallback),
            subscription: this._normalizeSubscription(subscriptionInput, subscriptionFallback),
            auditIpGeo: this._normalizeAuditIpGeo(auditIpGeoInput, auditIpGeoFallback),
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

    update(patch = {}) {
        this._assertAllowedPayload(patch);
        const candidate = {
            security: mergeSection(this.settings.security, patch.security),
            jobs: mergeSection(this.settings.jobs, patch.jobs),
            audit: mergeSection(this.settings.audit, patch.audit),
            subscription: mergeSection(this.settings.subscription, patch.subscription),
            auditIpGeo: mergeSection(this.settings.auditIpGeo, patch.auditIpGeo),
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
