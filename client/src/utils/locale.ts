export type ClientLocale = 'en-US' | 'zh-CN';

export interface LocalizedNotificationCopy {
    title?: string;
    body?: string;
}

export interface LocalizableNotificationLike {
    title?: string | null;
    body?: string | null;
    meta?: {
        localized?: Record<string, LocalizedNotificationCopy | undefined>;
        [key: string]: unknown;
    } | Record<string, unknown> | null;
}

/** Normalize browser/UI locale strings into one of the supported backend/UI locales. */
export function normalizeClientLocale(value: unknown): ClientLocale | null {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'en' || raw.startsWith('en-')) return 'en-US';
    if (raw === 'zh' || raw.startsWith('zh-')) return 'zh-CN';
    return null;
}

/** Read the active UI locale safely without throwing in restricted storage contexts. */
export function resolveActiveClientLocale(): ClientLocale {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = normalizeClientLocale(window.localStorage.getItem('nms_locale'));
            if (stored) return stored;
        }
    } catch {
        // Ignore storage errors in restricted contexts
    }
    if (typeof document !== 'undefined') {
        const docLocale = normalizeClientLocale(document.documentElement?.lang);
        if (docLocale) return docLocale;
    }
    return 'zh-CN';
}

/** Resolve localized notification title/body with explicit locale -> short locale -> raw fallback. */
export function resolveLocalizedNotificationText(
    notification?: LocalizableNotificationLike | null,
    locale?: string | null,
): { title: string; body: string } {
    const rawLocale = String(locale || '').trim();
    const activeLocale = normalizeClientLocale(rawLocale) || resolveActiveClientLocale();
    const shortLocale = activeLocale === 'en-US' ? 'en' : 'zh';
    const metaObj = notification?.meta && typeof notification.meta === 'object' ? notification.meta : undefined;
    const localizedMap = metaObj && 'localized' in metaObj && metaObj.localized && typeof metaObj.localized === 'object'
        ? (metaObj.localized as Record<string, LocalizedNotificationCopy | undefined>)
        : undefined;
    const entry = localizedMap
        ? ((rawLocale ? localizedMap[rawLocale] : undefined) ?? localizedMap[activeLocale] ?? localizedMap[shortLocale])
        : undefined;
    const title = entry?.title ? String(entry.title) : String(notification?.title || '');
    const body = entry && entry.body !== undefined
        ? String(entry.body || '')
        : String(notification?.body || '');
    return { title, body };
}
