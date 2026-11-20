import { Router } from 'express';
import dns from 'dns/promises';
import net from 'net';
import serverStore from '../store/serverStore.js';
import userStore from '../store/userStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import userGroupStore from '../store/userGroupStore.js';
import serverTelemetryStore from '../store/serverTelemetryStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import { derivePanelHealthFromStatus, ensureAuthenticated, fetchPanelServerStatus } from '../lib/panelClient.js';
import { normalizePanelType } from '../lib/panelType.js';
import { authMiddleware, adminOnly, operatorOrAbove } from '../middleware/auth.js';
import { pickLocalizedText, resolveRequestLocale, pickRequestText } from '../lib/requestLocale.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import config from '../config.js';
import { normalizeBoolean as parseBoolean } from '../lib/normalize.js';
import { buildGlobalDashboardSnapshot, buildSingleDashboardSnapshot, evictServerDashboardCaches } from '../lib/dashboardSnapshotService.js';
import { evictServerStatusCaches } from '../lib/serverStatusService.js';
import { buildServerDetailSnapshot } from '../lib/serverDetailSnapshotService.js';
import { buildErrorSnapshot, getServerLogSnapshot, getServerLogSnapshots } from '../lib/serverLogsSnapshotService.js';
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';
import { isReservedOrPrivateIp, stripIpv6Brackets } from '../lib/ipGeoResolver.js';
import { pingServer } from '../lib/probe.js';
import { fetchServerLogPayload as fetchServerLogResult, normalizeLogCount as normalizeRequestedLogCount, normalizeLogSource as normalizeRequestedLogSource } from '../services/panelLogsService.js';
import { invalidatePublicSubCache } from './subscriptions.js';

const router = Router();

function isPrivateAddress(address) {
    return isReservedOrPrivateIp(address);
}

function normalizeHostname(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
    return host;
}

function isBlockedHostname(hostname) {
    const host = normalizeHostname(hostname);
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local')) return true;
    if (host.endsWith('.internal')) return true;
    if (host.endsWith('.test')) return true;
    if (host.endsWith('.invalid')) return true;
    if (host.endsWith('.example')) return true;
    if (net.isIP(host) !== 0) return false; // allow IPv4/IPv6 literals
    if (!host.includes('.')) return true; // block single-label names
    return false;
}

function normalizeBasePathInput(basePath) {
    if (basePath === undefined || basePath === null) return '/';
    const text = String(basePath).trim();
    if (!text || text === '/') return '/';
    let normalized = text;
    if (!normalized.startsWith('/')) normalized = `/${normalized}`;
    normalized = normalized.replace(/\/+$/, '');
    return normalized || '/';
}

function splitPanelUrlAndBasePath(rawUrl, fallbackBasePath, options: any = {}) {
    const preferPathFromUrl = options.preferPathFromUrl === true;
    const fallback = normalizeBasePathInput(fallbackBasePath);
    try {
        const parsed = new URL(String(rawUrl || '').trim());
        const normalizedUrl = `${parsed.protocol}//${parsed.host}`;
        const pathname = String(parsed.pathname || '').trim();
        const pathFromUrl = pathname && pathname !== '/' ? normalizeBasePathInput(pathname) : '/';
        const usePathFromUrl = pathFromUrl !== '/' && (fallback === '/' || preferPathFromUrl);
        return {
            url: normalizedUrl,
            basePath: usePathFromUrl ? pathFromUrl : fallback,
        };
    } catch {
        return {
            url: String(rawUrl || '').trim(),
            basePath: fallback,
        };
    }
}

function deriveServerName(name, url, index) {
    const normalizedName = String(name || '').trim();
    if (normalizedName) return normalizedName;
    try {
        const parsed = new URL(url);
        return stripIpv6Brackets(parsed.hostname) || `Server ${index}`;
    } catch {
        return `Server ${index}`;
    }
}

function buildServerDedupeKey(url, basePath, username) {
    return `${String(url || '').trim().toLowerCase()}|${normalizeBasePathInput(basePath).toLowerCase()}|${String(username || '').trim().toLowerCase()}`;
}

function parseTagList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

function applyServerFilters(servers, query: any = {}) {
    const group = String(query.group || '').trim().toLowerCase();
    const environment = String(query.environment || '').trim().toLowerCase();
    const health = String(query.health || '').trim().toLowerCase();
    const tagList = parseTagList(query.tag).map((item) => item.toLowerCase());
    const q = String(query.q || '').trim().toLowerCase();

    return servers.filter((server) => {
        if (group && String(server.group || '').trim().toLowerCase() !== group) return false;
        if (environment && String(server.environment || '').trim().toLowerCase() !== environment) return false;
        if (health && String(server.health || '').trim().toLowerCase() !== health) return false;
        if (tagList.length > 0) {
            const existing = new Set((Array.isArray(server.tags) ? server.tags : []).map((item) => String(item || '').toLowerCase()));
            if (!tagList.every((tag) => existing.has(tag))) return false;
        }
        if (q) {
            const haystack = [
                server.name,
                server.url,
                server.basePath,
                server.panelType,
                server.username,
                server.group,
                server.environment,
                server.health,
                ...(Array.isArray(server.tags) ? server.tags : []),
            ]
                .map((item) => String(item || '').toLowerCase())
                .join(' ');
            if (!haystack.includes(q)) return false;
        }
        return true;
    });
}

