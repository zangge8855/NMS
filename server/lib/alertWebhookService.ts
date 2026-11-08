import dns from 'node:dns/promises';
import net from 'node:net';
import { isReservedOrPrivateIp, stripIpv6Brackets } from './ipGeoResolver.js';

const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

export interface WebhookSecurityDeps {
    fetchImpl?: typeof fetch;
    lookup?: (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
    timeoutMs?: number;
}

function isBlockedWebhookHostname(hostname: string): boolean {
    const host = stripIpv6Brackets(hostname).toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local')) return true;
    if (host.endsWith('.internal')) return true;
    if (host.endsWith('.test')) return true;
    if (host.endsWith('.invalid')) return true;
    if (host.endsWith('.example')) return true;
    if (net.isIP(host) !== 0) return false;
    if (!host.includes('.')) return true;
    return false;
}

export async function validateWebhookTargetUrl(rawUrl: unknown, deps: WebhookSecurityDeps = {}): Promise<URL> {
    const text = String(rawUrl || '').trim();
    if (!text) {
        throw new Error('Webhook URL is required');
    }

    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        throw new Error('Webhook URL is invalid');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Webhook URL must use http or https protocol');
    }

    if (parsed.username || parsed.password) {
        throw new Error('Webhook URL must not include embedded credentials');
    }

    const hostname = stripIpv6Brackets(parsed.hostname);
    if (isBlockedWebhookHostname(hostname)) {
        throw new Error('Webhook URL cannot target localhost or internal hostnames');
    }

    if (isReservedOrPrivateIp(hostname)) {
        throw new Error('Webhook URL cannot target private or local IP addresses');
    }

    if (net.isIP(hostname) === 0) {
        const lookup = deps.lookup || ((target: string) => dns.lookup(target, { all: true, verbatim: true }));
        let records: Array<{ address: string }>;
        try {
            records = await lookup(hostname);
        } catch {
            throw new Error('Webhook hostname resolution failed');
        }
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('Webhook hostname did not resolve to any address');
        }
        if (records.some((record) => isReservedOrPrivateIp(record?.address))) {
            throw new Error('Webhook hostname resolved to a private or internal IP address');
        }
    }

    return parsed;
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
    const fetchFn = deps.fetchImpl || fetch;
    const timeoutMs = Number.isFinite(Number(deps.timeoutMs)) && Number(deps.timeoutMs) > 0
        ? Math.floor(Number(deps.timeoutMs))
        : DEFAULT_WEBHOOK_TIMEOUT_MS;

    try {
        let finalUrl = String(url || '').trim();
        let requestInit: RequestInit;

        if (channel === 'bark') {
            finalUrl = buildBarkTargetUrl(url, barkKey, title, message);
            const validated = await validateWebhookTargetUrl(finalUrl, deps);
            finalUrl = validated.toString();
            requestInit = { redirect: 'manual' };
        } else {
            const validated = await validateWebhookTargetUrl(finalUrl, deps);
            finalUrl = validated.toString();

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
        let response: Response;
        try {
            response = await fetchFn(finalUrl, {
                ...requestInit,
                signal: controller.signal,
            });
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
