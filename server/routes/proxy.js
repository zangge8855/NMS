import { Router } from 'express';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { authMiddleware } from '../middleware/auth.js';
import multer from 'multer';
import {
    cleanupDepletedClientsCompat,
    clearClientIpsCompat,
    fetchClientRecordCompat,
    fetchPanelOnlineClients,
    getClientIpsCompat,
    isUnsupportedPanelEndpointError,
    parseLegacyAddClientBody,
    parseLegacyUpdateClientBody,
    postAddClientCompat,
    postAttachClientToInboundsCompat,
    postDeleteClientFromInboundCompat,
    postDetachClientFromInboundsCompat,
    postUpdateClientCompat,
    resetInboundTrafficCompat,
} from '../lib/panelApiCompat.js';
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 3,
        fields: 200,
    },
});
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_PREFIXES = ['/panel/api/', '/server/api/', '/sub/'];

function isAllowedPanelPath(path) {
    if (!path || typeof path !== 'string') return false;
    if (!path.startsWith('/')) return false;
    if (path.includes('..')) return false;
    return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function safeDecodePathSegment(value = '') {
    try {
        return decodeURIComponent(String(value || ''));
    } catch {
        return String(value || '');
    }
}

async function tryCompatPanelRequest(client, method, panelPath, body = {}) {
    if (method !== 'POST') return null;

    if (
        panelPath === '/panel/api/clients/onlinesByGuid'
        || panelPath === '/panel/api/clients/onlinesByNode'
        || panelPath === '/panel/api/clients/onlines'
        || panelPath === '/panel/api/inbounds/onlines'
    ) {
        return fetchPanelOnlineClients(client);
    }

    let match = panelPath.match(/^\/panel\/api\/inbounds\/clientIps\/([^/]+)$/);
    if (match) {
        return getClientIpsCompat(client, safeDecodePathSegment(match[1]));
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/clearClientIps\/([^/]+)$/);
    if (match) {
        return clearClientIpsCompat(client, safeDecodePathSegment(match[1]));
    }

    match = panelPath.match(/^\/panel\/api\/clients\/([^/]+)\/attach$/);
    if (match) {
        return postAttachClientToInboundsCompat(
            client,
            safeDecodePathSegment(match[1]),
            body?.inboundIds,
            { clientData: body?.client }
        );
    }

    match = panelPath.match(/^\/panel\/api\/clients\/([^/]+)\/detach$/);
    if (match) {
        return postDetachClientFromInboundsCompat(
            client,
            safeDecodePathSegment(match[1]),
            body?.inboundIds
        );
    }

    if (panelPath === '/panel/api/inbounds/addClient') {
        const parsed = parseLegacyAddClientBody(body);
        if (!parsed.client) return null;
        return postAddClientCompat(client, parsed.inboundId, parsed.client);
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/updateClient\/([^/]+)$/);
    if (match) {
        const identifier = safeDecodePathSegment(match[1]);
        const clientData = parseLegacyUpdateClientBody(body);
        return postUpdateClientCompat(client, body?.id, identifier, clientData, {
            clientData,
        });
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/([^/]+)\/delClient\/([^/]+)$/);
    if (match) {
        const inboundId = safeDecodePathSegment(match[1]);
        const identifier = safeDecodePathSegment(match[2]);
        return postDeleteClientFromInboundCompat(client, inboundId, identifier, {
            email: body?.email,
        });
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/delClient\/([^/]+)$/);
    if (match) {
        const inboundId = safeDecodePathSegment(match[1]);
        const identifier = body?.id || body?.clientId || body?.email || body?.password;
        if (!identifier) return null;
        return postDeleteClientFromInboundCompat(client, inboundId, identifier, {
            email: body?.email,
        });
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/(?:resetAllClientTraffics|resetTraffic)\/([^/]+)$/);
    if (match) {
        return resetInboundTrafficCompat(client, safeDecodePathSegment(match[1]));
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/delDepletedClients\/([^/]+)$/);
    if (match) {
        return cleanupDepletedClientsCompat(client, safeDecodePathSegment(match[1]));
    }

    return null;
}

async function tryCompatPanelGetRequest(client, panelPath) {
    let match = panelPath.match(/^\/panel\/api\/clients\/get\/([^/]+)$/);
    if (match) {
        const record = await fetchClientRecordCompat(client, safeDecodePathSegment(match[1]));
        if (!record?.client) {
            return {
                status: 404,
                data: { success: false, msg: 'client not found' },
            };
        }
        return {
            status: 200,
            data: { success: true, obj: record },
        };
    }

    return null;
}

// All proxy routes require auth
router.use(authMiddleware);

/**
 * ALL /api/panel/:serverId/*
 * Proxy requests to the specified 3x-ui panel.
 * The path after /api/panel/:serverId/ maps directly to the panel API path.
 *
 * Example:
 *   GET  /api/panel/abc123/panel/api/inbounds/list
 *   ->   GET  http://panel-server:2053/panel/api/inbounds/list
 */
router.all('/:serverId/*', upload.any(), async (req, res) => {
    const { serverId } = req.params;

    // Extract the actual panel API path (everything after /api/panel/:serverId)
    // req.params[0] captures the wildcard portion
    const panelPath = '/' + req.params[0];
    const method = String(req.method || '').toUpperCase();

    if (!ALLOWED_METHODS.has(method)) {
        return res.status(405).json({
            success: false,
            msg: `Method not allowed: ${method}`,
        });
    }

    if (!isAllowedPanelPath(panelPath)) {
        return res.status(400).json({
            success: false,
            msg: `Path not allowed: ${panelPath}`,
        });
    }

    try {
        const client = await ensureAuthenticated(serverId);

        const axiosConfig = {
            method: method.toLowerCase(),
            url: panelPath,
            timeout: 60000,
        };

        // Forward query params
        if (Object.keys(req.query).length > 0) {
            axiosConfig.params = req.query;
        }

        // Handle different content types
        if (req.files && req.files.length > 0) {
            // File upload (e.g., DB import)
            const FormData = (await import('form-data')).default;
            const form = new FormData();
            for (const file of req.files) {
                form.append(file.fieldname, file.buffer, {
                    filename: file.originalname,
                    contentType: file.mimetype,
                });
            }
            axiosConfig.data = form;
            axiosConfig.headers = {
                ...form.getHeaders(),
            };
        } else if (req.body && Object.keys(req.body).length > 0) {
            // Check the original content type
            const contentType = req.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
                axiosConfig.data = req.body;
                axiosConfig.headers = { 'Content-Type': 'application/json' };
            } else {
                // Default to form-urlencoded for 3x-ui compatibility
                const params = new URLSearchParams();
                for (const [key, val] of Object.entries(req.body)) {
                    if (typeof val === 'object') {
                        params.append(key, JSON.stringify(val));
                    } else {
                        params.append(key, val);
                    }
                }
                axiosConfig.data = params.toString();
                axiosConfig.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            }
        }

        const panelRes = await client(axiosConfig);

        // Handle binary responses (DB download)
        if (panelRes.headers['content-type']?.includes('application/octet-stream')) {
            res.set({
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': panelRes.headers['content-disposition'] || 'attachment; filename=x-ui.db',
            });
            return res.send(Buffer.from(panelRes.data));
        }

        // Invalidate cache if this was a modifying request
        if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
            invalidateServerPanelSnapshotCache(serverId);
        }

        // Forward JSON response
        res.status(panelRes.status).json(panelRes.data);
    } catch (error) {
        if (error?.message === 'Server not found') {
            return res.status(404).json({
                success: false,
                msg: '节点不存在，请刷新节点列表后重试',
            });
        }

        if (error?.code === 'PANEL_CREDENTIAL_UNREADABLE' || error?.code === 'PANEL_CREDENTIAL_MISSING') {
            return res.status(400).json({
                success: false,
                code: error.code,
                msg: '节点凭据不可用，请在“服务器管理”中重新输入并保存 3x-ui 凭据',
            });
        }
        if (error?.code === 'PANEL_LOGIN_FAILED') {
            return res.status(401).json({
                success: false,
                code: error.code,
                msg: `3x-ui 认证失败: ${error.message || '用户名或密码错误'}`,
            });
        }

        if (error.response && isUnsupportedPanelEndpointError(error)) {
            try {
                const client = await ensureAuthenticated(serverId);
                const compatRes = method === 'GET'
                    ? await tryCompatPanelGetRequest(client, panelPath)
                    : await tryCompatPanelRequest(client, method, panelPath, req.body || {});
                if (compatRes) {
                    return res.status(compatRes.status || 200).json(compatRes.data);
                }
            } catch (compatError) {
                if (compatError.response) {
                    return res.status(compatError.response.status).json(compatError.response.data || {
                        success: false,
                        msg: `Panel error: ${compatError.response.statusText}`,
                    });
                }
                return res.status(502).json({
                    success: false,
                    msg: `Failed to connect to panel: ${compatError.message}`,
                });
            }
        }

        if (error.response) {
            // Panel returned an error
            res.status(error.response.status).json(error.response.data || {
                success: false,
                msg: `Panel error: ${error.response.statusText}`,
            });
        } else {
            res.status(502).json({
                success: false,
                msg: `Failed to connect to panel: ${error.message}`,
            });
        }
    }
});

router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            msg: `Upload rejected: ${err.message}`,
        });
    }
    return next(err);
});

export default router;
