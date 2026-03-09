import { Router } from 'express';
import config from '../config.js';
import { toHttpError } from '../lib/httpError.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import { resolveClientIp } from '../lib/requestIp.js';
import {
    normalizeEmailInput,
    registerUser,
    resendVerificationCode,
    requestPasswordReset,
    resetPasswordWithCode,
    verifyEmailCode,
} from '../services/emailAuthService.js';
import {
    changeOwnPassword,
    createLoginSession,
    validateSession,
} from '../services/authSessionService.js';
import {
    adminResetUserPassword,
    buildUsersCsv,
    buildUsersExportFilename,
    bulkSetUsersEnabled,
    createManagedUser,
    deleteManagedUser,
    listUsers,
    provisionManagedUserSubscription,
    setManagedUserEnabled,
    updateManagedUser,
    updateManagedUserExpiry,
    updateUserSubscriptionBinding,
} from '../services/userAdminService.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = Router();

function startCleanupInterval(fn, delayMs) {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

// --- Simple in-memory rate limiter for login ---
const LOGIN_RATE_WINDOW = config.nodeEnv === 'development' ? 3 * 60 * 1000 : 15 * 60 * 1000;
const LOGIN_RATE_WINDOW_MINUTES = Math.max(1, Math.round(LOGIN_RATE_WINDOW / 60_000));
const LOGIN_RATE_MAX = config.nodeEnv === 'development' ? 300 : 20;
const loginAttempts = new Map(); // `${ip}|${username}` -> { count, firstAttempt, blockedUntil }

startCleanupInterval(() => {
    const now = Date.now();
    for (const [ip, data] of loginAttempts) {
        if ((data.blockedUntil && data.blockedUntil <= now) || (now - data.firstAttempt > LOGIN_RATE_WINDOW)) {
            loginAttempts.delete(ip);
        }
    }
}, 60_000);

function normalizeRateUsername(username) {
    const normalized = String(username || '').trim().toLowerCase();
    return normalized || '*';
}

function buildLoginRateKey(ip, username = '') {
    return `${String(ip || 'unknown')}|${normalizeRateUsername(username)}`;
}

function getLoginRateState(ip, username = '') {
    const key = buildLoginRateKey(ip, username);
    const now = Date.now();
    const data = loginAttempts.get(key);
    if (!data) {
        return { blocked: false, retryAfterMs: 0 };
    }
    if (data.blockedUntil && data.blockedUntil > now) {
        return { blocked: true, retryAfterMs: data.blockedUntil - now };
    }
    if (now - data.firstAttempt > LOGIN_RATE_WINDOW) {
        loginAttempts.delete(key);
        return { blocked: false, retryAfterMs: 0 };
    }
    return { blocked: false, retryAfterMs: 0 };
}

function recordLoginFailure(ip, username = '') {
    const key = buildLoginRateKey(ip, username);
    const now = Date.now();
    const data = loginAttempts.get(key);
    if (!data || now - data.firstAttempt > LOGIN_RATE_WINDOW) {
        loginAttempts.set(key, { count: 1, firstAttempt: now, blockedUntil: 0 });
        return;
    }
    data.count += 1;
    if (data.count >= LOGIN_RATE_MAX) {
        data.blockedUntil = now + LOGIN_RATE_WINDOW;
    }
}

function clearLoginRate(ip, username = '') {
    loginAttempts.delete(buildLoginRateKey(ip, username));
    // Also clear fallback bucket to avoid stale lock from legacy-password login attempts.
    if (normalizeRateUsername(username) !== '*') {
        loginAttempts.delete(buildLoginRateKey(ip, ''));
    }
}

// --- Register rate limiter ---
const REGISTER_RATE_WINDOW = 60 * 60 * 1000; // 1 hour
const REGISTER_RATE_MAX = 5;
const registerAttempts = new Map();

startCleanupInterval(() => {
    const now = Date.now();
    for (const [ip, data] of registerAttempts) {
        if (now - data.firstAttempt > REGISTER_RATE_WINDOW) registerAttempts.delete(ip);
    }
}, 60_000);

function checkRegisterRate(ip) {
    const now = Date.now();
    const data = registerAttempts.get(ip);
    if (!data || now - data.firstAttempt > REGISTER_RATE_WINDOW) {
        registerAttempts.set(ip, { count: 1, firstAttempt: now });
        return true;
    }
    data.count++;
    return data.count <= REGISTER_RATE_MAX;
}
// --- End rate limiters ---

// --- Password reset rate limiter ---
const RESET_RATE_WINDOW = 60 * 60 * 1000; // 1 hour
const RESET_RATE_MAX = 8;
const resetAttempts = new Map();

startCleanupInterval(() => {
    const now = Date.now();
    for (const [ip, data] of resetAttempts) {
        if (now - data.firstAttempt > RESET_RATE_WINDOW) resetAttempts.delete(ip);
    }
}, 60_000);

function checkResetRate(ip) {
    const now = Date.now();
    const data = resetAttempts.get(ip);
    if (!data || now - data.firstAttempt > RESET_RATE_WINDOW) {
        resetAttempts.set(ip, { count: 1, firstAttempt: now });
        return true;
    }
    data.count++;
    return data.count <= RESET_RATE_MAX;
}

/**
 * POST /api/auth/login
 * 支持两种模式:
 *   1. username + password (新版多用户)
 *   2. password only (向后兼容旧版单密码)
 */
router.post('/login', (req, res) => {
    const clientIp = resolveClientIp(req);
    const username = String(req.body?.username || '').trim();
    const rateState = getLoginRateState(clientIp, username);
    if (rateState.blocked) {
        appendSecurityAudit('login_rate_limited', req, { ip: clientIp });
        return res.status(429).json({
            success: false,
            msg: `登录尝试过于频繁，请 ${LOGIN_RATE_WINDOW_MINUTES} 分钟后再试`,
        });
    }

    const result = createLoginSession(req.body);
    if (!result.success) {
        recordLoginFailure(clientIp, username);
        const failState = getLoginRateState(clientIp, username);
        if (failState.blocked) {
            appendSecurityAudit('login_rate_limited', req, { ip: clientIp });
            return res.status(429).json({
                success: false,
                msg: `登录尝试过于频繁，请 ${LOGIN_RATE_WINDOW_MINUTES} 分钟后再试`,
            });
        }

        if (result.reason === 'email_not_verified') {
            return res.status(403).json({
                success: false,
                msg: '邮箱尚未验证，请先完成邮箱验证',
                needVerify: true,
                email: result.email,
            });
        }
        if (result.reason === 'user_disabled') {
            return res.status(403).json({
                success: false,
                msg: '账号待审核，请等待管理员审核通过后再登录',
            });
        }

        appendSecurityAudit('login_failed', req, { ip: clientIp, username: username || '(none)' });
        return res.status(401).json({ success: false, msg: '用户名或密码错误' });
    }

    appendSecurityAudit('login_success', req, { ip: clientIp, ...result.audit });
    clearLoginRate(clientIp, result.audit.username);
    res.json({
        success: true,
        token: result.token,
        user: result.user,
    });
});

/**
 * GET /api/auth/check
 * 验证 JWT 是否有效, 返回用户信息
 */
router.get('/check', (req, res) => {
    try {
        const result = validateSession(req.headers.authorization);
        res.json({
            success: true,
            user: result.user,
        });
    } catch {
        res.status(401).json({ success: false });
    }
});

// ── Registration Routes ─────────────────────────────────────

/**
 * POST /api/auth/register — 用户自助注册
 */
router.post('/register', async (req, res) => {
    // 检查注册是否开启
    if (!config.registration.enabled) {
        return res.status(403).json({ success: false, msg: '注册功能已关闭' });
    }

    const clientIp = resolveClientIp(req);
    if (!checkRegisterRate(clientIp)) {
        appendSecurityAudit('register_rate_limited', req, { ip: clientIp });
        return res.status(429).json({
            success: false,
            msg: '注册尝试过于频繁，请稍后再试',
        });
    }

    try {
        const result = await registerUser(req.body);

        appendSecurityAudit('verification_email_sent', req, {
            ip: clientIp,
            username: result.username,
            email: result.email,
            type: 'register',
        });
        appendSecurityAudit('user_registered', req, {
            ip: clientIp,
            username: result.username,
            email: result.email,
        });
        res.json({
            success: true,
            msg: '注册成功，请查收邮箱验证码。验证后需等待管理员审核通过才能登录。',
            email: result.user.email,
        });
    } catch (err) {
        const error = toHttpError(err, 400, '注册失败');
        if (error.code === 'VERIFICATION_EMAIL_SEND_FAILED') {
            appendSecurityAudit('verification_email_failed', req, {
                ip: clientIp,
                username: error.details?.username || String(req.body?.username || '').trim(),
                email: error.details?.email || normalizeEmailInput(req.body?.email),
                type: error.details?.type || 'register',
                error: error.details?.error || error.message,
            });
        }
        res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * POST /api/auth/verify-email — 邮箱验证
 */
router.post('/verify-email', (req, res) => {
    try {
        const result = verifyEmailCode(req.body);
        if (result.alreadyVerified) {
            return res.json({ success: true, msg: '邮箱已验证' });
        }

        appendSecurityAudit('email_verified', req, {
            email: result.email,
            username: result.user.username,
        });
        res.json({ success: true, msg: '邮箱验证成功，请登录' });
    } catch (err) {
        const error = toHttpError(err, 400, '邮箱验证失败');
        res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * POST /api/auth/resend-code — 重发验证码
 */
router.post('/resend-code', async (req, res) => {
    const clientIp = resolveClientIp(req);
    if (!checkRegisterRate(clientIp)) {
        return res.status(429).json({ success: false, msg: '请求过于频繁，请稍后再试' });
    }

    try {
        const result = await resendVerificationCode(req.body);
        if (result.alreadyVerified) {
            return res.json({ success: true, msg: '邮箱已验证，无需重发' });
        }

        appendSecurityAudit('verification_email_sent', req, {
            ip: clientIp,
            username: result.user.username,
            email: result.email,
            type: 'resend',
        });
        return res.json({ success: true, msg: '验证码已重新发送' });
    } catch (err) {
        const error = toHttpError(err, 500, '验证码重发失败');
        if (error.code === 'VERIFICATION_EMAIL_SEND_FAILED') {
            appendSecurityAudit('verification_email_failed', req, {
                ip: clientIp,
                username: error.details?.username || '',
                email: error.details?.email || normalizeEmailInput(req.body?.email),
                type: error.details?.type || 'resend',
                error: error.details?.error || error.message,
            });
        }
        res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * POST /api/auth/forgot-password — 发送密码重置验证码
 */
router.post('/forgot-password', async (req, res) => {
    const clientIp = resolveClientIp(req);
    if (!checkResetRate(clientIp)) {
        appendSecurityAudit('password_reset_request_rate_limited', req, { ip: clientIp });
        return res.status(429).json({ success: false, msg: '请求过于频繁，请稍后再试' });
    }

    try {
        const result = await requestPasswordReset(req.body);
        if (result.hidden) {
            // 不暴露邮箱是否存在，防止枚举。
            return res.json({ success: true, msg: '如果邮箱已注册，验证码已发送，请查收邮箱' });
        }

        appendSecurityAudit('password_reset_email_sent', req, {
            email: result.email,
            username: result.user.username,
        });
        appendSecurityAudit('password_reset_code_sent', req, {
            email: result.email,
            username: result.user.username,
        });
        return res.json({ success: true, msg: '重置验证码已发送，请查收邮箱' });
    } catch (err) {
        const error = toHttpError(err, 500, '发送失败');
        if (error.code === 'PASSWORD_RESET_EMAIL_SEND_FAILED') {
            appendSecurityAudit('password_reset_email_failed', req, {
                email: error.details?.email || normalizeEmailInput(req.body?.email),
                username: error.details?.username || '',
                error: error.details?.error || error.message,
            });
        }
        return res.status(error.status).json({ success: false, msg: error.message || '发送失败' });
    }
});

/**
 * POST /api/auth/reset-password — 使用邮箱验证码重置密码
 */
router.post('/reset-password', (req, res) => {
    try {
        const result = resetPasswordWithCode(req.body);
        appendSecurityAudit('password_reset_completed', req, {
            email: result.email,
            username: result.user.username,
        });
        return res.json({ success: true, msg: '密码重置成功，请使用新密码登录' });
    } catch (err) {
        const error = toHttpError(err, 400, '密码重置失败');
        return res.status(error.status).json({ success: false, msg: error.message });
    }
});

// ── User Management Routes (admin only) ────────────────────

/**
 * GET /api/auth/users — 获取所有用户列表
 */
router.get('/users', authMiddleware, adminOnly, (req, res) => {
    res.json({ success: true, obj: listUsers() });
});

/**
 * POST /api/auth/users — 创建新用户
 */
router.post('/users', authMiddleware, adminOnly, (req, res) => {
    try {
        const result = createManagedUser(req.body);
        appendSecurityAudit('user_created', req, result.audit);
        res.json({ success: true, obj: result.user });
    } catch (err) {
        const error = toHttpError(err, 400, '创建用户失败');
        res.status(error.status).json({ success: false, msg: error.message });
    }
});

// ── Bulk enable/disable users ──
router.post('/users/bulk-set-enabled', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = bulkSetUsersEnabled(req.body);
        return res.json({
            success: true,
            msg: `已${result.enabled ? '启用' : '停用'} ${result.successCount}/${result.total} 个用户`,
            obj: result.results,
        });
    } catch (err) {
        const error = toHttpError(err, 400, '批量更新用户状态失败');
        return res.status(error.status).json({ success: false, msg: error.message });
    }
});

// ── CSV export users ──
router.get('/users/export', authMiddleware, adminOnly, (req, res) => {
    const csv = buildUsersCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${buildUsersExportFilename()}"`);
    return res.send(csv);
});

/**
 * PUT /api/auth/users/:id — 更新用户信息
 */
router.put('/users/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const result = updateManagedUser(req.params.id, req.body);
        appendSecurityAudit('user_updated', req, { targetUser: result.user.username });
        res.json({ success: true, obj: result.user });
    } catch (err) {
        const error = toHttpError(err, 400, '更新用户失败');
        res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * PUT /api/auth/users/:id/subscription-binding — 管理员绑定用户订阅邮箱
 */
router.put('/users/:id/subscription-binding', authMiddleware, adminOnly, (req, res) => {
    try {
        const result = updateUserSubscriptionBinding(req.params.id, req.body);
        appendSecurityAudit('user_subscription_binding_updated', req, {
            targetUserId: result.target.id,
            targetUsername: result.target.username,
            subscriptionEmail: result.updated?.subscriptionEmail || '',
        });
        return res.json({
            success: true,
            obj: result.updated,
        });
    } catch (err) {
        const error = toHttpError(err, 400, '更新订阅绑定失败');
        return res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * PUT /api/auth/users/:id/set-enabled — 启用/停用用户
 */
router.put('/users/:id/set-enabled', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await setManagedUserEnabled(
            req.params.id,
            req.body,
            String(req.user?.username || 'admin')
        );
        appendSecurityAudit(result.enabled ? 'user_enabled' : 'user_disabled', req, {
            targetUserId: result.target.id,
            targetUsername: result.target.username,
            enabled: result.enabled,
        });
        return res.json({ success: true, obj: result.updated });
    } catch (err) {
        const error = toHttpError(err, 400, '更新用户状态失败');
        return res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * PUT /api/auth/users/:id/update-expiry — 更新用户所有客户端的到期时间
 */
router.put('/users/:id/update-expiry', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await updateManagedUserExpiry(
            req.params.id,
            req.body,
            String(req.user?.username || 'admin')
        );
        appendSecurityAudit('user_expiry_updated', req, {
            targetUserId: result.target.id,
            targetUsername: result.target.username,
            subscriptionEmail: result.subscriptionEmail,
            expiryTime: result.expiryTime,
            updated: result.deployment.updated,
            failed: result.deployment.failed,
        });

        return res.json({ success: true, obj: result.deployment });
    } catch (err) {
        const error = toHttpError(err, 400, '更新到期时间失败');
        return res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * POST /api/auth/users/:id/provision-subscription
 * 一键开通订阅：绑定订阅邮箱 + 写入节点/协议策略 + 预生成持久 token。
 */
router.post('/users/:id/provision-subscription', authMiddleware, adminOnly, async (req, res) => {
    try {
        const actor = String(req.user?.username || req.user?.role || 'admin');
        const result = await provisionManagedUserSubscription(req.params.id, req.body, actor);
        const { user, policy, subscription, deployment, context, target } = result;

        appendSecurityAudit('user_subscription_provisioned', req, {
            targetUserId: target.id,
            targetUsername: target.username,
            subscriptionEmail: context.subscriptionEmail,
            allowedServerCount: context.allowedServerIds.length,
            allowedProtocolCount: context.allowedProtocols.length,
            expiryTime: context.expiryTime,
            limitIp: context.limitIp,
            trafficLimitBytes: context.trafficLimitBytes,
            tokenAutoIssued: context.tokenState.autoIssued,
            tokenIssueError: context.tokenState.issueError || '',
            deploymentCreated: deployment.created,
            deploymentUpdated: deployment.updated,
            deploymentSkipped: deployment.skipped,
            deploymentFailed: deployment.failed,
        });

        return res.json({
            success: true,
            obj: {
                user,
                policy,
                subscription,
                deployment,
            },
        });
    } catch (err) {
        const error = toHttpError(err, 400, '开通订阅失败');
        return res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * PUT /api/auth/users/:id/reset-password — 管理员重置指定用户密码
 */
router.put('/users/:id/reset-password', authMiddleware, adminOnly, (req, res) => {
    try {
        const result = adminResetUserPassword(req.params.id, req.body);
        appendSecurityAudit('user_password_reset_by_admin', req, {
            targetUserId: result.target.id,
            targetUsername: result.target.username,
        });
        return res.json({ success: true, msg: '密码已重置' });
    } catch (err) {
        const error = toHttpError(err, 400, '管理员重置密码失败');
        return res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * DELETE /api/auth/users/:id — 删除用户
 */
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await deleteManagedUser(req.params.id);
        appendSecurityAudit('user_deleted', req, {
            targetUserId: result.targetUser.id,
            targetUser: result.targetUser.username,
            cleanupEmails: result.cleanupEmails,
            revokedTokenCount: result.revokedTokenCount,
            removedPolicyEmails: result.removedPolicyEmails,
            cleanupError: result.cleanupError,
            clientCleanup: result.clientCleanup,
        });
        res.json({
            success: true,
            obj: {
                revokedTokenCount: result.revokedTokenCount,
                removedPolicyEmails: result.removedPolicyEmails,
                cleanupError: result.cleanupError || null,
                clientCleanup: result.clientCleanup,
            },
        });
    } catch (err) {
        const error = toHttpError(err, 400, '删除用户失败');
        res.status(error.status).json({ success: false, msg: error.message });
    }
});

/**
 * PUT /api/auth/change-password — 修改自己的密码
 */
router.put('/change-password', authMiddleware, (req, res) => {
    try {
        const result = changeOwnPassword(req.body, req.user);
        appendSecurityAudit('password_changed', req, { username: result.user.username });
        res.json({ success: true, msg: '密码修改成功' });
    } catch (err) {
        const error = toHttpError(err, 400, '修改密码失败');
        res.status(error.status).json({ success: false, msg: error.message });
    }
});

export default router;
