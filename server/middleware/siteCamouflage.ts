import type { Request, Response, NextFunction } from 'express';
import { applyCamouflageResponseHeaders, renderCamouflageResponse } from '../lib/siteCamouflage.js';
import { normalizeClientBasePath, shouldServeClientRequest } from '../lib/clientBuild.js';

const HOST_PATTERN = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

function resolveHost(req: Request): string {
    const host = String(req.headers?.host || '').trim().toLowerCase();
    return HOST_PATTERN.test(host) ? host : '';
}

function resolveOrigin(req: Request, host: string): string {
    if (!host) return '';
    const forwarded = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const protocol = forwarded === 'https' || forwarded === 'http'
        ? forwarded
        : (req.secure ? 'https' : (req.protocol || 'http'));
    return `${protocol}://${host}`;
}

function resolveContactEmail(host: string): string {
    const hostname = host.replace(/:\d+$/, '').replace(/^www\./, '');
    return DOMAIN_PATTERN.test(hostname) ? `hello@${hostname}` : '';
}

export interface CamouflageNotFoundOptions {
    getSiteConfig?: () => any;
}

/**
 * Serves the public camouflage site for every request outside the real access
 * path: real pages for known routes, and a themed 404 page for anything else
 * (including probes for files such as /.env or /wp-login.php).
 */
export function createCamouflageNotFoundMiddleware({
    getSiteConfig = () => ({}),
}: CamouflageNotFoundOptions = {}) {
    return (req: Request, res: Response, next: NextFunction): void | Response => {
        const siteConfig = getSiteConfig() || {};
        const siteAccessPath = normalizeClientBasePath(siteConfig.accessPath, '/');
        const camouflageEnabled = siteConfig.camouflageEnabled === true;

        if (!camouflageEnabled || shouldServeClientRequest(req.path, siteAccessPath)) {
            return next();
        }

        const method = String(req.method || 'GET').toUpperCase();
        const host = resolveHost(req);
        const result = renderCamouflageResponse({
            siteConfig,
            requestPath: ['GET', 'HEAD'].includes(method) ? req.path : '/__missing__',
            requestMethod: method,
            origin: resolveOrigin(req, host),
            contactEmail: resolveContactEmail(host),
        });

        applyCamouflageResponseHeaders(res, result.cacheControl);
        if (result.lastModified) {
            res.setHeader('Last-Modified', result.lastModified);
        }
        return res
            .status(result.status)
            .type(result.contentType)
            .send(result.body);
    };
}
