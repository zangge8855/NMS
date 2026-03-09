import { Router } from 'express';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import {
    CLIENT_PROTOCOLS,
    applyEntitlementToClient,
    normalizeEmail,
    normalizeNonNegativeInt,
    normalizeProtocol,
    parseInboundClients,
    postUpdateClient,
    resolveClientIdentifier,
} from '../lib/clientEntitlements.js';
import clientEntitlementOverrideStore from '../store/clientEntitlementOverrideStore.js';
import serverStore from '../store/serverStore.js';
import userPolicyStore from '../store/userPolicyStore.js';

const router = Router();

function normalizeText(value) {
    return String(value || '').trim();
}

router.get('/entitlement-overrides', (req, res) => {
    const serverId = normalizeText(req.query?.serverId);
    const inboundId = normalizeText(req.query?.inboundId);
    const snapshot = clientEntitlementOverrideStore.exportState();
    const sourceItems = Array.isArray(snapshot)
        ? snapshot
        : Array.isArray(snapshot?.records)
            ? snapshot.records
            : Object.values(snapshot?.records || {});
    const items = sourceItems
        .filter((item) => {
            if (serverId && item.serverId !== serverId) return false;
            if (inboundId && String(item.inboundId) !== inboundId) return false;
            return true;
        });
    return res.json({
        success: true,
        obj: items,
    });
});

router.put('/entitlement', async (req, res) => {
    const serverId = normalizeText(req.body?.serverId);
    const inboundId = normalizeText(req.body?.inboundId);
    const requestedIdentifier = normalizeText(req.body?.clientIdentifier);
    const requestedEmail = normalizeEmail(req.body?.email);
    const mode = String(req.body?.mode || 'override').trim().toLowerCase();

    if (!serverId || !inboundId || !requestedIdentifier) {
        return res.status(400).json({
            success: false,
            msg: 'serverId, inboundId and clientIdentifier are required',
        });
    }
    if (!['override', 'follow_policy'].includes(mode)) {
        return res.status(400).json({
            success: false,
            msg: 'mode must be override or follow_policy',
        });
    }

    const server = serverStore.getById(serverId);
    if (!server) {
        return res.status(404).json({ success: false, msg: '服务器不存在' });
    }

    try {
        const panelClient = await ensureAuthenticated(serverId);
        const listRes = await panelClient.get('/panel/api/inbounds/list');
        const inbounds = Array.isArray(listRes.data?.obj) ? listRes.data.obj : [];
        const inbound = inbounds.find((item) => String(item?.id) === inboundId);
        if (!inbound) {
            return res.status(404).json({ success: false, msg: '入站不存在' });
        }

        const protocol = normalizeProtocol(req.body?.protocol || inbound.protocol);
        if (!CLIENT_PROTOCOLS.has(protocol)) {
            return res.status(400).json({ success: false, msg: '当前入站协议不支持单独限定' });
        }

        const clients = parseInboundClients(inbound);
        const match = clients.find((item) => {
            const identifier = resolveClientIdentifier(item, protocol);
            return identifier === requestedIdentifier || normalizeEmail(item.email) === requestedEmail;
        });
        if (!match) {
            return res.status(404).json({ success: false, msg: '入站用户不存在' });
        }

        const clientIdentifier = resolveClientIdentifier(match, protocol);
        const email = requestedEmail || normalizeEmail(match.email);

        let entitlement;
        if (mode === 'follow_policy') {
            const policy = userPolicyStore.get(email);
            entitlement = {
                expiryTime: normalizeNonNegativeInt(policy.expiryTime, 0),
                limitIp: normalizeNonNegativeInt(policy.limitIp, 0),
                trafficLimitBytes: normalizeNonNegativeInt(policy.trafficLimitBytes, 0),
            };
        } else {
            entitlement = {
                expiryTime: normalizeNonNegativeInt(req.body?.expiryTime, 0),
                limitIp: normalizeNonNegativeInt(req.body?.limitIp, 0),
                trafficLimitBytes: normalizeNonNegativeInt(req.body?.trafficLimitBytes, 0),
            };
        }

        const updatedClient = applyEntitlementToClient(match, entitlement);
        await postUpdateClient(panelClient, inbound.id, clientIdentifier, updatedClient);

        let overrideActive = false;
        if (mode === 'override') {
            clientEntitlementOverrideStore.upsert({
                serverId,
                inboundId,
                clientIdentifier,
                email,
                ...entitlement,
            }, req.user?.username || 'admin');
            overrideActive = true;
            appendSecurityAudit('client_entitlement_overridden', req, {
                serverId,
                inboundId,
                clientIdentifier,
                email,
                ...entitlement,
            });
        } else {
            clientEntitlementOverrideStore.remove(serverId, inboundId, clientIdentifier);
            appendSecurityAudit('client_entitlement_follow_policy', req, {
                serverId,
                inboundId,
                clientIdentifier,
                email,
                ...entitlement,
            });
        }

        return res.json({
            success: true,
            obj: {
                serverId,
                inboundId,
                email,
                clientIdentifier,
                overrideActive,
                entitlement,
            },
        });
    } catch (error) {
        return res.status(502).json({
            success: false,
            msg: error.message || '更新单独限定失败',
        });
    }
});

export default router;
