import { Router } from 'express';
import crypto from 'crypto';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import serverStore from '../store/serverStore.js';
import subscriptionTokenStore from '../store/subscriptionTokenStore.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import config from '../config.js';
import auditStore from '../store/auditStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import userStore from '../store/userStore.js';
import { canAccessSubscriptionEmail } from '../lib/subscriptionAccess.js';
import ipGeoResolver from '../lib/ipGeoResolver.js';
import { resolveClientIpDetails } from '../lib/requestIp.js';
import { normalizeBoolean, parseJsonObjectLike } from '../lib/normalize.js';
import { issueSubscriptionToken, listSubscriptionTokens, querySubscriptionAccess, revokeSubscriptionTokens, summarizeSubscriptionAccess } from '../services/subscriptionAuditService.js';
import systemSettingsStore from '../store/systemSettingsStore.js';

const router = Router();

/**
 * 订阅邮件访问控制中间件。
 * admin 可访问所有邮件的订阅;
 * user 仅可访问与自己身份绑定的邮箱/用户名。
 */
function ensureEmailAccess(req, res, next) {
    const requestedEmail = normalizeEmail(req.params.email);
    const allowed = canAccessSubscriptionEmail(req.user, requestedEmail, {
        findUserById: (id) => userStore.getById(id),
    });
    if (!allowed) {
        return res.status(403).json({
            success: false,
            msg: '权限不足: 只能查看自己的订阅链接',
        });
    }
    next();
}

const RECONSTRUCTED_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const LINK_PATTERN = /^(vmess|vless|trojan|ss|hy2|hysteria2|tuic|socks|http):\/\//i;
const MODE_SET = new Set(['auto', 'native', 'reconstructed']);
const POLICY_SCOPE_SET = new Set(['all', 'selected', 'none']);

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeMode(mode) {
    const normalized = String(mode || 'auto').trim().toLowerCase();
    return MODE_SET.has(normalized) ? normalized : 'auto';
}

function normalizeServerId(serverId) {
    const value = String(serverId || '').trim();
    return value || '';
}

function normalizePolicyScopeMode(mode, selectedItems = []) {
    const hasSelected = Array.isArray(selectedItems) && selectedItems.length > 0;
    const fallback = hasSelected ? 'selected' : 'all';
    const text = String(mode || '').trim().toLowerCase();
    if (!text) return fallback;
    if (!POLICY_SCOPE_SET.has(text)) return fallback;
    if (text === 'selected' && !hasSelected) return 'none';
    return text;
}

function signEmail(email) {
    return crypto
        .createHmac('sha256', config.jwt.secret)
        .update(normalizeEmail(email))
        .digest('hex');
}