function buildGovernanceSummary(servers: any[]) {
    const groupCounter: Record<string, number> = {};
    const environmentCounter: Record<string, number> = {};
    const healthCounter: Record<string, number> = {};
    const tagCounter: Record<string, number> = {};

    servers.forEach((server) => {
        const group = String(server.group || '').trim() || 'ungrouped';
        groupCounter[group] = (groupCounter[group] || 0) + 1;

        const environment = String(server.environment || '').trim() || 'unknown';
        environmentCounter[environment] = (environmentCounter[environment] || 0) + 1;

        const health = String(server.health || '').trim() || 'unknown';
        healthCounter[health] = (healthCounter[health] || 0) + 1;

        (Array.isArray(server.tags) ? server.tags : []).forEach((rawTag) => {
            const tag = String(rawTag || '').trim();
            if (!tag) return;
            tagCounter[tag] = (tagCounter[tag] || 0) + 1;
        });
    });

    return {
        total: servers.length,
        byGroup: groupCounter,
        byEnvironment: environmentCounter,
        byHealth: healthCounter,
        topTags: Object.entries(tagCounter)
            .map(([tag, count]) => ({ tag, count: Number(count) }))
            .sort((a, b) => b.count - a.count),
    };
}

function isUnsupportedPanelSettingEndpoint(error) {
    const status = Number(error?.response?.status || 0);
    const message = String(error?.response?.data?.msg || error?.message || '').toLowerCase();
    if (status === 404) {
        return !message.includes('token not found')
            && !message.includes('record not found')
            && !message.includes('not found token');
    }
    if ([405, 410, 501].includes(status)) return true;
    return message.includes('method not allowed')
        || message.includes('unsupported')
        || message.includes('not support')
        || message.includes('not implemented')
        || message.includes('no route');
}

function normalizePanelResponse(data, fallbackObj = null) {
    if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'success')) {
        return data;
    }
    return {
        success: true,
        obj: data === undefined ? fallbackObj : data,
    };
}

function normalizeTokenRows(payload) {
    const normalized = normalizePanelResponse(payload, []);
    const rows = Array.isArray(normalized.obj) ? normalized.obj : [];
    return rows.map((row) => {
        const token = String(row?.token || '').trim();
        const tokenPreview = token.length > 12
            ? `${token.slice(0, 6)}...${token.slice(-4)}`
            : (token ? 'configured' : '');
        const next = {
            ...row,
            scope: normalizePanelTokenScope(row?.scope) || PANEL_TOKEN_DEFAULT_SCOPE,
            tokenConfigured: Boolean(token),
            tokenPreview,
        };
        delete next.token;
        return next;
    });
}

// 3x-ui token scopes. Older panels have no scope column and treat every token as admin.
const PANEL_TOKEN_SCOPES = ['admin', 'monitor', 'node-sync', 'node-admin'];
const PANEL_TOKEN_DEFAULT_SCOPE = 'admin';

function normalizePanelTokenScope(value: unknown): string {
    const scope = String(value ?? '').trim().toLowerCase();
    return PANEL_TOKEN_SCOPES.includes(scope) ? scope : '';
}

/**
 * Current 3x-ui refuses to delete or toggle a token unless the caller names the scope it
 * expects the token to have. Use the caller's value, or read it from the token list.
 */
async function resolvePanelTokenExpectedScope(client: any, tokenId: string, provided: unknown): Promise<string> {
    const explicit = normalizePanelTokenScope(provided);
    if (explicit) return explicit;
    try {
        const response = await requestPanelApiTokenRoute(client, 'get');
        const row = normalizeTokenRows(response.data).find((item: any) => String(item?.id) === String(tokenId));
        if (row?.scope) return row.scope;
    } catch {
        // Fall through: an older panel ignores the field.
    }
    return PANEL_TOKEN_DEFAULT_SCOPE;
}

