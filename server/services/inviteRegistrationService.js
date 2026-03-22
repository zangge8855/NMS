import * as mailer from '../lib/mailer.js';
import { createHttpError } from '../lib/httpError.js';
import inviteCodeStore from '../store/inviteCodeStore.js';

function normalizeEmailInput(value) {
    return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function createAndSendInviteRegistrationEmail(payload = {}, deps = {}) {
    const inviteStore = deps.inviteCodeStore || inviteCodeStore;
    const emailSender = deps.mailer || mailer;
    const email = normalizeEmailInput(payload?.email);
    const actor = String(payload?.actor || '').trim() || 'admin';
    const registrationUrl = String(payload?.registrationUrl || '').trim();

    if (!email || !isValidEmail(email)) {
        throw createHttpError(400, '请输入有效邮箱');
    }

    const created = inviteStore.create({
        createdBy: actor,
        count: 1,
        usageLimit: payload?.usageLimit,
        subscriptionDays: payload?.subscriptionDays,
        targetEmail: email,
    });

    try {
        await emailSender.sendInviteRegistrationEmail(email, {
            inviteCode: created.code,
            usageLimit: created.usageLimit,
            subscriptionDays: created.subscriptionDays,
            registrationUrl,
            targetEmail: email,
        });
    } catch (error) {
        try {
            if (created.invite?.id) {
                inviteStore.revoke(created.invite.id, {
                    revokedBy: `${actor}:delivery_failed`,
                });
            }
        } catch {
            // Keep the original mail delivery error as the user-facing failure.
        }

        throw createHttpError(
            503,
            '邀请码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置',
            {
                code: 'INVITE_EMAIL_SEND_FAILED',
                details: {
                    email,
                    inviteId: created.invite?.id || '',
                    preview: created.invite?.preview || '',
                    error: error?.message || 'send failed',
                },
            }
        );
    }

    return {
        recipientEmail: email,
        registrationUrl,
        usageLimit: created.usageLimit,
        subscriptionDays: created.subscriptionDays,
        inviteCode: created.code,
        invite: created.invite,
    };
}