function verifyEmailSig(email, sig) {
    try {
        const expected = signEmail(email);
        if (typeof sig !== 'string' || sig.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'));
    } catch {
        return false;
    }
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

function shouldIncludeGeoLookup(req) {
    const raw = req?.query?.withGeo;
    if (raw === undefined || raw === null || raw === '') return true;
    return normalizeBoolean(raw, true);
}

async function enrichAccessPayloadWithGeo(payload, includeGeo = true) {
    const base = payload && typeof payload === 'object' ? payload : {};
    const items = Array.isArray(base.items) ? base.items : [];
    const topIps = Array.isArray(base.topIps) ? base.topIps : [];

    ipGeoResolver.configure(systemSettingsStore.getAuditIpGeo());
    const geoEnabled = includeGeo && ipGeoResolver.isEnabled();

    let map = new Map();
    if (geoEnabled) {
        try {
            map = await ipGeoResolver.lookupMany([
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
            ipLocation: geoEnabled ? ipGeoResolver.pickFromMap(map, item?.clientIp || item?.ip) : '',
        })),
        topIps: topIps.map((item) => ({
            ...item,
            ipLocation: geoEnabled ? ipGeoResolver.pickFromMap(map, item?.ip) : '',
        })),
        geo: {
            ...ipGeoResolver.metadata(),
            enabled: geoEnabled,
        },
    };
}

function appendQuery(url, query = {}) {
    const entries = Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
    if (entries.length === 0) return url;
    const qs = entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

function getServerHost(serverUrl) {
    try {
        return new URL(serverUrl).hostname;
    } catch {
        return serverUrl;
    }
}

function sanitizeNodeLabel(value) {
    const text = String(value || '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, 48);
}

function buildSafeTag(inbound) {
    const remark = sanitizeNodeLabel(inbound?.remark);
    const protocol = String(inbound?.protocol || 'node').trim().toUpperCase() || 'NODE';
    const port = String(inbound?.port || '').trim();
    const base = remark || protocol;
    return port ? `${base}-${port}` : base;
}

function getTag(_server, inbound, _email) {
    return buildSafeTag(inbound);
}

function sortInboundsForServer(serverId, inbounds = []) {
    return systemSettingsStore.sortInboundList(serverId, inbounds);
}

function rewriteLinkFragment(link, label) {
    const raw = String(link || '').trim();
    if (!raw || !label) return raw;
    const hashIndex = raw.indexOf('#');
    if (hashIndex >= 0) {
        return `${raw.slice(0, hashIndex)}#${encodeURIComponent(label)}`;
    }
    return `${raw}#${encodeURIComponent(label)}`;
}

function rewriteNativeLinkLabel(link, label) {
    const raw = String(link || '').trim();
    if (!raw || !label) return raw;

    if (raw.startsWith('vmess://')) {
        const encoded = raw.slice('vmess://'.length).trim();
        if (!encoded) return raw;

        try {
            const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
            const padding = normalized.length % 4 === 0
                ? ''
                : '='.repeat(4 - (normalized.length % 4));
            const payload = Buffer.from(normalized + padding, 'base64').toString('utf8');
            const data = JSON.parse(payload);
            data.ps = label;
            return `vmess://${Buffer.from(JSON.stringify(data)).toString('base64')}`;
        } catch {
            return raw;
        }
    }

    return rewriteLinkFragment(raw, label);
}

function selectNativeSubIds(mode, allSubIds = [], fallbackSubIds = []) {
    const source = mode === 'native' ? allSubIds : (mode === 'auto' ? fallbackSubIds : []);
    return Array.from(new Set(
        (Array.isArray(source) ? source : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
}

function setParamIfPresent(params, key, value) {
    if (value === undefined || value === null) return;
    const text = String(value);
    if (!text) return;
    params.set(key, text);
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value);
        if (text) return text;
    }
    return '';
}

function toTrimmedList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

function joinCsv(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .join(',');
    }
    return String(value || '').trim();
}

function getHeaderValue(headers, name) {
    if (!headers) return '';
    const target = String(name || '').trim().toLowerCase();
    if (!target) return '';

    if (Array.isArray(headers)) {
        const found = headers.find((row) => String(row?.name || '').trim().toLowerCase() === target);
        return firstNonEmpty(found?.value);
    }

    if (typeof headers === 'object') {
        const key = Object.keys(headers).find((item) => String(item || '').trim().toLowerCase() === target);
        if (!key) return '';
        const value = headers[key];
        if (Array.isArray(value)) return firstNonEmpty(value.find(Boolean));
        return firstNonEmpty(value);
    }

    return '';
}

function getRealityParams(stream) {
    const rs = stream.realitySettings || {};
    const rsSettings = rs.settings || {};
    const serverNames = toTrimmedList(rs.serverNames);
    const shortIds = toTrimmedList(rs.shortIds);

    const sni = firstNonEmpty(rsSettings.serverName, serverNames[0]);
    const pbk = firstNonEmpty(rsSettings.publicKey);
    const fp = firstNonEmpty(rsSettings.fingerprint, 'chrome');
    const sid = firstNonEmpty(shortIds[0]);
    const spx = firstNonEmpty(rsSettings.spiderX, '/');
    const pqv = firstNonEmpty(rsSettings.mldsa65Verify);

    return { sni, pbk, fp, sid, spx, pqv };
}

function applyTransportParams(params, stream) {
    const net = stream.network || 'tcp';
    if (net === 'ws') {
        params.set('path', stream.wsSettings?.path || '/');
        setParamIfPresent(params, 'host', firstNonEmpty(
            stream.wsSettings?.host,
            getHeaderValue(stream.wsSettings?.headers, 'Host')
        ));
    } else if (net === 'grpc') {
        setParamIfPresent(params, 'serviceName', stream.grpcSettings?.serviceName);
        setParamIfPresent(params, 'authority', stream.grpcSettings?.authority);
        if (stream.grpcSettings?.multiMode === true) {
            params.set('mode', 'multi');
        }
    } else if (net === 'tcp') {
        const headerType = stream.tcpSettings?.header?.type;
        if (headerType && headerType !== 'none') {
            params.set('headerType', headerType);
            if (headerType === 'http') {
                const request = stream.tcpSettings?.header?.request || {};
                const requestPaths = toTrimmedList(request.path);
                if (requestPaths.length > 0) {
                    params.set('path', requestPaths.join(','));
                }
                setParamIfPresent(params, 'host', getHeaderValue(request.headers, 'Host'));
            }
        }
    } else if (net === 'httpupgrade') {
        setParamIfPresent(params, 'path', stream.httpupgradeSettings?.path || '/');
        setParamIfPresent(params, 'host', firstNonEmpty(
            stream.httpupgradeSettings?.host,
            getHeaderValue(stream.httpupgradeSettings?.headers, 'Host')
        ));
    } else if (net === 'xhttp') {
        setParamIfPresent(params, 'path', stream.xhttpSettings?.path || '/');
        setParamIfPresent(params, 'host', firstNonEmpty(
            stream.xhttpSettings?.host,
            getHeaderValue(stream.xhttpSettings?.headers, 'Host')
        ));
        setParamIfPresent(params, 'mode', stream.xhttpSettings?.mode);
    } else if (net === 'kcp') {
        setParamIfPresent(params, 'seed', stream.kcpSettings?.seed);
        setParamIfPresent(params, 'headerType', stream.kcpSettings?.header?.type);
    } else if (net === 'quic') {
        setParamIfPresent(params, 'quicSecurity', stream.quicSettings?.security);
        setParamIfPresent(params, 'key', stream.quicSettings?.key);
        setParamIfPresent(params, 'headerType', stream.quicSettings?.header?.type);
    }
}

function buildVmessLink({ server, inbound, client, stream, diagnostics }) {
    const uuid = client.id || client.uuid;
    if (!uuid) {
        diagnostics.push('missing uuid');
        return null;
    }

    const net = stream.network || 'tcp';
    const security = stream.security || 'none';
    const realityServerNames = toTrimmedList(stream.realitySettings?.serverNames);
    const sni = stream.tlsSettings?.serverName
        || stream.realitySettings?.settings?.serverName
        || realityServerNames[0]
        || '';

    const vmessObj = {
        v: '2',
        ps: getTag(server, inbound, client.email || ''),
        add: getServerHost(server.url),
        port: String(inbound.port),
        id: uuid,
        aid: String(client.alterId || 0),
        scy: client.security || 'auto',
        net,
        type: stream.tcpSettings?.header?.type || 'none',
        host: stream.wsSettings?.headers?.Host
            || (Array.isArray(stream.httpSettings?.host)
                ? stream.httpSettings.host.join(',')
                : (stream.httpSettings?.host || '')),
        path: stream.wsSettings?.path || stream.httpSettings?.path || stream.grpcSettings?.serviceName || '/',
        tls: security === 'none' ? '' : (security === 'reality' ? 'tls' : security),
        sni,
        alpn: Array.isArray(stream.tlsSettings?.alpn) ? stream.tlsSettings.alpn.join(',') : '',
    };

    if (security === 'reality') {
        const reality = getRealityParams(stream);
        if (!reality.sni || !reality.pbk || !reality.fp) {
            diagnostics.push('missing reality required params: sni/pbk/fp');
            return null;
        }
        vmessObj.sni = reality.sni;
        vmessObj.pbk = reality.pbk;
        vmessObj.fp = reality.fp;
        vmessObj.sid = reality.sid || '';
        vmessObj.spx = reality.spx || '/';
    }

    return `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`;
}

function buildVlessLink({ server, inbound, client, stream, diagnostics }) {
    const uuid = client.id || client.uuid;
    if (!uuid) {
        diagnostics.push('missing uuid');
        return null;
    }

    const net = stream.network || 'tcp';
    const inboundSettings = parseJsonObjectLike(inbound.settings, {});
    const params = new URLSearchParams();
    params.set('type', net);
    params.set('encryption', firstNonEmpty(inboundSettings.encryption, client.encryption, 'none'));

    if (net === 'tcp') {
        setParamIfPresent(params, 'flow', client.flow);
    }
    applyTransportParams(params, stream);

    const security = stream.security || 'none';
    if (security === 'tls') {
        params.set('security', 'tls');
        const realityServerNames = toTrimmedList(stream.realitySettings?.serverNames);
        const sni = stream.tlsSettings?.serverName
            || stream.realitySettings?.settings?.serverName
            || realityServerNames[0]
            || '';
        setParamIfPresent(params, 'sni', sni);
        const alpn = joinCsv(stream.tlsSettings?.alpn);
        if (alpn) {
            params.set('alpn', alpn);
        }
        const fp = firstNonEmpty(stream.tlsSettings?.settings?.fingerprint);
        if (fp) {
            params.set('fp', fp);
        }
        const ech = firstNonEmpty(stream.tlsSettings?.settings?.echConfigList);
        if (ech) {
            params.set('ech', ech);
        }
        if (stream.tlsSettings?.allowInsecure === true) {
            params.set('allowInsecure', '1');
        }
    } else if (security === 'reality') {
        params.set('security', 'reality');
        if (!client.flow && net === 'tcp') {
            params.set('flow', 'xtls-rprx-vision');
        }
        const { sni, pbk, fp, sid, spx, pqv } = getRealityParams(stream);
        if (!sni || !pbk || !fp) {
            diagnostics.push('missing reality required params: sni/pbk/fp');
            return null;
        }
        params.set('sni', sni);
        params.set('pbk', pbk);
        params.set('fp', fp);
        setParamIfPresent(params, 'sid', sid);
        params.set('spx', spx);
        setParamIfPresent(params, 'pqv', pqv);
        const alpn = joinCsv(stream.tlsSettings?.alpn);
        if (alpn) {
            params.set('alpn', alpn);
        }
    }

    const tag = encodeURIComponent(getTag(server, inbound, client.email || ''));
    return `vless://${encodeURIComponent(uuid)}@${getServerHost(server.url)}:${inbound.port}?${params.toString()}#${tag}`;
}

function buildTrojanLink({ server, inbound, client, stream, diagnostics }) {
    const password = client.password || client.id;
    if (!password) {
        diagnostics.push('missing password');
        return null;
    }

    const net = stream.network || 'tcp';
    const params = new URLSearchParams();
    params.set('type', net);
    applyTransportParams(params, stream);

    const security = stream.security || 'none';
    if (security === 'tls') {
        params.set('security', 'tls');
        const sni = stream.tlsSettings?.serverName || '';
        setParamIfPresent(params, 'sni', sni);
        const alpn = joinCsv(stream.tlsSettings?.alpn);
        if (alpn) {
            params.set('alpn', alpn);
        }
        const fp = firstNonEmpty(stream.tlsSettings?.settings?.fingerprint);
        if (fp) {
            params.set('fp', fp);
        }
        const ech = firstNonEmpty(stream.tlsSettings?.settings?.echConfigList);
        if (ech) {
            params.set('ech', ech);
        }
        if (stream.tlsSettings?.allowInsecure === true) {
            params.set('allowInsecure', '1');
        }
    } else if (security === 'reality') {
        params.set('security', 'reality');
        const { sni, pbk, fp, sid, spx, pqv } = getRealityParams(stream);
        if (!sni || !pbk || !fp) {
            diagnostics.push('missing reality required params: sni/pbk/fp');
            return null;
        }
        params.set('sni', sni);
        params.set('pbk', pbk);
        params.set('fp', fp);
        setParamIfPresent(params, 'sid', sid);
        params.set('spx', spx || '/');
        setParamIfPresent(params, 'pqv', pqv);
    }

    const tag = encodeURIComponent(getTag(server, inbound, client.email || ''));
    return `trojan://${encodeURIComponent(password)}@${getServerHost(server.url)}:${inbound.port}?${params.toString()}#${tag}`;
}

function buildShadowsocksLink({ server, inbound, client, settings, diagnostics }) {
    const method = client.method || settings.method;
    const password = client.password;
    if (!method || !password) {
        diagnostics.push('missing shadowsocks method or password');
        return null;
    }

    const userInfo = Buffer.from(`${method}:${password}`).toString('base64');
    const tag = encodeURIComponent(getTag(server, inbound, client.email || ''));
    return `ss://${userInfo}@${getServerHost(server.url)}:${inbound.port}#${tag}`;
}

function buildClientLink({ server, inbound, client, settings, stream, diagnostics }) {
    switch ((inbound.protocol || '').toLowerCase()) {
        case 'vmess':
            return buildVmessLink({ server, inbound, client, stream, diagnostics });
        case 'vless':
            return buildVlessLink({ server, inbound, client, stream, diagnostics });
        case 'trojan':
            return buildTrojanLink({ server, inbound, client, stream, diagnostics });
        case 'shadowsocks':
            return buildShadowsocksLink({ server, inbound, client, settings, diagnostics });
        default:
            return null;
    }
}

function parseSubscriptionLinks(rawPayload) {
    const payload = String(rawPayload || '').trim();
    if (!payload) return [];

    const splitLines = (text) => text
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line && LINK_PATTERN.test(line));

    const directLines = splitLines(payload);
    if (directLines.length > 0) return directLines;

    const compact = payload.replace(/\s+/g, '');
    const normalizedBase64 = compact.replace(/-/g, '+').replace(/_/g, '/');
    const base64Like = normalizedBase64.length >= 16 && /^[A-Za-z0-9+/=]+$/.test(normalizedBase64);
    if (!base64Like) return [];

    try {
        const padding = normalizedBase64.length % 4 === 0
            ? ''
            : '='.repeat(4 - (normalizedBase64.length % 4));
        const decoded = Buffer.from(normalizedBase64 + padding, 'base64').toString('utf8');
        return splitLines(decoded);
    } catch {
        return [];
    }
}

async function collectNativeLinks({
    client,
    subIds,
    serverMeta,
    perServer,
    warnings,
}) {
    const links = new Set();
    for (const subId of subIds) {
        try {
            const response = await client.get(`/sub/${encodeURIComponent(subId)}`, {
                responseType: 'text',
                transformResponse: [(data) => data],
            });
            const payload = typeof response.data === 'string'
                ? response.data
                : Buffer.from(response.data || '').toString('utf8');
            const parsed = parseSubscriptionLinks(payload);
            if (parsed.length === 0) {
                const reason = `native subscription returned no parseable links for subId=${subId}`;
                const detail = {
                    type: 'native-empty',
                    server: serverMeta.name,
                    subId,
                    reason,
                };
                warnings.push(detail);
                perServer.warnings.push(detail);
                continue;
            }

            parsed.forEach((line) => {
                const label = `NODE-${links.size + 1}`;
                links.add(rewriteNativeLinkLabel(line, label));
            });
        } catch (error) {
            const reason = `native subscription failed for subId=${subId}: ${error.message}`;
            const detail = {
                type: 'native-error',
                server: serverMeta.name,
                subId,
                reason,
            };
            warnings.push(detail);
            perServer.warnings.push(detail);
        }
    }
    return Array.from(links);
}

function isClientEnabled(entry) {
    return entry?.enable !== false;
}

function isClientExpired(entry, nowTs) {
    const expiry = Number(entry?.expiryTime || 0);
    if (!Number.isFinite(expiry) || expiry <= 0) return false;
    return expiry <= nowTs;
}

async function collectByServer(serverMeta, normalizedEmail, mode, options = {}) {
    const allowedServerIdList = Array.isArray(options.policy?.allowedServerIds) ? options.policy.allowedServerIds : [];
    const allowedProtocolList = Array.isArray(options.policy?.allowedProtocols) ? options.policy.allowedProtocols : [];
    const serverScopeMode = normalizePolicyScopeMode(options.policy?.serverScopeMode, allowedServerIdList);
    const protocolScopeMode = normalizePolicyScopeMode(options.policy?.protocolScopeMode, allowedProtocolList);
    const allowedServerIds = new Set(allowedServerIdList);
    const allowedProtocols = new Set(allowedProtocolList);
    const nowTs = Number(options.nowTs || Date.now());

    const perServer = {
        serverId: serverMeta.id,
        server: serverMeta.name,
        matchedClientsRaw: 0,
        matchedClientsActive: 0,
        filteredExpired: 0,
        filteredDisabled: 0,
        filteredByPolicy: 0,
        nativeLinks: 0,
        reconstructedLinks: 0,
        warnings: [],
    };
    const warnings = [];
    const skipped = [];
    const links = new Set();
    let nativeLinks = [];
    let reconstructedLinks = [];

    if (serverScopeMode === 'none') {
        const detail = {
            type: 'policy-server-denied',
            server: serverMeta.name,
            reason: 'server scope mode is none',
        };
        perServer.filteredByPolicy = 1;
        perServer.warnings.push(detail);
        warnings.push(detail);
        return {
            links: [],
            skipped,
            warnings,
            perServer,
        };
    }

    if (serverScopeMode === 'selected' && !allowedServerIds.has(serverMeta.id)) {
        const detail = {
            type: 'policy-server-denied',
            server: serverMeta.name,
            reason: `server ${serverMeta.id} not in allowedServerIds`,
        };
        perServer.filteredByPolicy = 1;
        perServer.warnings.push(detail);
        warnings.push(detail);
        return {
            links: [],
            skipped,
            warnings,
            perServer,
        };
    }

    try {
        const client = await ensureAuthenticated(serverMeta.id);
        const listRes = await client.get('/panel/api/inbounds/list');
        const inbounds = sortInboundsForServer(serverMeta.id, listRes.data?.obj || []);
        const matchedEntries = [];
        const subIds = new Set();
        const fallbackSubIds = new Set();

        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            const settings = parseJsonObjectLike(inbound.settings, {});
            const stream = parseJsonObjectLike(inbound.streamSettings, {});
            const clients = Array.isArray(settings.clients) ? settings.clients : [];

            for (const entry of clients) {
                if (normalizeEmail(entry.email) !== normalizedEmail) continue;
                perServer.matchedClientsRaw += 1;

                if (!isClientEnabled(entry)) {
                    perServer.filteredDisabled += 1;
                    continue;
                }
                if (isClientExpired(entry, nowTs)) {
                    perServer.filteredExpired += 1;
                    continue;
                }
                if (protocolScopeMode === 'none') {
                    perServer.filteredByPolicy += 1;
                    continue;
                }
                if (protocolScopeMode === 'selected' && !allowedProtocols.has(protocol)) {
                    perServer.filteredByPolicy += 1;
                    continue;
                }

                matchedEntries.push({
                    inbound,
                    protocol,
                    entry,
                    settings,
                    stream,
                    subId: entry.subId ? String(entry.subId).trim() : '',
                });
                if (entry.subId) subIds.add(String(entry.subId).trim());
            }
        }

        perServer.matchedClientsActive = matchedEntries.length;

        const shouldReconstruct = mode === 'auto' || mode === 'reconstructed';

        if (shouldReconstruct) {
            for (const item of matchedEntries) {
                if (!RECONSTRUCTED_PROTOCOLS.has(item.protocol)) {
                    const reason = `unsupported protocol for reconstruction: ${item.protocol}`;
                    const detail = {
                        type: 'reconstructed-unsupported-protocol',
                        server: serverMeta.name,
                        inboundId: item.inbound.id,
                        protocol: item.protocol,
                        email: item.entry.email,
                        reason,
                    };
                    warnings.push(detail);
                    perServer.warnings.push(detail);
                    if (item.subId) fallbackSubIds.add(item.subId);
                    continue;
                }

                const diagnostics = [];
                const link = buildClientLink({
                    server: serverMeta,
                    inbound: item.inbound,
                    client: item.entry,
                    settings: item.settings,
                    stream: item.stream,
                    diagnostics,
                });

                if (!link) {
                    skipped.push({
                        server: serverMeta.name,
                        inboundId: item.inbound.id,
                        protocol: item.protocol,
                        email: item.entry.email,
                        reason: diagnostics.length > 0
                            ? diagnostics.join('; ')
                            : 'unsupported or missing parameters',
                    });
                    if (item.subId) fallbackSubIds.add(item.subId);
                    continue;
                }

                reconstructedLinks.push(link);
                links.add(link);
            }
        }

        const nativeSubIds = selectNativeSubIds(mode, Array.from(subIds), Array.from(fallbackSubIds));
        const shouldCollectNative = nativeSubIds.length > 0;
        if (shouldCollectNative) {
            nativeLinks = await collectNativeLinks({
                client,
                subIds: nativeSubIds,
                serverMeta,
                perServer,
                warnings,
            });
            nativeLinks.forEach((link) => links.add(link));
            perServer.nativeLinks = nativeLinks.length;
        }

        perServer.reconstructedLinks = reconstructedLinks.length;
        return {
            links: Array.from(links),
            skipped,
            warnings,
            perServer,
        };
    } catch (error) {
        const detail = {
            type: 'server-fetch-error',
            server: serverMeta.name,
            reason: error.message,
        };
        perServer.warnings.push(detail);
        warnings.push(detail);
        return {
            links: [],
            skipped,
            warnings,
            perServer,
        };
    }
}

async function buildMergedLinksByEmail(email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    const mode = normalizeMode(options.mode);
    const requestedServerId = normalizeServerId(options.serverId);
    const nowTs = Date.now();
    const policy = userPolicyStore.get(normalizedEmail);
    const policyAllowedServerIds = Array.isArray(policy.allowedServerIds) ? policy.allowedServerIds : [];
    const policyAllowedProtocols = Array.isArray(policy.allowedProtocols) ? policy.allowedProtocols : [];
    const policyServerScopeMode = normalizePolicyScopeMode(policy.serverScopeMode, policyAllowedServerIds);
    const policyProtocolScopeMode = normalizePolicyScopeMode(policy.protocolScopeMode, policyAllowedProtocols);
    const policyRestrictive = policyServerScopeMode !== 'all' || policyProtocolScopeMode !== 'all';
    if (!normalizedEmail) {
        return {
            links: [],
            skipped: [],
            warnings: [],
            perServer: [],
            sourceMode: 'none',
            mode,
            serverNotFound: false,
            matchedClientsRaw: 0,
            matchedClientsActive: 0,
            filteredExpired: 0,
            filteredDisabled: 0,
            filteredByPolicy: 0,
            subscriptionActive: false,
            inactiveReason: 'email-required',
            policy,
        };
    }

    const links = new Set();
    const skipped = [];
    const warnings = [];
    const perServer = [];

    const allServers = serverStore.getAll();
    const servers = requestedServerId
        ? allServers.filter((item) => item.id === requestedServerId)
        : allServers;
    const serverNotFound = requestedServerId && servers.length === 0;
    const requestedBlockedByPolicy = requestedServerId
        && (
            policyServerScopeMode === 'none'
            || (policyServerScopeMode === 'selected' && !policyAllowedServerIds.includes(requestedServerId))
        );

    if (serverNotFound) {
        return {
            links: [],
            skipped: [],
            warnings: [],
            perServer: [],
            sourceMode: 'none',
            mode,
            serverNotFound: true,
            matchedClientsRaw: 0,
            matchedClientsActive: 0,
            filteredExpired: 0,
            filteredDisabled: 0,
            filteredByPolicy: 0,
            subscriptionActive: false,
            inactiveReason: 'server-not-found',
            policy,
        };
    }
    if (requestedBlockedByPolicy) {
        return {
            links: [],
            skipped: [],
            warnings: [],
            perServer: [],
            sourceMode: 'none',
            mode,
            serverNotFound: false,
            matchedClientsRaw: 0,
            matchedClientsActive: 0,
            filteredExpired: 0,
            filteredDisabled: 0,
            filteredByPolicy: 1,
            subscriptionActive: false,
            inactiveReason: 'blocked-by-policy',
            policy,
        };
    }

    const collected = await Promise.all(
        servers.map((serverMeta) => collectByServer(serverMeta, normalizedEmail, mode, { nowTs, policy }))
    );

    for (const item of collected) {
        item.links.forEach((link) => links.add(link));
        skipped.push(...item.skipped);
        warnings.push(...item.warnings);
        perServer.push(item.perServer);
    }

    const nativeTotal = perServer.reduce((sum, item) => sum + Number(item.nativeLinks || 0), 0);
    const reconstructedTotal = perServer.reduce((sum, item) => sum + Number(item.reconstructedLinks || 0), 0);
    const matchedClientsRaw = perServer.reduce((sum, item) => sum + Number(item.matchedClientsRaw || 0), 0);
    const matchedClientsActive = perServer.reduce((sum, item) => sum + Number(item.matchedClientsActive || 0), 0);
    const filteredExpired = perServer.reduce((sum, item) => sum + Number(item.filteredExpired || 0), 0);
    const filteredDisabled = perServer.reduce((sum, item) => sum + Number(item.filteredDisabled || 0), 0);
    const filteredByPolicy = perServer.reduce((sum, item) => sum + Number(item.filteredByPolicy || 0), 0);

    let sourceMode = 'none';
    if (nativeTotal > 0 && reconstructedTotal > 0) sourceMode = 'mixed';
    else if (nativeTotal > 0) sourceMode = 'native';
    else if (reconstructedTotal > 0) sourceMode = 'reconstructed';

    const totalLinks = links.size;
    let inactiveReason = '';
    if (totalLinks === 0) {
        if (matchedClientsRaw === 0 && (policyRestrictive || filteredByPolicy > 0)) inactiveReason = 'blocked-by-policy';
        else if (matchedClientsRaw === 0) inactiveReason = 'user-not-found';
        else if (matchedClientsActive === 0 && filteredByPolicy > 0) inactiveReason = 'blocked-by-policy';
        else if (matchedClientsActive === 0 && (filteredExpired > 0 || filteredDisabled > 0)) inactiveReason = 'all-expired-or-disabled';
        else inactiveReason = 'no-links-found';
    }

    return {
        links: Array.from(links),
        skipped,
        warnings,
        perServer: perServer.sort((a, b) => String(a.server).localeCompare(String(b.server))),
        sourceMode,
        mode,
        serverNotFound: false,
        matchedClientsRaw,
        matchedClientsActive,
        filteredExpired,
        filteredDisabled,
        filteredByPolicy,
        subscriptionActive: totalLinks > 0,
        inactiveReason,
        policy,
    };
}

function buildSubscriptionPayload(links) {
    const raw = links.join('\n');
    const encoded = Buffer.from(raw, 'utf8').toString('base64');
    return { raw, encoded };
}

const META_RULES_BASE_URL = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo';
const MIHOMO_RULE_PROVIDERS = [
    {
        name: 'private-domain',
        behavior: 'domain',
        format: 'mrs',
        path: './ruleset/private-domain.mrs',
        url: `${META_RULES_BASE_URL}/geosite/private.mrs`,
    },
    {
        name: 'icloud-domain',
        behavior: 'domain',
        format: 'mrs',
        path: './ruleset/icloud-domain.mrs',
        url: `${META_RULES_BASE_URL}/geosite/icloud.mrs`,
    },
    {
        name: 'apple-domain',
        behavior: 'domain',
        format: 'mrs',
        path: './ruleset/apple-domain.mrs',
        url: `${META_RULES_BASE_URL}/geosite/apple.mrs`,
    },
    {
        name: 'google-domain',
        behavior: 'domain',
        format: 'mrs',
        path: './ruleset/google-domain.mrs',
        url: `${META_RULES_BASE_URL}/geosite/google.mrs`,
    },
    {
        name: 'proxy-domain',
        behavior: 'domain',
        format: 'mrs',
        path: './ruleset/proxy-domain.mrs',
        url: `${META_RULES_BASE_URL}/geosite/proxy.mrs`,
    },
    {
        name: 'telegram-domain',
        behavior: 'domain',
        format: 'mrs',
        path: './ruleset/telegram-domain.mrs',
        url: `${META_RULES_BASE_URL}/geosite/telegram.mrs`,
    },
    {
        name: 'cn-domain',
        behavior: 'domain',
        format: 'mrs',
        path: './ruleset/cn-domain.mrs',
        url: `${META_RULES_BASE_URL}/geosite/cn.mrs`,
    },
    {
        name: 'private-ip',
        behavior: 'ipcidr',
        format: 'mrs',
        path: './ruleset/private-ip.mrs',
        url: `${META_RULES_BASE_URL}/geoip/private.mrs`,
    },
    {
        name: 'telegram-ip',
        behavior: 'ipcidr',
        format: 'mrs',
        path: './ruleset/telegram-ip.mrs',
        url: `${META_RULES_BASE_URL}/geoip/telegram.mrs`,
    },
    {
        name: 'cn-ip',
        behavior: 'ipcidr',
        format: 'mrs',
        path: './ruleset/cn-ip.mrs',
        url: `${META_RULES_BASE_URL}/geoip/cn.mrs`,
    },
];

const MIHOMO_RULES = [
    'DOMAIN,clash.razord.top,DIRECT',
    'DOMAIN,yacd.haishan.me,DIRECT',
    'RULE-SET,private-domain,DIRECT',
    'RULE-SET,icloud-domain,DIRECT',
    'RULE-SET,apple-domain,DIRECT',
    'RULE-SET,google-domain,GLOBAL',
    'RULE-SET,telegram-domain,TELEGRAM',
    'RULE-SET,proxy-domain,GLOBAL',
    'RULE-SET,cn-domain,DOMESTIC',
    'RULE-SET,private-ip,DIRECT',
    'RULE-SET,telegram-ip,TELEGRAM',
    'RULE-SET,cn-ip,DOMESTIC',
    'MATCH,GLOBAL',
];

function normalizeSubscriptionFormat(format) {
    const text = String(format || '').trim().toLowerCase();
    if (text === 'raw') return 'raw';
    if (text === 'clash' || text === 'mihomo') return 'clash';
    return 'encoded';
}

function decodeBase64Text(text) {
    const normalized = String(text || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized) return '';
    const padding = normalized.length % 4 === 0
        ? ''
        : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function splitCommaValues(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function decodeMaybeEncoded(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

function extractLinkLabel(link, fallback = '') {
    const hashIndex = String(link || '').indexOf('#');
    const raw = hashIndex >= 0 ? String(link).slice(hashIndex + 1) : '';
    const decoded = sanitizeNodeLabel(decodeMaybeEncoded(raw));
    return decoded || fallback;
}

function makeUniqueName(base, usedNames) {
    const seed = sanitizeNodeLabel(base) || 'NODE';
    if (!usedNames.has(seed)) {
        usedNames.add(seed);
        return seed;
    }
    let index = 2;
    let candidate = `${seed}-${index}`;
    while (usedNames.has(candidate)) {
        index += 1;
        candidate = `${seed}-${index}`;
    }
    usedNames.add(candidate);
    return candidate;
}

function isYamlPlainString(value) {
    return /^[A-Za-z0-9._/@%-]+$/.test(value)
        && !['true', 'false', 'null', 'yes', 'no', '~'].includes(value.toLowerCase());
}

function formatYamlScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    const text = String(value);
    if (!text) return '""';
    if (isYamlPlainString(text)) return text;
    return JSON.stringify(text);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toYaml(value, indent = 0) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(value)) {
        if (value.length === 0) return `${pad}[]`;
        return value.map((item) => {
            if (Array.isArray(item) || isPlainObject(item)) {
                const rendered = toYaml(item, indent + 2);
                return `${pad}-\n${rendered}`;
            }
            return `${pad}- ${formatYamlScalar(item)}`;
        }).join('\n');
    }

    if (isPlainObject(value)) {
        const entries = Object.entries(value).filter(([, item]) => item !== undefined);
        if (entries.length === 0) return `${pad}{}`;
        return entries.map(([key, item]) => {
            if (Array.isArray(item) || isPlainObject(item)) {
                return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
            }
            return `${pad}${key}: ${formatYamlScalar(item)}`;
        }).join('\n');
    }

    return `${pad}${formatYamlScalar(value)}`;
}

function applySharedTlsConfig(proxy, options = {}) {
    const security = String(options.security || '').trim().toLowerCase();
    const servername = firstNonEmpty(options.servername, options.sni);
    const alpn = splitCommaValues(options.alpn);
    const fingerprint = firstNonEmpty(options.fingerprint);
    const clientFingerprint = firstNonEmpty(options.clientFingerprint);
    const publicKey = firstNonEmpty(options.publicKey);
    const shortId = firstNonEmpty(options.shortId);

    if (security === 'tls' || security === 'reality' || options.forceTls === true) {
        if (options.tlsField !== false) {
            proxy.tls = true;
        }
        if (options.servernameField === 'sni') {
            if (servername) proxy.sni = servername;
        } else if (servername) {
            proxy.servername = servername;
        }
        if (alpn.length > 0) proxy.alpn = alpn;
        if (fingerprint) proxy.fingerprint = fingerprint;
        if (clientFingerprint) proxy['client-fingerprint'] = clientFingerprint;
        if (options.skipCertVerify === true) proxy['skip-cert-verify'] = true;
    }

    if (security === 'reality' || publicKey) {
        if (!publicKey) return false;
        proxy['reality-opts'] = {
            'public-key': publicKey,
        };
        if (shortId) {
            proxy['reality-opts']['short-id'] = shortId;
        }
    }

    return true;
}

function applyTransportToMihomoProxy(proxy, network, options = {}) {
    const normalized = String(network || 'tcp').trim().toLowerCase() || 'tcp';
    if (['httpupgrade', 'xhttp', 'kcp', 'quic'].includes(normalized)) {
        return false;
    }

    if (normalized === 'http' || normalized === 'h2') {
        proxy.network = normalized;
        const path = decodeMaybeEncoded(options.path) || '/';
        const hostList = splitCommaValues(decodeMaybeEncoded(options.host));
        if (normalized === 'http') {
            proxy['http-opts'] = {
                path: splitCommaValues(path).length > 0 ? splitCommaValues(path) : [path],
            };
            if (hostList.length > 0) {
                proxy['http-opts'].headers = { Host: hostList };
            }
        } else {
            proxy['h2-opts'] = { path };
            if (hostList.length > 0) {
                proxy['h2-opts'].host = hostList;
            }
        }
        return true;
    }

    if (normalized === 'ws') {
        proxy.network = 'ws';
        proxy['ws-opts'] = { path: decodeMaybeEncoded(options.path) || '/' };
        const host = decodeMaybeEncoded(options.host);
        if (host) {
            proxy['ws-opts'].headers = { Host: host };
        }
        return true;
    }

    if (normalized === 'grpc') {
        proxy.network = 'grpc';
        const serviceName = decodeMaybeEncoded(options.serviceName) || decodeMaybeEncoded(options.path);
        if (serviceName) {
            proxy['grpc-opts'] = { 'grpc-service-name': serviceName };
        }
        return true;
    }

    if (normalized === 'tcp') {
        const headerType = String(options.headerType || '').trim().toLowerCase();
        if (headerType && headerType !== 'none') {
            return false;
        }
        proxy.network = 'tcp';
        return true;
    }

    return false;
}

function parseVmessProxy(link, usedNames, index) {
    const encoded = String(link || '').slice('vmess://'.length).trim();
    if (!encoded) return null;

    let payload;
    try {
        payload = JSON.parse(decodeBase64Text(encoded));
    } catch {
        return null;
    }

    const server = firstNonEmpty(payload.add, payload.server);
    const port = Number(payload.port);
    const uuid = firstNonEmpty(payload.id, payload.uuid);
    if (!server || !Number.isFinite(port) || port <= 0 || !uuid) return null;

    const name = makeUniqueName(payload.ps || extractLinkLabel(link, `NODE-${index}`), usedNames);
    const proxy = {
        name,
        type: 'vmess',
        server,
        port,
        udp: true,
        uuid,
        alterId: Number(payload.aid || 0) || 0,
        cipher: firstNonEmpty(payload.scy, payload.cipher, 'auto'),
    };

    if (!applyTransportToMihomoProxy(proxy, payload.net || 'tcp', {
        path: payload.path,
        host: payload.host,
        serviceName: payload.path,
        headerType: payload.type,
    })) {
        return null;
    }

    if (!applySharedTlsConfig(proxy, {
        security: payload.tls === 'tls' ? 'tls' : (payload.pbk ? 'reality' : ''),
        servername: payload.sni,
        alpn: payload.alpn,
        publicKey: payload.pbk,
        shortId: payload.sid,
        clientFingerprint: payload.fp,
    })) {
        return null;
    }

    return proxy;
}

function parseVlessProxy(link, usedNames, index) {
    let parsed;
    try {
        parsed = new URL(link);
    } catch {
        return null;
    }

    const server = parsed.hostname;
    const port = Number(parsed.port);
    const uuid = decodeMaybeEncoded(parsed.username);
    if (!server || !Number.isFinite(port) || port <= 0 || !uuid) return null;

    const query = parsed.searchParams;
    const network = query.get('type') || 'tcp';
    const name = makeUniqueName(extractLinkLabel(link, `NODE-${index}`), usedNames);
    const proxy = {
        name,
        type: 'vless',
        server,
        port,
        udp: true,
        uuid,
        encryption: firstNonEmpty(query.get('encryption'), ''),
    };

    const flow = firstNonEmpty(query.get('flow'));
    if (flow) proxy.flow = flow;

    if (!applyTransportToMihomoProxy(proxy, network, {
        path: query.get('path'),
        host: query.get('host'),
        serviceName: query.get('serviceName'),
        headerType: query.get('headerType'),
    })) {
        return null;
    }

    if (!applySharedTlsConfig(proxy, {
        security: query.get('security'),
        servername: query.get('sni'),
        alpn: query.get('alpn'),
        publicKey: query.get('pbk'),
        shortId: query.get('sid'),
        clientFingerprint: query.get('fp'),
        skipCertVerify: normalizeBoolean(query.get('allowInsecure'), false),
    })) {
        return null;
    }

    return proxy;
}

function parseTrojanProxy(link, usedNames, index) {
    let parsed;
    try {
        parsed = new URL(link);
    } catch {
        return null;
    }

    const server = parsed.hostname;
    const port = Number(parsed.port);
    const password = decodeMaybeEncoded(parsed.username);
    if (!server || !Number.isFinite(port) || port <= 0 || !password) return null;

    const query = parsed.searchParams;
    const network = query.get('type') || 'tcp';
    const name = makeUniqueName(extractLinkLabel(link, `NODE-${index}`), usedNames);
    const proxy = {
        name,
        type: 'trojan',
        server,
        port,
        udp: true,
        password,
    };

    if (!applyTransportToMihomoProxy(proxy, network, {
        path: query.get('path'),
        host: query.get('host'),
        serviceName: query.get('serviceName'),
    })) {
        return null;
    }

    if (!applySharedTlsConfig(proxy, {
        security: query.get('security') || 'tls',
        sni: query.get('sni'),
        servernameField: 'sni',
        tlsField: false,
        forceTls: true,
        alpn: query.get('alpn'),
        publicKey: query.get('pbk'),
        shortId: query.get('sid'),
        clientFingerprint: query.get('fp'),
        skipCertVerify: normalizeBoolean(query.get('allowInsecure'), false),
    })) {
        return null;
    }

    return proxy;
}

function parseShadowsocksUserInfo(value) {
    const raw = String(value || '').trim();
    if (!raw) return { method: '', password: '' };
    if (raw.includes(':')) {
        const splitIndex = raw.indexOf(':');
        return {
            method: raw.slice(0, splitIndex),
            password: raw.slice(splitIndex + 1),
        };
    }
    try {
        const decoded = decodeBase64Text(raw);
        const splitIndex = decoded.indexOf(':');
        if (splitIndex < 0) return { method: '', password: '' };
        return {
            method: decoded.slice(0, splitIndex),
            password: decoded.slice(splitIndex + 1),
        };
    } catch {
        return { method: '', password: '' };
    }
}

function parseShadowsocksProxy(link, usedNames, index) {
    const withoutScheme = String(link || '').slice('ss://'.length);
    if (!withoutScheme) return null;

    const [targetPart] = withoutScheme.split('#');
    const [mainPart] = String(targetPart || '').split('?');
    if (!mainPart) return null;

    let userInfo = '';
    let serverInfo = '';
    if (mainPart.includes('@')) {
        const splitIndex = mainPart.lastIndexOf('@');
        userInfo = mainPart.slice(0, splitIndex);
        serverInfo = mainPart.slice(splitIndex + 1);
    } else {
        try {
            const decoded = decodeBase64Text(mainPart);
            const splitIndex = decoded.lastIndexOf('@');
            if (splitIndex < 0) return null;
            userInfo = decoded.slice(0, splitIndex);
            serverInfo = decoded.slice(splitIndex + 1);
        } catch {
            return null;
        }
    }

    const endpointIndex = serverInfo.lastIndexOf(':');
    if (endpointIndex < 0) return null;
    const server = serverInfo.slice(0, endpointIndex);
    const port = Number(serverInfo.slice(endpointIndex + 1));
    const { method, password } = parseShadowsocksUserInfo(userInfo);
    if (!server || !Number.isFinite(port) || port <= 0 || !method || !password) return null;

    const name = makeUniqueName(extractLinkLabel(link, `NODE-${index}`), usedNames);
    return {
        name,
        type: 'ss',
        server,
        port,
        udp: true,
        cipher: method,
        password,
    };
}

function parseMihomoProxyFromLink(link, usedNames, index) {
    const normalized = String(link || '').trim();
    if (!normalized) return null;
    if (normalized.startsWith('vmess://')) return parseVmessProxy(normalized, usedNames, index);
    if (normalized.startsWith('vless://')) return parseVlessProxy(normalized, usedNames, index);
    if (normalized.startsWith('trojan://')) return parseTrojanProxy(normalized, usedNames, index);
    if (normalized.startsWith('ss://')) return parseShadowsocksProxy(normalized, usedNames, index);
    return null;
}

function buildMihomoConfigObject(links = []) {
    const linkList = Array.isArray(links) ? links : [];
    const usedNames = new Set();
    const proxies = [];

    linkList.forEach((link, index) => {
        const proxy = parseMihomoProxyFromLink(link, usedNames, index + 1);
        if (proxy) {
            proxies.push(proxy);
        }
    });

    if (proxies.length === 0) return null;
    const proxyNames = proxies.map((item) => item.name);
    const selectableProxyTargets = ['AUTO', ...proxyNames, 'DIRECT'];
    const flexibleProxyTargets = ['PROXY', 'AUTO', ...proxyNames, 'DIRECT'];

    const ruleProviders = {};
    MIHOMO_RULE_PROVIDERS.forEach((provider) => {
        ruleProviders[provider.name] = {
            type: 'http',
            behavior: provider.behavior,
            format: provider.format,
            path: provider.path,
            url: provider.url,
            interval: 86400,
        };
    });

    return {
        mode: 'rule',
        'log-level': 'info',
        ipv6: true,
        'unified-delay': true,
        'tcp-concurrent': true,
        proxies,
        'proxy-groups': [
            {
                name: 'PROXY',
                type: 'select',
                proxies: selectableProxyTargets,
            },
            {
                name: 'AUTO',
                type: 'url-test',
                url: 'https://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50,
                proxies: proxyNames,
            },
            {
                name: 'GLOBAL',
                type: 'select',
                proxies: flexibleProxyTargets,
            },
            {
                name: 'TELEGRAM',
                type: 'select',
                proxies: flexibleProxyTargets,
            },
            {
                name: 'DOMESTIC',
                type: 'select',
                proxies: ['DIRECT', 'PROXY', 'AUTO', ...proxyNames],
            },
        ],
        'rule-providers': ruleProviders,
        rules: MIHOMO_RULES,
    };
}

function buildMihomoConfigFromLinks(links = []) {
    const config = buildMihomoConfigObject(links);
    if (!config) return '';
    return `${toYaml(config)}\n`;
}

function getForwardedProtocol(req) {
    const raw = req.headers['x-forwarded-proto'];
    if (Array.isArray(raw)) return raw[0] || req.protocol;
    if (typeof raw === 'string' && raw.trim()) return raw.split(',')[0].trim();
    return req.protocol;
}

function pickHeaderFirstValue(raw) {
    if (Array.isArray(raw)) {
        return String(raw[0] || '').trim();
    }
    const text = String(raw || '').trim();
    if (!text) return '';
    return text.split(',')[0].trim();
}

function normalizeBaseUrl(urlLike) {
    const text = String(urlLike || '').trim();
    if (!text) return '';
    try {
        const parsed = new URL(text);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return '';
    }
}

function resolvePublicBase(req) {
    const runtime = systemSettingsStore.getSubscription();
    const configured = normalizeBaseUrl(runtime?.publicBaseUrl || config.subscription?.publicBaseUrl || '');
    if (configured) return configured;

    const forwardedProtocol = pickHeaderFirstValue(req.headers['x-forwarded-proto']) || getForwardedProtocol(req) || req.protocol;
    const forwardedHostRaw = pickHeaderFirstValue(req.headers['x-forwarded-host']);
    const forwardedPort = pickHeaderFirstValue(req.headers['x-forwarded-port']);
    if (forwardedHostRaw) {
        const host = forwardedHostRaw.includes(':') || !forwardedPort
            ? forwardedHostRaw
            : `${forwardedHostRaw}:${forwardedPort}`;
        const base = normalizeBaseUrl(`${forwardedProtocol}://${host}`);
        if (base) return base;
    }

    const originBase = normalizeBaseUrl(req.headers.origin);
    if (originBase) return originBase;

    const refererBase = normalizeBaseUrl(req.headers.referer);
    if (refererBase) return refererBase;

    const host = req.get('host');
    return normalizeBaseUrl(`${getForwardedProtocol(req)}://${host}`);
}

function buildTokenPublicBase(req, email, rawToken) {
    const base = resolvePublicBase(req);
    const { tokenId, tokenSecret } = subscriptionTokenStore.parseToken(rawToken);
    if (!tokenId || !tokenSecret || !base) return '';
    return `${base}/api/subscriptions/public/t/${encodeURIComponent(tokenId)}/${encodeURIComponent(tokenSecret)}`;
}

function buildLegacyPublicBase(req, email) {
    const base = resolvePublicBase(req);
    const sig = signEmail(email);
    if (!base) return '';
    return `${base}/api/subscriptions/public/${encodeURIComponent(email)}/${sig}`;
}

function buildSubscriptionUrls(publicBase, mode, serverId) {
    const base = String(publicBase || '').trim();
    if (!base) {
        return {
            subscriptionUrl: '',
            subscriptionUrlRaw: '',
            subscriptionUrlNative: '',
            subscriptionUrlReconstructed: '',
            subscriptionUrlNativeRaw: '',
            subscriptionUrlReconstructedRaw: '',
            subscriptionUrlV2rayn: '',
            subscriptionUrlClash: '',
            subscriptionUrlMihomo: '',
            subscriptionUrlSingbox: '',
            subscriptionConverterConfigured: false,
        };
    }
    const query = {
        serverId: serverId || undefined,
        mode: mode === 'auto' ? undefined : mode,
    };
    const subscriptionUrl = appendQuery(base, query);
    const subscriptionUrlRaw = appendQuery(subscriptionUrl, { format: 'raw' });
    const subscriptionUrlNative = appendQuery(base, {
        serverId: serverId || undefined,
        mode: 'native',
    });
    const subscriptionUrlReconstructed = appendQuery(base, {
        serverId: serverId || undefined,
        mode: 'reconstructed',
    });
    const subscriptionUrlNativeRaw = appendQuery(base, {
        serverId: serverId || undefined,
        mode: 'native',
        format: 'raw',
    });
    const subscriptionUrlReconstructedRaw = appendQuery(base, {
        serverId: serverId || undefined,
        mode: 'reconstructed',
        format: 'raw',
    });

    const subscriptionUrlV2rayn = subscriptionUrl;
    const subscriptionUrlClash = appendQuery(subscriptionUrl, { format: 'clash' });
    const subscriptionUrlMihomo = appendQuery(subscriptionUrl, { format: 'mihomo' });
    const subscriptionUrlSingbox = '';

    return {
        subscriptionUrl,
        subscriptionUrlRaw,
        subscriptionUrlNative,
        subscriptionUrlReconstructed,
        subscriptionUrlNativeRaw,
        subscriptionUrlReconstructedRaw,
        subscriptionUrlV2rayn,
        subscriptionUrlClash,
        subscriptionUrlMihomo,
        subscriptionUrlSingbox,
        subscriptionConverterConfigured: false,
    };
}

function buildScopeTokenName(serverId = '') {
    return `auto-persistent:${serverId || 'all'}`;
}

function getOrCreateScopeToken(email, serverId = '', actor = 'admin') {
    const scopeName = buildScopeTokenName(serverId);
    const existing = subscriptionTokenStore.getFirstActiveTokenByName(email, scopeName);
    if (existing?.token) {
        return {
            token: existing.token,
            metadata: existing.metadata,
            scopeName,
            autoIssued: false,
            issueError: null,
        };
    }

    try {
        const issued = subscriptionTokenStore.issue(email, {
            name: scopeName,
            noExpiry: true,
            ttlDays: 0,
            ignoreActiveLimit: true,
            createdBy: actor,
        });
        return {
            token: issued.token,
            metadata: issued.metadata,
            scopeName,
            autoIssued: true,
            issueError: null,
        };
    } catch (error) {
        return {
            token: '',
            metadata: null,
            scopeName,
            autoIssued: false,
            issueError: error.message || 'Failed to issue persistent token',
        };
    }
}

function appendSubscriptionAccessAudit(req, payload = {}) {
    const ipDetails = resolveClientIpDetails(req);
    auditStore.appendSubscriptionAccess({
        email: payload.email,
        tokenId: payload.tokenId,
        ip: ipDetails.clientIp,
        clientIp: ipDetails.clientIp,
        proxyIp: ipDetails.proxyIp,
        ipSource: ipDetails.ipSource,
        cfCountry: ipDetails.cfCountry,
        userAgent: req?.headers?.['user-agent'] || '',
        status: payload.status,
        reason: payload.reason,
        serverId: payload.serverId,
        mode: payload.mode,
        format: payload.format,
    });
}

async function handlePublicTokenRequest(req, res, emailFromPath = '') {
    const hintedEmail = normalizeEmail(emailFromPath || req.params.email);
    const tokenId = String(req.params.tokenId || '').trim();
    const tokenSecret = String(req.params.token || '').trim();
    const mode = normalizeMode(req.query.mode);
    const serverId = normalizeServerId(req.query.serverId);
    const format = normalizeSubscriptionFormat(req.query.format);

    if (!tokenId || !tokenSecret) {
        appendSecurityAudit('subscription_public_denied', req, {
            reason: 'missing-token',
            email: hintedEmail,
            tokenId,
        });
        appendSubscriptionAccessAudit(req, {
            email: hintedEmail,
            tokenId,
            status: 'denied',
            reason: 'missing-token',
            mode,
            serverId,
            format,
        });
        return res.status(403).send('invalid subscription token');
    }

    const verification = hintedEmail
        ? subscriptionTokenStore.verify(hintedEmail, tokenId, tokenSecret)
        : subscriptionTokenStore.verifyByTokenId(tokenId, tokenSecret);
    const email = normalizeEmail(verification?.email || hintedEmail);
    if (!verification.ok) {
        appendSecurityAudit('subscription_public_denied', req, {
            reason: verification.reason,
            email,
            tokenId,
        });
        appendSubscriptionAccessAudit(req, {
            email,
            tokenId,
            status: verification.reason === 'expired'
                ? 'expired'
                : (verification.reason === 'revoked' ? 'revoked' : 'denied'),
            reason: verification.reason,
            mode,
            serverId,
            format,
        });
        if (verification.reason === 'expired') {
            return res.status(410).send('subscription token expired');
        }
        if (verification.reason === 'revoked') {
            return res.status(403).send('subscription token revoked');
        }
        return res.status(403).send('invalid subscription token');
    }

    const { links, serverNotFound, inactiveReason } = await buildMergedLinksByEmail(email, { mode, serverId });
    if (serverNotFound) {
        appendSubscriptionAccessAudit(req, {
            email,
            tokenId,
            status: 'denied',
            reason: 'server-not-found',
            mode,
            serverId,
            format,
        });
        return res.status(404).send('server not found');
    }
    if (links.length === 0) {
        appendSubscriptionAccessAudit(req, {
            email,
            tokenId,
            status: inactiveReason === 'all-expired-or-disabled' ? 'expired' : 'denied',
            reason: inactiveReason || 'no-links-found',
            mode,
            serverId,
            format,
        });
        return res.status(410).send(inactiveReason || 'no links found');
    }

    subscriptionTokenStore.touchLastUsedByTokenId(tokenId);
    appendSubscriptionAccessAudit(req, {
        email,
        tokenId,
        status: 'success',
        reason: 'ok',
        mode,
        serverId,
        format,
    });
    const { raw, encoded } = buildSubscriptionPayload(links);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Subscription-Token-Id', tokenId);
    if (format === 'clash') {
        const yaml = buildMihomoConfigFromLinks(links);
        if (!yaml) {
            return res.status(410).send('no clash-compatible links found');
        }
        res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
        return res.send(yaml);
    }
    if (format === 'raw') return res.send(raw);
    return res.send(encoded);
}

router.get('/public/t/:tokenId/:token', async (req, res) => {
    return handlePublicTokenRequest(req, res, '');
});

// Legacy route for backward compatibility.
router.get('/public/:email/:tokenId/:token', async (req, res) => {
    return handlePublicTokenRequest(req, res, req.params.email);
});

router.get('/public/:email/:sig', async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const sig = String(req.params.sig || '');
    const mode = normalizeMode(req.query.mode);
    const serverId = normalizeServerId(req.query.serverId);
    const format = normalizeSubscriptionFormat(req.query.format);

    if (!email || !verifyEmailSig(email, sig)) {
        appendSecurityAudit('subscription_public_denied_legacy', req, {
            reason: 'invalid-signature',
            email,
        });
        appendSubscriptionAccessAudit(req, {
            email,
            tokenId: 'legacy-signature',
            status: 'denied',
            reason: 'invalid-signature',
            mode,
            serverId,
            format,
        });
        return res.status(403).send('invalid subscription signature');
    }

    subscriptionTokenStore.migrateLegacySigToken(email, sig, { createdBy: 'legacy-signature' });
    const { links, serverNotFound, inactiveReason } = await buildMergedLinksByEmail(email, { mode, serverId });
    if (serverNotFound) {
        appendSubscriptionAccessAudit(req, {
            email,
            tokenId: 'legacy-signature',
            status: 'denied',
            reason: 'server-not-found',
            mode,
            serverId,
            format,
        });
        return res.status(404).send('server not found');
    }
    if (links.length === 0) {
        appendSubscriptionAccessAudit(req, {
            email,
            tokenId: 'legacy-signature',
            status: inactiveReason === 'all-expired-or-disabled' ? 'expired' : 'denied',
            reason: inactiveReason || 'no-links-found',
            mode,
            serverId,
            format,
        });
        return res.status(410).send(inactiveReason || 'no links found');
    }

    appendSubscriptionAccessAudit(req, {
        email,
        tokenId: 'legacy-signature',
        status: 'success',
        reason: 'ok',
        mode,
        serverId,
        format,
    });
    const { raw, encoded } = buildSubscriptionPayload(links);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Subscription-Legacy', '1');
    if (format === 'clash') {
        const yaml = buildMihomoConfigFromLinks(links);
        if (!yaml) {
            return res.status(410).send('no clash-compatible links found');
        }
        res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
        return res.send(yaml);
    }
    if (format === 'raw') return res.send(raw);
    return res.send(encoded);
});

router.get('/users', authMiddleware, adminOnly, async (req, res) => {
    const requestedServerId = normalizeServerId(req.query.serverId);
    const allServers = serverStore.getAll();
    const targetServers = requestedServerId
        ? allServers.filter((item) => item.id === requestedServerId)
        : allServers;

    if (requestedServerId && targetServers.length === 0) {
        return res.status(404).json({ success: false, msg: 'Server not found' });
    }

    const emails = new Set();
    const warnings = [];

    await Promise.all(targetServers.map(async (serverMeta) => {
        try {
            const client = await ensureAuthenticated(serverMeta.id);
            const listRes = await client.get('/panel/api/inbounds/list');
            const inbounds = sortInboundsForServer(serverMeta.id, Array.isArray(listRes.data?.obj) ? listRes.data.obj : []);

            for (const inbound of inbounds) {
                const settings = parseJsonObjectLike(inbound.settings, {});
                const clients = Array.isArray(settings.clients) ? settings.clients : [];
                for (const entry of clients) {
                    const email = normalizeEmail(entry.email);
                    if (email) emails.add(email);
                }
            }
        } catch (error) {
            warnings.push({
                serverId: serverMeta.id,
                server: serverMeta.name,
                reason: error.message,
            });
        }
    }));

    const users = Array.from(emails).sort((a, b) => a.localeCompare(b));
    return res.json({
        success: true,
        obj: {
            users,
            total: users.length,
            serverScope: requestedServerId || 'all',
            warnings,
        },
    });
});

router.get('/access/summary', authMiddleware, adminOnly, async (req, res) => {
    try {
        const summary = await summarizeSubscriptionAccess({
            from: req.query.from,
            to: req.query.to,
            email: req.query.email,
            tokenId: req.query.tokenId,
            status: req.query.status,
            ip: req.query.ip,
            serverId: req.query.serverId,
        }, {
            includeGeo: shouldIncludeGeoLookup(req),
        });
        return res.json({
            success: true,
            obj: summary,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            msg: error.message || 'Failed to query access summary',
        });
    }
});

router.get('/access', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await querySubscriptionAccess({
            page: req.query.page,
            pageSize: req.query.pageSize,
            from: req.query.from,
            to: req.query.to,
            email: req.query.email,
            tokenId: req.query.tokenId,
            status: req.query.status,
            ip: req.query.ip,
            serverId: req.query.serverId,
        }, {
            includeGeo: shouldIncludeGeoLookup(req),
        });
        return res.json({
            success: true,
            obj: result,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            msg: error.message || 'Failed to query access logs',
        });
    }
});

