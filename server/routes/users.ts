import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import userStore from '../store/userStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import userGroupStore from '../store/userGroupStore.js';
import auditStore from '../store/auditStore.js';
import subscriptionTokenStore from '../store/subscriptionTokenStore.js';
import { authMiddleware, auditorOrAbove, operatorOrAbove } from '../middleware/auth.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import { normalizeEmail } from '../lib/normalize.js';
import { querySubscriptionAccess } from '../services/subscriptionAuditService.js';
import { enrichAuditEvents } from '../lib/auditEventEnrichment.js';
import { resolveEffectivePolicy } from '../lib/userPolicyResolver.js';
import { autoDeployClients } from '../services/subscriptionSyncService.js';
import { pickLocalizedText, resolveRequestLocale } from '../lib/requestLocale.js';
import config from '../config.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import { resolvePublicBase } from './subscriptions.js';
import {
    cloneUserClientOnServer,
    removeUserExtraClientBinding,
    updateUserExtraClientBinding,
} from '../services/userClientCloneService.js';

const SAFE_HOST_HEADER_RE = /^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::\d{1,5})?$/;

export function resolveGuestPassSubscriptionBase(req: Request): string {
    const configured = String(
        systemSettingsStore.getSubscription()?.publicBaseUrl
        || config.subscription?.publicBaseUrl
        || ''
    ).trim().replace(/\/+$/, '');
    if (configured) {
        return configured;
    }
    const rawHost = String(typeof req.get === 'function' ? req.get('host') : req.headers?.host || '').trim();
    if (!rawHost || !SAFE_HOST_HEADER_RE.test(rawHost)) {
        return '';
    }
    return resolvePublicBase(req);
}

function assertOperatorCanManageUserTokens(req: Request, res: Response, user: any, locale: string): boolean {
    const actorRole = String((req as any).user?.role || '').trim().toLowerCase();
    const targetRole = String(user?.role || 'user').trim().toLowerCase();
    if (actorRole !== 'admin' && targetRole !== 'user') {
        res.status(403).json({
            success: false,
            msg: pickLocalizedText(
                locale as any,
                '权限不足：仅超级管理员可管理非普通用户账号的订阅令牌',
                'Insufficient permissions: only administrators may manage subscription tokens for staff accounts'
            ),
        });
        return false;
    }
    return true;
}

const router = Router();

router.use(authMiddleware);

function collectUserEmails(user: any): string[] {
    return Array.from(new Set([
        normalizeEmail(user?.email),
        normalizeEmail(user?.subscriptionEmail || user?.email),
    ].filter(Boolean)));
}

function buildAuditTarget(user: any) {
    const email = normalizeEmail(user?.email);
    const subscriptionEmail = normalizeEmail(user?.subscriptionEmail || user?.email);
    return {
        targetUserId: user?.id || '',
        targetUsername: user?.username || '',
        email: email || subscriptionEmail,
        subscriptionEmail,
    };
}

function mergeAuditResults(results: any[] = [], pageSize: number = 50) {
    const seen = new Set<string>();
    const items: any[] = [];

    results.forEach((result) => {
        (result?.items || []).forEach((item: any) => {
            const key = String(item?.id || `${item?.ts || ''}:${item?.eventType || ''}:${item?.path || ''}`);
            if (!key || seen.has(key)) return;
            seen.add(key);
            items.push(item);
        });
    });

    items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return {
        items: items.slice(0, pageSize),
        total: items.length,
    };
}

