import { Router, type Request, type Response } from 'express';
import certificateStore from '../store/certificateStore.js';
import { issueOrRenewCertificate, dispatchCertificateToServers } from '../services/acmeService.js';
import { authMiddleware, operatorOrAbove, auditorOrAbove } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

function sanitizeCert(cert: any, includeSecrets = false) {
    if (!cert) return null;
    const sanitized = { ...cert };
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
    const includeSecrets = req.query.includeSecrets === 'true';
    return res.json({ success: true, obj: sanitizeCert(cert, includeSecrets) });
});

/**
 * POST /api/certificates — Add a new certificate profile
 */
router.post('/', operatorOrAbove, async (req: Request, res: Response) => {
    const { domain, provider, challengeType, cfApiToken, email, autoRenew, assignedServerIds } = req.body || {};
    if (!domain) {
        return res.status(400).json({ success: false, msg: 'Domain is required' });
    }

    try {
        const record = certificateStore.create({
            domain,
            provider,
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
                return res.json({
                    success: true,
                    obj: sanitizeCert(record, false),
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
    const updated = certificateStore.update(req.params.id, req.body || {});
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
        return res.status(500).json({ success: false, msg: err.message || 'Failed to renew certificate' });
    }
});

/**
 * POST /api/certificates/:id/dispatch — Dispatch certificate to server nodes
 */
router.post('/:id/dispatch', operatorOrAbove, async (req: Request, res: Response) => {
    try {
        const serverIds = Array.isArray(req.body?.serverIds) ? req.body.serverIds : undefined;
        const result = await dispatchCertificateToServers(req.params.id, serverIds);
        return res.json({ success: true, obj: result });
    } catch (err: any) {
        return res.status(500).json({ success: false, msg: err.message || 'Failed to dispatch certificate' });
    }
});

export default router;
