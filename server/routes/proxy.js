import { Router } from 'express';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { authMiddleware } from '../middleware/auth.js';
import multer from 'multer';

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
const ALLOWED_PREFIXES = ['/panel/api/', '/sub/'];

function isAllowedPanelPath(path) {
    if (!path || typeof path !== 'string') return false;
    if (!path.startsWith('/')) return false;
    if (path.includes('..')) return false;
    return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
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

        // Forward JSON response
        res.status(panelRes.status).json(panelRes.data);
    } catch (error) {
        if (error?.message === 'Server not found') {
            return res.status(404).json({
                success: false,
                msg: `Server not found: ${serverId}`,
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
