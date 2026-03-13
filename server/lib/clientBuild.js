import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, extname, resolve } from 'path';
import { createSiteCamouflageHtml } from './siteCamouflage.js';

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
    if (/[\s?#]/.test(text)) return fallbackValue;

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

export function shouldServeCamouflageRequest(req = {}) {
    const method = String(req.method || 'GET').toUpperCase();
    const pathname = String(req.path || '/').trim() || '/';
    if (!['GET', 'HEAD'].includes(method)) return false;
    if (extname(pathname)) return false;
    return true;
}

export function injectClientBasePath(html, basePath = '/') {
    const normalizedBasePath = normalizeClientBasePath(basePath, '/');
    const snippet = `<script>window.__NMS_SITE_BASE_PATH__=${JSON.stringify(normalizedBasePath)};</script>`;
    if (!html.includes('</head>')) {
        return `${snippet}${html}`;
    }
    return html.replace('</head>', `${snippet}</head>`);
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
        const camouflageEnabled = siteConfig.camouflageEnabled === true;

        if (!shouldServeClientRequest(req.path, siteAccessPath)) {
            if (camouflageEnabled && shouldServeCamouflageRequest(req)) {
                return res.type('html').send(createSiteCamouflageHtml({
                    requestPath: req.path,
                }));
            }
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

    // Keep document requests under the access-path gate. Static assets remain public,
    // but "/" must not auto-serve dist/index.html before the fallback handler runs.
    app.use(express.static(clientBuild, CLIENT_STATIC_OPTIONS));
    app.get('*', createClientBuildFallbackHandler({
        clientIndexFile,
        hasClientIndex: () => fs.existsSync(clientIndexFile),
        missingBuildMessage,
        getSiteAccessPath,
        getSiteConfig,
    }));

    return { clientBuild, clientIndexFile, hasClientIndex };
}
