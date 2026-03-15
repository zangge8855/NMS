import { extname } from 'path';
import { applyCamouflageResponseHeaders, createSiteCamouflageHtml } from '../lib/siteCamouflage.js';
import { normalizeClientBasePath, shouldServeCamouflageRequest, shouldServeClientRequest } from '../lib/clientBuild.js';

function resolveCamouflageHomePath() {
    return '/';
}

function resolveStatusCode(pathname = '/') {
    return String(pathname || '/').trim() === '/' ? 200 : 404;
}

export function createCamouflageNotFoundMiddleware({
    getSiteConfig = () => ({}),
} = {}) {
    return (req, res, next) => {
        const siteConfig = getSiteConfig() || {};
        const siteAccessPath = normalizeClientBasePath(siteConfig.accessPath, '/');
        const camouflageEnabled = siteConfig.camouflageEnabled === true;

        if (!camouflageEnabled || shouldServeClientRequest(req.path, siteAccessPath)) {
            return next();
        }

        if (shouldServeCamouflageRequest(req)) {
            const statusCode = resolveStatusCode(req.path);
            applyCamouflageResponseHeaders(res);
            return res
                .status(statusCode)
                .type('html')
                .send(createSiteCamouflageHtml({
                    siteConfig,
                    requestPath: req.originalUrl || req.path,
                    requestMethod: req.method,
                    statusCode,
                }));
        }

        const method = String(req.method || 'GET').toUpperCase();
        if (['GET', 'HEAD'].includes(method) && extname(String(req.path || ''))) {
            applyCamouflageResponseHeaders(res);
            return res.redirect(302, resolveCamouflageHomePath());
        }

        return next();
    };
}
