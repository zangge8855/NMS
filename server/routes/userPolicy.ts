import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import serverStore from '../store/serverStore.js';
import userPolicyStore, { ALLOWED_PROTOCOLS, POLICY_SCOPE_MODES } from '../store/userPolicyStore.js';
import { updateManagedUserPolicyByEmail } from '../services/userAdminService.js';

const router = Router();

function normalizeEmail(email: unknown): string {
    return String(email || '').trim().toLowerCase();
}

function normalizeServerIds(input: any = []): string[] {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function normalizeProtocols(input: any = []): string[] {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => ALLOWED_PROTOCOLS.has(item))
    ));
}

function normalizeInboundKeys(input: any = []): string[] {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function normalizeTextList(input: any = []): string[] {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function normalizeScopeMode(input: unknown, fallback: string = 'all'): string {
    const normalizedFallback = POLICY_SCOPE_MODES.has(String(fallback || '').trim().toLowerCase())
        ? String(fallback || '').trim().toLowerCase()
        : 'all';
    const text = String(input || '').trim().toLowerCase();
    if (!text) return normalizedFallback;
    if (!POLICY_SCOPE_MODES.has(text)) return normalizedFallback;
    return text;
}

function normalizeNonNegativeInt(value: unknown, fallback: number = 0): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function parseRequestLimit(value: unknown, field: string): number {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        const error: any = new Error(`Invalid value for ${field}: expected a non-negative number`);
        error.status = 400;
        throw error;
    }
    return Math.floor(parsed);
}

function sanitizeUserRecord(user: any): any {
    if (!user || typeof user !== 'object') return user;
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        subscriptionEmail: user.subscriptionEmail,
        groupId: user.groupId,
        role: user.role,
        enabled: user.enabled !== false,
        emailVerified: !!user.emailVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt || null,
    };
}

function sanitizePolicyResult(result: any): any {
    if (!result || typeof result !== 'object') return result;
    const next = { ...result };
    if (next.target) next.target = sanitizeUserRecord(next.target);
    if (next.updated) next.updated = sanitizeUserRecord(next.updated);
    if (next.user) next.user = sanitizeUserRecord(next.user);
    return next;
}

router.use(authMiddleware);

router.get('/:email', (req: Request, res: Response) => {
    const email = normalizeEmail(req.params.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: 'Email is required' });
    }

    const policy = userPolicyStore.get(email);
    return res.json({
        success: true,
        obj: policy,
    });
});