// GET /api/users/:id/detail — aggregate user detail
router.get('/:id/detail', auditorOrAbove, async (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '用户不存在', 'User not found') });
    }

    const trackedEmails = collectUserEmails(user);
    const subscriptionEmail = normalizeEmail(user.subscriptionEmail || user.email);

    // User basic info (public fields)
    const userInfo: any = {
        id: user.id,
        username: user.username,
        email: normalizeEmail(user.email),
        subscriptionEmail,
        groupId: String(user.groupId || '').trim(),
        groupName: '',
        emailVerified: !!user.emailVerified,
        role: user.role,
        enabled: user.enabled !== false,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt || null,
        isGuest: Boolean(user.isGuest),
        guestExpiresAt: user.guestExpiresAt || null,
        extraClients: userStore.listExtraClients(user.id),
    };

    // Access policy
    let policy: any = null;
    let effectivePolicy: any = null;
    let group: any = null;
    if (subscriptionEmail) {
        try {
            policy = userPolicyStore.get(subscriptionEmail);
            group = user.groupId ? userGroupStore.getById(user.groupId) : null;
            effectivePolicy = resolveEffectivePolicy(user, policy, group);
            if (group?.name) userInfo.groupName = group.name;
        } catch (e: any) { console.error(`[Users Route] Failed to get policy for ${subscriptionEmail}:`, e.message); }
    }

    // Recent audit events
    let recentAudit: any = { items: [], total: 0 };
    try {
        const auditQueries = trackedEmails.map((email) => auditStore.queryEvents({
            targetEmail: email,
            pageSize: 50,
        }));
        if (user.id) {
            auditQueries.push(auditStore.queryEvents({
                q: String(user.id),
                pageSize: 50,
            }));
        }
        recentAudit = mergeAuditResults(
            auditQueries,
            50
        );
        recentAudit = {
            ...recentAudit,
            items: await enrichAuditEvents(recentAudit.items),
        };
    } catch (e: any) { console.error(`[Users Route] Failed to query audit events:`, e.message); }

    // Subscription access logs
    let subscriptionAccess: any = { items: [], total: 0 };
    if (subscriptionEmail) {
        try {
            subscriptionAccess = await querySubscriptionAccess({
                email: subscriptionEmail,
                pageSize: 50,
            });
        } catch (e: any) { console.error(`[Users Route] Failed to query subscription access for ${subscriptionEmail}:`, e.message); }
    }

    // Subscription tokens
    let tokens: any[] = [];
    if (subscriptionEmail) {
        try {
            tokens = subscriptionTokenStore.listByEmail(subscriptionEmail);
        } catch (e: any) { console.error(`[Users Route] Failed to list tokens for ${subscriptionEmail}:`, e.message); }
    }

    return res.json({
        success: true,
        obj: {
            user: userInfo,
            policy,
            effectivePolicy,
            group,
            recentAudit,
            subscriptionAccess,
            tokens,
        },
    });
});

// GET /api/users/:id/tokens — list user's subscription tokens
router.get('/:id/tokens', auditorOrAbove, (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '用户不存在', 'User not found') });
    }
    const email = normalizeEmail(user.subscriptionEmail || user.email);
    if (!email) {
        return res.json({ success: true, obj: [] });
    }
    const tokens = subscriptionTokenStore.listByEmail(email);
    return res.json({ success: true, obj: tokens });
});

// POST /api/users/:id/tokens — issue new subscription token
router.post('/:id/tokens', operatorOrAbove, (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '用户不存在', 'User not found') });
    }
    if (!assertOperatorCanManageUserTokens(req, res, user, locale)) {
        return;
    }
    const email = normalizeEmail(user.subscriptionEmail || user.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: pickLocalizedText(locale, '用户未配置邮箱', 'User has no email configured') });
    }
    try {
        const explicitNoExpiry = req.body?.noExpiry === true;
        const rawTtl = Number(req.body?.ttlDays);
        const issueOptions: any = {
            name: String(req.body?.name || '').trim() || 'manual',
            noExpiry: explicitNoExpiry,
            createdBy: (req as any).user?.username || 'admin',
        };
        if (!explicitNoExpiry && Number.isFinite(rawTtl) && rawTtl > 0) {
            issueOptions.ttlDays = rawTtl;
        }
        const result = subscriptionTokenStore.issue(email, issueOptions);
        appendSecurityAudit('subscription_token_issued', req, {
            ...buildAuditTarget(user),
            tokenId: result.tokenId,
            publicTokenId: result.publicTokenId,
            tokenName: result.metadata?.name || '',
            ttlDays: result.ttlDays,
            noExpiry: result.metadata?.expiresAt === null,
        });
        return res.json({ success: true, obj: result });
    } catch (err: any) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

