import { Router } from 'express';
import { toHttpError } from '../lib/httpError.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import { listEntitlementOverrides, updateClientEntitlement } from '../services/clientEntitlementService.js';

const router = Router();

router.get('/entitlement-overrides', (req, res) => {
    return res.json({
        success: true,
        obj: listEntitlementOverrides({
            serverId: req.query?.serverId,
            inboundId: req.query?.inboundId,
        }),
    });
});

router.put('/entitlement', async (req, res) => {
    try {
        const result = await updateClientEntitlement(req.body, req.user?.username || 'admin');

        if (result.overrideActive) {
            appendSecurityAudit('client_entitlement_overridden', req, {
                serverId: result.serverId,
                inboundId: result.inboundId,
                clientIdentifier: result.clientIdentifier,
                email: result.email,
                ...result.entitlement,
            });
        } else {
            appendSecurityAudit('client_entitlement_follow_policy', req, {
                serverId: result.serverId,
                inboundId: result.inboundId,
                clientIdentifier: result.clientIdentifier,
                email: result.email,
                ...result.entitlement,
            });
        }

        return res.json({
            success: true,
            obj: result,
        });
    } catch (error) {
        const httpError = toHttpError(error, 502, '更新单独限定失败');
        return res.status(httpError.status).json({
            success: false,
            msg: httpError.message || '更新单独限定失败',
        });
    }
});

export default router;
