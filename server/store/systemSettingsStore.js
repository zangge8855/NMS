import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const SETTINGS_FILE = path.join(config.dataDir, 'system_settings.json');

const ALLOWED_KEYS = {
    site: new Set([
        'accessPath',
        'camouflageEnabled',
        'camouflageTemplate',
        'camouflageTitle',
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
    telegram: new Set([
        'enabled',
        'botToken',
        'clearBotToken',
        'chatId',
        'commandMenuEnabled',
        'opsDigestIntervalMinutes',
        'dailyDigestIntervalHours',
        'sendDailyBackup',
        'sendSystemStatus',
        'sendSecurityAudit',
        'sendEmergencyAlerts',
    ]),
};

const GEO_PROVIDERS = new Set(['ip_api', 'ipip_myip']);
const CAMOUFLAGE_TEMPLATES = new Set(['corporate', 'nginx', 'blog']);
const RESERVED_SITE_ACCESS_PATHS = ['/api', '/assets', '/ws'];
const LEGACY_AUDIT_IP_GEO_PROVIDER = 'ipip_myip';
const LEGACY_AUDIT_IP_GEO_ENDPOINT = 'http://myip.ipip.net/?ip={ip}';
const DEFAULT_CAMOUFLAGE_TEMPLATE = 'corporate';
const DEFAULT_CAMOUFLAGE_TITLE = 'Edge Precision Systems';
const TELEGRAM_TOKEN_ENC_ALGO = 'aes-256-gcm';
const TELEGRAM_TOKEN_ENC_PREFIX = 'nms-tg:v1';
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

function loadObjectDetailed(file) {
    try {
        if (!fs.existsSync(file)) {
            return {
                value: {},
                error: null,
            };
        }
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return {
            value: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {},
            error: null,
        };
    } catch (error) {
        return {
            value: {},
            error,
        };
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

function normalizeCamouflageTemplate(value, fallback = DEFAULT_CAMOUFLAGE_TEMPLATE) {
    const candidate = String(value || '').trim().toLowerCase();
    return CAMOUFLAGE_TEMPLATES.has(candidate) ? candidate : fallback;
}

function normalizeCamouflageTitle(value, fallback = DEFAULT_CAMOUFLAGE_TITLE) {
    const text = String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return fallback;
    return text.slice(0, 96);
}

function normalizeTelegramChatId(value, fallback = '') {
    const text = String(value || '').trim();
    if (!text) return String(fallback || '').trim();
    return text.replace(/\s+/g, '').slice(0, 160);
}

function maskTelegramTokenPreview(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    if (token.length <= 10) return `${token.slice(0, 3)}...`;
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
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

export class SystemSettingsStore {
    constructor() {
        ensureDataDir();
        const loaded = loadObjectDetailed(SETTINGS_FILE);
        this.settings = this._normalizeSettings(loaded.value);
        this.startupLoadError = loaded.error?.message || '';
        if (loaded.error) {
            console.warn(`Failed to load system settings at startup: ${loaded.error.message}`);
            return;
        }
        try {
            this._save();
        } catch (error) {
            console.warn('Failed to persist system settings at startup:', error.message);
        }
    }

    _credentialSecrets() {
        const primary = String(config.credentials?.secret || '').trim();
        const legacy = Array.isArray(config.credentials?.legacySecrets)
            ? config.credentials.legacySecrets
            : [];
        const jwtSecret = String(config.jwt?.secret || '').trim();
        return Array.from(new Set([primary, ...legacy, jwtSecret].map((item) => String(item || '').trim()).filter(Boolean)));
    }

    _credentialKeyFromSecret(secret) {
        return crypto.createHash('sha256').update(String(secret || '')).digest();
    }

    _credentialKey() {
        const [primary] = this._credentialSecrets();
        return this._credentialKeyFromSecret(primary || config.jwt?.secret || '');
    }

    _credentialKeys() {
        const secrets = this._credentialSecrets();
        if (secrets.length === 0) {
            return [this._credentialKeyFromSecret(config.jwt?.secret || '')];
        }
        return secrets.map((secret) => this._credentialKeyFromSecret(secret));
    }

    _isEncryptedTelegramToken(value) {
        return typeof value === 'string' && value.startsWith(`${TELEGRAM_TOKEN_ENC_PREFIX}:`);
    }

    _encryptTelegramToken(token) {
        const text = String(token || '').trim();
        if (!text) return '';
        if (this._isEncryptedTelegramToken(text)) return text;

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(TELEGRAM_TOKEN_ENC_ALGO, this._credentialKey(), iv);
        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${TELEGRAM_TOKEN_ENC_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    _decryptTelegramTokenDetailed(payload) {
        const text = String(payload || '').trim();
        if (!text) {
            return { value: '', status: 'missing' };
        }
        if (!this._isEncryptedTelegramToken(text)) {
            return { value: text, status: 'plaintext' };
        }

        const parts = text.split(':');
        if (parts.length < 5) {
            return { value: '', status: 'unreadable' };
        }

        const prefix = `${parts[0]}:${parts[1]}`;
        if (prefix !== TELEGRAM_TOKEN_ENC_PREFIX) {
            return { value: '', status: 'unreadable' };
        }

        const ivHex = parts[2];
        const tagHex = parts[3];
        const encryptedHex = parts.slice(4).join(':');
        for (const key of this._credentialKeys()) {
            try {
                const decipher = crypto.createDecipheriv(
                    TELEGRAM_TOKEN_ENC_ALGO,
                    key,
                    Buffer.from(ivHex, 'hex')
                );
                decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
                const decrypted = Buffer.concat([
                    decipher.update(Buffer.from(encryptedHex, 'hex')),
                    decipher.final(),
                ]);
                return {
                    value: decrypted.toString('utf8'),
                    status: 'ok',
                };
            } catch {
                // Try next key.
            }
        }

        return { value: '', status: 'unreadable' };
    }

    _buildPublicTelegram(section = {}) {
        const decrypted = this._decryptTelegramTokenDetailed(section.botTokenEnc);
        const botToken = String(decrypted.value || '').trim();
        return {
            enabled: section.enabled === true,
            botToken: '',
            botTokenConfigured: !!botToken,
            botTokenPreview: maskTelegramTokenPreview(botToken),
            chatId: String(section.chatId || '').trim(),
            commandMenuEnabled: section.commandMenuEnabled === true,
            opsDigestIntervalMinutes: Number(section.opsDigestIntervalMinutes || 0),
            dailyDigestIntervalHours: Number(section.dailyDigestIntervalHours || 0),
            sendDailyBackup: section.sendDailyBackup === true,
            sendSystemStatus: section.sendSystemStatus !== false,
            sendSecurityAudit: section.sendSecurityAudit !== false,
            sendEmergencyAlerts: section.sendEmergencyAlerts !== false,
        };
    }

    _defaults() {
        const maxConcurrency = Math.max(1, Number(config.jobs?.maxConcurrency || 10));
        const defaultConcurrency = Math.min(5, maxConcurrency);
        return {
            site: {
                accessPath: '/',
                camouflageEnabled: false,
                camouflageTemplate: DEFAULT_CAMOUFLAGE_TEMPLATE,
                camouflageTitle: DEFAULT_CAMOUFLAGE_TITLE,
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
            telegram: {
                enabled: false,
                botTokenEnc: '',
                chatId: '',
                commandMenuEnabled: config.telegram?.commandMenuEnabled === true,
                opsDigestIntervalMinutes: 30,
                dailyDigestIntervalHours: 24,
                sendDailyBackup: false,
                sendSystemStatus: true,
                sendSecurityAudit: true,
                sendEmergencyAlerts: true,
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
            camouflageTemplate: normalizeCamouflageTemplate(input.camouflageTemplate, fallback.camouflageTemplate),
            camouflageTitle: normalizeCamouflageTitle(input.camouflageTitle, fallback.camouflageTitle),
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

    _normalizeTelegram(input = {}, fallback) {
        const rawBotToken = String(input.botToken || '').trim();
        const rawBotTokenEnc = String(input.botTokenEnc || '').trim();
        const fallbackBotTokenEnc = String(fallback.botTokenEnc || '').trim();
        const clearBotToken = normalizeBoolean(input.clearBotToken, false);

        let botTokenEnc = fallbackBotTokenEnc;
        if (rawBotToken) {
            botTokenEnc = this._encryptTelegramToken(rawBotToken);
        } else if (clearBotToken) {
            botTokenEnc = '';
        } else if (rawBotTokenEnc) {
            botTokenEnc = rawBotTokenEnc;
        }

        return {
            enabled: normalizeBoolean(input.enabled, fallback.enabled),
            botTokenEnc,
            chatId: normalizeTelegramChatId(input.chatId, fallback.chatId),
            commandMenuEnabled: normalizeBoolean(input.commandMenuEnabled, fallback.commandMenuEnabled),
            opsDigestIntervalMinutes: normalizeInt(input.opsDigestIntervalMinutes, fallback.opsDigestIntervalMinutes, { min: 0, max: 1440 }),
            dailyDigestIntervalHours: normalizeInt(input.dailyDigestIntervalHours, fallback.dailyDigestIntervalHours, { min: 0, max: 168 }),
            sendDailyBackup: normalizeBoolean(input.sendDailyBackup, fallback.sendDailyBackup),
            sendSystemStatus: normalizeBoolean(input.sendSystemStatus, fallback.sendSystemStatus),
            sendSecurityAudit: normalizeBoolean(input.sendSecurityAudit, fallback.sendSecurityAudit),
            sendEmergencyAlerts: normalizeBoolean(input.sendEmergencyAlerts, fallback.sendEmergencyAlerts),
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
        const telegramFallback = mergeSection(defaults.telegram, fallbackRoot.telegram);
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
        const telegramInput = mergeSection(defaults.telegram, input.telegram);
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
            telegram: this._normalizeTelegram(telegramInput, telegramFallback),
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
        const snapshot = safeClone(this.settings) || this._normalizeSettings();
        snapshot.telegram = this._buildPublicTelegram(this.settings?.telegram || {});
        return snapshot;
    }

    getSecurity() {
        return { ...this.settings.security };
    }

    getSite() {
        return { ...this.settings.site };
    }

    getRegistration() {
        return { ...this.settings.registration };
    }

    getJobs() {
        return { ...this.settings.jobs };
    }

    getAudit() {
        return { ...this.settings.audit };
    }

    getSubscription() {
        return { ...this.settings.subscription };
    }

    getAuditIpGeo() {
        return { ...this.settings.auditIpGeo };
    }

    getTelegram() {
        const section = this.settings?.telegram || this._defaults().telegram;
        const decrypted = this._decryptTelegramTokenDetailed(section.botTokenEnc);
        const botToken = String(decrypted.value || '').trim();
        return {
            enabled: section.enabled === true,
            botToken,
            botTokenStatus: decrypted.status,
            botTokenConfigured: !!botToken,
            botTokenPreview: maskTelegramTokenPreview(botToken),
            chatId: String(section.chatId || '').trim(),
            commandMenuEnabled: section.commandMenuEnabled === true,
            opsDigestIntervalMinutes: Number(section.opsDigestIntervalMinutes || 0),
            dailyDigestIntervalHours: Number(section.dailyDigestIntervalHours || 0),
            sendDailyBackup: section.sendDailyBackup === true,
            sendSystemStatus: section.sendSystemStatus !== false,
            sendSecurityAudit: section.sendSecurityAudit !== false,
            sendEmergencyAlerts: section.sendEmergencyAlerts !== false,
        };
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
            telegram: mergeSection(this.settings.telegram, patch.telegram),
            serverOrder: this.settings.serverOrder,
            inboundOrder: this.settings.inboundOrder,
            userOrder: this.settings.userOrder,
            updatedAt: new Date().toISOString(),
        };
        const candidateSiteAccessPath = normalizeSiteAccessPath(candidate.site?.accessPath, '/');
        const candidateCamouflageEnabled = normalizeBoolean(candidate.site?.camouflageEnabled, false);
        if (candidateCamouflageEnabled && candidateSiteAccessPath === '/') {
            throw new Error('site.camouflageEnabled requires a non-root site.accessPath');
        }
        this.settings = this._normalizeSettings(candidate, this.settings);
        if (this.settings.telegram?.enabled === true) {
            const telegram = this.getTelegram();
            if (!telegram.botTokenConfigured) {
                throw new Error('telegram.botToken is required when Telegram alerts are enabled');
            }
            if (!telegram.chatId) {
                throw new Error('telegram.chatId is required when Telegram alerts are enabled');
            }
        }
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
