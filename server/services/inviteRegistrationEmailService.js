import inviteCodeStore, { normalizeSubscriptionDays } from '../store/inviteCodeStore.js';
import { sendInviteRegistrationEmail } from '../lib/mailer.js';

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function isLikelyEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizePositiveInt(value, fallback, options = {}) {
    const parsed = Number.parseInt(String(value), 10);
    let output = Number.isInteger(parsed) ? parsed : fallback;
    if (Number.isInteger(options.min)) output = Math.max(options.min, output);
    if (Number.isInteger(options.max)) output = Math.min(options.max, output);
    return output;
}

export function normalizeInviteRegistrationRecipients(input) {
    const chunks = Array.isArray(input) ? input : [input];
    const entries = chunks
        .flatMap((item) => String(item || '').split(/[\n,;]+/))
        .map((item) => normalizeEmail(item))
        .filter(Boolean);
    const seen = new Set();
    const recipients = [];
    const skipped = [];

    entries.forEach((email) => {
        if (!isLikelyEmail(email)) {
            skipped.push({ email, reason: 'invalid_email' });
            return;
        }
        if (seen.has(email)) {
            skipped.push({ email, reason: 'duplicate_email' });
            return;
        }
        seen.add(email);
        recipients.push(email);
    });

    return {
        recipients,
        skipped,
    };
}

export function normalizeInviteRegistrationMessage(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\u0000/g, '')
        .trim()
        .slice(0, 1200);
}

export function normalizeInviteRegistrationEntryUrl(value, fallback = '') {
    const candidate = normalizeText(value);
    if (!candidate) {
        const fallbackValue = normalizeText(fallback);
        return fallbackValue ? normalizeInviteRegistrationEntryUrl(fallbackValue, '') : '';
    }

    try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        const fallbackValue = normalizeText(fallback);
        return fallbackValue ? normalizeInviteRegistrationEntryUrl(fallbackValue, '') : '';
    }
}

export function buildInviteRegistrationUrl(entryUrl, params = {}) {
    const normalizedEntryUrl = normalizeInviteRegistrationEntryUrl(entryUrl);
    if (!normalizedEntryUrl) return '';

    const url = new URL(normalizedEntryUrl);
    const inviteCode = normalizeText(params.inviteCode).toUpperCase();
    const email = normalizeEmail(params.email);

    url.searchParams.set('mode', 'register');
    if (inviteCode) url.searchParams.set('invite', inviteCode);
    if (email) url.searchParams.set('email', email);
    return url.toString();
}

export async function sendInviteRegistrationCampaign(payload = {}, deps = {}) {
    const actor = normalizeText(payload.createdBy || deps.createdBy || 'admin');
    const inviterName = normalizeText(payload.inviterName || actor);
    const usageLimit = normalizePositiveInt(payload.usageLimit, 1, { min: 1, max: 1000 });
    const subscriptionDays = normalizeSubscriptionDays(payload.subscriptionDays, 30);
    const message = normalizeInviteRegistrationMessage(payload.message);
    const entryUrl = normalizeInviteRegistrationEntryUrl(payload.entryUrl, deps.entryUrl);
    const resolved = normalizeInviteRegistrationRecipients(payload.emails ?? payload.recipients);
    const sendEmail = typeof deps.sendEmail === 'function' ? deps.sendEmail : sendInviteRegistrationEmail;
    const createInvite = typeof deps.createInvite === 'function'
        ? deps.createInvite
        : (options) => inviteCodeStore.create(options);
    const revokeInvite = typeof deps.revokeInvite === 'function'
        ? deps.revokeInvite
        : (id, options) => inviteCodeStore.revoke(id, options);
    const onProgress = typeof deps.onProgress === 'function' ? deps.onProgress : null;
    const signal = deps.signal || null;
    const failures = [];
    const successes = [];
    let sent = 0;

    if (resolved.recipients.length === 0) {
        throw new Error(resolved.skipped.length > 0 ? '没有可用的邀请邮箱，请检查输入格式' : '至少填写一个邀请邮箱');
    }

    for (let index = 0; index < resolved.recipients.length; index += 1) {
        if (signal?.aborted) {
            const abortError = new Error('邀请发送已取消');
            abortError.name = 'AbortError';
            throw abortError;
        }

        const recipient = resolved.recipients[index];
        if (onProgress) {
            onProgress({
                step: index,
                total: resolved.recipients.length,
                label: `准备发送给 ${recipient}`,
            });
        }

        let created = null;
        try {
            created = await createInvite({
                createdBy: actor,
                count: 1,
                usageLimit,
                subscriptionDays,
            });
            const invite = created?.invite || created?.invites?.[0] || {};
            const inviteCode = normalizeText(created?.code || created?.codes?.[0] || '').toUpperCase();
            const registrationUrl = buildInviteRegistrationUrl(entryUrl, {
                inviteCode,
                email: recipient,
            });

            await sendEmail(recipient, {
                inviteCode,
                usageLimit,
                subscriptionDays,
                registrationUrl,
                inviterName,
                message,
            });

            sent += 1;
            successes.push({
                email: recipient,
                inviteId: normalizeText(invite?.id),
                preview: normalizeText(invite?.preview),
                registrationUrl,
            });
        } catch (error) {
            const inviteId = normalizeText(created?.invite?.id || created?.invites?.[0]?.id);
            if (inviteId) {
                try {
                    await revokeInvite(inviteId, { revokedBy: actor });
                } catch {
                    // The invite was only created for the failed send attempt; best-effort rollback is enough.
                }
            }

            failures.push({
                email: recipient,
                error: normalizeText(error?.message) || '发送失败',
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
        total: resolved.recipients.length,
        success: sent,
        failed: failures.length,
        skipped: resolved.skipped.length,
        usageLimit,
        subscriptionDays,
        entryUrl,
        failures: failures.slice(0, 20),
        successes: successes.slice(0, 20),
        skippedDetails: resolved.skipped.slice(0, 20),
    };
}
