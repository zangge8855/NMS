import {
    requestExternalWithPinnedIp,
    resolveExternalHttpTarget,
    type ResolvedExternalTarget,
} from './ssrfProtection.js';

const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

export interface WebhookSecurityDeps {
    fetchImpl?: typeof fetch;
    lookup?: (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
    timeoutMs?: number;
}

export async function validateWebhookTargetUrl(rawUrl: unknown, deps: WebhookSecurityDeps = {}): Promise<URL> {
    const resolved = await resolveExternalHttpTarget(rawUrl, {
        label: 'Webhook',
        lookup: deps.lookup,
    });
    return resolved.url;
}

function buildBarkTargetUrl(urlValue: unknown, barkKeyValue: unknown, title: unknown, message: unknown): string {
    const rawUrl = String(urlValue || '').trim();
    const rawKey = String(barkKeyValue || '').trim();
    const rawTarget = rawUrl || rawKey;
    if (!rawTarget) {
        throw new Error('Bark URL or key is required');
    }

    let baseUrl = rawTarget;
    if (!/^https?:\/\//i.test(rawTarget)) {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawTarget)) {
            throw new Error('Webhook URL must use http or https protocol');
        }
        if (/[\/\\?#\s@]|\.\./.test(rawTarget)) {
            throw new Error('Bark key contains unsupported characters');
        }
        baseUrl = `https://api.day.app/${encodeURIComponent(rawTarget)}`;
    }

    return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(String(title || ''))}/${encodeURIComponent(String(message || ''))}`;
}

export async function sendWebhookAlert(webhookConfig: any, payload: any, deps: WebhookSecurityDeps = {}) {
    const { channel, url, barkKey } = webhookConfig || {};
    const { title, message, event, timestamp } = payload || {};
    const fetchFn = typeof deps.fetchImpl === 'function' ? deps.fetchImpl : null;
    const timeoutMs = Number.isFinite(Number(deps.timeoutMs)) && Number(deps.timeoutMs) > 0
        ? Math.floor(Number(deps.timeoutMs))
        : DEFAULT_WEBHOOK_TIMEOUT_MS;

    try {
        let finalUrl = String(url || '').trim();
        let resolvedTarget: ResolvedExternalTarget;
        let requestInit: RequestInit;

        if (channel === 'bark') {
            finalUrl = buildBarkTargetUrl(url, barkKey, title, message);
            resolvedTarget = await resolveExternalHttpTarget(finalUrl, {
                label: 'Webhook',
                lookup: deps.lookup,
            });
            finalUrl = resolvedTarget.url.toString();
            requestInit = { method: 'GET', redirect: 'manual' };
        } else {
            resolvedTarget = await resolveExternalHttpTarget(finalUrl, {
                label: 'Webhook',
                lookup: deps.lookup,
            });
            finalUrl = resolvedTarget.url.toString();

            if (channel === 'discord') {
                requestInit = {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        embeds: [{
                            title,
                            description: message,
                            color: 0x3b82f6,
                        }],
                    }),
                };
            } else if (channel === 'feishu' || channel === 'lark') {
                requestInit = {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        msg_type: 'text',
                        content: { text: `${title}\n${message}` },
                    }),
                };
            } else if (channel === 'wechat' || channel === 'wechatwork') {
                requestInit = {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        msgtype: 'text',
                        text: { content: `${title}\n${message}` },
                    }),
                };
            } else {
                requestInit = {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event,
                        title,
                        message,
                        timestamp: timestamp || new Date().toISOString(),
                    }),
                };
            }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: { ok?: boolean; status?: number; statusText?: string; type?: string };
        try {
            if (fetchFn) {
                response = await fetchFn(finalUrl, {
                    ...requestInit,
                    signal: controller.signal,
                });
            } else {
                response = await requestExternalWithPinnedIp(resolvedTarget, {
                    method: requestInit.method || 'GET',
                    headers: (requestInit.headers as Record<string, string>) || {},
                    body: typeof requestInit.body === 'string' ? requestInit.body : undefined,
                    timeoutMs,
                    signal: controller.signal,
                });
            }
        } finally {
            clearTimeout(timer);
        }

        if (response?.type === 'opaqueredirect' || (typeof response?.status === 'number' && response.status >= 300 && response.status < 400)) {
            throw new Error('Webhook redirects are not allowed');
        }
        if (response && typeof response.ok === 'boolean' && !response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
        }
        return { success: true, msg: 'Webhook sent successfully' };
    } catch (err: any) {
        const messageText = err?.name === 'AbortError'
            ? `Request timed out after ${timeoutMs}ms`
            : (err?.message || String(err));
        throw new Error(`Webhook Error [${channel}]: ${messageText}`);
    }
}
