import jwt from 'jsonwebtoken';
import config from '../config.js';
import * as mailer from '../lib/mailer.js';
import { checkAccountPassword } from '../lib/passwordValidator.js';
import { createHttpError } from '../lib/httpError.js';
import userRepository from '../repositories/userRepository.js';
import { isValidEmail, normalizeEmailInput } from './emailAuthService.js';

function normalizeUsernameInput(value) {
    return String(value || '').trim();
}

function resolveUserSubscriptionEmail(user) {
    if (!user || typeof user !== 'object') return '';
    if (Object.prototype.hasOwnProperty.call(user, 'subscriptionEmail')) {
        return normalizeEmailInput(user.subscriptionEmail);
    }
    return normalizeEmailInput(user.email);
}

function buildSessionUser(user, fallback = {}) {
    return {
        username: String(user?.username || fallback.username || '').trim(),
        role: String(user?.role || fallback.role || 'user').trim(),
        email: user?.email || '',
        subscriptionEmail: resolveUserSubscriptionEmail(user),
        emailVerified: user?.emailVerified === true,
    };
}

function buildAuditUser(user, fallback = {}) {
    const sessionUser = buildSessionUser(user, fallback);
    return {
        userId: String(user?.id || fallback.userId || '').trim(),
        username: sessionUser.username,
        role: sessionUser.role,
        email: normalizeEmailInput(sessionUser.email),
        subscriptionEmail: normalizeEmailInput(sessionUser.subscriptionEmail),
    };
}

function buildSignedToken(payload, deps = {}) {
    const jwtConfig = deps.jwtConfig || config.jwt;
    const signer = deps.jwtSign || jwt.sign;
    return signer(payload, jwtConfig.secret, {
        expiresIn: jwtConfig.expiresIn,
    });
}

function buildExpiryIso(ttlMinutes) {
    return new Date(Date.now() + Number(ttlMinutes || 0) * 60 * 1000).toISOString();
}

function createLoginSession(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const authConfig = deps.authConfig || config.auth;
    const username = String(payload?.username || '').trim();
    const password = typeof payload?.password === 'string' ? payload.password : '';
    const user = userRepo.authenticate(username, password);

    if (!user) {
        const existingUser = username ? userRepo.getByUsername(username) : null;
        const adminUser = userRepo.getByUsername('admin') || userRepo.list().find((item) => item.role === 'admin');
        const legacyUsername = String(adminUser?.username || 'admin').trim();
        const usernameMatchesLegacy = !username || username === legacyUsername;

        if (usernameMatchesLegacy && authConfig.allowLegacyPasswordLogin !== false && password === authConfig.adminPassword) {
            const tokenPayload = {
                role: 'admin',
                username: legacyUsername || 'admin',
            };
            if (adminUser?.id) tokenPayload.userId = adminUser.id;

            return {
                success: true,
                token: buildSignedToken(tokenPayload, deps),
                user: buildSessionUser(adminUser, tokenPayload),
                audit: {
                    ...buildAuditUser(adminUser, tokenPayload),
                    legacyMode: true,
                },
            };
        }

        return {
            success: false,
            reason: 'invalid_credentials',
            audit: existingUser ? buildAuditUser(existingUser) : null,
        };
    }

    const fullUser = userRepo.getByUsername(user.username);
    if (fullUser && fullUser.email && !fullUser.emailVerified && fullUser.role !== 'admin') {
        return {
            success: false,
            reason: 'email_not_verified',
            email: fullUser.email,
            audit: buildAuditUser(fullUser),
        };
    }

    if (fullUser && fullUser.enabled === false && fullUser.role !== 'admin') {
        return {
            success: false,
            reason: 'user_disabled',
            email: normalizeEmailInput(fullUser.email),
            subscriptionEmail: resolveUserSubscriptionEmail(fullUser),
            audit: buildAuditUser(fullUser),
        };
    }

    const tokenPayload = { userId: user.id, role: user.role, username: user.username };
    return {
        success: true,
        token: buildSignedToken(tokenPayload, deps),
        user: buildSessionUser(fullUser, tokenPayload),
        audit: {
            ...buildAuditUser(fullUser, tokenPayload),
            legacyMode: false,
        },
    };
}

function validateSession(authHeader, deps = {}) {
    if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
        throw createHttpError(401, '未授权');
    }

    try {
        const verifier = deps.jwtVerify || jwt.verify;
        const jwtConfig = deps.jwtConfig || config.jwt;
        const decoded = verifier(String(authHeader).split(' ')[1], jwtConfig.secret);
        const userRepo = deps.userRepository || userRepository;
        const stored = decoded.userId ? userRepo.getById(decoded.userId) : userRepo.getByUsername(decoded.username);

        return {
            decoded,
            user: buildSessionUser(stored, decoded),
        };
    } catch {
        throw createHttpError(401, '未授权');
    }
}

function resolveCurrentUserRecord(currentUser = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const userId = String(currentUser?.userId || '').trim();
    if (userId) {
        return userRepo.getById(userId);
    }

    const username = String(currentUser?.username || '').trim();
    if (username) {
        return userRepo.getByUsername(username);
    }
    return null;
}

