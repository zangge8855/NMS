import config from '../config.js';
import * as mailer from '../lib/mailer.js';
import { checkAccountPassword } from '../lib/passwordValidator.js';
import { createHttpError } from '../lib/httpError.js';
import { localizeUserStoreErrorMessage, normalizeAppLocale, pickLocalizedText } from '../lib/requestLocale.js';
import subscriptionTokenRepository from '../repositories/subscriptionTokenRepository.js';
import userRepository from '../repositories/userRepository.js';
import userPolicyRepository from '../repositories/userPolicyRepository.js';
import inviteCodeStore from '../store/inviteCodeStore.js';
import { provisionSubscriptionForUser } from './subscriptionSyncService.js';

function normalizeEmailInput(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildExpiryIso(ttlMinutes: unknown): string {
    return new Date(Date.now() + Number(ttlMinutes || 0) * 60 * 1000).toISOString();
}

function buildInviteProvisionPayload(email: string, invite: any = {}) {
    const subscriptionDays = Math.max(0, Number.parseInt(String(invite?.subscriptionDays || 0), 10) || 0);
    return {
        subscriptionEmail: email,
        expiryDays: subscriptionDays,
        serverScopeMode: 'all',
        protocolScopeMode: 'all',
    };
}

async function registerUser(payload: any = {}, deps: any = {}): Promise<any> {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const emailSender = deps.mailer || mailer;
    const registrationConfig = deps.registrationConfig || config.registration;
    const inviteStore = deps.inviteCodeStore || inviteCodeStore;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const tokenRepo = deps.subscriptionTokenRepository || subscriptionTokenRepository;
    const provisionSubscription = deps.provisionSubscriptionForUser || provisionSubscriptionForUser;
    const inviteOnlyEnabled = deps.inviteOnlyEnabled === true;
    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');
    const email = normalizeEmailInput(payload?.email);
    const inviteCode = String(payload?.inviteCode || '').trim();

    if (!username || !password || !email) {
        throw createHttpError(400, pickLocalizedText(locale, '用户名、密码和邮箱不能为空', 'Username, password, and email are required'));
    }
    if (!isValidEmail(email)) {
        throw createHttpError(400, pickLocalizedText(locale, '邮箱格式不正确', 'Invalid email format'));
    }

    const passwordCheck = checkAccountPassword(password, locale);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    let invite: any = null;
    if (inviteOnlyEnabled) {
        if (!inviteCode) {
            throw createHttpError(400, pickLocalizedText(locale, '邀请码不能为空', 'Invite code is required'));
        }
        try {
            invite = inviteStore.assertUsable(inviteCode);
            const inviteTargetEmail = normalizeEmailInput(invite?.targetEmail);
            if (inviteTargetEmail && inviteTargetEmail !== email) {
                throw createHttpError(
                    400,
                    pickLocalizedText(locale, '邀请码仅限指定邮箱使用', 'Invite code is restricted to the specified email'),
                    {
                        code: 'INVITE_CODE_EMAIL_MISMATCH',
                        details: {
                            username,
                            email,
                            inviteTargetEmail,
                            inviteCodePresent: true,
                        },
                    }
                );
            }
        } catch (error: any) {
            if (error?.code === 'INVITE_CODE_EMAIL_MISMATCH') {
                throw error;
            }
            throw createHttpError(400, error.message || pickLocalizedText(locale, '邀请码无效', 'Invalid invite code'), {
                code: 'INVITE_CODE_INVALID',
                details: {
                    username,
                    email,
                    inviteCodePresent: true,
                },
            });
        }
    }

    let user: any;
    try {
        user = userRepo.add({
            username,
            password,
            email,
            subscriptionEmail: inviteOnlyEnabled ? email : '',
            role: registrationConfig.defaultRole,
            emailVerified: inviteOnlyEnabled,
            enabled: inviteOnlyEnabled,
        });
    } catch (error: any) {
        throw createHttpError(400, localizeUserStoreErrorMessage(error?.message, locale));
    }

    if (inviteOnlyEnabled) {
        try {
            inviteStore.consume(inviteCode, {
                usedByUserId: user.id,
                usedByUsername: user.username,
            });
        } catch (error: any) {
            try {
                userRepo.remove(user.id);
            } catch {
                // Ignore rollback failure and surface the invite error instead.
            }
            throw createHttpError(400, error.message || pickLocalizedText(locale, '邀请码无效', 'Invalid invite code'), {
                code: 'INVITE_CODE_INVALID',
                details: {
                    username,
                    email,
                    inviteCodePresent: true,
                },
            });
        }

        let provisionResult: any = null;
        let provisionError = '';
        try {
            provisionResult = await provisionSubscription(
                user,
                buildInviteProvisionPayload(email, invite),
                'invite_registration',
                {
                    userRepository: userRepo,
                    userPolicyRepository: policyRepo,
                    subscriptionTokenRepository: tokenRepo,
                }
            );
        } catch (error: any) {
            provisionError = error?.message || pickLocalizedText(locale, '自动开通订阅失败', 'Failed to provision subscription automatically');
        }

        return {
            user,
            username,
            email,
            invite,
            requireEmailVerification: false,
            requireApproval: false,
            subscriptionProvisioned: provisionResult !== null,
            provisionError,
            provisionResult,
        };
    }

    const code = emailSender.generateVerifyCode();
    const expiresAt = buildExpiryIso(registrationConfig.verifyCodeTtlMinutes);

    try {
        await emailSender.sendVerificationEmail(email, code, username);
        userRepo.setVerifyCode(user.id, code, expiresAt);
    } catch (error: any) {
        try {
            userRepo.remove(user.id);
        } catch {
            // Ignore rollback failure and surface the email error instead.
        }

        throw createHttpError(
            503,
            pickLocalizedText(
                locale,
                '验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
                'Failed to send verification code email, please try again later or check SMTP configuration'
            ),
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
        requireEmailVerification: true,
    };
}

function verifyEmailCode(payload: any = {}, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const email = normalizeEmailInput(payload?.email);
    const code = String(payload?.code || '').trim();

    if (!email || !code) {
        throw createHttpError(400, pickLocalizedText(locale, '请提供邮箱和验证码', 'Email and verification code are required'));
    }

    const user = userRepo.getByEmail(email);
    if (!user) {
        throw createHttpError(404, pickLocalizedText(locale, '邮箱未注册', 'Email is not registered'));
    }

    if (user.emailVerified) {
        return {
            user,
            email,
            alreadyVerified: true,
        };
    }

    if (!user.verifyCode || user.verifyCode !== code) {
        if (user.verifyCode && typeof userRepo.recordVerifyCodeFailure === 'function') {
            const failure = userRepo.recordVerifyCodeFailure(user.id, 5);
            if (failure?.invalidated) {
                throw createHttpError(
                    429,
                    pickLocalizedText(
                        locale,
                        '验证码错误次数过多，请重新发送验证码',
                        'Too many incorrect verification code attempts, please resend a new code'
                    )
                );
            }
        }
        throw createHttpError(400, pickLocalizedText(locale, '验证码错误', 'Verification code is incorrect'));
    }

    if (user.verifyCodeExpiresAt && new Date(user.verifyCodeExpiresAt) < new Date()) {
        throw createHttpError(400, pickLocalizedText(locale, '验证码已过期，请重新发送', 'Verification code has expired, please resend'));
    }

    userRepo.setEmailVerified(user.id);
    return {
        user,
        email,
        alreadyVerified: false,
    };
}

async function resendVerificationCode(payload: any = {}, deps: any = {}): Promise<any> {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const emailSender = deps.mailer || mailer;
    const registrationConfig = deps.registrationConfig || config.registration;
    const email = normalizeEmailInput(payload?.email);

    if (!email) {
        throw createHttpError(400, pickLocalizedText(locale, '请提供邮箱', 'Email is required'));
    }

    const user = userRepo.getByEmail(email);
    if (!user) {
        throw createHttpError(404, pickLocalizedText(locale, '邮箱未注册', 'Email is not registered'));
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
    } catch (error: any) {
        throw createHttpError(
            503,
            pickLocalizedText(
                locale,
                '验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
                'Failed to send verification code email, please try again later or check SMTP configuration'
            ),
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

async function requestPasswordReset(payload: any = {}, deps: any = {}): Promise<any> {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const emailSender = deps.mailer || mailer;
    const registrationConfig = deps.registrationConfig || config.registration;
    const email = normalizeEmailInput(payload?.email);

    if (!email || !isValidEmail(email)) {
        throw createHttpError(400, pickLocalizedText(locale, '请输入有效邮箱', 'Please enter a valid email address'));
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
    } catch (error: any) {
        throw createHttpError(
            503,
            pickLocalizedText(
                locale,
                '重置验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
                'Failed to send password reset code email, please try again later or check SMTP configuration'
            ),
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

function resetPasswordWithCode(payload: any = {}, deps: any = {}) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const userRepo = deps.userRepository || userRepository;
    const email = normalizeEmailInput(payload?.email);
    const code = String(payload?.code || '').trim();
    const newPassword = String(payload?.newPassword || '');

    if (!email || !code || !newPassword) {
        throw createHttpError(400, pickLocalizedText(locale, '邮箱、验证码和新密码不能为空', 'Email, verification code, and new password are required'));
    }
    if (!isValidEmail(email)) {
        throw createHttpError(400, pickLocalizedText(locale, '邮箱格式不正确', 'Invalid email format'));
    }

    const passwordCheck = checkAccountPassword(newPassword, locale);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    const user = userRepo.getByEmail(email);
    if (!user) {
        throw createHttpError(400, pickLocalizedText(locale, '邮箱或验证码错误', 'Email or verification code is incorrect'));
    }
    if (!user.resetCode || user.resetCode !== code) {
        if (user.resetCode && typeof userRepo.recordResetCodeFailure === 'function') {
            const failure = userRepo.recordResetCodeFailure(user.id, 5);
            if (failure?.invalidated) {
                throw createHttpError(
                    429,
                    pickLocalizedText(
                        locale,
                        '验证码错误次数过多，请重新获取验证码',
                        'Too many incorrect verification code attempts, please request a new code'
                    )
                );
            }
        }
        throw createHttpError(400, pickLocalizedText(locale, '邮箱或验证码错误', 'Email or verification code is incorrect'));
    }
    if (user.resetCodeExpiresAt && new Date(user.resetCodeExpiresAt) < new Date()) {
        throw createHttpError(400, pickLocalizedText(locale, '验证码已过期，请重新获取', 'Verification code has expired, please request a new code'));
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
