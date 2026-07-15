import systemSettingsStore from '../store/systemSettingsStore.js';
import ipGeoResolver from './ipGeoResolver.js';
import ipIspResolver from './ipIspResolver.js';

function looksLikeIp(value) {
    const text = String(value || '').trim();
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(text) || text.includes(':');
}

function extractIp(row, fallback = '') {
    if (typeof row === 'string') return row.trim();
    if (!row || typeof row !== 'object' || Array.isArray(row)) return String(fallback || '').trim();
    return [row.ip, row.clientIp, row.address, row.host, row.value, row.remoteAddr]
        .map((value) => String(value || '').trim())
        .find(Boolean) || String(fallback || '').trim();
}

function buildLookupMap(rows) {
    return rows
        .map((row) => extractIp(row))
        .filter(looksLikeIp);
}

async function resolveLabels(ips, deps = {}) {
    const settings = deps.systemSettingsStore || systemSettingsStore;
    const geo = deps.ipGeoResolver || ipGeoResolver;
    const isp = deps.ipIspResolver || ipIspResolver;
    geo.configure(settings.getAuditIpGeo());
    if (typeof isp.configure === 'function') isp.configure(settings.getAuditIpGeo());

    const geoEnabled = geo.isEnabled();
    const ispEnabled = typeof isp.isEnabled === 'function' && isp.isEnabled();
    const geoMap = geoEnabled ? await geo.lookupMany(ips).catch(() => new Map()) : new Map();
    const ispMap = ispEnabled ? await isp.lookupMany(ips).catch(() => new Map()) : new Map();

    return { geo, isp, geoEnabled, ispEnabled, geoMap, ispMap };
}

function annotateRow(row, fallbackIp, labels) {
    const ip = extractIp(row, fallbackIp);
    if (!ip || !looksLikeIp(ip)) return row;
    const next = typeof row === 'object' && row !== null && !Array.isArray(row)
        ? { ...row }
        : { ip };
    if (!next.ip) next.ip = ip;
    next.ipLocation = labels.geoEnabled ? labels.geo.pickFromMap(labels.geoMap, ip) : '';
    next.ipCarrier = labels.ispEnabled ? labels.isp.pickFromMap(labels.ispMap, ip) : '';
    return next;
}

export async function enrichClientIpPayload(payload, deps = {}) {
    if (payload === null || payload === undefined) return payload;

    if (Array.isArray(payload)) {
        const rows = payload.map((row) => row);
        const labels = await resolveLabels(buildLookupMap(rows), deps);
        return rows.map((row) => annotateRow(row, '', labels));
    }

    if (typeof payload !== 'object') return payload;

    if (Array.isArray(payload.items)) {
        return {
            ...payload,
            items: await enrichClientIpPayload(payload.items, deps),
        };
    }
    if (Array.isArray(payload.ips)) {
        return {
            ...payload,
            ips: await enrichClientIpPayload(payload.ips, deps),
        };
    }

    const keyedRows = Object.entries(payload).filter(([key]) => looksLikeIp(key));
    if (keyedRows.length > 0) {
        const labels = await resolveLabels(keyedRows.map(([key]) => key), deps);
        return {
            ...payload,
            ...Object.fromEntries(keyedRows.map(([key, value]) => [key, annotateRow(value, key, labels)])),
        };
    }

    const ip = extractIp(payload);
    if (ip && looksLikeIp(ip)) {
        const labels = await resolveLabels([ip], deps);
        return annotateRow(payload, ip, labels);
    }

    return payload;
}
