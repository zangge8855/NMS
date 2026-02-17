import crypto from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { generateVerifyCode, sendVerificationEmail, sendPasswordResetEmail } from '../lib/mailer.js';
import { checkAccountPassword } from '../lib/passwordValidator.js';
import { resolveClientIp } from '../lib/requestIp.js';
import userStore from '../store/userStore.js';
import serverStore from '../store/serverStore.js';
import userPolicyStore, { ALLOWED_PROTOCOLS, POLICY_SCOPE_MODES } from '../store/userPolicyStore.js';
import subscriptionTokenStore from '../store/subscriptionTokenStore.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = Router();

// --- Simple in-memory rate limiter for login ---
const LOGIN_RATE_WINDOW = config.nodeEnv === 'development' ? 3 * 60 * 1000 : 15 * 60 * 1000;
const LOGIN_RATE_WINDOW_MINUTES = Math.max(1, Math.round(LOGIN_RATE_WINDOW / 60_000));
const LOGIN_RATE_MAX = config.nodeEnv === 'development' ? 300 : 20;
const loginAttempts = new Map(); // `${ip}|${username}` -> { count, firstAttempt, blockedUntil }

setInterval(() => {
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

setInterval(() => {
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

setInterval(() => {
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

// Email format validation
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmailInput(value) {
    return String(value || '').trim().toLowerCase();
}

function resolveUserSubscriptionEmail(user) {
    if (!user || typeof user !== 'object') return '';
    if (Object.prototype.hasOwnProperty.call(user, 'subscriptionEmail')) {
        return normalizeEmailInput(user.subscriptionEmail);
    }
    return normalizeEmailInput(user.email);
}

function normalizeServerIds(input = []) {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function normalizeProtocols(input = []) {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => ALLOWED_PROTOCOLS.has(item))
    ));
}

function normalizeScopeMode(input, fallback = 'all') {
    const normalizedFallback = POLICY_SCOPE_MODES.has(String(fallback || '').trim().toLowerCase())
        ? String(fallback || '').trim().toLowerCase()
        : 'all';
    const text = String(input || '').trim().toLowerCase();
    if (!text) return normalizedFallback;
    if (!POLICY_SCOPE_MODES.has(text)) return normalizedFallback;
    return text;
}

function buildScopeTokenName(serverId = '') {
    return `auto-persistent:${serverId || 'all'}`;
}

function ensurePersistentSubscriptionToken(email, actor = 'admin') {
    const scopeName = buildScopeTokenName('');
    const existing = subscriptionTokenStore.getFirstActiveTokenByName(email, scopeName);
    if (existing?.metadata?.id) {
        return {
            metadata: existing.metadata,
            autoIssued: false,
            issueError: null,
        };
    }

    try {
        const issued = subscriptionTokenStore.issue(email, {
            name: scopeName,
            noExpiry: true,
            ttlDays: 0,
            ignoreActiveLimit: true,
            createdBy: actor,
        });
        return {
            metadata: issued.metadata,
            autoIssued: true,
            issueError: null,
        };
    } catch (error) {
        return {
            metadata: null,
            autoIssued: false,
            issueError: error.message || 'Failed to issue persistent token',
        };
    }
}

const DEPLOY_CLIENT_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const DEPLOY_UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const DEPLOY_PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

function buildStableSubId(email) {
    return crypto.createHash('sha256').update(normalizeEmailInput(email)).digest('hex').slice(0, 16);
}

function buildDeployFormBody(data = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
        } else {
            params.append(key, String(value));
        }
    }
    return params.toString();
}

function resolveDeployFlow(protocol, inbound) {
    if (protocol !== 'vless') return '';
    let stream = {};
    try {
        stream = typeof inbound.streamSettings === 'string'
            ? JSON.parse(inbound.streamSettings)
            : (inbound.streamSettings || {});
    } catch { /* ignore */ }
    const network = String(stream.network || '').toLowerCase();
    const security = String(stream.security || '').toLowerCase();
    if ((network === 'tcp' || network === 'http') && (security === 'reality' || security === 'tls')) {
        return 'xtls-rprx-vision';
    }
    return '';
}

async function autoDeployClients(subscriptionEmail, allServers, policy, options = {}) {
    const result = { total: 0, created: 0, skipped: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;

    // Determine target servers
    const serverScopeMode = String(policy.serverScopeMode || 'all').toLowerCase();
    let targetServers = [];
    if (serverScopeMode === 'all') {
        targetServers = allServers;
    } else if (serverScopeMode === 'selected') {
        const allowed = new Set(Array.isArray(policy.allowedServerIds) ? policy.allowedServerIds : []);
        targetServers = allServers.filter((s) => allowed.has(s.id));
    }
    // 'none' → empty list

    if (targetServers.length === 0) return result;

    // Determine allowed protocols
    const protocolScopeMode = String(policy.protocolScopeMode || 'all').toLowerCase();
    let allowedProtocols = null; // null = all
    if (protocolScopeMode === 'selected') {
        allowedProtocols = new Set(Array.isArray(policy.allowedProtocols) ? policy.allowedProtocols : []);
    } else if (protocolScopeMode === 'none') {
        return result; // no protocols allowed
    }

    // Determine allowed inbounds (optional, from options)
    const allowedInboundKeys = Array.isArray(options.allowedInboundKeys) && options.allowedInboundKeys.length > 0
        ? new Set(options.allowedInboundKeys)
        : null; // null = all

    // Generate unified credentials
    const uuid = crypto.randomUUID();
    const password = crypto.randomBytes(16).toString('hex');
    const subId = buildStableSubId(email);
    const expiryTime = Math.max(0, Math.floor(Number(options.expiryTime) || 0));

    for (const server of targetServers) {
        let client;
        try {
            client = await ensureAuthenticated(server.id);
        } catch (err) {
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: `Auth failed: ${err.message}`,
            });
            result.failed += 1;
            result.total += 1;
            continue;
        }

        let inbounds;
        try {
            const listRes = await client.get('/panel/api/inbounds/list');
            inbounds = listRes.data?.obj || [];
        } catch (err) {
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: `List inbounds failed: ${err.message}`,
            });
            result.failed += 1;
            result.total += 1;
            continue;
        }

        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();

            // Skip non-client protocols
            if (!DEPLOY_CLIENT_PROTOCOLS.has(protocol)) continue;

            // Skip disabled inbounds
            if (inbound.enable === false) continue;

            // Skip protocols not in policy
            if (allowedProtocols && !allowedProtocols.has(protocol)) continue;

            // Skip inbounds not in selection (if specified)
            if (allowedInboundKeys && !allowedInboundKeys.has(`${server.id}:${inbound.id}`)) continue;

            result.total += 1;

            try {
                // Check if client already exists
                let settings = {};
                try {
                    settings = typeof inbound.settings === 'string'
                        ? JSON.parse(inbound.settings)
                        : (inbound.settings || {});
                } catch { /* ignore */ }
                const existingClients = Array.isArray(settings.clients) ? settings.clients : [];
                const alreadyExists = existingClients.some(
                    (c) => normalizeEmailInput(c.email) === email
                );

                if (alreadyExists) {
                    result.skipped += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: 'skipped',
                    });
                    continue;
                }

                // Build client data
                const clientData = {
                    email,
                    enable: true,
                    id: uuid,
                    totalGB: 0,
                    expiryTime,
                    tgId: '',
                    subId,
                    limitIp: 0,
                    comment: '',
                    reset: 0,
                };

                if (DEPLOY_UUID_PROTOCOLS.has(protocol)) {
                    clientData.flow = resolveDeployFlow(protocol, inbound);
                }
                if (DEPLOY_PASSWORD_PROTOCOLS.has(protocol)) {
                    clientData.password = password;
                }

                await client.post(
                    '/panel/api/inbounds/addClient',
                    buildDeployFormBody({
                        id: inbound.id,
                        settings: { clients: [clientData] },
                    }),
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                );

                result.created += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'created',
                });
            } catch (err) {
                result.failed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'failed',
                    error: err.message,
                });
            }
        }
    }

    return result;
}