function changeOwnPassword(payload = {}, currentUser = {}, deps = {}) {
    const oldPassword = String(payload?.oldPassword || '');
    const newPassword = String(payload?.newPassword || '');
    if (!oldPassword || !newPassword) {
        throw createHttpError(400, '请提供旧密码和新密码');
    }

    const passwordCheck = checkAccountPassword(newPassword);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    const userRepo = deps.userRepository || userRepository;
    const user = resolveCurrentUserRecord(currentUser, deps);
    if (!user) {
        throw createHttpError(400, '无法识别当前用户');
    }

    const verified = userRepo.authenticate(user.username, oldPassword);
    if (!verified) {
        throw createHttpError(401, '旧密码错误');
    }

    userRepo.update(user.id, { password: newPassword });
    return {
        user,
    };
}

function resolveOwnProfileUpdateInput(payload = {}, currentUser = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const user = resolveCurrentUserRecord(currentUser, deps);
    if (!user) {
        throw createHttpError(400, '无法识别当前用户');
    }
    const username = normalizeUsernameInput(payload?.username);
    const email = normalizeEmailInput(payload?.email);
    if (!username) {
        throw createHttpError(400, '请提供用户名');
    }
    if (!email) {
        throw createHttpError(400, '请提供邮箱');
    }
    if (!isValidEmail(email)) {
        throw createHttpError(400, '邮箱格式不正确');
    }

    const existingByUsername = typeof userRepo.getByUsername === 'function'
        ? userRepo.getByUsername(username)
        : null;
    if (existingByUsername && String(existingByUsername.id || '').trim() !== String(user.id || '').trim()) {
        throw createHttpError(400, `用户名 "${username}" 已存在`);
    }
    const existingByEmail = typeof userRepo.getByEmail === 'function'
        ? userRepo.getByEmail(email)
        : null;
    if (existingByEmail && String(existingByEmail.id || '').trim() !== String(user.id || '').trim()) {
        throw createHttpError(400, `邮箱 "${email}" 已被注册`);
    }

    const previousUsername = normalizeUsernameInput(user.username);
    const previousEmail = normalizeEmailInput(user.email);
    const previousSubscriptionEmail = normalizeEmailInput(user.subscriptionEmail);

    return {
        userRepo,
        user,
        username,
        email,
        previousUsername,
        previousEmail,
        previousSubscriptionEmail,
    };
}

async function requestOwnProfileUpdateVerification(payload = {}, currentUser = {}, deps = {}) {
    const emailSender = deps.mailer || mailer;
    const registrationConfig = deps.registrationConfig || config.registration;
    const {
        userRepo,
        user,
        username,
        email,
        previousUsername,
        previousEmail,
    } = resolveOwnProfileUpdateInput(payload, currentUser, deps);

    if (username === previousUsername && email === previousEmail) {
        throw createHttpError(400, '账号信息没有变化');
    }
    if (!previousEmail) {
        throw createHttpError(400, '当前账号未绑定登录邮箱');
    }

    const code = emailSender.generateVerifyCode();
    const expiresAt = buildExpiryIso(registrationConfig.verifyCodeTtlMinutes);
    try {
        await emailSender.sendVerificationEmail(previousEmail, code, previousUsername || username);
        userRepo.setProfileUpdateVerification(user.id, {
            code,
            expiresAt,
            targetEmail: previousEmail,
            username,
            email,
        });
    } catch (error) {
        throw createHttpError(
            503,
            '验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
            {
                code: 'PROFILE_VERIFICATION_EMAIL_SEND_FAILED',
                details: {
                    userId: String(user?.id || '').trim(),
                    previousEmail,
                    nextEmail: email,
                    error: error?.message || 'send failed',
                },
            }
        );
    }

    return {
        user,
        verificationEmail: previousEmail,
        username,
        email,
        expiresAt,
    };
}

function updateOwnProfile(payload = {}, currentUser = {}, deps = {}) {
    const {
        userRepo,
        user,
        username,
        email,
        previousUsername,
        previousEmail,
        previousSubscriptionEmail,
    } = resolveOwnProfileUpdateInput(payload, currentUser, deps);
    const code = String(payload?.code || '').trim();
    if (!code) {
        throw createHttpError(400, '请提供邮箱验证码');
    }
    if (username === previousUsername && email === previousEmail) {
        throw createHttpError(400, '账号信息没有变化');
    }

    if (!String(user?.profileVerifyCode || '').trim()) {
        throw createHttpError(400, '请先发送邮箱验证码');
    }
    if (String(user.profileVerifyCode).trim() !== code) {
        throw createHttpError(400, '验证码错误');
    }
    if (user.profileVerifyCodeExpiresAt && new Date(user.profileVerifyCodeExpiresAt) < new Date()) {
        throw createHttpError(400, '验证码已过期，请重新发送');
    }
    if (normalizeEmailInput(user.profileVerifyTargetEmail) !== previousEmail) {
        throw createHttpError(400, '验证邮箱已变化，请重新发送验证码');
    }
    if (normalizeUsernameInput(user.profileVerifyUsername) !== username || normalizeEmailInput(user.profileVerifyEmail) !== email) {
        throw createHttpError(400, '账号信息已变更，请重新发送验证码');
    }

    const updated = userRepo.update(user.id, { username, email, emailVerified: true });
    if (!updated) {
        throw createHttpError(404, '用户不存在');
    }
    userRepo.clearProfileUpdateVerification(user.id);

    return {
        user: updated,
        previousUsername,
        previousEmail,
        previousSubscriptionEmail,
        subscriptionEmailSynced: false,
    };
}

export {
    createLoginSession,
    validateSession,
    changeOwnPassword,
    requestOwnProfileUpdateVerification,
    updateOwnProfile,
};