async function requestPanelApiTokenRoute(client: any, method: string, suffix: string = '', data: any = undefined) {
    const normalizedSuffix = suffix ? `/${String(suffix).replace(/^\/+/, '')}` : '';
    const attempts = [
        `/panel/api/setting/apiTokens${normalizedSuffix}`,
        `/panel/setting/apiTokens${normalizedSuffix}`,
    ];
    let lastError = null;
    for (const url of attempts) {
        try {
            return await client({
                method,
                url,
                data,
                timeout: 15_000,
            });
        } catch (err) {
            // The first route is the current one; its error explains the failure better
            // than the legacy fallback's generic 404.
            lastError = lastError || err;
            if (!isUnsupportedPanelSettingEndpoint(err)) {
                throw err;
            }
        }
    }
    throw lastError || new Error('No panel API token route attempts were provided');
}

function sendPanelTokenRouteError(res, error, fallbackMessage) {
    if (isUnsupportedPanelSettingEndpoint(error)) {
        const panelMsg = error?.response?.data?.msg;
        return res.status(501).json({
            success: false,
            msg: pickRequestText(res.req, '当前节点面板不支持通过 NMS 管理 API Token', 'This node panel does not support managing API tokens through NMS'),
            ...(typeof panelMsg === 'string' && panelMsg.trim() && panelMsg.length <= 300 ? { detail: panelMsg.trim() } : {}),
        });
    }
    if (error?.response) {
        return res.status(error.response.status || 502).json(error.response.data || {
            success: false,
            msg: fallbackMessage,
        });
    }
    return res.status(502).json({
        success: false,
        msg: error?.message || fallbackMessage,
    });
}

async function validateServerUrl(url, options: any = {}) {
    const allowPrivate = options.allowPrivate === true;
    if (!url || typeof url !== 'string') return '请填写节点面板地址';

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return '节点面板地址格式无效，请使用完整 http/https URL';
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '节点面板地址仅支持 http/https 协议';
    }

    if (parsed.username || parsed.password) {
        return '节点面板地址不能包含用户名或密码，请在凭据字段单独填写';
    }

    const hostname = normalizeHostname(parsed.hostname);
    if (!allowPrivate) {
        if (isBlockedHostname(hostname)) {
            return '节点面板地址不能使用 localhost 或内部保留主机名';
        }

        if (isPrivateAddress(hostname)) {
            return '节点面板地址不能使用私有或内部 IP';
        }

        if (net.isIP(hostname) !== 0) return null;

        try {
            const lookupResults = await dns.lookup(hostname, { all: true, verbatim: true });
            if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
                return '节点域名无法解析，请检查 URL 或 DNS 配置';
            }
            if (lookupResults.some((item) => isPrivateAddress(item.address))) {
                return '节点域名解析到私有或内部 IP，请更换可访问地址';
            }
        } catch {
            return '节点域名解析失败，请检查 URL 或 DNS 配置';
        }
    }

    return null;
}

// All server management routes require auth
router.use(authMiddleware);

/**
 * GET /api/servers
 * List all registered servers (without passwords).
 */
router.get('/', (req, res) => {
    const all = serverStore.getAll();
    const filtered = applyServerFilters(all, req.query || {});
    res.json({
        success: true,
        obj: filtered,
        meta: {
            total: all.length,
            filtered: filtered.length,
        },
    });
});

router.get('/governance/summary', (req, res) => {
    const all = serverStore.getAll();
    const filtered = applyServerFilters(all, req.query || {});
    return res.json({
        success: true,
        obj: buildGovernanceSummary(filtered),
    });
});

router.get('/telemetry/overview', (req, res) => {
    const all = serverStore.getAll();
    const filtered = applyServerFilters(all, req.query || {});
    return res.json({
        success: true,
        obj: serverTelemetryStore.getOverview({
            servers: filtered,
            hours: req.query.hours,
            points: req.query.points,
        }),
    });
});

router.get('/dashboard/snapshot', async (req, res) => {
    try {
        const payload = await buildGlobalDashboardSnapshot({
            force: parseBoolean(req.query?.refresh, false),
        }, {
            serverStore,
            userStore,
            systemSettingsStore,
        });
        return res.json({
            success: true,
            obj: payload,
        });
    } catch (error) {
        return res.status(error?.status || 500).json({
            success: false,
            msg: error.message || '获取仪表盘快照失败',
        });
    }
});