// DELETE /api/users/:id/tokens/:tid — revoke token
router.delete('/:id/tokens/:tid', operatorOrAbove, (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '用户不存在', 'User not found') });
    }
    if (!assertOperatorCanManageUserTokens(req, res, user, locale)) {
        return;
    }
    const email = normalizeEmail(user.subscriptionEmail || user.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: pickLocalizedText(locale, '用户未配置邮箱', 'User has no email configured') });
    }
    const result = subscriptionTokenStore.revoke(email, req.params.tid, 'admin-revoke');
    if (!result) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, 'Token 不存在', 'Token not found') });
    }
    appendSecurityAudit('subscription_token_revoked', req, {
        ...buildAuditTarget(user),
        tokenId: result.id,
        publicTokenId: result.publicTokenId || '',
        tokenName: result.name || '',
        revokedReason: result.revokedReason || 'admin-revoke',
    }, { outcome: 'success' });
    return res.json({ success: true, obj: result });
});

// POST /api/users/:id/clients/clone — clone/create an extra client on a single server for the same subscription
router.post('/:id/clients/clone', operatorOrAbove, async (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '用户不存在', 'User not found') });
    }
    if (!assertOperatorCanManageUserTokens(req, res, user, locale)) {
        return;
    }
    try {
        const actor = (req as any).user?.username || 'admin';
        const result = await cloneUserClientOnServer(req.params.id, req.body || {}, actor, { locale });
        appendSecurityAudit('user_client_cloned', req, {
            ...buildAuditTarget(user),
            serverId: result.serverId,
            serverName: result.serverName,
            inboundId: result.inboundId,
            inboundRemark: result.inboundRemark,
            protocol: result.protocol,
            clientEmail: result.clientEmail,
            nodeLabel: result.binding?.nodeLabel || '',
            trafficLimitBytes: result.entitlement?.trafficLimitBytes || 0,
            expiryTime: result.entitlement?.expiryTime || 0,
        });
        return res.status(201).json({
            success: true,
            msg: pickLocalizedText(locale, '客户端已复制并加入用户订阅', 'Client cloned and linked to the user subscription'),
            obj: result,
        });
    } catch (err: any) {
        return res.status(err?.status || 400).json({
            success: false,
            msg: err?.message || pickLocalizedText(locale, '复制客户端失败', 'Failed to clone client'),
        });
    }
});

// PATCH /api/users/:id/clients/extra/:bindingId — update cloned client node label
router.patch('/:id/clients/extra/:bindingId', operatorOrAbove, (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '用户不存在', 'User not found') });
    }
    if (!assertOperatorCanManageUserTokens(req, res, user, locale)) {
        return;
    }
    try {
        const updated = updateUserExtraClientBinding(req.params.id, req.params.bindingId, req.body || {}, { locale });
        appendSecurityAudit('user_client_clone_updated', req, {
            ...buildAuditTarget(user),
            bindingId: updated.id,
            serverId: updated.serverId,
            inboundId: updated.inboundId,
            clientEmail: updated.clientEmail,
            nodeLabel: updated.nodeLabel,
        });
        return res.json({
            success: true,
            msg: pickLocalizedText(locale, '已更新节点标签', 'Node label updated'),
            obj: updated,
        });
    } catch (err: any) {
        return res.status(err?.status || 400).json({
            success: false,
            msg: err?.message || pickLocalizedText(locale, '更新失败', 'Failed to update'),
        });
    }
});

