import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import userStore from '../store/userStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import userGroupStore from '../store/userGroupStore.js';
import auditStore from '../store/auditStore.js';
import subscriptionTokenStore from '../store/subscriptionTokenStore.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import { normalizeEmail } from '../lib/normalize.js';
import { querySubscriptionAccess } from '../services/subscriptionAuditService.js';
import { enrichAuditEvents } from '../lib/auditEventEnrichment.js';
import { resolveEffectivePolicy } from '../lib/userPolicyResolver.js';

const router = Router();

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
router.get('/:id/detail', async (req: Request, res: Response) => {
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: '用户不存在' });
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
router.get('/:id/tokens', (req: Request, res: Response) => {
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: '用户不存在' });
    }
    const email = normalizeEmail(user.subscriptionEmail || user.email);
    if (!email) {
        return res.json({ success: true, obj: [] });
    }
    const tokens = subscriptionTokenStore.listByEmail(email);
    return res.json({ success: true, obj: tokens });
});

// POST /api/users/:id/tokens — issue new subscription token
router.post('/:id/tokens', (req: Request, res: Response) => {
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: '用户不存在' });
    }
    const email = normalizeEmail(user.subscriptionEmail || user.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: '用户未配置邮箱' });
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
router.delete('/:id/tokens/:tid', (req: Request, res: Response) => {
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: '用户不存在' });
    }
    const email = normalizeEmail(user.subscriptionEmail || user.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: '用户未配置邮箱' });
    }
    const result = subscriptionTokenStore.revoke(email, req.params.tid, 'admin-revoke');
    if (!result) {
        return res.status(404).json({ success: false, msg: 'Token 不存在' });
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

/**
 * POST /api/users/guest-pass — 创建临时访客试用订阅码
 */
router.post('/guest-pass', authMiddleware, adminOnly, (req: Request, res: Response) => {
    try {
        const { durationHours = 24, trafficLimitGb = 2, note = '访客临时体验' } = req.body || {};
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

        // Set policy limits if needed
        if (newUser && newUser.id) {
            userPolicyStore.upsert(email, {
                trafficLimitBytes: Math.floor(limitGb * 1024 * 1024 * 1024),
                expiryTime: new Date(expiresAt).getTime(),
                comment: `[临时访客] ${note} (${hours}小时限时 / ${limitGb}GB)`,
            });
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
            name: `访客试用 (${hours}小时)`,
        });

        const subscriptionUrl = `${req.protocol}://${req.get('host')}/api/subscriptions/public/t/${tokenInfo.publicTokenId}/${tokenInfo.tokenSecret}`;

        return res.json({
            success: true,
            msg: '临时访客试用码创建成功',
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
        return res.status(400).json({ success: false, msg: err.message || '创建访客试用码失败' });
    }
});

export default router;
