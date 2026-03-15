import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, extname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_MISSING_CLIENT_BUILD_MESSAGE = 'Client build not found. Run `cd client && npm run build` before starting NMS in production.';
export const SITE_BASE_PATH_SCRIPT = 'window.__NMS_SITE_BASE_PATH__';
export const CLIENT_STATIC_OPTIONS = {
    index: false,
};

export function resolveClientBuildPaths(rootDir = resolve(__dirname, '..', '..')) {
    const clientBuild = resolve(rootDir, 'client', 'dist');
    const clientIndexFile = resolve(clientBuild, 'index.html');
    return { clientBuild, clientIndexFile };
}

export function normalizeClientBasePath(value, fallback = '/') {
    const fallbackValue = String(fallback || '/').trim() || '/';
    const text = String(value || '').trim();
    if (!text) return fallbackValue;
    if (/\s|[?#]/.test(text)) return fallbackValue;

    const segments = text
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean);

    if (segments.some((item) => item === '.' || item === '..')) {
        return fallbackValue;
    }

    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function shouldServeClientRequest(pathname = '/', basePath = '/') {
    const normalizedPathname = String(pathname || '/').trim() || '/';
    const normalizedBasePath = normalizeClientBasePath(basePath, '/');
    if (normalizedBasePath === '/') return true;
    return normalizedPathname === normalizedBasePath || normalizedPathname.startsWith(`${normalizedBasePath}/`);
}

export function stripClientBasePath(pathname = '/', basePath = '/') {
    const normalizedPathname = String(pathname || '/').trim() || '/';
    const normalizedBasePath = normalizeClientBasePath(basePath, '/');
    if (normalizedBasePath === '/') return normalizedPathname;
    if (normalizedPathname === normalizedBasePath) return '/';
    if (!normalizedPathname.startsWith(`${normalizedBasePath}/`)) return null;
    return normalizedPathname.slice(normalizedBasePath.length) || '/';
}

export function shouldServeCamouflageRequest(req = {}) {
    const method = String(req.method || 'GET').toUpperCase();
    const pathname = String(req.path || '/').trim() || '/';
    if (!['GET', 'HEAD'].includes(method)) return false;
    if (extname(pathname)) return false;
    return true;
}

export function rewriteClientAssetPaths(html, basePath = '/') {
    const normalizedBasePath = normalizeClientBasePath(basePath, '/');
    if (normalizedBasePath === '/') return html;

    return html.replace(/((?:src|href)=["'])\/assets\//g, `$1${normalizedBasePath}/assets/`);
}

export function injectClientBasePath(html, basePath = '/') {
    const normalizedBasePath = normalizeClientBasePath(basePath, '/');
    const withAssetPaths = rewriteClientAssetPaths(html, normalizedBasePath);
    const snippet = `<script>window.__NMS_SITE_BASE_PATH__=${JSON.stringify(normalizedBasePath)};</script>`;
    if (!withAssetPaths.includes('</head>')) {
        return `${snippet}${withAssetPaths}`;
    }
    return withAssetPaths.replace('</head>', `${snippet}</head>`);
}

export function createClientStaticHandler({
    clientBuild,
    getSiteAccessPath = () => '/',
    getSiteConfig = null,
}) {
    const staticHandler = express.static(clientBuild, CLIENT_STATIC_OPTIONS);

    return (req, res, next) => {
        const siteConfig = typeof getSiteConfig === 'function'
            ? (getSiteConfig() || {})
            : { accessPath: typeof getSiteAccessPath === 'function' ? getSiteAccessPath() : getSiteAccessPath };
        const siteAccessPath = normalizeClientBasePath(siteConfig.accessPath, '/');
        const relativePath = stripClientBasePath(req.path, siteAccessPath);
        if (!relativePath || relativePath === '/' || !extname(relativePath)) {
            return next();
        }

        const originalUrl = req.url;
        const queryIndex = originalUrl.indexOf('?');
        const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';
        req.url = `${relativePath}${query}`;
        return staticHandler(req, res, (error) => {
            req.url = originalUrl;
            return next(error);
        });
    };
}

export function createClientBuildFallbackHandler({
    clientIndexFile,
    hasClientIndex,
    missingBuildMessage = DEFAULT_MISSING_CLIENT_BUILD_MESSAGE,
    getSiteAccessPath = () => '/',
    getSiteConfig = null,
    readClientIndexFile = (file) => fs.readFileSync(file, 'utf8'),
}) {
    return (req, res, next) => {
        const siteConfig = typeof getSiteConfig === 'function'
            ? (getSiteConfig() || {})
            : { accessPath: typeof getSiteAccessPath === 'function' ? getSiteAccessPath() : getSiteAccessPath };
        const siteAccessPath = normalizeClientBasePath(siteConfig.accessPath, '/');
        const relativePath = stripClientBasePath(req.path, siteAccessPath);

        if (!shouldServeClientRequest(req.path, siteAccessPath)) {
            return next();
        }
        if (relativePath && relativePath !== '/' && !!extname(relativePath)) {
            return next();
        }

        const exists = typeof hasClientIndex === 'function'
            ? !!hasClientIndex()
            : !!hasClientIndex;
        if (!exists) {
            return res.status(503).type('text/plain').send(missingBuildMessage);
        }
        try {
            const html = readClientIndexFile(clientIndexFile);
            return res.type('html').send(injectClientBasePath(html, siteAccessPath));
        } catch (error) {
            return next(error);
        }
    };
}

export function registerClientBuildRoutes(app, options = {}) {
    const {
        rootDir,
        missingBuildMessage = DEFAULT_MISSING_CLIENT_BUILD_MESSAGE,
        getSiteAccessPath = () => '/',
        getSiteConfig = null,
    } = options;
    const { clientBuild, clientIndexFile } = resolveClientBuildPaths(rootDir);
    const hasClientIndex = fs.existsSync(clientIndexFile);

    if (!hasClientIndex) {
        console.warn(`[Client] Build file not found: ${clientIndexFile}`);
    }

    app.use(createClientStaticHandler({
        clientBuild,
        getSiteAccessPath,
        getSiteConfig,
    }));
    app.get('*', createClientBuildFallbackHandler({
        clientIndexFile,
        hasClientIndex: () => fs.existsSync(clientIndexFile),
        missingBuildMessage,
        getSiteAccessPath,
        getSiteConfig,
    }));

    return { clientBuild, clientIndexFile, hasClientIndex };
}