// DELETE /api/users/:id/clients/extra/:bindingId — delete cloned client from panel and user subscription
router.delete('/:id/clients/extra/:bindingId', operatorOrAbove, async (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: pickLocalizedText(locale, '用户不存在', 'User not found') });
    }
    if (!assertOperatorCanManageUserTokens(req, res, user, locale)) {
        return;
    }
    try {
        const result = await removeUserExtraClientBinding(req.params.id, req.params.bindingId, { locale });
        appendSecurityAudit('user_client_clone_deleted', req, {
            ...buildAuditTarget(user),
            bindingId: result.removed?.id || req.params.bindingId,
            serverId: result.removed?.serverId || '',
            inboundId: result.removed?.inboundId || '',
            clientEmail: result.removed?.clientEmail || '',
            panelRemoved: result.panelRemoved,
            panelWarning: result.panelWarning || '',
        });
        return res.json({
            success: true,
            msg: result.panelWarning
                ? pickLocalizedText(
                    locale,
                    `已解除订阅绑定（面板清理提示：${result.panelWarning}）`,
                    `Unlinked from subscription (panel warning: ${result.panelWarning})`
                )
                : pickLocalizedText(locale, '已删除复制客户端', 'Cloned client removed'),
            obj: result,
        });
    } catch (err: any) {
        return res.status(err?.status || 400).json({
            success: false,
            msg: err?.message || pickLocalizedText(locale, '删除复制客户端失败', 'Failed to delete cloned client'),
        });
    }
});

/**
 * POST /api/users/guest-pass — 创建临时访客试用订阅码
 */
router.post('/guest-pass', authMiddleware, operatorOrAbove, async (req: Request, res: Response) => {
    const locale = resolveRequestLocale(req);
    try {
        const defaultNote = pickLocalizedText(locale, '访客临时体验', 'Guest trial');
        const { durationHours = 24, trafficLimitGb = 2, note = defaultNote } = req.body || {};
        const hours = Math.max(1, Math.min(720, Number(durationHours) || 24));
        const limitGb = Math.max(0.5, Math.min(100, Number(trafficLimitGb) || 2));
        const randomSuffix = crypto.randomBytes(3).toString('hex');
        const username = `guest_${randomSuffix}`;
        const email = `${username}@guest.local`;
        const tempPassword = `Pass_${crypto.randomBytes(4).toString('hex')}!`;
        const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

        const newUser = userStore.add({
            username,
            email,
            password: tempPassword,
            role: 'user',
            enabled: true,
            emailVerified: true,
            isGuest: true,
            guestExpiresAt: expiresAt,
        });

        // Set policy limits and auto-deploy credentials to active nodes
        if (newUser && newUser.id) {
            const guestPolicy = userPolicyStore.upsert(email, {
                serverScopeMode: 'all',
                protocolScopeMode: 'all',
                trafficLimitBytes: Math.floor(limitGb * 1024 * 1024 * 1024),
                expiryTime: new Date(expiresAt).getTime(),
                comment: pickLocalizedText(
                    locale,
                    `[临时访客] ${note} (${hours}小时限时 / ${limitGb}GB)`,
                    `[Guest Pass] ${note} (${hours}h limit / ${limitGb}GB)`
                ),
            });
            try {
                await autoDeployClients(email, guestPolicy);
            } catch {
                // Best-effort node provisioning for guest pass
            }
        }

        appendSecurityAudit('guest_pass_created', req, {
            username,
            email,
            durationHours: hours,
            trafficLimitGb: limitGb,
            expiresAt,
        });

        const tokenInfo = subscriptionTokenStore.issue(email, {
            createdBy: 'guest-pass',
            ttlDays: Math.max(1, Math.ceil(hours / 24)),
            name: pickLocalizedText(locale, `访客试用 (${hours}小时)`, `Guest trial (${hours}h)`),
        });

        const baseUrl = resolveGuestPassSubscriptionBase(req);
        const subscriptionUrl = `${baseUrl}/api/subscriptions/public/t/${tokenInfo.publicTokenId}/${tokenInfo.tokenSecret}`;

        return res.json({
            success: true,
            msg: pickLocalizedText(locale, '临时访客试用码创建成功', 'Temporary guest trial code created'),
            obj: {
                user: newUser,
                username,
                email,
                password: tempPassword,
                durationHours: hours,
                trafficLimitGb: limitGb,
                expiresAt,
                subscriptionUrl,
                token: tokenInfo.token,
            },
        });

    } catch (err: any) {
        return res.status(400).json({
            success: false,
            msg: err.message || pickLocalizedText(locale, '创建访客试用码失败', 'Failed to create guest trial code'),
        });
    }
});

export default router;
