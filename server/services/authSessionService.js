import jwt from 'jsonwebtoken';
import config from '../config.js';
import { checkAccountPassword } from '../lib/passwordValidator.js';
import { createHttpError } from '../lib/httpError.js';
import userRepository from '../repositories/userRepository.js';
import { normalizeEmailInput } from './emailAuthService.js';

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

    const userId = currentUser?.userId;
    if (!userId) {
        throw createHttpError(400, '无法识别当前用户');
    }

    const userRepo = deps.userRepository || userRepository;
    const user = userRepo.getById(userId);
    if (!user) {
        throw createHttpError(404, '用户不存在');
    }

    const verified = userRepo.authenticate(user.username, oldPassword);
    if (!verified) {
        throw createHttpError(401, '旧密码错误');
    }

    userRepo.update(userId, { password: newPassword });
    return {
        user,
    };
}

export { createLoginSession, validateSession, changeOwnPassword };