router.get('/:email/tokens', authMiddleware, adminOnly, (req, res) => {
    try {
        return res.json({
            success: true,
            obj: listSubscriptionTokens(req.params.email),
        });
    } catch (error) {
        return res.status(error?.status || 400).json({ success: false, msg: error.message || 'Email is required' });
    }
});

router.post('/:email/issue', authMiddleware, adminOnly, (req, res) => {
    try {
        const issued = issueSubscriptionToken(req.params.email, {
            name: req.body?.name,
            ttlDays: req.body?.ttlDays,
            createdBy: req.user?.role || 'admin',
            buildUrls: (token) => {
                const publicBase = buildTokenPublicBase(req, req.params.email, token);
                return buildSubscriptionUrls(publicBase, 'auto', '');
            },
        });
        appendSecurityAudit('subscription_token_issued', req, {
            email: issued.email,
            tokenId: issued.tokenId,
            ttlDays: issued.ttlDays,
            name: issued.name,
        });

        return res.json({
            success: true,
            obj: {
                email: issued.email,
                name: issued.name,
                ttlDays: issued.ttlDays,
                tokenId: issued.tokenId,
                token: issued.token,
                metadata: issued.metadata,
                ...issued.urls,
            },
        });
    } catch (error) {
        return res.status(error?.status || 400).json({
            success: false,
            msg: error.message || 'Failed to issue token',
        });
    }
});