router.get('/logs/snapshot', async (req, res) => {
    try {
        const items = await getServerLogSnapshots({
            serverIds: String(req.query?.serverIds || '').trim(),
            source: req.query?.source,
            count: req.query?.count,
            force: parseBoolean(req.query?.refresh, false),
        });
        return res.json({
            success: true,
            obj: {
                items,
                fetchedAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        return res.status(error?.status || 502).json({
            success: false,
            msg: error.message || '获取日志快照失败',
        });
    }
});

router.get('/:id/logs', async (req, res) => {
    const normalizedServerId = String(req.params.id || '').trim();
    const server = serverStore.getById(normalizedServerId);
    if (!server) {
        return res.status(404).json({
            success: false,
            msg: pickRequestText(req, '节点不存在，请刷新节点列表后重试', 'Node not found. Refresh the node list and try again.'),
        });
    }

    const source = normalizeRequestedLogSource(req.query?.source);
    const count = normalizeRequestedLogCount(req.query?.count, 100);
    try {
        const payload = await getServerLogSnapshot(normalizedServerId, {
            source,
            count,
            force: parseBoolean(req.query?.refresh, false),
        }, {
            fetchServerLogPayload: fetchServerLogResult,
        });
        return res.json({
            success: true,
            obj: {
                serverId: payload.serverId,
                serverName: payload.serverName || '',
                source: payload.source || source,
                count: payload.count || count,
                supported: payload.supported !== false,
                warning: payload.warning || '',
                sourcePath: payload.sourcePath || '',
                lines: Array.isArray(payload.lines) ? payload.lines : [],
                fetchedAt: payload.fetchedAt || new Date().toISOString(),
            },
        });
    } catch (error) {
        return res.json({
            success: true,
            obj: buildErrorSnapshot(server, { source, count }, error),
        });
    }
});

router.get('/:id/dashboard/snapshot', async (req, res) => {
    try {
        const payload = await buildSingleDashboardSnapshot(req.params.id, {
            force: parseBoolean(req.query?.refresh, false),
        }, {
            serverStore,
            userStore,
            systemSettingsStore,
        });
        return res.json({
            success: true,
            obj: payload,
        });
    } catch (error) {
        return res.status(error?.status || 500).json({
            success: false,
            msg: error.message || '获取节点仪表盘快照失败',
        });
    }
});

router.get('/:id/snapshot', async (req, res) => {
    try {
        const payload = await buildServerDetailSnapshot(req.params.id, {
            force: parseBoolean(req.query?.refresh, false),
        }, {
            serverStore,
            systemSettingsStore,
        });
        return res.json({
            success: true,
            obj: payload,
        });
    } catch (error) {
        return res.status(error?.status || 500).json({
            success: false,
            msg: error.message || '获取服务器快照失败',
        });
    }
});

router.get('/:id/panel-api-tokens', adminOnly, async (req, res) => {
    try {
        const client = await ensureAuthenticated(req.params.id);
        const response = await requestPanelApiTokenRoute(client, 'get');
        if (response.data && typeof response.data === 'object' && response.data.success === false) {
            return res.json(response.data);
        }
        return res.json({
            success: true,
            obj: normalizeTokenRows(response.data),
        });
    } catch (error) {
        return sendPanelTokenRouteError(res, error, '获取面板 API Token 列表失败');
    }
});

router.post('/:id/panel-api-tokens', adminOnly, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
        return res.status(400).json({
            success: false,
            msg: 'token name is required',
        });
    }
    if (name.length > 64) {
        return res.status(400).json({
            success: false,
            msg: 'token name must be 64 characters or fewer',
        });
    }
    const rawScope = req.body?.scope;
    const scope = rawScope === undefined || rawScope === null || String(rawScope).trim() === ''
        ? PANEL_TOKEN_DEFAULT_SCOPE
        : normalizePanelTokenScope(rawScope);
    if (!scope) {
        return res.status(400).json({
            success: false,
            msg: `scope must be one of: ${PANEL_TOKEN_SCOPES.join(', ')}`,
        });
    }
    const expiresAt = Number(req.body?.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt < 0 || (expiresAt > 0 && expiresAt <= Date.now())) {
        return res.status(400).json({
            success: false,
            msg: 'expiresAt must be 0 (never) or a future unix-ms timestamp',
        });
    }

    try {
        const client = await ensureAuthenticated(req.params.id);
        const response = await requestPanelApiTokenRoute(client, 'post', 'create', {
            name,
            scope,
            expiresAt: Math.floor(expiresAt),
        });
        appendSecurityAudit('panel_api_token_created', req, {
            serverId: req.params.id,
            name,
            scope,
            expiresAt: Math.floor(expiresAt),
        });
        return res.status(response.status || 200).json(normalizePanelResponse(response.data));
    } catch (error) {
        return sendPanelTokenRouteError(res, error, '创建面板 API Token 失败');
    }
});

router.patch('/:id/panel-api-tokens/:tokenId', adminOnly, async (req, res) => {
    try {
        const client = await ensureAuthenticated(req.params.id);
        const enabled = parseBoolean(req.body?.enabled, true);
        const expectedScope = await resolvePanelTokenExpectedScope(client, req.params.tokenId, req.body?.expectedScope);
        const response = await requestPanelApiTokenRoute(client, 'post', `setEnabled/${encodeURIComponent(req.params.tokenId)}`, {
            enabled,
            expectedScope,
        });
        appendSecurityAudit('panel_api_token_enabled_changed', req, {
            serverId: req.params.id,
            tokenId: String(req.params.tokenId || ''),
            enabled,
        });
        return res.status(response.status || 200).json(normalizePanelResponse(response.data, true));
    } catch (error) {
        return sendPanelTokenRouteError(res, error, '更新面板 API Token 状态失败');
    }
});

router.delete('/:id/panel-api-tokens/:tokenId', adminOnly, async (req, res) => {
    try {
        const client = await ensureAuthenticated(req.params.id);
        const expectedScope = await resolvePanelTokenExpectedScope(
            client,
            req.params.tokenId,
            req.body?.expectedScope ?? req.query?.expectedScope
        );
        const response = await requestPanelApiTokenRoute(client, 'post', `delete/${encodeURIComponent(req.params.tokenId)}`, {
            expectedScope,
        });
        appendSecurityAudit('panel_api_token_deleted', req, {
            serverId: req.params.id,
            tokenId: String(req.params.tokenId || ''),
        });
        return res.status(response.status || 200).json(normalizePanelResponse(response.data, true));
    } catch (error) {
        return sendPanelTokenRouteError(res, error, '删除面板 API Token 失败');
    }
});

router.get('/:id', (req, res) => {
    const server = serverStore.getAll().find(s => s.id === req.params.id);
    if (!server) {
        const locale = resolveRequestLocale(req);
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '服务器不存在', 'Server not found') });
    }
    return res.json({ success: true, obj: server });
});

