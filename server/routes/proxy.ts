import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { isSuiPanelServer } from '../lib/panelType.js';
import serverStore from '../store/serverStore.js';
import { authMiddleware } from '../middleware/auth.js';
import { ROLES } from '../store/userStore.js';
import multer from 'multer';
import {
    cleanupDepletedClientsCompat,
    clearClientIpsCompat,
    fetchClientRecordCompat,
    fetchPanelOnlineClients,
    getClientIpsCompat,
    isUnsupportedPanelEndpointError,
    normalizeInboundIds,
    parseLegacyAddClientBody,
    parseLegacyUpdateClientBody,
    postAddClientCompat,
    postAttachClientToInboundsCompat,
    postBulkAdjustClientsCompat,
    postDeleteClientFromInboundCompat,
    postDetachClientFromInboundsCompat,
    postUpdateClientCompat,
    resetInboundTrafficCompat,
    postRestartXrayCompat,
    postStopXrayCompat,
    postImportDBCompat,
    postUpdateGeofileCompat,
    postTelegramBackupCompat,
    getExportDBCompat,
    getTlsCertPathsCompat,
    postAddInboundCompat,
    postUpdateInboundCompat,
    postDeleteInboundCompat,
    getNewX25519CertCompat,
} from '../lib/panelApiCompat.js';
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';
import { enrichClientIpPayload } from '../lib/clientIpEnrichment.js';
import { invalidatePublicSubCache } from './subscriptions.js';
import { pickLocalizedText, resolveRequestLocale, pickRequestText } from '../lib/requestLocale.js';
import type { AppLocale } from '../lib/requestLocale.js';
import {
    evaluateProxyAccess,
    isMutatingProxyRequest,
    type ProxyAccessDenyReason,
} from '../lib/proxyAccessPolicy.js';

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
const ALLOWED_PREFIXES = ['/panel/api/', '/server/api/', '/sub/', '/sui/'];
// Native s-ui actions, answered by the s-ui adapter (never forwarded to a 3x-ui panel).
const SUI_NATIVE_PREFIX = '/sui/';

function decodePathIteratively(rawPath: string): string {
    let current = String(rawPath || '');
    for (let pass = 0; pass < 3; pass += 1) {
        if (current.includes('..') || current.includes('\\') || /[\x00-\x1f\x7f]/.test(current)) {
            return '';
        }
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current) break;
            current = decoded;
        } catch {
            break;
        }
    }
    if (current.includes('..') || current.includes('\\') || /[\x00-\x1f\x7f]/.test(current)) {
        return '';
    }
    return current;
}

function isAllowedPanelPath(rawPath: unknown): boolean {
    if (!rawPath || typeof rawPath !== 'string') return false;
    if (!rawPath.startsWith('/')) return false;
    const decoded = decodePathIteratively(rawPath);
    if (!decoded) return false;
    const normalizedRaw = path.posix.normalize(rawPath);
    const normalizedDecoded = path.posix.normalize(decoded);
    if (normalizedRaw.includes('..') || normalizedDecoded.includes('..')) return false;
    return (
        ALLOWED_PREFIXES.some((prefix) => normalizedRaw.startsWith(prefix))
        && ALLOWED_PREFIXES.some((prefix) => normalizedDecoded.startsWith(prefix))
    );
}

function proxyAccessDeniedMessage(locale: AppLocale, reason: ProxyAccessDenyReason | undefined): string {
    if (reason === 'admin_only_endpoint') {
        return pickLocalizedText(
            locale,
            '权限不足: 面板设置、API 令牌、面板用户、多节点管理和数据库导入导出仅限管理员',
            'Insufficient permissions: panel settings, API tokens, panel users, multi-node management and database import/export are restricted to administrators'
        );
    }
    if (reason === 'auditor_read_only') {
        return pickLocalizedText(
            locale,
            '权限不足: 审计员角色仅限只读查询',
            'Insufficient permissions: the auditor role is limited to read-only queries'
        );
    }
    return pickLocalizedText(
        locale,
        '权限不足: 当前角色无法访问节点控制代理',
        'Insufficient permissions: your role cannot access the node control proxy'
    );
}

function isPrimitiveFormArray(value: unknown): value is Array<string | number | boolean> {
    return Array.isArray(value)
        && value.length > 0
        && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
}