async function autoUpdateClientExpiry(subscriptionEmail, allServers, newExpiryTime) {
    const result = { total: 0, updated: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;
    const expiryTime = Math.max(0, Math.floor(Number(newExpiryTime) || 0));

    for (const server of allServers) {
        let client;
        try {
            client = await ensureAuthenticated(server.id);
        } catch { continue; }

        let inbounds;
        try {
            const listRes = await client.get('/panel/api/inbounds/list');
            inbounds = listRes.data?.obj || [];
        } catch { continue; }

        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!DEPLOY_CLIENT_PROTOCOLS.has(protocol)) continue;

            let settings = {};
            try {
                settings = typeof inbound.settings === 'string'
                    ? JSON.parse(inbound.settings)
                    : (inbound.settings || {});
            } catch { continue; }

            const clients = Array.isArray(settings.clients) ? settings.clients : [];
            const match = clients.find((c) => normalizeEmailInput(c.email) === email);
            if (!match) continue;

            result.total += 1;
            try {
                const identifier = match.id || match.password || '';
                const updatedClient = { ...match, expiryTime };
                await client.post(
                    '/panel/api/inbounds/updateClient/' + encodeURIComponent(identifier),
                    buildDeployFormBody({
                        id: inbound.id,
                        settings: { clients: [updatedClient] },
                    }),
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                );
                result.updated += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    status: 'updated',
                });
            } catch (err) {
                result.failed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    status: 'failed',
                    error: err.message,
                });
            }
        }
    }

    return result;
}

