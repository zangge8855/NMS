declare global {
    interface Window {
        __NMS_SITE_BASE_PATH__?: string;
    }
}

function readBasePathMeta(): string {
    if (typeof document === 'undefined') return '';
    const meta = document.querySelector('meta[name="nms-site-base-path"]');
    return meta?.getAttribute('content') || '';
}

export function resolveSiteBasePath(): string {
    if (typeof window === 'undefined') return '/';
    // /theme-init.js copies the server-injected meta tag into the global; read the
    // meta directly as a fallback in case that script failed to load.
    const raw = String(window.__NMS_SITE_BASE_PATH__ || readBasePathMeta() || '/').trim();
    if (!raw || /[\s?#]/.test(raw)) return '/';

    const segments = raw
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean);

    if (segments.some((item) => item === '.' || item === '..')) return '/';
    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function buildSiteAssetPath(assetPath: string = '/'): string {
    const normalizedAssetPath = String(assetPath || '/').startsWith('/')
        ? String(assetPath || '/')
        : `/${String(assetPath || '/')}`;
    const basePath = resolveSiteBasePath();
    return basePath === '/' ? normalizedAssetPath : `${basePath}${normalizedAssetPath}`;
}