/**
 * POST /api/servers
 * Register a new 3x-ui or s-ui panel server.
 */
router.post('/', operatorOrAbove, async (req, res) => {
    const { name, url, basePath, panelType, username, password, apiToken, group, tags, environment, health } = req.body;
    const hasPasswordAuth = String(username || '').trim() && String(password || '');
    const hasApiTokenAuth = String(apiToken || '').trim();
    if (!url || (!hasPasswordAuth && !hasApiTokenAuth)) {
        return res.status(400).json({ success: false, msg: 'url and panel credentials or apiToken are required' });
    }

    const splitTarget = splitPanelUrlAndBasePath(url, basePath, { preferPathFromUrl: true });
    const urlError = await validateServerUrl(splitTarget.url, {
        allowPrivate: config.servers?.allowPrivateServerUrl === true,
    });
    if (urlError) {
        return res.status(400).json({ success: false, msg: urlError });
    }

    const server = serverStore.add({
        name,
        url: splitTarget.url,
        basePath: splitTarget.basePath,
        panelType,
        username,
        password,
        apiToken,
        group,
        tags,
        environment,
        health,
    });
    appendSecurityAudit('server_added', req, {
        serverId: server.id,
        name: server.name,
        url: server.url,
        panelType: server.panelType,
    });
    invalidateServerPanelSnapshotCache(server.id);
    evictServerDashboardCaches(server.id);
    evictServerStatusCaches(server.id);
    invalidatePublicSubCache();

    // Test connection
    try {
        await ensureAuthenticated(server.id);
        res.json({ success: true, obj: server, msg: 'Server added and connected' });
    } catch (e) {
        // Still add, but warn about connection
        res.json({ success: true, obj: server, msg: `Server added but connection failed: ${e.message}` });
    }
});

/**
 * POST /api/servers/batch
 * Batch register servers with shared credentials.
 *
 * body:
 * {
 *   common: { username, password, apiToken, basePath, panelType },
 *   items: [{ name, url, basePath, panelType, username, password, apiToken, line }],
 *   testConnection: true|false
 * }
 */