router.post('/:email/revoke', authMiddleware, adminOnly, (req, res) => {
    try {
        const result = revokeSubscriptionTokens(req.params.email, req.body);
        if (result.revokeAll) {
            appendSecurityAudit('subscription_token_revoke_all', req, {
                email: result.email,
                revoked: result.revoked,
                reason: result.reason,
            });
            return res.json({
                success: true,
                obj: { email: result.email, revoked: result.revoked },
            });
        }

        appendSecurityAudit('subscription_token_revoked', req, {
            email: result.email,
            tokenId: result.tokenId,
            reason: result.reason,
        });
        return res.json({
            success: true,
            obj: result.revoked,
        });
    } catch (error) {
        return res.status(error?.status || 400).json({ success: false, msg: error.message || 'Failed to revoke token' });
    }
});

router.get('/:email/raw', authMiddleware, ensureEmailAccess, async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const mode = normalizeMode(req.query.mode);
    const serverId = normalizeServerId(req.query.serverId);
    const { links, serverNotFound, inactiveReason } = await buildMergedLinksByEmail(email, { mode, serverId });
    if (serverNotFound) {
        return res.status(404).json({ success: false, msg: 'Server not found' });
    }
    if (links.length === 0) {
        return res.status(410).json({
            success: false,
            msg: inactiveReason || 'No active links found for this user',
        });
    }
    const { raw } = buildSubscriptionPayload(links);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(raw);
});