async function autoRemoveClients(subscriptionEmail, allServers) {
    const result = { total: 0, removed: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;

    for (const server of allServers) {
        let client;
        try {
            client = await ensureAuthenticated(server.id);
        } catch {
            continue; // skip servers we can't reach
        }

        let inbounds;
        try {
            const listRes = await client.get('/panel/api/inbounds/list');
            inbounds = listRes.data?.obj || [];
        } catch {
            continue;
        }

        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!DEPLOY_CLIENT_PROTOCOLS.has(protocol)) continue;

            let settings = {};
            try {
                settings = typeof inbound.settings === 'string'
                    ? JSON.parse(inbound.settings)
                    : (inbound.settings || {});
            } catch { continue; }
            const clients = Array.isArray(settings.clients) ? settings.clients : [];
            const matched = clients.find((c) => normalizeEmailInput(c.email) === email);
            if (!matched) continue;

            result.total += 1;
            const clientId = matched.id || matched.password || email;

            try {
                const encoded = encodeURIComponent(clientId);
                await client.post(`/panel/api/inbounds/${inbound.id}/delClient/${encoded}`);
                result.removed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    status: 'removed',
                });
            } catch (err) {
                result.failed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    status: 'failed',
                    error: err.message,
                });
            }
        }
    }
    return result;
}

/**
 * POST /api/auth/login
 * 支持两种模式:
 *   1. username + password (新版多用户)
 *   2. password only (向后兼容旧版单密码)
 */
router.post('/login', (req, res) => {
    const clientIp = resolveClientIp(req);
    const allowLegacyPasswordLogin = config.auth.allowLegacyPasswordLogin !== false;
    const rawUsername = req.body?.username;
    const rawPassword = req.body?.password;
    const username = String(rawUsername || '').trim();
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    const rateState = getLoginRateState(clientIp, username);
    if (rateState.blocked) {
        appendSecurityAudit('login_rate_limited', req, { ip: clientIp });
        return res.status(429).json({
            success: false,
            msg: `登录尝试过于频繁，请 ${LOGIN_RATE_WINDOW_MINUTES} 分钟后再试`,
        });
    }

    // 尝试多用户认证
    const user = userStore.authenticate(username, password);

    if (!user) {
        // 向后兼容: 仅密码模式
        const normalizedUsername = username;
        const adminUser = userStore.getByUsername('admin') || userStore.getAll().find((item) => item.role === 'admin');
        const legacyUsername = String(adminUser?.username || 'admin').trim();
        const usernameMatchesLegacy = !normalizedUsername || normalizedUsername === legacyUsername;
        if (usernameMatchesLegacy && allowLegacyPasswordLogin && password === config.auth.adminPassword) {
            const tokenPayload = {
                role: 'admin',
                username: legacyUsername || 'admin',
            };
            if (adminUser?.id) tokenPayload.userId = adminUser.id;

            const token = jwt.sign(tokenPayload, config.jwt.secret, {
                expiresIn: config.jwt.expiresIn,
            });
            appendSecurityAudit('login_success', req, {
                ip: clientIp,
                username: tokenPayload.username,
                role: 'admin',
                legacyMode: true,
            });
            clearLoginRate(clientIp, username || tokenPayload.username);
            return res.json({
                success: true,
                token,
                user: {
                    username: tokenPayload.username,
                    role: 'admin',
                    email: adminUser?.email || '',
                    subscriptionEmail: resolveUserSubscriptionEmail(adminUser),
                },
            });
        }

        recordLoginFailure(clientIp, username);
        const failState = getLoginRateState(clientIp, username);
        if (failState.blocked) {
            appendSecurityAudit('login_rate_limited', req, { ip: clientIp });
            return res.status(429).json({
                success: false,
                msg: `登录尝试过于频繁，请 ${LOGIN_RATE_WINDOW_MINUTES} 分钟后再试`,
            });
        }

        appendSecurityAudit('login_failed', req, { ip: clientIp, username: username || '(none)' });
        return res.status(401).json({ success: false, msg: '用户名或密码错误' });
    }

    // 检查邮箱是否已验证 (admin 用户跳过检查)
    const fullUser = userStore.getByUsername(user.username);
    if (fullUser && fullUser.email && !fullUser.emailVerified && fullUser.role !== 'admin') {
        return res.status(403).json({
            success: false,
            msg: '邮箱尚未验证，请先完成邮箱验证',
            needVerify: true,
            email: fullUser.email,
        });
    }

    // 检查账号是否已启用 (admin 用户跳过检查)
    if (fullUser && fullUser.enabled === false && fullUser.role !== 'admin') {
        return res.status(403).json({
            success: false,
            msg: '账号待审核，请等待管理员审核通过后再登录',
        });
    }

    const token = jwt.sign(
        { userId: user.id, role: user.role, username: user.username },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );

    appendSecurityAudit('login_success', req, { ip: clientIp, username: user.username, role: user.role });
    clearLoginRate(clientIp, user.username);
    res.json({
        success: true,
        token,
        user: {
            username: user.username,
            role: user.role,
            email: fullUser?.email || '',
            subscriptionEmail: resolveUserSubscriptionEmail(fullUser),
        },
    });
});

