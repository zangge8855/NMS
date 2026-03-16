import systemSettingsStore from '../store/systemSettingsStore.js';
import ipGeoResolver, { normalizeIpAddress } from './ipGeoResolver.js';
import ipIspResolver from './ipIspResolver.js';

const MASKED_IP_PATTERN = /^ip_[0-9a-f]{16}$/i;
const MASKED_UA_PATTERN = /^ua_[0-9a-f]{16}$/i;

export function normalizeAuditIp(value) {
    const text = String(value || '').trim();
    if (!text || text === 'unknown') return '';
    if (MASKED_IP_PATTERN.test(text)) return '';
    return normalizeIpAddress(text) || text;
}

export function normalizeAuditUserAgent(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (MASKED_UA_PATTERN.test(text)) return '';
    return text;
}

function configureResolvers(deps = {}) {
    const settingsRepository = deps.systemSettingsRepository || systemSettingsStore;
    const geoResolver = deps.ipGeoResolver || ipGeoResolver;
    const ispResolver = deps.ipIspResolver || ipIspResolver;
    const auditIpGeo = typeof settingsRepository.getAuditIpGeo === 'function'
        ? settingsRepository.getAuditIpGeo()
        : {};

    if (typeof geoResolver.configure === 'function') {
        geoResolver.configure(auditIpGeo);
    }
    if (typeof ispResolver.configure === 'function') {
        ispResolver.configure(auditIpGeo);
    }

    return { geoResolver, ispResolver };
}

export async function enrichAuditEvents(items = [], deps = {}) {
    const rows = Array.isArray(items) ? items : [];
    if (rows.length === 0) return [];

    const { geoResolver, ispResolver } = configureResolvers(deps);
    const geoEnabled = typeof geoResolver.isEnabled === 'function' && geoResolver.isEnabled();
    const ispEnabled = typeof ispResolver.isEnabled === 'function' && ispResolver.isEnabled();
    const ipCandidates = rows.map((item) => normalizeAuditIp(item?.ip)).filter(Boolean);

    let geoMap = new Map();
    let ispMap = new Map();
    if (geoEnabled) {
        try {
            geoMap = await geoResolver.lookupMany(ipCandidates);
        } catch {
            geoMap = new Map();
        }
    }
    if (ispEnabled) {
        try {
            ispMap = await ispResolver.lookupMany(ipCandidates);
        } catch {
            ispMap = new Map();
        }
    }

    return rows.map((item) => {
        const rawIp = String(item?.ip || '').trim();
        const rawUserAgent = String(item?.details?.userAgent || item?.userAgent || '').trim();
        const ip = normalizeAuditIp(rawIp);
        const userAgent = normalizeAuditUserAgent(rawUserAgent);

        return {
            ...item,
            ip,
            ipMasked: !ip && MASKED_IP_PATTERN.test(rawIp),
            userAgent,
            userAgentMasked: !userAgent && MASKED_UA_PATTERN.test(rawUserAgent),
            ipLocation: geoEnabled ? geoResolver.pickFromMap(geoMap, ip) : String(item?.ipLocation || ''),
            ipCarrier: ispEnabled ? ispResolver.pickFromMap(ispMap, ip) : String(item?.ipCarrier || ''),
        };
    });
}

export async function enrichAuditEvent(item, deps = {}) {
    if (!item || typeof item !== 'object') return null;
    const [enriched] = await enrichAuditEvents([item], deps);
    return enriched || null;
}
