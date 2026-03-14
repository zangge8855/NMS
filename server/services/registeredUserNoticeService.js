import userStore from '../store/userStore.js';
import { buildOperationalNoticeEmail, sendOperationalNoticeEmail } from '../lib/mailer.js';

const NOTICE_SCOPE = {
    ALL: 'all',
    VERIFIED: 'verified',
};

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function isLikelyEmail(value) {
    const text = normalizeEmail(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

export function normalizeNoticeScope(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === NOTICE_SCOPE.VERIFIED ? NOTICE_SCOPE.VERIFIED : NOTICE_SCOPE.ALL;
}

export function resolveRegisteredUserNoticeRecipients(users = [], options = {}) {
    const scope = normalizeNoticeScope(options.scope);
    const includeDisabled = options.includeDisabled !== false;
    const seen = new Set();
    const recipients = [];
    const skipped = [];

    (Array.isArray(users) ? users : []).forEach((user) => {
        if (user?.role === 'admin') return;
        if (!includeDisabled && user?.enabled === false) {
            skipped.push({ userId: user?.id || '', username: user?.username || '', reason: 'disabled' });
            return;
        }

        const loginEmail = normalizeEmail(user?.email);
        const subscriptionEmail = normalizeEmail(user?.subscriptionEmail);
        const verified = user?.emailVerified === true;
        let address = '';

        if (scope === NOTICE_SCOPE.VERIFIED) {
            address = verified ? loginEmail : '';
        } else {
            address = loginEmail || subscriptionEmail;
        }

        if (!address) {
            skipped.push({ userId: user?.id || '', username: user?.username || '', reason: scope === NOTICE_SCOPE.VERIFIED ? 'unverified_or_missing' : 'missing_email' });
            return;
        }
        if (!isLikelyEmail(address)) {
            skipped.push({ userId: user?.id || '', username: user?.username || '', reason: 'invalid_email', email: address });
            return;
        }
        if (seen.has(address)) {
            skipped.push({ userId: user?.id || '', username: user?.username || '', reason: 'duplicate_email', email: address });
            return;
        }

        seen.add(address);
        recipients.push({
            userId: String(user?.id || '').trim(),
            username: String(user?.username || '').trim(),
            email: address,
            emailVerified: verified,
            enabled: user?.enabled !== false,
        });
    });

    return {
        scope,
        includeDisabled,
        recipients,
        skipped,
    };
}

export function buildRegisteredUserNoticePreview(payload = {}, deps = {}) {
    const subject = String(payload.subject || '').trim();
    const message = String(payload.message || '').trim();
    const actionUrl = String(payload.actionUrl || '').trim();
    const actionLabel = String(payload.actionLabel || '').trim() || '查看详情';
    const scope = normalizeNoticeScope(payload.scope);
    const includeDisabled = payload.includeDisabled !== false;
    const users = Array.isArray(deps.users) ? deps.users : userStore.getAll();
    const resolved = resolveRegisteredUserNoticeRecipients(users, { scope, includeDisabled });
    const sampleRecipient = resolved.recipients[0] || {
        username: '示例用户',
        email: '',
        emailVerified: false,
        enabled: true,
    };
    const emailPreview = buildOperationalNoticeEmail({
        subject,
        message,
        actionUrl,
        actionLabel,
        username: sampleRecipient.username || '示例用户',
    });

    return {
        scope,
        includeDisabled,
        recipientCount: resolved.recipients.length,
        skippedCount: resolved.skipped.length,
        singleRecipientMode: true,
        sampleRecipient: {
            username: sampleRecipient.username || '示例用户',
            email: sampleRecipient.email || '',
            emailVerified: sampleRecipient.emailVerified === true,
            enabled: sampleRecipient.enabled !== false,
        },
        subject: emailPreview.subject,
        html: emailPreview.html,
    };
}

export async function sendRegisteredUserNoticeCampaign(payload = {}, deps = {}) {
    const subject = String(payload.subject || '').trim();
    const message = String(payload.message || '').trim();
    const actionUrl = String(payload.actionUrl || '').trim();
    const actionLabel = String(payload.actionLabel || '').trim() || '查看详情';
    const scope = normalizeNoticeScope(payload.scope);
    const includeDisabled = payload.includeDisabled !== false;

    if (!subject) throw new Error('通知主题不能为空');
    if (!message) throw new Error('通知内容不能为空');

    const users = Array.isArray(deps.users) ? deps.users : userStore.getAll();
    const sendEmail = deps.sendEmail || sendOperationalNoticeEmail;
    const onProgress = typeof deps.onProgress === 'function' ? deps.onProgress : null;
    const signal = deps.signal || null;
    const resolved = resolveRegisteredUserNoticeRecipients(users, { scope, includeDisabled });
    const failures = [];
    let sent = 0;

    for (let index = 0; index < resolved.recipients.length; index += 1) {
        if (signal?.aborted) {
            const abortError = new Error('通知发送已取消');
            abortError.name = 'AbortError';
            throw abortError;
        }

        const recipient = resolved.recipients[index];
        if (onProgress) {
            onProgress({
                step: index,
                total: resolved.recipients.length,
                label: `准备发送给 ${recipient.username || recipient.email}`,
            });
        }

        try {
            await sendEmail(recipient.email, {
                subject,
                message,
                actionUrl,
                actionLabel,
                username: recipient.username,
            });
            sent += 1;
        } catch (error) {
            failures.push({
                userId: recipient.userId,
                username: recipient.username,
                email: recipient.email,
                error: error.message || '发送失败',
            });
        }

        if (onProgress) {
            onProgress({
                step: index + 1,
                total: resolved.recipients.length,
                label: `已处理 ${index + 1} / ${resolved.recipients.length}`,
            });
        }
    }

    return {
        scope,
        includeDisabled,
        total: resolved.recipients.length,
        success: sent,
        failed: failures.length,
        skipped: resolved.skipped.length,
        failures: failures.slice(0, 20),
        skippedDetails: resolved.skipped.slice(0, 20),
    };
}
