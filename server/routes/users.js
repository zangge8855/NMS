import { Router } from 'express';
import userStore from '../store/userStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import auditStore from '../store/auditStore.js';
import subscriptionTokenStore from '../store/subscriptionTokenStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import { normalizeEmail } from '../lib/normalize.js';
import { querySubscriptionAccess } from '../services/subscriptionAuditService.js';
import ipGeoResolver, { normalizeIpAddress } from '../lib/ipGeoResolver.js';
import ipIspResolver from '../lib/ipIspResolver.js';

const router = Router();
const MASKED_IP_PATTERN = /^ip_[0-9a-f]{16}$/i;
const MASKED_UA_PATTERN = /^ua_[0-9a-f]{16}$/i;

function collectUserEmails(user) {
    return Array.from(new Set([
        normalizeEmail(user?.email),
        normalizeEmail(user?.subscriptionEmail || user?.email),
    ].filter(Boolean)));
}

function buildAuditTarget(user) {
    const email = normalizeEmail(user?.email);
    const subscriptionEmail = normalizeEmail(user?.subscriptionEmail || user?.email);
    return {
        targetUserId: user?.id || '',
        targetUsername: user?.username || '',
        email: email || subscriptionEmail,
        subscriptionEmail,
    };
}

function mergeAuditResults(results = [], pageSize = 50) {
    const seen = new Set();
    const items = [];

    results.forEach((result) => {
        (result?.items || []).forEach((item) => {
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

function normalizeAuditIp(value) {
    const text = String(value || '').trim();
    if (!text || text === 'unknown') return '';
    if (MASKED_IP_PATTERN.test(text)) return '';
    return normalizeIpAddress(text) || text;
}

function normalizeAuditUserAgent(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (MASKED_UA_PATTERN.test(text)) return '';
    return text;
}

async function enrichAuditEvents(items = []) {
    const rows = Array.isArray(items) ? items : [];
    if (rows.length === 0) return [];

    const auditIpGeo = systemSettingsStore.getAuditIpGeo();
    ipGeoResolver.configure(auditIpGeo);
    ipIspResolver.configure(auditIpGeo);

    const geoEnabled = ipGeoResolver.isEnabled();
    const ispEnabled = typeof ipIspResolver.isEnabled === 'function' && ipIspResolver.isEnabled();
    const ipCandidates = rows.map((item) => normalizeAuditIp(item?.ip)).filter(Boolean);

    let geoMap = new Map();
    let ispMap = new Map();
    if (geoEnabled) {
        try {
            geoMap = await ipGeoResolver.lookupMany(ipCandidates);
        } catch {
            geoMap = new Map();
        }
    }
    if (ispEnabled) {
        try {
            ispMap = await ipIspResolver.lookupMany(ipCandidates);
        } catch {
            ispMap = new Map();
        }
    }

    return rows.map((item) => {
        const rawIp = String(item?.ip || '').trim();
        const rawUserAgent = String(item?.details?.userAgent || item?.userAgent || '').trim();
        const ip = normalizeAuditIp(rawIp);
        const userAgent = normalizeAuditUserAgent(rawUserAgent);
        return {
            ...item,
            ip,
            ipMasked: !ip && MASKED_IP_PATTERN.test(rawIp),
            userAgent,
            userAgentMasked: !userAgent && MASKED_UA_PATTERN.test(rawUserAgent),
            ipLocation: geoEnabled ? ipGeoResolver.pickFromMap(geoMap, ip) : '',
            ipCarrier: ispEnabled ? ipIspResolver.pickFromMap(ispMap, ip) : '',
        };
    });
}

// GET /api/users/:id/detail — aggregate user detail
router.get('/:id/detail', async (req, res) => {
    const user = userStore.getById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, msg: '用户不存在' });
    }

    const trackedEmails = collectUserEmails(user);
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
        } catch (e) { console.error(`[Users Route] Failed to get policy for ${subscriptionEmail}:`, e.message); }
    }

    // Recent audit events
    let recentAudit = { items: [], total: 0 };
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
    } catch (e) { console.error(`[Users Route] Failed to query audit events:`, e.message); }

    // Subscription access logs
    let subscriptionAccess = { items: [], total: 0 };
    if (subscriptionEmail) {
        try {
            subscriptionAccess = await querySubscriptionAccess({
                email: subscriptionEmail,
                pageSize: 50,
            });
        } catch (e) { console.error(`[Users Route] Failed to query subscription access for ${subscriptionEmail}:`, e.message); }
    }

    // Subscription tokens
    let tokens = [];
    if (subscriptionEmail) {
        try {
            tokens = subscriptionTokenStore.listByEmail(subscriptionEmail);
        } catch (e) { console.error(`[Users Route] Failed to list tokens for ${subscriptionEmail}:`, e.message); }
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
        appendSecurityAudit('subscription_token_issued', req, {
            ...buildAuditTarget(user),
            tokenId: result.tokenId,
            publicTokenId: result.publicTokenId,
            tokenName: result.metadata?.name || '',
            ttlDays: result.ttlDays,
            noExpiry: result.metadata?.expiresAt === null,
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
    appendSecurityAudit('subscription_token_revoked', req, {
        ...buildAuditTarget(user),
        tokenId: result.id,
        publicTokenId: result.publicTokenId || '',
        tokenName: result.name || '',
        revokedReason: result.revokedReason || 'admin-revoke',
    }, { outcome: 'success' });
    return res.json({ success: true, obj: result });
});

export default router;