router.post('/batch', operatorOrAbove, async (req, res) => {
    const common = req.body?.common && typeof req.body.common === 'object' ? req.body.common : {};
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const shouldTestConnection = req.body?.testConnection !== false;

    if (items.length === 0) {
        return res.status(400).json({
            success: false,
            msg: 'items is required and must be a non-empty array',
        });
    }

    const commonUsername = String(common.username || '').trim();
    const commonPassword = String(common.password || '').trim();
    const commonApiToken = String(common.apiToken || '').trim();
    const commonBasePath = common.basePath;
    const commonPanelType = common.panelType;
    const commonGroup = common.group;
    const commonTags = common.tags;
    const commonEnvironment = common.environment;
    const commonHealth = common.health;

    const existingKeySet = new Set(
        serverStore.getAll().map((server) => buildServerDedupeKey(server.url, server.basePath || '/', server.username))
    );

    const results = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i] && typeof items[i] === 'object' ? items[i] : {};
        const line = Number.isInteger(item.line) && item.line > 0 ? item.line : (i + 1);

        const rawUrl = String(item.url || '').trim();
        const username = String(item.username || commonUsername || '').trim();
        const password = String(item.password || commonPassword || '').trim();
        const apiToken = String(item.apiToken || commonApiToken || '').trim();
        const requestedBasePath = item.basePath !== undefined ? item.basePath : commonBasePath;
        const panelType = normalizePanelType(item.panelType !== undefined ? item.panelType : commonPanelType);
        const group = item.group !== undefined ? item.group : commonGroup;
        const tags = item.tags !== undefined ? item.tags : commonTags;
        const environment = item.environment !== undefined ? item.environment : commonEnvironment;
        const health = item.health !== undefined ? item.health : commonHealth;

        if (!rawUrl) {
            results.push({
                line,
                success: false,
                msg: pickRequestText(req, '缺少面板地址(url)', 'Panel address (url) is required'),
            });
            continue;
        }

        if ((!username || !password) && !apiToken) {
            results.push({
                line,
                success: false,
                url: rawUrl,
                msg: pickRequestText(req, '缺少用户名/密码或 API Token', 'Username/password or API token is required'),
            });
            continue;
        }

        const splitTarget = splitPanelUrlAndBasePath(rawUrl, requestedBasePath);
        const normalizedUrl = splitTarget.url;
        const normalizedBasePath = splitTarget.basePath;
        const normalizedName = deriveServerName(item.name, normalizedUrl, i + 1);

        const urlError = await validateServerUrl(normalizedUrl, {
            allowPrivate: config.servers?.allowPrivateServerUrl === true,
        });

        if (urlError) {
            results.push({
                line,
                success: false,
                name: normalizedName,
                url: normalizedUrl,
                basePath: normalizedBasePath,
                msg: urlError,
            });
            continue;
        }

        const dedupeKey = buildServerDedupeKey(normalizedUrl, normalizedBasePath, username);
        if (existingKeySet.has(dedupeKey)) {
            results.push({
                line,
                success: false,
                name: normalizedName,
                url: normalizedUrl,
                basePath: normalizedBasePath,
                msg: pickRequestText(req, '服务器已存在(同 URL + BasePath + 用户名)', 'Server already exists (same URL + base path + username)'),
            });
            continue;
        }

        try {
            const server = serverStore.add({
                name: normalizedName,
                url: normalizedUrl,
                basePath: normalizedBasePath,
                panelType,
                username,
                password,
                apiToken,
                group,
                tags,
                environment,
                health,
            });

            existingKeySet.add(dedupeKey);
            appendSecurityAudit('server_added', req, {
                serverId: server.id,
                name: server.name,
                url: server.url,
            });

            let connected = null;
            let msg = '服务器已添加';

            if (shouldTestConnection) {
                try {
                    await ensureAuthenticated(server.id);
                    connected = true;
                    msg = '服务器已添加并连接成功';
                } catch (e) {
                    connected = false;
                    msg = `服务器已添加，但连接失败: ${e.message}`;
                }
            }

            results.push({
                line,
                success: true,
                connected,
                serverId: server.id,
                name: server.name,
                url: server.url,
                basePath: server.basePath,
                panelType: server.panelType,
                group: server.group || '',
                tags: Array.isArray(server.tags) ? server.tags : [],
                environment: server.environment || 'unknown',
                health: server.health || 'unknown',
                msg,
            });
        } catch (e) {
            results.push({
                line,
                success: false,
                name: normalizedName,
                url: normalizedUrl,
                basePath: normalizedBasePath,
                msg: e.message || '添加失败',
            });
        }
    }

    const summary = {
        total: items.length,
        success: results.filter((item) => item.success).length,
        failed: results.filter((item) => !item.success).length,
    };
    if (summary.success > 0) {
        for (const item of results) {
            if (item.success && item.serverId) {
                invalidateServerPanelSnapshotCache(item.serverId);
                evictServerDashboardCaches(item.serverId);
                evictServerStatusCaches(item.serverId);
            }
        }
        invalidatePublicSubCache();
    }

    appendSecurityAudit('server_batch_added', req, {
        total: summary.total,
        success: summary.success,
        failed: summary.failed,
    });

    return res.json({
        success: true,
        msg: pickRequestText(req, `批量添加完成: ${summary.success}/${summary.total} 成功`, `Batch add finished: ${summary.success}/${summary.total} succeeded`),
        obj: {
            summary,
            results,
        },
    });
});

/**
 * PUT /api/servers/:id
 * Update a registered server.
 */