/**
 * Re-encode a parsed urlencoded body for the panel. Repeated keys arrive as an
 * array and go back out as repeated keys, which is what panels read with
 * PostFormArray (e.g. sub-balancer inboundIds). Other objects are sent as JSON.
 */
export function encodePanelFormBody(body: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(body || {})) {
        if (isPrimitiveFormArray(val)) {
            for (const item of val) params.append(key, String(item));
        } else if (val !== null && typeof val === 'object') {
            params.append(key, JSON.stringify(val));
        } else {
            params.append(key, val === undefined || val === null ? '' : String(val));
        }
    }
    return params.toString();
}

function safeDecodePathSegment(value: unknown = ''): string {
    try {
        return decodeURIComponent(String(value || ''));
    } catch {
        return String(value || '');
    }
}

async function tryCompatPanelRequest(client: any, method: string, panelPath: string, body: any = {}, files: any[] = []): Promise<any> {
    if (method !== 'POST') return null;

    if (panelPath === '/panel/api/server/restartXray' || panelPath === '/panel/api/server/restartXrayService') {
        return postRestartXrayCompat(client);
    }

    if (panelPath === '/panel/api/server/stopXray' || panelPath === '/panel/api/server/stopXrayService') {
        return postStopXrayCompat(client);
    }

    if (panelPath === '/panel/api/server/database/import' || panelPath === '/panel/api/server/importDB') {
        return postImportDBCompat(client, files);
    }

    if (panelPath === '/panel/api/server/geofile/update' || panelPath === '/panel/api/server/updateGeofile') {
        return postUpdateGeofileCompat(client);
    }

    if (panelPath === '/panel/api/server/telegram/backup' || panelPath === '/panel/api/backuptotgbot') {
        return postTelegramBackupCompat(client);
    }

    if (panelPath === '/panel/api/clients/add') {
        const clientData = body?.client;
        const inboundIds = normalizeInboundIds(body?.inboundIds);
        if (!clientData || inboundIds.length === 0) return null;
        for (const inboundId of inboundIds) {
            await postAddClientCompat(client, inboundId, clientData);
        }
        return {
            status: 200,
            data: { success: true, obj: { added: inboundIds.length } },
        };
    }

    if (panelPath === '/panel/api/clients/bulkAdjust') {
        return postBulkAdjustClientsCompat(client, body || {});
    }

    let match = panelPath.match(/^\/panel\/api\/clients\/update\/([^/]+)$/);
    if (match) {
        const email = safeDecodePathSegment(match[1]);
        const clientData = body || {};
        const record = await fetchClientRecordCompat(client, email);
        if (!record || !record.client || !record.inboundIds || record.inboundIds.length === 0) {
            return {
                status: 404,
                data: { success: false, msg: 'client not found' },
            };
        }
        for (const inboundId of record.inboundIds) {
            await postUpdateClientCompat(client, inboundId, email, clientData, {
                currentEmail: email,
                clientData,
            });
        }
        return {
            status: 200,
            data: { success: true, obj: clientData },
        };
    }

    match = panelPath.match(/^\/panel\/api\/clients\/del\/([^/]+)$/);
    if (match) {
        const email = safeDecodePathSegment(match[1]);
        const record = await fetchClientRecordCompat(client, email);
        if (!record || !record.inboundIds || record.inboundIds.length === 0) {
            return {
                status: 404,
                data: { success: false, msg: 'client not found' },
            };
        }
        for (const inboundId of record.inboundIds) {
            await postDeleteClientFromInboundCompat(client, inboundId, email, { email });
        }
        return {
            status: 200,
            data: { success: true, obj: { deleted: record.inboundIds.length } },
        };
    }

    match = panelPath.match(/^\/panel\/api\/clients\/resetTraffic\/([^/]+)$/);
    if (match) {
        const email = safeDecodePathSegment(match[1]);
        const encodedEmail = encodeURIComponent(email);
        try {
            return await client.post(`/panel/api/clients/resetTraffic/${encodedEmail}`);
        } catch (error) {
            if (!isUnsupportedPanelEndpointError(error)) {
                throw error;
            }
            return {
                status: 501,
                data: { success: false, msg: 'Resetting traffic for a single client is not supported by this panel version' },
            };
        }
    }

    if (
        panelPath === '/panel/api/clients/onlinesByGuid'
        || panelPath === '/panel/api/clients/onlinesByNode'
        || panelPath === '/panel/api/clients/onlines'
        || panelPath === '/panel/api/inbounds/onlines'
    ) {
        return fetchPanelOnlineClients(client);
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/clientIps\/([^/]+)$/) || panelPath.match(/^\/panel\/api\/clients\/ips\/([^/]+)$/);
    if (match) {
        const response = await getClientIpsCompat(client, safeDecodePathSegment(match[1]));
        if (response?.data?.success === false) return response;
        return {
            ...response,
            data: {
                ...(response.data || {}),
                obj: await enrichClientIpPayload(response?.data?.obj),
            },
        };
    }

    match = panelPath.match(/^\/panel\/api\/inbounds\/clearClientIps\/([^/]+)$/) || panelPath.match(/^\/panel\/api\/clients\/clearIps\/([^/]+)$/);
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

    if (panelPath === '/panel/api/inbounds/add' || panelPath === '/panel/inbounds/add' || panelPath === '/panel/inbound/add' || panelPath === '/panel/api/inbound/add') {
        return postAddInboundCompat(client, body || {});
    }

    match = panelPath.match(/^\/panel\/(?:api\/)?inbounds?\/update\/([^/]+)$/);
    if (match) {
        return postUpdateInboundCompat(client, safeDecodePathSegment(match[1]), body || {});
    }

    match = panelPath.match(/^\/panel\/(?:api\/)?inbounds?\/del\/([^/]+)$/);
    if (match) {
        return postDeleteInboundCompat(client, safeDecodePathSegment(match[1]));
    }

    if (panelPath === '/panel/api/server/getNewX25519Cert' || panelPath === '/panel/api/inbounds/getNewX25519Cert' || panelPath === '/server/getNewX25519Cert') {
        return getNewX25519CertCompat(client);
    }

    return null;
}

