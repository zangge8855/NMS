import { Router, type Request, type Response } from 'express';
import certificateStore, { resolveCertificateStatus } from '../store/certificateStore.js';
import {
    issueOrRenewCertificate,
    dispatchCertificateToServers,
    normalizeSanList,
} from '../services/acmeService.js';
import { authMiddleware, operatorOrAbove, auditorOrAbove } from '../middleware/auth.js';
import { ROLES } from '../store/userStore.js';
import { stripIpv6Brackets } from '../lib/ipGeoResolver.js';

const router = Router();

router.use(authMiddleware);

function sanitizeCert(cert: any, includeSecrets = false) {
    if (!cert) return null;
    const sanitized = {
        ...cert,
        status: resolveCertificateStatus(cert),
    };
    if (!includeSecrets) {
        if (sanitized.cfApiToken) sanitized.cfApiToken = '********';
        if (sanitized.privateKey) sanitized.hasPrivateKey = true;
        delete sanitized.privateKey;
    }
    return sanitized;
}

/**
 * GET /api/certificates — List all certificates
 */
router.get('/', auditorOrAbove, (_req: Request, res: Response) => {
    const list = certificateStore.getAll().map((c) => sanitizeCert(c, false));
    return res.json({ success: true, obj: list });
});

/**
 * GET /api/certificates/:id — Get certificate details
 */
router.get('/:id', auditorOrAbove, (req: Request, res: Response) => {
    const cert = certificateStore.getById(req.params.id);
    if (!cert) {
        return res.status(404).json({ success: false, msg: 'Certificate not found' });
    }
    const userRole = (req as any).user?.role;
    const canAccessSecrets = userRole === ROLES.admin || userRole === ROLES.operator;
    const includeSecrets = req.query.includeSecrets === 'true' && canAccessSecrets;
    return res.json({ success: true, obj: sanitizeCert(cert, includeSecrets) });
});

/**
 * POST /api/certificates — Add a new certificate profile
 */
router.post('/', operatorOrAbove, async (req: Request, res: Response) => {
    const {
        domain,
        sans,
        provider,
        acmeDirectoryUrl,
        challengeType,
        cfApiToken,
        email,
        autoRenew,
        assignedServerIds,
    } = req.body || {};
    const normalizedDomain = stripIpv6Brackets(String(domain || '').trim());
    if (!normalizedDomain) {
        return res.status(400).json({ success: false, msg: 'Domain is required' });
    }

    const normalizedSans = normalizeSanList(normalizedDomain, sans).filter((item) => item !== normalizedDomain.toLowerCase());

    try {
        const record = certificateStore.create({
            domain: normalizedDomain,
            sans: normalizedSans,
            provider,
            acmeDirectoryUrl,
            challengeType,
            cfApiToken,
            email,
            autoRenew,
            assignedServerIds,
        });

        // Optionally issue immediately
        if (req.body?.issueImmediately !== false) {
            try {
                const issued = await issueOrRenewCertificate(record.id);
                return res.json({ success: true, obj: sanitizeCert(issued, false) });
            } catch (issueErr: any) {
                const failedRecord = certificateStore.getById(record.id) || record;
                return res.json({
                    success: true,
                    obj: sanitizeCert(failedRecord, false),
                    warning: `Created but issuance had warning: ${issueErr.message}`,
                });
            }
        }

        return res.json({ success: true, obj: sanitizeCert(record, false) });
    } catch (err: any) {
        return res.status(500).json({ success: false, msg: err.message || 'Failed to create certificate' });
    }
});

/**
 * PUT /api/certificates/:id — Update certificate profile
 */
router.put('/:id', operatorOrAbove, (req: Request, res: Response) => {
    const existing = certificateStore.getById(req.params.id);
    if (!existing) {
        return res.status(404).json({ success: false, msg: 'Certificate not found' });
    }

    const body = req.body || {};
    const updates: Record<string, any> = {};
    if (body.domain !== undefined) {
        const nextDomain = stripIpv6Brackets(String(body.domain || '').trim());
        if (!nextDomain) {
            return res.status(400).json({ success: false, msg: 'Domain cannot be empty' });
        }
        updates.domain = nextDomain;
    }
    if (body.sans !== undefined) {
        const targetDomain = updates.domain || existing.domain;
        updates.sans = normalizeSanList(targetDomain, body.sans).filter((item) => item !== targetDomain.toLowerCase());
    }
    if (body.provider !== undefined) updates.provider = String(body.provider || '').trim() || 'letsencrypt';
    if (body.acmeDirectoryUrl !== undefined) updates.acmeDirectoryUrl = String(body.acmeDirectoryUrl || '').trim();
    if (body.challengeType !== undefined) updates.challengeType = String(body.challengeType || '').trim() || 'dns-cloudflare';
    if (body.email !== undefined) updates.email = String(body.email || '').trim();
    if (body.autoRenew !== undefined) updates.autoRenew = Boolean(body.autoRenew);
    if (body.assignedServerIds !== undefined) {
        updates.assignedServerIds = Array.isArray(body.assignedServerIds)
            ? body.assignedServerIds.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
    }
    if (body.cfApiToken !== undefined && body.cfApiToken !== '********') {
        updates.cfApiToken = String(body.cfApiToken || '').trim();
    }

    const updated = certificateStore.update(req.params.id, updates);
    if (!updated) {
        return res.status(404).json({ success: false, msg: 'Certificate not found' });
    }
    return res.json({ success: true, obj: sanitizeCert(updated, false) });
});

/**
 * DELETE /api/certificates/:id — Delete certificate
 */
router.delete('/:id', operatorOrAbove, (req: Request, res: Response) => {
    const deleted = certificateStore.delete(req.params.id);
    if (!deleted) {
        return res.status(404).json({ success: false, msg: 'Certificate not found' });
    }
    return res.json({ success: true, msg: 'Certificate deleted' });
});

/**
 * POST /api/certificates/:id/renew — Renew certificate
 */
router.post('/:id/renew', operatorOrAbove, async (req: Request, res: Response) => {
    try {
        const renewed = await issueOrRenewCertificate(req.params.id);
        return res.json({ success: true, obj: sanitizeCert(renewed, false) });
    } catch (err: any) {
        const message = err?.message || 'Failed to renew certificate';
        const status = /not found/i.test(message) ? 404 : (/required|unsupported/i.test(message) ? 400 : 500);
        return res.status(status).json({ success: false, msg: message });
    }
});

/**
 * POST /api/certificates/:id/dispatch — Dispatch certificate to server nodes
 */
router.post('/:id/dispatch', operatorOrAbove, async (req: Request, res: Response) => {
    try {
        const serverIds = Array.isArray(req.body?.serverIds) ? req.body.serverIds : undefined;
        const inboundIds = Array.isArray(req.body?.inboundIds) ? req.body.inboundIds : undefined;
        const applyAllTlsInbounds = req.body?.applyAllTlsInbounds === true;
        const result = await dispatchCertificateToServers(req.params.id, serverIds, {
            inboundIds,
            applyAllTlsInbounds,
        });
        return res.json({ success: true, obj: result });
    } catch (err: any) {
        const message = err?.message || 'Failed to dispatch certificate';
        const status = /not found|does not have valid certificate|match/i.test(message) ? 400 : 500;
        return res.status(status).json({ success: false, msg: message });
    }
});

export default router;
