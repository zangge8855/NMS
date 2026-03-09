import config from '../config.js';
import ipGeoResolver from '../lib/ipGeoResolver.js';
import { createHttpError } from '../lib/httpError.js';
import auditRepository from '../repositories/auditRepository.js';
import subscriptionTokenRepository from '../repositories/subscriptionTokenRepository.js';
import systemSettingsRepository from '../repositories/systemSettingsRepository.js';

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function resolveTtlDays(value) {
    const requested = toPositiveInt(value, config.subscription.defaultTtlDays);
    return Math.max(1, Math.min(requested, config.subscription.maxTtlDays));
}

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

async function enrichAccessPayloadWithGeo(payload, includeGeo = true, deps = {}) {
    const settingsRepository = deps.systemSettingsRepository || systemSettingsRepository;
    const resolver = deps.ipGeoResolver || ipGeoResolver;
    const base = payload && typeof payload === 'object' ? payload : {};
    const items = Array.isArray(base.items) ? base.items : [];
    const topIps = Array.isArray(base.topIps) ? base.topIps : [];

    resolver.configure(settingsRepository.getAuditIpGeo());
    const geoEnabled = includeGeo && resolver.isEnabled();

    let map = new Map();
    if (geoEnabled) {
        try {
            map = await resolver.lookupMany([
                ...items.map((item) => item?.clientIp || item?.ip),
                ...topIps.map((item) => item?.ip),
            ]);
        } catch {
            map = new Map();
        }
    }

    return {
        ...base,
        items: items.map((item) => ({
            ...item,
            ipLocation: geoEnabled ? resolver.pickFromMap(map, item?.clientIp || item?.ip) : '',
        })),
        topIps: topIps.map((item) => ({
            ...item,
            ipLocation: geoEnabled ? resolver.pickFromMap(map, item?.ip) : '',
        })),
        geo: {
            ...resolver.metadata(),
            enabled: geoEnabled,
        },
    };
}

async function summarizeSubscriptionAccess(filters = {}, options = {}, deps = {}) {
    const repository = deps.auditRepository || auditRepository;
    const summary = repository.summarizeSubscriptionAccess(filters);
    return enrichAccessPayloadWithGeo(summary, options.includeGeo !== false, deps);
}

async function querySubscriptionAccess(filters = {}, options = {}, deps = {}) {
    const repository = deps.auditRepository || auditRepository;
    const result = repository.querySubscriptionAccess(filters);
    return enrichAccessPayloadWithGeo(result, options.includeGeo !== false, deps);
}

function listSubscriptionTokens(email, deps = {}) {
    const repository = deps.subscriptionTokenRepository || subscriptionTokenRepository;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        throw createHttpError(400, 'Email is required');
    }
    return {
        email: normalizedEmail,
        active: repository.countActiveByEmail(normalizedEmail),
        limit: config.subscription.maxActiveTokensPerUser,
        tokens: repository.listByEmail(normalizedEmail, {
            includeRevoked: true,
            includeExpired: true,
        }),
    };
}

function issueSubscriptionToken(email, input = {}, deps = {}) {
    const repository = deps.subscriptionTokenRepository || subscriptionTokenRepository;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        throw createHttpError(400, 'Email is required');
    }

    const issued = repository.issue(normalizedEmail, {
        name: String(input.name || '').trim(),
        ttlDays: resolveTtlDays(input.ttlDays),
        createdBy: input.createdBy || 'admin',
    });

    return {
        email: normalizedEmail,
        name: String(input.name || '').trim(),
        ttlDays: resolveTtlDays(input.ttlDays),
        tokenId: issued.tokenId,
        token: issued.token,
        metadata: issued.metadata,
        urls: typeof input.buildUrls === 'function'
            ? input.buildUrls(issued.token)
            : {},
    };
}

function revokeSubscriptionTokens(email, input = {}, deps = {}) {
    const repository = deps.subscriptionTokenRepository || subscriptionTokenRepository;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        throw createHttpError(400, 'Email is required');
    }

    const reason = String(input.reason || 'manual-revoke').trim() || 'manual-revoke';
    if (normalizeBoolean(input.revokeAll, false)) {
        return {
            email: normalizedEmail,
            revokeAll: true,
            revoked: repository.revokeAllByEmail(normalizedEmail, reason),
            reason,
        };
    }

    const tokenId = String(input.tokenId || '').trim();
    if (!tokenId) {
        throw createHttpError(400, 'tokenId is required');
    }

    const revoked = repository.revoke(normalizedEmail, tokenId, reason);
    if (!revoked) {
        throw createHttpError(404, 'Token not found');
    }

    return {
        email: normalizedEmail,
        revokeAll: false,
        tokenId,
        revoked,
        reason,
    };
}

export {
    issueSubscriptionToken,
    listSubscriptionTokens,
    querySubscriptionAccess,
    revokeSubscriptionTokens,
    summarizeSubscriptionAccess,
};