router.put('/:id', operatorOrAbove, async (req, res) => {
    const current = serverStore.getById(req.params.id);
    if (!current) {
        const locale = resolveRequestLocale(req);
        return res.status(404).json({
            success: false,
            msg: pickLocalizedText(locale, '节点不存在，请刷新节点列表后重试', 'Node not found; refresh the server list and try again'),
        });
    }

    if (req.body.url) {
        const splitTarget = splitPanelUrlAndBasePath(
            req.body.url,
            req.body.basePath !== undefined ? req.body.basePath : current.basePath,
            { preferPathFromUrl: req.body.basePath === undefined }
        );

        const urlError = await validateServerUrl(splitTarget.url, {
            allowPrivate: config.servers?.allowPrivateServerUrl === true,
        });
        if (urlError) {
            return res.status(400).json({ success: false, msg: urlError });
        }

        req.body.url = splitTarget.url;
        req.body.basePath = splitTarget.basePath;
    } else if (req.body.basePath !== undefined) {
        req.body.basePath = normalizeBasePathInput(req.body.basePath);
    }

    const updated = serverStore.update(req.params.id, req.body);
    if (normalizePanelType(current.panelType) !== updated.panelType
        || current.url !== updated.url
        || current.basePath !== updated.basePath
        || current.name !== updated.name
        || current.health !== updated.health) {
        // Cached inbounds/status/names belong to the previous server configuration.
        invalidateServerPanelSnapshotCache(updated.id);
        evictServerDashboardCaches(updated.id);
        evictServerStatusCaches(updated.id);
    }
    invalidatePublicSubCache();
    appendSecurityAudit('server_updated', req, {
        serverId: updated.id,
        changedKeys: Object.keys(req.body || {}),
    });
    res.json({ success: true, obj: updated });
});

/**
 * DELETE /api/servers/:id
 * Remove a registered server.
 */
router.delete('/:id', operatorOrAbove, (req, res) => {
    const serverId = String(req.params.id || '').trim();
    const removed = serverStore.remove(serverId);
    if (!removed) {
        const locale = resolveRequestLocale(req);
        return res.status(404).json({
            success: false,
            msg: pickLocalizedText(locale, '节点不存在，请刷新节点列表后重试', 'Node not found; refresh the server list and try again'),
        });
    }
    systemSettingsStore.removeInboundRemark(serverId);
    systemSettingsStore.removeInboundHidden(serverId);
    const actor = String(req.user?.username || req.user?.role || 'admin');
    const affectedPolicies = userPolicyStore.removeServerId(serverId, actor);
    const affectedGroups = userGroupStore.removeServerId(serverId, actor);
    invalidateServerPanelSnapshotCache(serverId);
    evictServerDashboardCaches(serverId);
    evictServerStatusCaches(serverId);
    invalidatePublicSubCache();
    appendSecurityAudit('server_deleted', req, { serverId, affectedPolicies, affectedGroups });
    res.json({
        success: true,
        msg: 'Server removed',
        obj: {
            serverId,
            affectedPolicies,
            affectedGroups,
        },
    });
});

/**
 * POST /api/servers/:id/test
 * Test connection to a specific panel.
 *
 * Optional body:
 * {
 *   username?: string,
 *   password?: string,
 *   apiToken?: string,
 *   persistCredentials?: boolean // default true when username+password or apiToken provided
 * }
 */
router.post('/:id/test', operatorOrAbove, async (req, res) => {
    try {
        const rawUsername = req.body?.username;
        const rawPassword = req.body?.password;
        const rawApiToken = req.body?.apiToken;
        const hasUsername = rawUsername !== undefined && rawUsername !== null && String(rawUsername).trim() !== '';
        const hasPassword = rawPassword !== undefined && rawPassword !== null && String(rawPassword) !== '';
        const hasApiToken = rawApiToken !== undefined && rawApiToken !== null && String(rawApiToken).trim() !== '';
        const hasManualCredentials = hasUsername || hasPassword || hasApiToken;

        if ((hasUsername || hasPassword) && (!hasUsername || !hasPassword)) {
            return res.status(400).json({
                success: false,
                code: 'PANEL_CREDENTIAL_INPUT_INVALID',
                msg: 'username and password must both be provided, or use apiToken alone',
            });
        }

        const authOptions = hasManualCredentials
            ? {
                ...(hasUsername || hasPassword ? {
                    username: String(rawUsername).trim(),
                    password: String(rawPassword),
                } : {}),
                ...(hasApiToken ? {
                    apiToken: String(rawApiToken).trim(),
                } : {}),
                forceLogin: true,
            }
            : undefined;

        const client = await ensureAuthenticated(req.params.id, authOptions);
        if (hasManualCredentials && parseBoolean(req.body?.persistCredentials, true)) {
            serverStore.update(req.params.id, {
                ...(hasUsername || hasPassword ? {
                    username: String(rawUsername).trim(),
                    password: String(rawPassword),
                } : {}),
                ...(hasApiToken ? {
                    apiToken: String(rawApiToken).trim(),
                } : {}),
            });
            appendSecurityAudit('server_credentials_updated_via_test', req, {
                serverId: req.params.id,
            });
        }
        const statusRes = await fetchPanelServerStatus(client);
        const healthState = derivePanelHealthFromStatus(statusRes?.data || statusRes);
        const currentServer = serverStore.getById(req.params.id);
        if (currentServer && String(currentServer.health || '').trim().toLowerCase() !== 'maintenance') {
            serverStore.update(req.params.id, { health: healthState.health });
        }
        appendSecurityAudit('server_test_success', req, { serverId: req.params.id });
        res.json({ success: true, msg: 'Connection successful', obj: statusRes.data?.obj });
    } catch (e) {
        if (e?.code === 'PANEL_CREDENTIAL_UNREADABLE' || e?.code === 'PANEL_CREDENTIAL_MISSING') {
            return res.status(400).json({
                success: false,
                code: e.code,
                msg: pickRequestText(req, '节点凭据不可用，请重新输入并保存面板管理用户名/密码或 API Token', 'Node credentials are unavailable. Re-enter and save the panel username/password or API token.'),
            });
        }
        if (e?.code === 'PANEL_LOGIN_FAILED') {
            return res.status(401).json({
                success: false,
                code: e.code,
                msg: pickRequestText(req, '节点认证失败，请检查并重新保存面板用户名/密码', 'Node authentication failed. Check and re-save the panel username/password.'),
            });
        }
        appendSecurityAudit('server_test_failed', req, {
            serverId: req.params.id,
            error: e.message,
        });
        res.status(500).json({
            success: false,
            code: e?.code || 'PANEL_CONNECTION_FAILED',
            msg: pickRequestText(req, '节点面板连接失败，请检查面板地址、端口和网络访问策略', 'Could not connect to the node panel. Check the panel address, port and network access policy.'),
        });
    }
});

