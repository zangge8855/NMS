import jwt from 'jsonwebtoken';
import config from '../config.js';
import * as mailer from '../lib/mailer.js';
import { checkAccountPassword } from '../lib/passwordValidator.js';
import { createHttpError } from '../lib/httpError.js';
import { normalizeAppLocale, pickLocalizedText } from '../lib/requestLocale.js';
import {
    buildTotpUri,
    generateBackupCodes,
    generateTotpSecret,
    hashBackupCode,
    verifyBackupCode,
    verifyTotp,
} from '../lib/totp.js';
import userRepository from '../repositories/userRepository.js';
import { isValidEmail, normalizeEmailInput } from './emailAuthService.js';

const TWO_FACTOR_CHALLENGE_AUDIENCE = 'nms-2fa-challenge';
const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;
const TWO_FACTOR_FAILURE_MAX_ATTEMPTS = 5;
const TWO_FACTOR_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const twoFactorFailures = new Map<string, { count: number; firstAttempt: number; blockedUntil: number }>();

function getTwoFactorFailureState(userId: string) {
    const key = String(userId || '').trim();
    if (!key) return { blocked: false };
    const now = Date.now();
    const record = twoFactorFailures.get(key);
    if (!record) return { blocked: false };
    if (record.blockedUntil > now) return { blocked: true };
    if (now - record.firstAttempt > TWO_FACTOR_FAILURE_WINDOW_MS) {
        twoFactorFailures.delete(key);
        return { blocked: false };
    }
    return { blocked: false };
}

function recordTwoFactorFailure(userId: string) {
    const key = String(userId || '').trim();
    if (!key) return false;
    const now = Date.now();
    if (twoFactorFailures.size >= 5000) {
        for (const [entryKey, entry] of twoFactorFailures.entries()) {
            if ((entry.blockedUntil && entry.blockedUntil <= now) || (now - entry.firstAttempt > TWO_FACTOR_FAILURE_WINDOW_MS)) {
                twoFactorFailures.delete(entryKey);
            }
        }
    }
    const existing = twoFactorFailures.get(key);
    if (!existing || now - existing.firstAttempt > TWO_FACTOR_FAILURE_WINDOW_MS) {
        twoFactorFailures.set(key, { count: 1, firstAttempt: now, blockedUntil: 0 });
        return false;
    }
    existing.count += 1;
    if (existing.count >= TWO_FACTOR_FAILURE_MAX_ATTEMPTS) {
        existing.blockedUntil = now + TWO_FACTOR_FAILURE_WINDOW_MS;
        return true;
    }
    return false;
}

function clearTwoFactorFailures(userId: string) {
    const key = String(userId || '').trim();
    if (key) twoFactorFailures.delete(key);
}

function normalizeUsernameInput(value: unknown): string {
    return String(value || '').trim();
}

function resolveLoginIdentifier(payload: any = {}): string {
    return normalizeUsernameInput(payload?.identifier || payload?.username || payload?.email);
}

function findUserByLoginIdentifier(userRepo: any, identifier: string) {
    const normalizedIdentifier = normalizeUsernameInput(identifier);
    if (!normalizedIdentifier || !userRepo) return null;

    if (typeof userRepo.getByLoginIdentifier === 'function') {
        return userRepo.getByLoginIdentifier(normalizedIdentifier);
    }

    const normalizedEmail = normalizeEmailInput(normalizedIdentifier);
    if (normalizedEmail && isValidEmail(normalizedEmail) && typeof userRepo.getByEmail === 'function') {
        const emailUser = userRepo.getByEmail(normalizedEmail);
        if (emailUser) return emailUser;
    }

    return typeof userRepo.getByUsername === 'function'
        ? userRepo.getByUsername(normalizedIdentifier)
        : null;
}

function resolveUserSubscriptionEmail(user: any): string {
    if (!user || typeof user !== 'object') return '';
    const explicitSubEmail = normalizeEmailInput(user.subscriptionEmail);
    if (explicitSubEmail) {
        return explicitSubEmail;
    }
    return normalizeEmailInput(user.email);
}

