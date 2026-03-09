import config from '../config.js';
import * as mailer from '../lib/mailer.js';
import { checkAccountPassword } from '../lib/passwordValidator.js';
import { createHttpError } from '../lib/httpError.js';
import userRepository from '../repositories/userRepository.js';

function normalizeEmailInput(value) {
    return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildExpiryIso(ttlMinutes) {
    return new Date(Date.now() + Number(ttlMinutes || 0) * 60 * 1000).toISOString();
}

async function registerUser(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const emailSender = deps.mailer || mailer;
    const registrationConfig = deps.registrationConfig || config.registration;
    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');
    const email = normalizeEmailInput(payload?.email);

    if (!username || !password || !email) {
        throw createHttpError(400, '用户名、密码和邮箱不能为空');
    }
    if (!isValidEmail(email)) {
        throw createHttpError(400, '邮箱格式不正确');
    }

    const passwordCheck = checkAccountPassword(password);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    const user = userRepo.add({
        username,
        password,
        email,
        subscriptionEmail: '',
        role: registrationConfig.defaultRole,
        emailVerified: false,
        enabled: false,
    });

    const code = emailSender.generateVerifyCode();
    const expiresAt = buildExpiryIso(registrationConfig.verifyCodeTtlMinutes);

    try {
        await emailSender.sendVerificationEmail(email, code, username);
        userRepo.setVerifyCode(user.id, code, expiresAt);
    } catch (error) {
        try {
            userRepo.remove(user.id);
        } catch {
            // Ignore rollback failure and surface the email error instead.
        }

        throw createHttpError(
            503,
            '验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
            {
                code: 'VERIFICATION_EMAIL_SEND_FAILED',
                details: {
                    username,
                    email,
                    type: 'register',
                    error: error?.message || 'send failed',
                },
            }
        );
    }

    return {
        user,
        username,
        email,
    };
}

function verifyEmailCode(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const email = normalizeEmailInput(payload?.email);
    const code = String(payload?.code || '').trim();

    if (!email || !code) {
        throw createHttpError(400, '请提供邮箱和验证码');
    }

    const user = userRepo.getByEmail(email);
    if (!user) {
        throw createHttpError(404, '邮箱未注册');
    }

    if (user.emailVerified) {
        return {
            user,
            email,
            alreadyVerified: true,
        };
    }

    if (!user.verifyCode || user.verifyCode !== code) {
        throw createHttpError(400, '验证码错误');
    }

    if (user.verifyCodeExpiresAt && new Date(user.verifyCodeExpiresAt) < new Date()) {
        throw createHttpError(400, '验证码已过期，请重新发送');
    }

    userRepo.setEmailVerified(user.id);
    return {
        user,
        email,
        alreadyVerified: false,
    };
}

async function resendVerificationCode(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const emailSender = deps.mailer || mailer;
    const registrationConfig = deps.registrationConfig || config.registration;
    const email = normalizeEmailInput(payload?.email);

    if (!email) {
        throw createHttpError(400, '请提供邮箱');
    }

    const user = userRepo.getByEmail(email);
    if (!user) {
        throw createHttpError(404, '邮箱未注册');
    }

    if (user.emailVerified) {
        return {
            user,
            email,
            alreadyVerified: true,
        };
    }

    const code = emailSender.generateVerifyCode();
    const expiresAt = buildExpiryIso(registrationConfig.verifyCodeTtlMinutes);

    try {
        await emailSender.sendVerificationEmail(email, code, user.username);
        userRepo.setVerifyCode(user.id, code, expiresAt);
    } catch (error) {
        throw createHttpError(
            503,
            '验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
            {
                code: 'VERIFICATION_EMAIL_SEND_FAILED',
                details: {
                    username: user.username,
                    email,
                    type: 'resend',
                    error: error?.message || 'send failed',
                },
            }
        );
    }

    return {
        user,
        email,
        alreadyVerified: false,
    };
}

async function requestPasswordReset(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const emailSender = deps.mailer || mailer;
    const registrationConfig = deps.registrationConfig || config.registration;
    const email = normalizeEmailInput(payload?.email);

    if (!email || !isValidEmail(email)) {
        throw createHttpError(400, '请输入有效邮箱');
    }

    const user = userRepo.getByEmail(email);
    if (!user || !user.emailVerified) {
        return {
            email,
            hidden: true,
        };
    }

    const code = emailSender.generateVerifyCode();
    const ttlMinutes = registrationConfig.passwordResetCodeTtlMinutes || registrationConfig.verifyCodeTtlMinutes;
    const expiresAt = buildExpiryIso(ttlMinutes);

    try {
        await emailSender.sendPasswordResetEmail(email, code, user.username);
        userRepo.setPasswordResetCode(user.id, code, expiresAt);
    } catch (error) {
        throw createHttpError(
            503,
            '重置验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
            {
                code: 'PASSWORD_RESET_EMAIL_SEND_FAILED',
                details: {
                    username: user.username,
                    email,
                    error: error?.message || 'send failed',
                },
            }
        );
    }

    return {
        user,
        email,
        hidden: false,
    };
}

function resetPasswordWithCode(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const email = normalizeEmailInput(payload?.email);
    const code = String(payload?.code || '').trim();
    const newPassword = String(payload?.newPassword || '');

    if (!email || !code || !newPassword) {
        throw createHttpError(400, '邮箱、验证码和新密码不能为空');
    }
    if (!isValidEmail(email)) {
        throw createHttpError(400, '邮箱格式不正确');
    }

    const passwordCheck = checkAccountPassword(newPassword);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    const user = userRepo.getByEmail(email);
    if (!user) {
        throw createHttpError(400, '邮箱或验证码错误');
    }
    if (!user.resetCode || user.resetCode !== code) {
        throw createHttpError(400, '邮箱或验证码错误');
    }
    if (user.resetCodeExpiresAt && new Date(user.resetCodeExpiresAt) < new Date()) {
        throw createHttpError(400, '验证码已过期，请重新获取');
    }

    userRepo.update(user.id, { password: newPassword });
    userRepo.clearPasswordResetCode(user.id);

    return {
        user,
        email,
    };
}

export {
    isValidEmail,
    normalizeEmailInput,
    registerUser,
    verifyEmailCode,
    resendVerificationCode,
    requestPasswordReset,
    resetPasswordWithCode,
};