// ── Batch Update (labels, group, environment, tags) ───────
router.patch('/batch', operatorOrAbove, (req, res) => {
    const { serverIds, updates } = req.body || {};
    if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return res.status(400).json({ success: false, msg: 'serverIds is required' });
    }
    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ success: false, msg: 'updates is required' });
    }

    const allowed = ['name', 'group', 'tags', 'environment', 'health', 'panelType'];
    const filteredUpdates = {};
    for (const key of allowed) {
        if (updates[key] !== undefined) filteredUpdates[key] = updates[key];
    }
    if (Object.keys(filteredUpdates).length === 0) {
        return res.status(400).json({ success: false, msg: 'No valid update fields provided' });
    }

    const results = { updated: [], failed: [] };
    for (const id of serverIds) {
        try {
            const updated = serverStore.update(id, filteredUpdates);
            if (updated) {
                results.updated.push({ id, name: updated.name });
                invalidateServerPanelSnapshotCache(updated.id);
                evictServerDashboardCaches(updated.id);
                evictServerStatusCaches(updated.id);
            } else {
                results.failed.push({ id, msg: pickRequestText(req, '节点不存在，请刷新节点列表后重试', 'Node not found. Refresh the node list and try again.') });
            }
        } catch (err) {
            results.failed.push({ id, msg: String(err?.message || err) });
        }
    }
    if (results.updated.length > 0) {
        invalidatePublicSubCache();
    }

    appendSecurityAudit('servers_batch_update', req, {
        serverIds,
        updates: filteredUpdates,
        updatedCount: results.updated.length,
        failedCount: results.failed.length,
    });

    return res.json({
        success: results.failed.length === 0,
        msg: `Updated ${results.updated.length}/${serverIds.length} servers`,
        obj: results,
    });
});

function probeServer(urlStr: string): Promise<{ latencyMs: number, online: boolean, httpStatus?: number }> {
    return pingServer(urlStr, { timeoutMs: 2500 });
}

router.post('/ping-all', authMiddleware, operatorOrAbove, async (req: any, res: any) => {
    try {
        const servers = serverStore.getAll();
        const results: Record<string, { latencyMs: number, online: boolean }> = {};
        
        await Promise.all(servers.map(async (srv: any) => {
            const probe = await probeServer(srv.url);
            results[srv.id] = probe;
        }));
        
        res.json({ success: true, results });
    } catch (err) {
        res.status(500).json({ success: false, msg: String(err) });
    }
});

router.post('/:id/ping', authMiddleware, operatorOrAbove, async (req: any, res: any) => {
    try {
        const server = serverStore.getById(req.params.id);
        if (!server) {
            return res.status(404).json({ success: false, msg: 'Server not found' });
        }
        
        const probe = await probeServer(server.url);
        res.json({ success: true, ...probe });
    } catch (err) {
        res.status(500).json({ success: false, msg: String(err) });
    }
});

export {
    isBlockedHostname,
    normalizePanelTokenScope,
    normalizeTokenRows,
    requestPanelApiTokenRoute,
    resolvePanelTokenExpectedScope,
    validateServerUrl,
};
export default router;
