import type { Request } from 'express';

export type AppLocale = 'zh-CN' | 'en-US';

export function normalizeAppLocale(value: unknown, fallback: AppLocale = 'zh-CN'): AppLocale {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'en' || raw.startsWith('en-') || raw.startsWith('en_')) {
        return 'en-US';
    }
    if (raw === 'zh' || raw.startsWith('zh-') || raw.startsWith('zh_')) {
        return 'zh-CN';
    }
    return fallback;
}

export function parseAcceptLanguageLocale(headerValue: unknown, fallback: AppLocale = 'zh-CN'): AppLocale {
    const raw = String(headerValue || '').trim();
    if (!raw) return fallback;

    const weighted = raw
        .split(',')
        .map((part, index) => {
            const segments = part.trim().split(';').map((s) => s.trim()).filter(Boolean);
            const tag = (segments[0] || '').toLowerCase();
            let q = 1;
            for (let i = 1; i < segments.length; i += 1) {
                const match = /^q=([0-9]+(?:\.[0-9]+)?)$/i.exec(segments[i]);
                if (match) {
                    q = Number(match[1]);
                    break;
                }
            }
            return {
                tag,
                q: Number.isFinite(q) ? q : 0,
                index,
            };
        })
        .filter((entry) => entry.tag && entry.q > 0)
        .sort((a, b) => (b.q - a.q) || (a.index - b.index));

    for (const entry of weighted) {
        if (entry.tag === 'en' || entry.tag.startsWith('en-')) return 'en-US';
        if (entry.tag === 'zh' || entry.tag.startsWith('zh-')) return 'zh-CN';
    }

    return fallback;
}

export function resolveRequestLocale(req?: Partial<Pick<Request, 'headers' | 'query'>> | null): AppLocale {
    if (!req) return 'zh-CN';
    const explicitCandidates = [
        req.query?.lang,
        req.query?.locale,
        req.headers?.['x-locale'],
        req.headers?.['x-lang'],
    ];
    for (const candidate of explicitCandidates) {
        const value = Array.isArray(candidate) ? candidate[0] : candidate;
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'en' || raw.startsWith('en-') || raw.startsWith('en_')) {
            return 'en-US';
        }
        if (raw === 'zh' || raw.startsWith('zh-') || raw.startsWith('zh_')) {
            return 'zh-CN';
        }
    }

    const acceptLang = req.headers?.['accept-language'];
    return parseAcceptLanguageLocale(Array.isArray(acceptLang) ? acceptLang[0] : acceptLang, 'zh-CN');
}

export function resolveNotificationLocale(explicitLocale?: unknown): AppLocale {
    const explicitRaw = String(explicitLocale || '').trim().toLowerCase();
    if (explicitRaw) {
        if (explicitRaw === 'en' || explicitRaw.startsWith('en-') || explicitRaw.startsWith('en_')) {
            return 'en-US';
        }
        if (explicitRaw === 'zh' || explicitRaw.startsWith('zh-') || explicitRaw.startsWith('zh_')) {
            return 'zh-CN';
        }
    }

    const envCandidate = process.env.NOTIFICATION_LOCALE || process.env.NMS_LOCALE || process.env.APP_LOCALE;
    return normalizeAppLocale(envCandidate, 'zh-CN');
}

export function isEnglishLocale(locale: unknown): boolean {
    return normalizeAppLocale(locale, 'zh-CN') === 'en-US';
}

export function pickLocalizedText(locale: unknown, zhText: string, enText: string): string {
    return isEnglishLocale(locale) ? enText : zhText;
}

export function localizeUserStoreErrorMessage(message: unknown, locale: AppLocale = 'zh-CN'): string {
    const raw = String(message || '').trim();
    if (!raw || !isEnglishLocale(locale)) return raw;
    if (raw === '用户名和密码不能为空') return 'Username and password are required';
    if (raw === '用户名不能为空') return 'Username is required';
    const invalidRole = /^无效角色:\s*(.+)$/.exec(raw);
    if (invalidRole) return `Invalid role: ${invalidRole[1]}`;
    const dupUsername = /^用户名 "(.+)" 已存在$/.exec(raw);
    if (dupUsername) return `Username "${dupUsername[1]}" already exists`;
    const dupEmail = /^邮箱 "(.+)" 已被注册$/.exec(raw);
    if (dupEmail) return `Email "${dupEmail[1]}" is already registered`;
    const dupSubEmail = /^订阅绑定邮箱 "(.+)" 已被其他账号占用$/.exec(raw);
    if (dupSubEmail) return `Subscription email "${dupSubEmail[1]}" is already bound to another account`;
    return raw;
}
