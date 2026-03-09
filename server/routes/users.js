import { Router } from 'express';
import userStore from '../store/userStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import auditStore from '../store/auditStore.js';
import subscriptionTokenStore from '../store/subscriptionTokenStore.js';

const router = Router();

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

// GET /api/users/:id/detail — aggregate user detail
router.get('/:id/detail', (req, res) => {
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: '用户不存在' });
    }

    const subscriptionEmail = normalizeEmail(user.subscriptionEmail || user.email);

    // User basic info (public fields)
    const userInfo = {
        id: user.id,
        username: user.username,
        email: normalizeEmail(user.email),
        subscriptionEmail,
        emailVerified: !!user.emailVerified,
        role: user.role,
        enabled: user.enabled !== false,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt || null,
    };

    // Access policy
    let policy = null;
    if (subscriptionEmail) {
        try {
            policy = userPolicyStore.get(subscriptionEmail);
        } catch { /* ignore */ }
    }

    // Recent audit events
    let recentAudit = { items: [], total: 0 };
    try {
        recentAudit = auditStore.queryEvents({
            targetEmail: subscriptionEmail || normalizeEmail(user.email),
            pageSize: 20,
        });
    } catch { /* ignore */ }

    // Subscription access logs
    let subscriptionAccess = { items: [], total: 0 };
    if (subscriptionEmail) {
        try {
            subscriptionAccess = auditStore.querySubscriptionAccess({
                email: subscriptionEmail,
                pageSize: 20,
            });
        } catch { /* ignore */ }
    }

    // Subscription tokens
    let tokens = [];
    if (subscriptionEmail) {
        try {
            tokens = subscriptionTokenStore.listByEmail(subscriptionEmail);
        } catch { /* ignore */ }
    }

    return res.json({
        success: true,
        obj: {
            user: userInfo,
            policy,
            recentAudit,
            subscriptionAccess,
            tokens,
        },
    });
});

// GET /api/users/:id/tokens — list user's subscription tokens
router.get('/:id/tokens', (req, res) => {
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
router.post('/:id/tokens', (req, res) => {
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: '用户不存在' });
    }
    const email = normalizeEmail(user.subscriptionEmail || user.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: '用户未配置邮箱' });
    }
    try {
        const result = subscriptionTokenStore.issue(email, {
            name: String(req.body?.name || '').trim() || 'manual',
            ttlDays: Number(req.body?.ttlDays) || 0,
            noExpiry: req.body?.noExpiry === true,
            createdBy: req.user?.username || 'admin',
        });
        return res.json({ success: true, obj: result });
    } catch (err) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

// DELETE /api/users/:id/tokens/:tid — revoke token
router.delete('/:id/tokens/:tid', (req, res) => {
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
    return res.json({ success: true, obj: result });
});

export default router;