/**
 * GET /api/auth/check
 * 验证 JWT 是否有效, 返回用户信息
 */
router.get('/check', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false });
    }
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], config.jwt.secret);
        const stored = decoded.userId ? userStore.getById(decoded.userId) : userStore.getByUsername(decoded.username);
        res.json({
            success: true,
            user: {
                username: decoded.username,
                role: decoded.role,
                email: stored?.email || '',
                subscriptionEmail: resolveUserSubscriptionEmail(stored),
            },
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
        const { username, password, email } = req.body;

        // 校验必填字段
        if (!username || !password || !email) {
            return res.status(400).json({ success: false, msg: '用户名、密码和邮箱不能为空' });
        }

        // 校验邮箱格式
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
        }

        const passwordCheck = checkAccountPassword(password);
        if (!passwordCheck.valid) {
            return res.status(400).json({ success: false, msg: passwordCheck.reason });
        }

        // 创建用户 (emailVerified = false, enabled = false 待审核)
        const user = userStore.add({
            username,
            password,
            email,
            subscriptionEmail: '',
            role: config.registration.defaultRole,
            emailVerified: false,
            enabled: false,
        });

        // 生成并发送验证码
        const code = generateVerifyCode();
        const expiresAt = new Date(Date.now() + config.registration.verifyCodeTtlMinutes * 60 * 1000).toISOString();
        userStore.setVerifyCode(user.id, code, expiresAt);

        try {
            await sendVerificationEmail(email, code, username);
        } catch (mailErr) {
            console.error('Failed to send verification email:', mailErr.message);
            // 不回滚用户, 允许后续重新发送
        }

        appendSecurityAudit('user_registered', req, { ip: clientIp, username, email });
        res.json({
            success: true,
            msg: '注册成功，请查收邮箱验证码。验证后需等待管理员审核通过才能登录。',
            email: user.email,
        });
    } catch (err) {
        res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * POST /api/auth/verify-email — 邮箱验证
 */
router.post('/verify-email', (req, res) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ success: false, msg: '请提供邮箱和验证码' });
        }

        const user = userStore.getByEmail(email);
        if (!user) {
            return res.status(404).json({ success: false, msg: '邮箱未注册' });
        }

        if (user.emailVerified) {
            return res.json({ success: true, msg: '邮箱已验证' });
        }

        if (!user.verifyCode || user.verifyCode !== code.trim()) {
            return res.status(400).json({ success: false, msg: '验证码错误' });
        }

        if (user.verifyCodeExpiresAt && new Date(user.verifyCodeExpiresAt) < new Date()) {
            return res.status(400).json({ success: false, msg: '验证码已过期，请重新发送' });
        }

        userStore.setEmailVerified(user.id);
        appendSecurityAudit('email_verified', req, { email, username: user.username });
        res.json({ success: true, msg: '邮箱验证成功，请登录' });
    } catch (err) {
        res.status(400).json({ success: false, msg: err.message });
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
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, msg: '请提供邮箱' });
        }

        const user = userStore.getByEmail(email);
        if (!user) {
            return res.status(404).json({ success: false, msg: '邮箱未注册' });
        }

        if (user.emailVerified) {
            return res.json({ success: true, msg: '邮箱已验证，无需重发' });
        }

        const code = generateVerifyCode();
        const expiresAt = new Date(Date.now() + config.registration.verifyCodeTtlMinutes * 60 * 1000).toISOString();
        userStore.setVerifyCode(user.id, code, expiresAt);

        await sendVerificationEmail(email, code, user.username);

        res.json({ success: true, msg: '验证码已重新发送' });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
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
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ success: false, msg: '请输入有效邮箱' });
        }

        const user = userStore.getByEmail(email);
        if (!user || !user.emailVerified) {
            // 不暴露邮箱是否存在，防止枚举。
            return res.json({ success: true, msg: '如果邮箱已注册，验证码已发送，请查收邮箱' });
        }

        const code = generateVerifyCode();
        const ttlMinutes = config.registration.passwordResetCodeTtlMinutes || config.registration.verifyCodeTtlMinutes;
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
        userStore.setPasswordResetCode(user.id, code, expiresAt);

        await sendPasswordResetEmail(email, code, user.username);
        appendSecurityAudit('password_reset_code_sent', req, { email, username: user.username });
        return res.json({ success: true, msg: '重置验证码已发送，请查收邮箱' });
    } catch (err) {
        return res.status(500).json({ success: false, msg: err.message || '发送失败' });
    }
});

