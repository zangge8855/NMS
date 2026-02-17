import { Router } from 'express';
import dns from 'dns/promises';
import net from 'net';
import serverStore from '../store/serverStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import config from '../config.js';

const router = Router();

function isPrivateIPv4(ip) {
    const parts = String(ip).split('.').map((item) => Number(item));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    return false;
}

function isPrivateIPv6(ip) {
    const lower = String(ip).toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
        return true; // link-local fe80::/10
    }
    if (lower.startsWith('::ffff:')) {
        const embedded = lower.replace('::ffff:', '');
        if (net.isIP(embedded) === 4) return isPrivateIPv4(embedded);
    }
    return false;
}

function isPrivateAddress(address) {
    const family = net.isIP(address);
    if (family === 4) return isPrivateIPv4(address);
    if (family === 6) return isPrivateIPv6(address);
    return false;
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

function splitPanelUrlAndBasePath(rawUrl, fallbackBasePath, options = {}) {
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
        return parsed.hostname || `Server ${index}`;
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

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function applyServerFilters(servers, query = {}) {
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

function buildGovernanceSummary(servers) {
    const groupCounter = {};
    const environmentCounter = {};
    const healthCounter = {};
    const tagCounter = {};

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
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count),
    };
}

async function validateServerUrl(url, options = {}) {
    const allowPrivate = options.allowPrivate === true;
    if (!url || typeof url !== 'string') return 'URL is required';

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return 'Invalid URL format';
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return 'Only http/https URLs are allowed';
    }

    if (parsed.username || parsed.password) {
        return 'URL must not include credentials';
    }

    const hostname = normalizeHostname(parsed.hostname);
    if (!allowPrivate) {
        if (isBlockedHostname(hostname)) {
            return 'localhost/internal hostnames are not allowed';
        }

        if (isPrivateAddress(hostname)) {
            return 'Private/internal IP addresses are not allowed';
        }

        if (net.isIP(hostname) !== 0) return null;

        try {
            const lookupResults = await dns.lookup(hostname, { all: true, verbatim: true });
            if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
                return 'Server hostname cannot be resolved';
            }
            if (lookupResults.some((item) => isPrivateAddress(item.address))) {
                return 'Server resolves to private/internal IP addresses';
            }
        } catch {
            return 'Failed to resolve server hostname';
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

/**
 * POST /api/servers
 * Register a new 3x-ui panel server.
 */
router.post('/', async (req, res) => {
    const { name, url, basePath, username, password, group, tags, environment, health } = req.body;
    if (!url || !username || !password) {
        return res.status(400).json({ success: false, msg: 'url, username, and password are required' });
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
        username,
        password,
        group,
        tags,
        environment,
        health,
    });
    appendSecurityAudit('server_added', req, {
        serverId: server.id,
        name: server.name,
        url: server.url,
    });

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
 *   common: { username, password, basePath },
 *   items: [{ name, url, basePath, username, password, line }],
 *   testConnection: true|false
 * }
 */
router.post('/batch', async (req, res) => {
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
    const commonBasePath = common.basePath;
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
        const requestedBasePath = item.basePath !== undefined ? item.basePath : commonBasePath;
        const group = item.group !== undefined ? item.group : commonGroup;
        const tags = item.tags !== undefined ? item.tags : commonTags;
        const environment = item.environment !== undefined ? item.environment : commonEnvironment;
        const health = item.health !== undefined ? item.health : commonHealth;

        if (!rawUrl) {
            results.push({
                line,
                success: false,
                msg: '缺少面板地址(url)',
            });
            continue;
        }

        if (!username || !password) {
            results.push({
                line,
                success: false,
                url: rawUrl,
                msg: '缺少用户名或密码',
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
                msg: '服务器已存在(同 URL + BasePath + 用户名)',
            });
            continue;
        }

        try {
            const server = serverStore.add({
                name: normalizedName,
                url: normalizedUrl,
                basePath: normalizedBasePath,
                username,
                password,
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

    appendSecurityAudit('server_batch_added', req, {
        total: summary.total,
        success: summary.success,
        failed: summary.failed,
    });

    return res.json({
        success: true,
        msg: `批量添加完成: ${summary.success}/${summary.total} 成功`,
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
router.put('/:id', async (req, res) => {
    const current = serverStore.getById(req.params.id);
    if (!current) {
        return res.status(404).json({ success: false, msg: 'Server not found' });
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
router.delete('/:id', (req, res) => {
    const serverId = String(req.params.id || '').trim();
    const removed = serverStore.remove(serverId);
    if (!removed) {
        return res.status(404).json({ success: false, msg: 'Server not found' });
    }
    const affectedPolicies = userPolicyStore.removeServerId(serverId, String(req.user?.username || req.user?.role || 'admin'));
    appendSecurityAudit('server_deleted', req, { serverId, affectedPolicies });
    res.json({
        success: true,
        msg: 'Server removed',
        obj: {
            serverId,
            affectedPolicies,
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
 *   persistCredentials?: boolean // default true when username+password provided
 * }
 */
router.post('/:id/test', async (req, res) => {
    try {
        const rawUsername = req.body?.username;
        const rawPassword = req.body?.password;
        const hasUsername = rawUsername !== undefined && rawUsername !== null && String(rawUsername).trim() !== '';
        const hasPassword = rawPassword !== undefined && rawPassword !== null && String(rawPassword) !== '';
        const hasManualCredentials = hasUsername || hasPassword;

        if (hasManualCredentials && (!hasUsername || !hasPassword)) {
            return res.status(400).json({
                success: false,
                code: 'PANEL_CREDENTIAL_INPUT_INVALID',
                msg: 'username and password must both be provided',
            });
        }

        const authOptions = hasManualCredentials
            ? {
                username: String(rawUsername).trim(),
                password: String(rawPassword),
                forceLogin: true,
            }
            : undefined;

        const client = await ensureAuthenticated(req.params.id, authOptions);
        if (hasManualCredentials && parseBoolean(req.body?.persistCredentials, true)) {
            serverStore.update(req.params.id, {
                username: String(rawUsername).trim(),
                password: String(rawPassword),
            });
            appendSecurityAudit('server_credentials_updated_via_test', req, {
                serverId: req.params.id,
            });
        }
        const statusRes = await client.get('/panel/api/server/status');
        appendSecurityAudit('server_test_success', req, { serverId: req.params.id });
        res.json({ success: true, msg: 'Connection successful', obj: statusRes.data?.obj });
    } catch (e) {
        if (e?.code === 'PANEL_CREDENTIAL_UNREADABLE' || e?.code === 'PANEL_CREDENTIAL_MISSING') {
            return res.status(400).json({
                success: false,
                code: e.code,
                msg: '节点凭据不可用，请重新输入并保存 3x-ui 管理用户名/密码',
            });
        }
        if (e?.code === 'PANEL_LOGIN_FAILED') {
            return res.status(401).json({
                success: false,
                code: e.code,
                msg: `连接失败：${e.message || '3x-ui 用户名或密码错误'}`,
            });
        }
        appendSecurityAudit('server_test_failed', req, {
            serverId: req.params.id,
            error: e.message,
        });
        res.status(500).json({ success: false, msg: `Connection failed: ${e.message}` });
    }
});

export { isBlockedHostname, validateServerUrl };
export default router;