function buildSessionUser(user: any, fallback: any = {}) {
    return {
        username: String(user?.username || fallback.username || '').trim(),
        role: String(user?.role || fallback.role || 'user').trim(),
        email: user?.email || '',
        subscriptionEmail: resolveUserSubscriptionEmail(user),
        emailVerified: user?.emailVerified === true,
    };
}

function buildAuditUser(user: any, fallback: any = {}) {
    const sessionUser = buildSessionUser(user, fallback);
    return {
        userId: String(user?.id || fallback.userId || '').trim(),
        username: sessionUser.username,
        role: sessionUser.role,
        email: normalizeEmailInput(sessionUser.email),
        subscriptionEmail: normalizeEmailInput(sessionUser.subscriptionEmail),
    };
}

function buildSignedToken(payload: any, deps: any = {}): string {
    const jwtConfig = deps.jwtConfig || config.jwt;
    const signer = deps.jwtSign || jwt.sign;
    return signer(payload, jwtConfig.secret, {
        expiresIn: jwtConfig.expiresIn,
    });
}

function buildExpiryIso(ttlMinutes: unknown): string {
    return new Date(Date.now() + Number(ttlMinutes || 0) * 60 * 1000).toISOString();
}

function createLoginSession(payload: any = {}, deps: any = {}): any {
    const userRepo = deps.userRepository || userRepository;
    const authConfig = deps.authConfig || config.auth;
    const loginIdentifier = resolveLoginIdentifier(payload);
    const password = typeof payload?.password === 'string' ? payload.password : '';
    const user = userRepo.authenticate(loginIdentifier, password);

    if (!user) {
        const existingUser = loginIdentifier ? findUserByLoginIdentifier(userRepo, loginIdentifier) : null;
        const listedUsers = typeof userRepo.list === 'function' ? userRepo.list() : [];
        const adminUser = (typeof userRepo.getByUsername === 'function' ? userRepo.getByUsername('admin') : null)
            || listedUsers.find((item: any) => item.role === 'admin');
        const legacyUsername = String(adminUser?.username || 'admin').trim();
        const legacyEmail = normalizeEmailInput(adminUser?.email);
        const normalizedIdentifierEmail = normalizeEmailInput(loginIdentifier);
        const identifierMatchesLegacy = !loginIdentifier
            || loginIdentifier === legacyUsername
            || (legacyEmail && normalizedIdentifierEmail === legacyEmail);

        if (identifierMatchesLegacy && authConfig.allowLegacyPasswordLogin === true && password === authConfig.adminPassword) {
            const tokenPayload: any = {
                role: 'admin',
                username: legacyUsername || 'admin',
                tokenVersion: Number(adminUser?.tokenVersion || 1),
            };
            if (adminUser?.id) tokenPayload.userId = adminUser.id;

            const twoFactor = adminUser?.id && typeof userRepo.getTwoFactor === 'function'
                ? userRepo.getTwoFactor(adminUser.id)
                : null;
            if (twoFactor && twoFactor.enabled === true) {
                return {
                    success: false,
                    reason: 'two_factor_required',
                    challengeToken: buildTwoFactorChallenge(tokenPayload, deps),
                    email: normalizeEmailInput(adminUser?.email),
                    audit: buildAuditUser(adminUser, tokenPayload),
                };
            }

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
    if (fullUser && (fullUser.isGuest === true || fullUser.role === 'guest')) {
        return {
            success: false,
            reason: 'guest_login_forbidden',
            audit: buildAuditUser(fullUser),
        };
    }

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

    const tokenPayload = {
        userId: user.id,
        role: user.role,
        username: user.username,
        tokenVersion: Number(fullUser?.tokenVersion || 1),
    };

    const twoFactor = typeof userRepo.getTwoFactor === 'function'
        ? userRepo.getTwoFactor(user.id)
        : null;
    if (twoFactor && twoFactor.enabled === true) {
        return {
            success: false,
            reason: 'two_factor_required',
            challengeToken: buildTwoFactorChallenge(tokenPayload, deps),
            email: normalizeEmailInput(fullUser?.email),
            audit: buildAuditUser(fullUser, tokenPayload),
        };
    }

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

function buildTwoFactorChallenge(tokenPayload: any, deps: any = {}): string {
    const jwtConfig = deps.jwtConfig || config.jwt;
    const signer = deps.jwtSign || jwt.sign;
    return signer(
        {
            type: '2fa_challenge',
            userId: tokenPayload.userId,
            username: tokenPayload.username,
            role: tokenPayload.role,
        },
        jwtConfig.secret,
        {
            audience: TWO_FACTOR_CHALLENGE_AUDIENCE,
            expiresIn: TWO_FACTOR_CHALLENGE_TTL_SECONDS,
        }
    );
}

function verifyTwoFactorChallenge(token: unknown, deps: any = {}): any {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    if (!token || typeof token !== 'string') {
        throw createHttpError(400, pickLocalizedText(locale, '缺少 2FA 挑战凭证', 'Missing 2FA challenge token'));
    }
    const jwtConfig = deps.jwtConfig || config.jwt;
    const verifier = deps.jwtVerify || jwt.verify;
    try {
        const decoded: any = verifier(token, jwtConfig.secret, {
            audience: TWO_FACTOR_CHALLENGE_AUDIENCE,
            algorithms: ['HS256'],
        });
        if (!decoded || decoded.type !== '2fa_challenge' || !decoded.userId) {
            throw new Error('invalid');
        }
        return decoded;
    } catch {
        throw createHttpError(401, pickLocalizedText(locale, '2FA 挑战凭证无效或已过期', '2FA challenge token is invalid or expired'));
    }
}

function completeTwoFactorLogin(payload: any = {}, deps: any = {}): any {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const challenge = verifyTwoFactorChallenge(payload?.challengeToken, deps);
    const stored = userRepo.getById(challenge.userId);
    if (!stored) throw createHttpError(401, pickLocalizedText(locale, '账号不存在', 'Account not found'));
    if (stored.enabled === false && stored.role !== 'admin') {
        throw createHttpError(403, pickLocalizedText(locale, '账号已停用', 'Account has been disabled'));
    }
    if (getTwoFactorFailureState(stored.id).blocked) {
        throw createHttpError(
            429,
            pickLocalizedText(
                locale,
                '2FA 验证尝试过于频繁，请 15 分钟后再试',
                'Too many 2FA verification attempts, please try again in 15 minutes'
            )
        );
    }

    const config2FA = typeof userRepo.getTwoFactor === 'function'
        ? userRepo.getTwoFactor(stored.id)
        : null;
    if (!config2FA || config2FA.enabled !== true) {
        throw createHttpError(400, pickLocalizedText(locale, '账号未启用 2FA', '2FA is not enabled for this account'));
    }

    const code = String(payload?.code || '').trim();
    const usedBackup = payload?.useBackupCode === true;
    let backupConsumed = false;

    if (usedBackup) {
        const result = verifyBackupCode(code, config2FA.backupCodeHashes);
        if (!result.match) {
            if (recordTwoFactorFailure(stored.id)) {
                throw createHttpError(
                    429,
                    pickLocalizedText(
                        locale,
                        '2FA 验证尝试过于频繁，请 15 分钟后再试',
                        'Too many 2FA verification attempts, please try again in 15 minutes'
                    )
                );
            }
            return { success: false, reason: 'invalid_code', audit: buildAuditUser(stored, challenge) };
        }
        userRepo.consumeTwoFactorBackupCode(stored.id, result.remaining);
        backupConsumed = true;
    } else if (!verifyTotp(code, config2FA.secret)) {
        if (recordTwoFactorFailure(stored.id)) {
            throw createHttpError(
                429,
                pickLocalizedText(
                    locale,
                    '2FA 验证尝试过于频繁，请 15 分钟后再试',
                    'Too many 2FA verification attempts, please try again in 15 minutes'
                )
            );
        }
        return { success: false, reason: 'invalid_code', audit: buildAuditUser(stored, challenge) };
    }

    clearTwoFactorFailures(stored.id);
    const tokenPayload = {
        userId: stored.id,
        role: stored.role,
        username: stored.username,
        tokenVersion: Number(stored.tokenVersion || 1),
    };
    return {
        success: true,
        token: buildSignedToken(tokenPayload, deps),
        user: buildSessionUser(stored, tokenPayload),
        audit: {
            ...buildAuditUser(stored, tokenPayload),
            twoFactor: true,
            backupCodeUsed: backupConsumed,
        },
    };
}

function beginTwoFactorEnrollment(currentUser: any, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const stored = userRepo.getById(currentUser?.userId)
        || userRepo.getByUsername(currentUser?.username);
    if (!stored) throw createHttpError(404, pickLocalizedText(locale, '账号不存在', 'Account not found'));

    const existing = typeof userRepo.getTwoFactor === 'function'
        ? userRepo.getTwoFactor(stored.id)
        : null;
    if (existing && existing.enabled) {
        throw createHttpError(409, pickLocalizedText(locale, '当前账号已启用 2FA', '2FA is already enabled for this account'));
    }

    const secret = generateTotpSecret();
    const accountName = stored.email || stored.username || 'admin';
    const uri = buildTotpUri({ secret, accountName, issuer: 'NMS' });
    return { secret, otpauth: uri, accountName };
}

function enableTwoFactor(payload: any = {}, currentUser: any, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const stored = userRepo.getById(currentUser?.userId)
        || userRepo.getByUsername(currentUser?.username);
    if (!stored) throw createHttpError(404, pickLocalizedText(locale, '账号不存在', 'Account not found'));

    const existing = typeof userRepo.getTwoFactor === 'function'
        ? userRepo.getTwoFactor(stored.id)
        : null;
    if (existing && existing.enabled) {
        throw createHttpError(409, pickLocalizedText(locale, '当前账号已启用 2FA', '2FA is already enabled for this account'));
    }

    const secret = String(payload?.secret || '').trim();
    const code = String(payload?.code || '').trim();
    if (!secret) throw createHttpError(400, pickLocalizedText(locale, '缺少 2FA 密钥', 'Missing 2FA secret'));
    if (!verifyTotp(code, secret)) {
        throw createHttpError(400, pickLocalizedText(locale, '验证码不正确,请重试', 'Verification code is incorrect, please try again'));
    }

    const backupCodes = generateBackupCodes(10);
    const backupCodeHashes = backupCodes.map((code2) => hashBackupCode(code2));
    userRepo.setTwoFactor(stored.id, { secret, backupCodeHashes });

    return {
        enabled: true,
        backupCodes,
        audit: buildAuditUser(stored),
    };
}

function disableTwoFactor(payload: any = {}, currentUser: any, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const stored = userRepo.getById(currentUser?.userId)
        || userRepo.getByUsername(currentUser?.username);
    if (!stored) throw createHttpError(404, pickLocalizedText(locale, '账号不存在', 'Account not found'));

    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (!password) throw createHttpError(400, pickLocalizedText(locale, '需要确认当前账号密码', 'Current account password is required'));
    const verified = userRepo.authenticate(stored.username, password);
    if (!verified) throw createHttpError(401, pickLocalizedText(locale, '账号密码不正确', 'Account password is incorrect'));

    userRepo.clearTwoFactor(stored.id);
    return {
        enabled: false,
        audit: buildAuditUser(stored),
    };
}

function getTwoFactorStatus(currentUser: any, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const stored = userRepo.getById(currentUser?.userId)
        || userRepo.getByUsername(currentUser?.username);
    if (!stored) throw createHttpError(404, pickLocalizedText(locale, '账号不存在', 'Account not found'));
    const existing = typeof userRepo.getTwoFactor === 'function'
        ? userRepo.getTwoFactor(stored.id)
        : null;
    return {
        enabled: existing?.enabled === true,
        enabledAt: existing?.enabledAt || '',
        backupCodesRemaining: Array.isArray(existing?.backupCodeHashes) ? existing.backupCodeHashes.length : 0,
    };
}

function validateSession(authHeader: unknown, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const unauthorizedMsg = pickLocalizedText(locale, '未授权', 'Unauthorized');
    if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
        throw createHttpError(401, unauthorizedMsg);
    }

    try {
        const verifier = deps.jwtVerify || jwt.verify;
        const jwtConfig = deps.jwtConfig || config.jwt;
        const decoded: any = verifier(String(authHeader).split(' ')[1], jwtConfig.secret, {
            algorithms: ['HS256'],
        });
        if (!decoded || decoded.type || decoded.isGuest || decoded.role === 'guest') {
            throw createHttpError(401, unauthorizedMsg);
        }
        const userRepo = deps.userRepository || userRepository;
        const stored = decoded.userId ? userRepo.getById(decoded.userId) : userRepo.getByUsername(decoded.username);
        if (!stored) {
            throw createHttpError(401, unauthorizedMsg);
        }
        if (stored.enabled === false && stored.role !== 'admin') {
            throw createHttpError(401, unauthorizedMsg);
        }
        if (decoded.role && stored.role && decoded.role !== stored.role) {
            throw createHttpError(401, unauthorizedMsg);
        }
        if (Number(decoded.tokenVersion ?? 1) !== Number(stored.tokenVersion ?? 1)) {
            throw createHttpError(401, unauthorizedMsg);
        }

        return {
            decoded,
            user: buildSessionUser(stored, decoded),
        };
    } catch {
        throw createHttpError(401, unauthorizedMsg);
    }
}

function resolveCurrentUserRecord(currentUser: any = {}, deps: any = {}) {
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

function changeOwnPassword(payload: any = {}, currentUser: any = {}, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const oldPassword = String(payload?.oldPassword || '');
    const newPassword = String(payload?.newPassword || '');
    if (!oldPassword || !newPassword) {
        throw createHttpError(400, pickLocalizedText(locale, '请提供旧密码和新密码', 'Current password and new password are required'));
    }

    const passwordCheck = checkAccountPassword(newPassword, locale);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    const userRepo = deps.userRepository || userRepository;
    const user = resolveCurrentUserRecord(currentUser, deps);
    if (!user) {
        throw createHttpError(400, pickLocalizedText(locale, '无法识别当前用户', 'Unable to identify current user'));
    }

    const verified = userRepo.authenticate(user.username, oldPassword);
    if (!verified) {
        throw createHttpError(401, pickLocalizedText(locale, '旧密码错误', 'Current password is incorrect'));
    }

    userRepo.update(user.id, { password: newPassword });
    return {
        user,
    };
}

function resolveOwnProfileUpdateInput(payload: any = {}, currentUser: any = {}, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const user = resolveCurrentUserRecord(currentUser, deps);
    if (!user) {
        throw createHttpError(400, pickLocalizedText(locale, '无法识别当前用户', 'Unable to identify current user'));
    }
    const username = normalizeUsernameInput(payload?.username);
    const email = normalizeEmailInput(payload?.email);
    if (!username) {
        throw createHttpError(400, pickLocalizedText(locale, '请提供用户名', 'Username is required'));
    }
    if (!email) {
        throw createHttpError(400, pickLocalizedText(locale, '请提供邮箱', 'Email is required'));
    }
    if (!isValidEmail(email)) {
        throw createHttpError(400, pickLocalizedText(locale, '邮箱格式不正确', 'Invalid email format'));
    }

    const existingByUsername = typeof userRepo.getByUsername === 'function'
        ? userRepo.getByUsername(username)
        : null;
    if (existingByUsername && String(existingByUsername.id || '').trim() !== String(user.id || '').trim()) {
        throw createHttpError(400, pickLocalizedText(locale, `用户名 "${username}" 已存在`, `Username "${username}" already exists`));
    }
    const existingByEmail = typeof userRepo.getByEmail === 'function'
        ? userRepo.getByEmail(email)
        : null;
    if (existingByEmail && String(existingByEmail.id || '').trim() !== String(user.id || '').trim()) {
        throw createHttpError(400, pickLocalizedText(locale, `邮箱 "${email}" 已被注册`, `Email "${email}" is already registered`));
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

async function requestOwnProfileUpdateVerification(payload: any = {}, currentUser: any = {}, deps: any = {}): Promise<any> {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
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
        throw createHttpError(400, pickLocalizedText(locale, '账号信息没有变化', 'Account information has not changed'));
    }
    const targetEmail = previousEmail || email;
    if (!targetEmail) {
        throw createHttpError(400, pickLocalizedText(locale, '请提供要绑定的邮箱', 'Please provide an email address to bind'));
    }

    const code = emailSender.generateVerifyCode();
    const expiresAt = buildExpiryIso(registrationConfig.verifyCodeTtlMinutes);
    try {
        await emailSender.sendVerificationEmail(targetEmail, code, previousUsername || username);
        userRepo.setProfileUpdateVerification(user.id, {
            code,
            expiresAt,
            targetEmail,
            username,
            email,
        });
    } catch (error: any) {
        throw createHttpError(
            503,
            pickLocalizedText(
                locale,
                '验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
                'Failed to send verification code email, please try again later or check SMTP configuration'
            ),
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
        verificationEmail: targetEmail,
        username,
        email,
        expiresAt,
    };
}

function updateOwnProfile(payload: any = {}, currentUser: any = {}, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
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
        throw createHttpError(400, pickLocalizedText(locale, '请提供邮箱验证码', 'Email verification code is required'));
    }
    if (username === previousUsername && email === previousEmail) {
        throw createHttpError(400, pickLocalizedText(locale, '账号信息没有变化', 'Account information has not changed'));
    }

    const targetEmail = previousEmail || email;

    if (!String(user?.profileVerifyCode || '').trim()) {
        throw createHttpError(400, pickLocalizedText(locale, '请先发送邮箱验证码', 'Please send an email verification code first'));
    }
    if (String(user.profileVerifyCode).trim() !== code) {
        if (typeof userRepo.recordProfileVerifyFailure === 'function') {
            const failure = userRepo.recordProfileVerifyFailure(user.id, 5);
            if (failure?.invalidated) {
                throw createHttpError(
                    429,
                    pickLocalizedText(
                        locale,
                        '验证码错误次数过多，请重新发送验证码',
                        'Too many incorrect verification code attempts, please request a new code'
                    )
                );
            }
        }
        throw createHttpError(400, pickLocalizedText(locale, '验证码错误', 'Verification code is incorrect'));
    }
    if (user.profileVerifyCodeExpiresAt && new Date(user.profileVerifyCodeExpiresAt) < new Date()) {
        throw createHttpError(400, pickLocalizedText(locale, '验证码已过期，请重新发送', 'Verification code has expired, please resend'));
    }
    if (normalizeEmailInput(user.profileVerifyTargetEmail) !== targetEmail) {
        throw createHttpError(400, pickLocalizedText(locale, '验证邮箱已变化，请重新发送验证码', 'Verification email has changed, please resend the code'));
    }
    if (normalizeUsernameInput(user.profileVerifyUsername) !== username || normalizeEmailInput(user.profileVerifyEmail) !== email) {
        throw createHttpError(400, pickLocalizedText(locale, '账号信息已变更，请重新发送验证码', 'Account details changed, please resend the code'));
    }

    const updated = userRepo.update(user.id, { username, email, emailVerified: true });
    if (!updated) {
        throw createHttpError(404, pickLocalizedText(locale, '用户不存在', 'User not found'));
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

function createDirectUserSession(user: any, deps: any = {}): any {
    const tokenPayload = {
        userId: user.id,
        role: user.role,
        username: user.username,
        tokenVersion: Number(user?.tokenVersion || 1),
    };
    return {
        success: true,
        token: buildSignedToken(tokenPayload, deps),
        user: buildSessionUser(user, tokenPayload),
        audit: {
            ...buildAuditUser(user, tokenPayload),
            legacyMode: false,
        },
    };
}

export {
    createLoginSession,
    createDirectUserSession,
    validateSession,
    changeOwnPassword,
    requestOwnProfileUpdateVerification,
    updateOwnProfile,
    completeTwoFactorLogin,
    beginTwoFactorEnrollment,
    enableTwoFactor,
    disableTwoFactor,
    getTwoFactorStatus,
};