router.put('/:email', async (req: Request, res: Response) => {
    const email = normalizeEmail(req.params.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: 'Email is required' });
    }

    const currentPolicy = userPolicyStore.get(email);
    const hasAllowedServerIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedServerIds');
    const hasBlockedServerIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'blockedServerIds');
    const hasAllowedProtocols = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedProtocols');
    const hasServerScopeMode = Object.prototype.hasOwnProperty.call(req.body || {}, 'serverScopeMode');
    const hasProtocolScopeMode = Object.prototype.hasOwnProperty.call(req.body || {}, 'protocolScopeMode');
    const allowedServerIds = hasAllowedServerIds ? normalizeServerIds(req.body?.allowedServerIds) : (currentPolicy.allowedServerIds || []);
    const blockedServerIds = hasBlockedServerIds ? normalizeServerIds(req.body?.blockedServerIds) : (currentPolicy.blockedServerIds || []);
    const existingServerIds = new Set(serverStore.getAll().map((item: any) => item.id));
    const invalidServerIds = [...allowedServerIds, ...blockedServerIds].filter((item) => !existingServerIds.has(item));
    if (invalidServerIds.length > 0) {
        return res.status(400).json({
            success: false,
            msg: `Unknown server IDs: ${invalidServerIds.join(', ')}`,
        });
    }

    const allowedProtocols = hasAllowedProtocols ? normalizeProtocols(req.body?.allowedProtocols) : (currentPolicy.allowedProtocols || []);
    const hasAllowedInboundKeys = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedInboundKeys');
    const allowedInboundKeys = hasAllowedInboundKeys
        ? normalizeInboundKeys(req.body?.allowedInboundKeys)
        : (currentPolicy.allowedInboundKeys || []);
    const hasBlockedInboundKeys = Object.prototype.hasOwnProperty.call(req.body || {}, 'blockedInboundKeys');
    const blockedInboundKeys = hasBlockedInboundKeys
        ? normalizeInboundKeys(req.body?.blockedInboundKeys)
        : (currentPolicy.blockedInboundKeys || []);
    let serverScopeMode = hasServerScopeMode
        ? normalizeScopeMode(req.body?.serverScopeMode, allowedServerIds.length > 0 ? 'selected' : 'all')
        : normalizeScopeMode(currentPolicy.serverScopeMode, allowedServerIds.length > 0 ? 'selected' : 'all');
    let protocolScopeMode = hasProtocolScopeMode
        ? normalizeScopeMode(req.body?.protocolScopeMode, allowedProtocols.length > 0 ? 'selected' : 'all')
        : normalizeScopeMode(currentPolicy.protocolScopeMode, allowedProtocols.length > 0 ? 'selected' : 'all');

    if (serverScopeMode === 'selected' && allowedServerIds.length === 0) {
        serverScopeMode = 'none';
    }
    if (protocolScopeMode === 'selected' && allowedProtocols.length === 0) {
        protocolScopeMode = 'none';
    }

    try {
        const result = await updateManagedUserPolicyByEmail(
            email,
            {
                allowedServerIds,
                blockedServerIds,
                allowedProtocols,
                allowedInboundKeys,
                blockedInboundKeys,
                serverScopeMode,
                protocolScopeMode,
                expiryTime: Object.prototype.hasOwnProperty.call(req.body || {}, 'expiryTime')
                    ? parseRequestLimit(req.body?.expiryTime, 'expiryTime')
                    : normalizeNonNegativeInt(currentPolicy.expiryTime, 0),
                limitIp: Object.prototype.hasOwnProperty.call(req.body || {}, 'limitIp')
                    ? parseRequestLimit(req.body?.limitIp, 'limitIp')
                    : normalizeNonNegativeInt(currentPolicy.limitIp, 0),
                trafficLimitBytes: Object.prototype.hasOwnProperty.call(req.body || {}, 'trafficLimitBytes')
                    ? parseRequestLimit(req.body?.trafficLimitBytes, 'trafficLimitBytes')
                    : normalizeNonNegativeInt(currentPolicy.trafficLimitBytes, 0),
                speedLimitUp: Object.prototype.hasOwnProperty.call(req.body || {}, 'speedLimitUp')
                    ? parseRequestLimit(req.body?.speedLimitUp, 'speedLimitUp')
                    : normalizeNonNegativeInt(currentPolicy.speedLimitUp, 0),
                speedLimitDown: Object.prototype.hasOwnProperty.call(req.body || {}, 'speedLimitDown')
                    ? parseRequestLimit(req.body?.speedLimitDown, 'speedLimitDown')
                    : normalizeNonNegativeInt(currentPolicy.speedLimitDown, 0),
                trafficResetCycle: String(req.body?.trafficResetCycle || currentPolicy.trafficResetCycle || 'none').trim().toLowerCase(),
                ipLimitPolicy: String(req.body?.ipLimitPolicy || currentPolicy.ipLimitPolicy || 'first-wins').trim().toLowerCase(),
                inheritGroup: req.body?.inheritGroup === true,
                overrideFields: normalizeTextList(req.body?.overrideFields),
            },
            (req as any).user?.username || (req as any).user?.role || 'admin'
        );
        appendSecurityAudit('user_policy_updated', req, {
            email: result.subscriptionEmail,
            subscriptionEmail: result.subscriptionEmail,
            targetUserId: result.target?.id || '',
            targetUsername: result.target?.username || '',
            allowedServerIds,
            blockedServerIds,
            allowedProtocols,
            allowedInboundKeys: result.policy?.allowedInboundKeys || [],
            blockedInboundKeys: result.policy?.blockedInboundKeys || [],
            serverScopeMode,
            protocolScopeMode,
            expiryTime: result.policy?.expiryTime || 0,
            limitIp: result.policy?.limitIp || 0,
            trafficLimitBytes: result.policy?.trafficLimitBytes || 0,
            syncFailureCount: Number(result.clientSync?.failed || 0) + Number(result.deployment?.failed || 0),
        });

        return res.json({
            success: true,
            msg: result.partialFailure
                ? '订阅策略已保存，但部分节点同步失败'
                : '订阅策略已保存',
            obj: sanitizePolicyResult(result),
        });
    } catch (error: any) {
        return res.status(400).json({
            success: false,
            msg: error.message || 'Update policy failed',
        });
    }
});

export default router;
export { parseRequestLimit };
