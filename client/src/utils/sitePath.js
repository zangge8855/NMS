export function resolveSiteBasePath() {
    if (typeof window === 'undefined') return '/';
    const raw = String(window.__NMS_SITE_BASE_PATH__ || '/').trim();
    if (!raw || /[\s?#]/.test(raw)) return '/';

    const segments = raw
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean);

    if (segments.some((item) => item === '.' || item === '..')) return '/';
    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function buildSiteAssetPath(assetPath = '/') {
    const normalizedAssetPath = String(assetPath || '/').startsWith('/')
        ? String(assetPath || '/')
        : `/${String(assetPath || '/')}`;
    const basePath = resolveSiteBasePath();
    return basePath === '/' ? normalizedAssetPath : `${basePath}${normalizedAssetPath}`;
}