/**
 * POST /api/auth/reset-password — 使用邮箱验证码重置密码
 */
router.post('/reset-password', (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const code = String(req.body?.code || '').trim();
        const newPassword = String(req.body?.newPassword || '');

        if (!email || !code || !newPassword) {
            return res.status(400).json({ success: false, msg: '邮箱、验证码和新密码不能为空' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
        }

        const passwordCheck = checkAccountPassword(newPassword);
        if (!passwordCheck.valid) {
            return res.status(400).json({ success: false, msg: passwordCheck.reason });
        }

        const user = userStore.getByEmail(email);
        if (!user) {
            return res.status(400).json({ success: false, msg: '邮箱或验证码错误' });
        }
        if (!user.resetCode || user.resetCode !== code) {
            return res.status(400).json({ success: false, msg: '邮箱或验证码错误' });
        }
        if (user.resetCodeExpiresAt && new Date(user.resetCodeExpiresAt) < new Date()) {
            return res.status(400).json({ success: false, msg: '验证码已过期，请重新获取' });
        }

        userStore.update(user.id, { password: newPassword });
        userStore.clearPasswordResetCode(user.id);

        appendSecurityAudit('password_reset_completed', req, {
            email,
            username: user.username,
        });
        return res.json({ success: true, msg: '密码重置成功，请使用新密码登录' });
    } catch (err) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

// ── User Management Routes (admin only) ────────────────────

/**
 * GET /api/auth/users — 获取所有用户列表
 */
router.get('/users', authMiddleware, adminOnly, (req, res) => {
    res.json({ success: true, obj: userStore.getAll() });
});

/**
 * POST /api/auth/users — 创建新用户
 */
router.post('/users', authMiddleware, adminOnly, (req, res) => {
    try {
        const { username, password, role } = req.body;
        const email = normalizeEmailInput(req.body?.email);
        const subscriptionEmail = Object.prototype.hasOwnProperty.call(req.body || {}, 'subscriptionEmail')
            ? normalizeEmailInput(req.body?.subscriptionEmail)
            : email;

        if (email && !isValidEmail(email)) {
            return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
        }
        if (subscriptionEmail && !isValidEmail(subscriptionEmail)) {
            return res.status(400).json({ success: false, msg: '订阅绑定邮箱格式不正确' });
        }

        const passwordCheck = checkAccountPassword(password);
        if (!passwordCheck.valid) {
            return res.status(400).json({ success: false, msg: passwordCheck.reason });
        }

        const user = userStore.add({
            username,
            password,
            role,
            email,
            subscriptionEmail,
            emailVerified: true,
            enabled: true,
        });
        appendSecurityAudit('user_created', req, {
            targetUser: username,
            role,
            email,
            subscriptionEmail: user.subscriptionEmail || '',
        });
        res.json({ success: true, obj: user });
    } catch (err) {
        res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * PUT /api/auth/users/:id — 更新用户信息
 */
router.put('/users/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const { username, password, role } = req.body;
        const nextData = { username, password, role };

        if (Object.prototype.hasOwnProperty.call(req.body, 'email')) {
            const email = normalizeEmailInput(req.body?.email);
            if (email && !isValidEmail(email)) {
                return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
            }
            nextData.email = email;
        }

        if (Object.prototype.hasOwnProperty.call(req.body, 'subscriptionEmail')) {
            const subscriptionEmail = normalizeEmailInput(req.body?.subscriptionEmail);
            if (subscriptionEmail && !isValidEmail(subscriptionEmail)) {
                return res.status(400).json({ success: false, msg: '订阅绑定邮箱格式不正确' });
            }
            nextData.subscriptionEmail = subscriptionEmail;
        }

        // 如果更新密码，检查账号密码策略
        if (password) {
            const passwordCheck = checkAccountPassword(password);
            if (!passwordCheck.valid) {
                return res.status(400).json({ success: false, msg: passwordCheck.reason });
            }
        }

        const user = userStore.update(req.params.id, nextData);
        if (!user) return res.status(404).json({ success: false, msg: '用户不存在' });
        appendSecurityAudit('user_updated', req, { targetUser: user.username });
        res.json({ success: true, obj: user });
    } catch (err) {
        res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * PUT /api/auth/users/:id/subscription-binding — 管理员绑定用户订阅邮箱
 */
router.put('/users/:id/subscription-binding', authMiddleware, adminOnly, (req, res) => {
    try {
        if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'subscriptionEmail')) {
            return res.status(400).json({ success: false, msg: 'subscriptionEmail is required' });
        }
        const subscriptionEmail = normalizeEmailInput(req.body?.subscriptionEmail);
        if (subscriptionEmail && !isValidEmail(subscriptionEmail)) {
            return res.status(400).json({ success: false, msg: '订阅绑定邮箱格式不正确' });
        }

        const target = userStore.getById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, msg: '用户不存在' });
        }

        const updated = userStore.setSubscriptionEmail(req.params.id, subscriptionEmail);
        appendSecurityAudit('user_subscription_binding_updated', req, {
            targetUserId: target.id,
            targetUsername: target.username,
            subscriptionEmail: updated?.subscriptionEmail || '',
        });
        return res.json({
            success: true,
            obj: updated,
        });
    } catch (err) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * PUT /api/auth/users/:id/set-enabled — 启用/停用用户
 */
router.put('/users/:id/set-enabled', authMiddleware, adminOnly, async (req, res) => {
    try {
        const target = userStore.getById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, msg: '用户不存在' });
        }
        if (target.role === 'admin') {
            return res.status(400).json({ success: false, msg: '管理员账号无法停用' });
        }

        const enabled = !!req.body?.enabled;
        const updated = userStore.setEnabled(req.params.id, enabled);

        const subscriptionEmail = resolveUserSubscriptionEmail(target);
        const allServers = serverStore.getAll();

        if (!enabled && subscriptionEmail) {
            // 停用：删除 3x-ui 客户端 + 撤销订阅 token
            try {
                await autoRemoveClients(subscriptionEmail, allServers);
            } catch { /* best-effort */ }
            try {
                subscriptionTokenStore.revokeAllByEmail(subscriptionEmail, 'user-disabled');
            } catch { /* best-effort */ }
        } else if (enabled && subscriptionEmail) {
            // 启用：如果已有 policy，恢复客户端
            const policy = userPolicyStore.get(subscriptionEmail);
            if (policy) {
                try {
                    await autoDeployClients(subscriptionEmail, allServers, policy);
                } catch { /* best-effort */ }
                try {
                    ensurePersistentSubscriptionToken(subscriptionEmail, String(req.user?.username || 'admin'));
                } catch { /* best-effort */ }
            }
        }

        appendSecurityAudit(enabled ? 'user_enabled' : 'user_disabled', req, {
            targetUserId: target.id,
            targetUsername: target.username,
            enabled,
        });
        return res.json({ success: true, obj: updated });
    } catch (err) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * PUT /api/auth/users/:id/update-expiry — 更新用户所有客户端的到期时间
 */
router.put('/users/:id/update-expiry', authMiddleware, adminOnly, async (req, res) => {
    try {
        const target = userStore.getById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, msg: '用户不存在' });
        }

        const subscriptionEmail = resolveUserSubscriptionEmail(target);
        if (!subscriptionEmail) {
            return res.status(400).json({ success: false, msg: '该用户无订阅邮箱' });
        }

        const expiryTime = Math.max(0, Math.floor(Number(req.body?.expiryTime) || 0));
        const allServers = serverStore.getAll();
        const result = await autoUpdateClientExpiry(subscriptionEmail, allServers, expiryTime);

        appendSecurityAudit('user_expiry_updated', req, {
            targetUserId: target.id,
            targetUsername: target.username,
            subscriptionEmail,
            expiryTime,
            updated: result.updated,
            failed: result.failed,
        });

        return res.json({ success: true, obj: result });
    } catch (err) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * POST /api/auth/users/:id/provision-subscription
 * 一键开通订阅：绑定订阅邮箱 + 写入节点/协议策略 + 预生成持久 token。
 */
router.post('/users/:id/provision-subscription', authMiddleware, adminOnly, async (req, res) => {
    try {
        const target = userStore.getById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, msg: '用户不存在' });
        }
        if (target.role === 'admin') {
            return res.status(400).json({ success: false, msg: '管理员账号无需开通订阅' });
        }

        const requestedEmail = Object.prototype.hasOwnProperty.call(req.body || {}, 'subscriptionEmail')
            ? req.body?.subscriptionEmail
            : (target.subscriptionEmail || target.email);
        const subscriptionEmail = normalizeEmailInput(requestedEmail);
        if (!subscriptionEmail) {
            return res.status(400).json({
                success: false,
                msg: '订阅绑定邮箱不能为空，请先为该用户设置邮箱',
            });
        }
        if (!isValidEmail(subscriptionEmail)) {
            return res.status(400).json({ success: false, msg: '订阅绑定邮箱格式不正确' });
        }

        const allowedServerIds = normalizeServerIds(req.body?.allowedServerIds);
        const existingServerIds = new Set(serverStore.getAll().map((item) => item.id));
        const invalidServerIds = allowedServerIds.filter((item) => !existingServerIds.has(item));
        if (invalidServerIds.length > 0) {
            return res.status(400).json({
                success: false,
                msg: `Unknown server IDs: ${invalidServerIds.join(', ')}`,
            });
        }
        const allowedProtocols = normalizeProtocols(req.body?.allowedProtocols);
        let serverScopeMode = normalizeScopeMode(req.body?.serverScopeMode, allowedServerIds.length > 0 ? 'selected' : 'all');
        let protocolScopeMode = normalizeScopeMode(req.body?.protocolScopeMode, allowedProtocols.length > 0 ? 'selected' : 'all');

        if (serverScopeMode === 'selected' && allowedServerIds.length === 0) {
            serverScopeMode = 'none';
        }
        if (protocolScopeMode === 'selected' && allowedProtocols.length === 0) {
            protocolScopeMode = 'none';
        }

        const actor = String(req.user?.username || req.user?.role || 'admin');
        const user = userStore.setSubscriptionEmail(target.id, subscriptionEmail);
        const policy = userPolicyStore.upsert(
            subscriptionEmail,
            { allowedServerIds, allowedProtocols, serverScopeMode, protocolScopeMode },
            actor
        );
        const tokenState = ensurePersistentSubscriptionToken(subscriptionEmail, actor);

        // Parse expiry: support expiryTime (timestamp ms) or expiryDays (relative days)
        let expiryTime = 0;
        const rawExpiryTime = Number(req.body?.expiryTime || 0);
        const rawExpiryDays = Number(req.body?.expiryDays || 0);
        if (rawExpiryTime > 0) {
            expiryTime = Math.floor(rawExpiryTime);
        } else if (rawExpiryDays > 0) {
            expiryTime = Date.now() + Math.floor(rawExpiryDays) * 24 * 60 * 60 * 1000;
        }

        // Parse allowed inbound keys (optional)
        const allowedInboundKeys = Array.isArray(req.body?.allowedInboundKeys)
            ? req.body.allowedInboundKeys.map((k) => String(k).trim()).filter(Boolean)
            : [];

        // Auto-deploy clients to 3x-ui panels
        let deployment = { total: 0, created: 0, skipped: 0, failed: 0, details: [] };
        try {
            deployment = await autoDeployClients(subscriptionEmail, serverStore.getAll(), policy, {
                expiryTime,
                allowedInboundKeys,
            });
        } catch (err) {
            deployment.error = err.message || 'Auto-deploy failed';
        }

        appendSecurityAudit('user_subscription_provisioned', req, {
            targetUserId: target.id,
            targetUsername: target.username,
            subscriptionEmail,
            allowedServerCount: allowedServerIds.length,
            allowedProtocolCount: allowedProtocols.length,
            tokenAutoIssued: tokenState.autoIssued,
            tokenIssueError: tokenState.issueError || '',
            deploymentCreated: deployment.created,
            deploymentSkipped: deployment.skipped,
            deploymentFailed: deployment.failed,
        });

        return res.json({
            success: true,
            obj: {
                user,
                policy,
                subscription: {
                    email: subscriptionEmail,
                    status: subscriptionEmail ? 'active' : 'pending',
                    fetchPath: `/api/subscriptions/${encodeURIComponent(subscriptionEmail)}`,
                    token: {
                        currentTokenId: tokenState.metadata?.id || '',
                        autoIssued: tokenState.autoIssued,
                        issueError: tokenState.issueError,
                    },
                },
                deployment,
            },
        });
    } catch (err) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * PUT /api/auth/users/:id/reset-password — 管理员重置指定用户密码
 */
router.put('/users/:id/reset-password', authMiddleware, adminOnly, (req, res) => {
    try {
        const newPassword = String(req.body?.newPassword || '');
        if (!newPassword) {
            return res.status(400).json({ success: false, msg: '新密码不能为空' });
        }

        const passwordCheck = checkAccountPassword(newPassword);
        if (!passwordCheck.valid) {
            return res.status(400).json({ success: false, msg: passwordCheck.reason });
        }

        const target = userStore.getById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, msg: '用户不存在' });
        }

        userStore.update(req.params.id, { password: newPassword });
        userStore.clearPasswordResetCode(req.params.id);
        appendSecurityAudit('user_password_reset_by_admin', req, {
            targetUserId: target.id,
            targetUsername: target.username,
        });
        return res.json({ success: true, msg: '密码已重置' });
    } catch (err) {
        return res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * DELETE /api/auth/users/:id — 删除用户
 */
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const targetUser = userStore.getById(req.params.id);
        if (!targetUser) {
            return res.status(404).json({ success: false, msg: '用户不存在' });
        }
        if (targetUser.role === 'admin') {
            return res.status(400).json({ success: false, msg: '管理员账号不支持在此处删除' });
        }

        const cleanupEmails = Array.from(new Set([
            normalizeEmailInput(targetUser.email),
            resolveUserSubscriptionEmail(targetUser),
        ].filter(Boolean)));
        const ok = userStore.remove(req.params.id);
        if (!ok) return res.status(404).json({ success: false, msg: '用户不存在' });

        let revokedTokenCount = 0;
        const removedPolicyEmails = [];
        let cleanupError = '';
        for (const email of cleanupEmails) {
            try {
                revokedTokenCount += subscriptionTokenStore.revokeAllByEmail(email, 'user-deleted');
                const removed = userPolicyStore.remove(email);
                if (removed) removedPolicyEmails.push(email);
            } catch (error) {
                cleanupError = error.message || 'cleanup-failed';
            }
        }

        // Remove clients from 3x-ui panels
        let clientCleanup = { total: 0, removed: 0, failed: 0 };
        for (const email of cleanupEmails) {
            try {
                const removal = await autoRemoveClients(email, serverStore.getAll());
                clientCleanup.total += removal.total;
                clientCleanup.removed += removal.removed;
                clientCleanup.failed += removal.failed;
            } catch {
                // best-effort, don't block user deletion
            }
        }

        appendSecurityAudit('user_deleted', req, {
            targetUserId: targetUser.id,
            targetUser: targetUser.username,
            cleanupEmails,
            revokedTokenCount,
            removedPolicyEmails,
            cleanupError,
            clientCleanup,
        });
        res.json({
            success: true,
            obj: {
                revokedTokenCount,
                removedPolicyEmails,
                cleanupError: cleanupError || null,
                clientCleanup,
            },
        });
    } catch (err) {
        res.status(400).json({ success: false, msg: err.message });
    }
});

/**
 * PUT /api/auth/change-password — 修改自己的密码
 */
router.put('/change-password', authMiddleware, (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, msg: '请提供旧密码和新密码' });
        }

        const passwordCheck = checkAccountPassword(newPassword);
        if (!passwordCheck.valid) {
            return res.status(400).json({ success: false, msg: passwordCheck.reason });
        }

        const userId = req.user.userId;
        if (!userId) {
            return res.status(400).json({ success: false, msg: '无法识别当前用户' });
        }

        const user = userStore.getById(userId);
        if (!user) {
            return res.status(404).json({ success: false, msg: '用户不存在' });
        }

        // Verify old password
        const verified = userStore.authenticate(user.username, oldPassword);
        if (!verified) {
            return res.status(401).json({ success: false, msg: '旧密码错误' });
        }

        userStore.update(userId, { password: newPassword });
        appendSecurityAudit('password_changed', req, { username: user.username });
        res.json({ success: true, msg: '密码修改成功' });
    } catch (err) {
        res.status(400).json({ success: false, msg: err.message });
    }
});

export default router;