router.get('/:email', authMiddleware, ensureEmailAccess, async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const mode = normalizeMode(req.query.mode);
    const serverId = normalizeServerId(req.query.serverId);

    const {
        links,
        skipped,
        warnings,
        perServer,
        sourceMode,
        serverNotFound,
        matchedClientsRaw,
        matchedClientsActive,
        filteredExpired,
        filteredDisabled,
        filteredByPolicy,
        subscriptionActive,
        inactiveReason,
        policy,
    } = await buildMergedLinksByEmail(email, { mode, serverId });

    if (serverNotFound) {
        return res.status(404).json({ success: false, msg: 'Server not found' });
    }

    const { raw, encoded } = buildSubscriptionPayload(links);
    const scopeToken = getOrCreateScopeToken(email, serverId, req.user?.role || 'admin');
    const tokenRequired = !scopeToken?.token;
    if (scopeToken.autoIssued && scopeToken.metadata?.id) {
        appendSecurityAudit('subscription_token_auto_issued', req, {
            email,
            tokenId: scopeToken.metadata.id,
            ttlDays: 0,
            scope: scopeToken.scopeName,
        });
    }

    let subscriptionUrl = '';
    let subscriptionUrlRaw = '';
    let subscriptionUrlNative = '';
    let subscriptionUrlReconstructed = '';
    let subscriptionUrlNativeRaw = '';
    let subscriptionUrlReconstructedRaw = '';
    let subscriptionUrlV2rayn = '';
    let subscriptionUrlClash = '';
    let subscriptionUrlMihomo = '';
    let subscriptionUrlSingbox = '';
    let subscriptionConverterConfigured = false;

    if (scopeToken?.token) {
        const publicBase = buildTokenPublicBase(req, email, scopeToken.token);
        const builtUrls = buildSubscriptionUrls(publicBase, mode, serverId);
        subscriptionUrl = builtUrls.subscriptionUrl;
        subscriptionUrlRaw = builtUrls.subscriptionUrlRaw;
        subscriptionUrlNative = builtUrls.subscriptionUrlNative;
        subscriptionUrlReconstructed = builtUrls.subscriptionUrlReconstructed;
        subscriptionUrlNativeRaw = builtUrls.subscriptionUrlNativeRaw;
        subscriptionUrlReconstructedRaw = builtUrls.subscriptionUrlReconstructedRaw;
        subscriptionUrlV2rayn = builtUrls.subscriptionUrlV2rayn;
        subscriptionUrlClash = builtUrls.subscriptionUrlClash;
        subscriptionUrlMihomo = builtUrls.subscriptionUrlMihomo;
        subscriptionUrlSingbox = builtUrls.subscriptionUrlSingbox;
        subscriptionConverterConfigured = builtUrls.subscriptionConverterConfigured === true;
    }
    const legacySubscriptionUrl = '';
    const tokens = subscriptionTokenStore.listByEmail(email, {
        includeRevoked: true,
        includeExpired: true,
    });

    return res.json({
        success: true,
        obj: {
            email,
            total: links.length,
            links,
            skipped,
            warnings,
            perServer,
            sourceMode,
            mode,
            subscriptionActive,
            inactiveReason: inactiveReason || null,
            matchedClientsRaw,
            matchedClientsActive,
            filteredExpired,
            filteredDisabled,
            filteredByPolicy,
            policy,
            raw,
            subscription: encoded,
            subscriptionUrl,
            subscriptionUrlRaw,
            subscriptionUrlNative,
            subscriptionUrlReconstructed,
            subscriptionUrlNativeRaw,
            subscriptionUrlReconstructedRaw,
            subscriptionUrlV2rayn,
            subscriptionUrlClash,
            subscriptionUrlMihomo,
            subscriptionUrlSingbox,
            subscriptionConverterConfigured,
            legacySubscriptionUrl,
            token: {
                tokenRequired,
                currentTokenId: scopeToken?.metadata?.id || '',
                scope: serverId ? 'server' : 'all',
                serverId: serverId || '',
                activeCount: subscriptionTokenStore.countActiveByEmail(email),
                activeLimit: config.subscription.maxActiveTokensPerUser,
                tokens,
                autoIssued: scopeToken.autoIssued,
                issueError: scopeToken.issueError || null,
            },
        },
    });
});

export default router;
export {
    buildMihomoConfigFromLinks,
    normalizeSubscriptionFormat,
    selectNativeSubIds,
};