async function tryCompatPanelGetRequest(client: any, panelPath: string): Promise<any> {
    if (panelPath === '/panel/api/server/database/export' || panelPath === '/panel/api/server/getDb') {
        return getExportDBCompat(client);
    }

    if (panelPath === '/panel/api/server/tlsCertPaths' || panelPath === '/panel/api/server/getWebCertFiles') {
        return getTlsCertPathsCompat(client);
    }

    if (panelPath === '/panel/api/server/getNewX25519Cert' || panelPath === '/panel/api/inbounds/getNewX25519Cert' || panelPath === '/server/getNewX25519Cert') {
        return getNewX25519CertCompat(client);
    }

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

router.all('/:serverId/*', upload.any(), async (req: Request, res: Response) => {
    const { serverId } = req.params;

    const panelPath = '/' + req.params[0];
    const method = String(req.method || '').toUpperCase();

    if (!ALLOWED_METHODS.has(method)) {
        return res.status(405).json({
            success: false,
            msg: `Method not allowed: ${method}`,
        });
    }

    const locale = resolveRequestLocale(req);
    const userRole = (req as any).user?.role;
    if (userRole !== ROLES.admin && userRole !== ROLES.operator && userRole !== ROLES.auditor) {
        return res.status(403).json({
            success: false,
            msg: proxyAccessDeniedMessage(locale, 'role_not_permitted'),
        });
    }

    if (!isAllowedPanelPath(panelPath)) {
        return res.status(400).json({
            success: false,
            msg: `Path not allowed: ${panelPath}`,
        });
    }

    const decodedPanelPath = decodePathIteratively(panelPath) || panelPath;
    const canonicalPath = path.posix.normalize(decodedPanelPath);

    const access = evaluateProxyAccess(userRole, method, canonicalPath, req.body);
    if (!access.allowed) {
        return res.status(403).json({
            success: false,
            msg: proxyAccessDeniedMessage(locale, access.reason),
        });
    }

    const serverRecord = serverStore.getById(serverId);
    const isSuiServer = Boolean(serverRecord && isSuiPanelServer(serverRecord));
    const panelLabel = isSuiServer ? 's-ui' : '3x-ui';
    if (canonicalPath.startsWith(SUI_NATIVE_PREFIX) && serverRecord && !isSuiServer) {
        return res.status(400).json({
            success: false,
            msg: pickLocalizedText(locale, '该接口仅适用于 s-ui 节点', 'This endpoint is only available on s-ui nodes'),
        });
    }

    try {
        const client = await ensureAuthenticated(serverId);

        const axiosConfig: any = {
            method: method.toLowerCase(),
            url: canonicalPath,
            timeout: 60000,
        };
        if (canonicalPath === '/panel/api/server/database/export' || canonicalPath === '/panel/api/server/getDb') {
            axiosConfig.responseType = 'arraybuffer';
        }

        if (Object.keys(req.query).length > 0) {
            axiosConfig.params = req.query;
        }

        const files = req.files as Express.Multer.File[];
        if (files && files.length > 0) {
            const FormData = (await import('form-data')).default;
            const form = new FormData();
            for (const file of files) {
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
            const contentType = req.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
                axiosConfig.data = req.body;
                axiosConfig.headers = { 'Content-Type': 'application/json' };
            } else {
                axiosConfig.data = encodePanelFormBody(req.body);
                axiosConfig.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            }
        }

        const panelRes = await client(axiosConfig);

        if (String(panelRes.headers['content-type'] || '').includes('application/octet-stream')) {
            res.set({
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': panelRes.headers['content-disposition'] || 'attachment; filename=x-ui.db',
            });
            return res.send(Buffer.from(panelRes.data));
        }

        if (isMutatingProxyRequest(method, canonicalPath)) {
            invalidateServerPanelSnapshotCache(serverId);
            invalidatePublicSubCache();
        }

        let responseData = panelRes.data;
        if (
            canonicalPath.startsWith('/panel/api/inbounds/clientIps/')
            || canonicalPath.startsWith('/panel/api/clients/ips/')
        ) {
            if (responseData && typeof responseData === 'object' && responseData.obj !== undefined) {
                responseData = {
                    ...responseData,
                    obj: await enrichClientIpPayload(responseData.obj),
                };
            } else if (responseData) {
                responseData = await enrichClientIpPayload(responseData);
            }
        }

        res.status(panelRes.status).json(responseData);
    } catch (error: any) {
        if (error?.message === 'Server not found') {
            return res.status(404).json({
                success: false,
                msg: pickRequestText(req, '节点不存在，请刷新节点列表后重试', 'Node not found. Refresh the node list and try again.'),
            });
        }

        if (error?.code === 'PANEL_CREDENTIAL_UNREADABLE' || error?.code === 'PANEL_CREDENTIAL_MISSING') {
            return res.status(400).json({
                success: false,
                code: error.code,
                msg: pickRequestText(req, `节点凭据不可用，请在“服务器管理”中重新输入并保存 ${panelLabel} 凭据`, `Node credentials are unavailable. Re-enter and save the ${panelLabel} credentials under Server Management.`),
            });
        }
        if (error?.code === 'PANEL_LOGIN_FAILED') {
            return res.status(401).json({
                success: false,
                code: error.code,
                msg: pickRequestText(req, `${panelLabel} 认证失败: ${error.message || '用户名或密码错误'}`, `${panelLabel} authentication failed: ${error.message || 'invalid username or password'}`),
            });
        }

        if (error.response && isUnsupportedPanelEndpointError(error)) {
            try {
                const client = await ensureAuthenticated(serverId);
                const compatRes = method === 'GET'
                    ? await tryCompatPanelGetRequest(client, canonicalPath)
                    : await tryCompatPanelRequest(client, method, canonicalPath, req.body || {}, req.files as Express.Multer.File[]);
                if (compatRes) {
                    const compatStatus = Number(compatRes.status || 200);
                    if (compatStatus < 400 && isMutatingProxyRequest(method, canonicalPath)) {
                        invalidateServerPanelSnapshotCache(serverId);
                        invalidatePublicSubCache();
                    }
                    if (compatRes.isBinary) {
                        res.set(compatRes.headers || {});
                        return res.send(compatRes.data);
                    }
                    return res.status(compatStatus).json(compatRes.data);
                }
            } catch (compatError: any) {
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

router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            msg: `Upload rejected: ${err.message}`,
        });
    }
    return next(err);
});

export default router;
