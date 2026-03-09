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
import { createHttpError } from '../lib/httpError.js';
import clientEntitlementOverrideRepository from '../repositories/clientEntitlementOverrideRepository.js';
import serverRepository from '../repositories/serverRepository.js';
import userPolicyRepository from '../repositories/userPolicyRepository.js';
import { listPanelInbounds } from './panelGateway.js';

function normalizeText(value) {
    return String(value || '').trim();
}

function listEntitlementOverrides(filters = {}, deps = {}) {
    const overrideRepository = deps.overrideRepository || clientEntitlementOverrideRepository;
    return overrideRepository.list(filters);
}

async function updateClientEntitlement(payload = {}, actor = 'admin', deps = {}) {
    const overrideRepository = deps.overrideRepository || clientEntitlementOverrideRepository;
    const policyRepository = deps.userPolicyRepository || userPolicyRepository;
    const servers = deps.serverRepository || serverRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;

    const serverId = normalizeText(payload.serverId);
    const inboundId = normalizeText(payload.inboundId);
    const requestedIdentifier = normalizeText(payload.clientIdentifier);
    const requestedEmail = normalizeEmail(payload.email);
    const mode = String(payload.mode || 'override').trim().toLowerCase();

    if (!serverId || !inboundId || !requestedIdentifier) {
        throw createHttpError(400, 'serverId, inboundId and clientIdentifier are required');
    }
    if (!['override', 'follow_policy'].includes(mode)) {
        throw createHttpError(400, 'mode must be override or follow_policy');
    }

    const server = servers.getById(serverId);
    if (!server) {
        throw createHttpError(404, '服务器不存在');
    }

    const { client, inbounds } = await listInbounds(serverId);
    const inbound = inbounds.find((item) => String(item?.id) === inboundId);
    if (!inbound) {
        throw createHttpError(404, '入站不存在');
    }

    const protocol = normalizeProtocol(payload.protocol || inbound.protocol);
    if (!CLIENT_PROTOCOLS.has(protocol)) {
        throw createHttpError(400, '当前入站协议不支持单独限定');
    }

    const clients = parseInboundClients(inbound);
    const match = clients.find((item) => {
        const identifier = resolveClientIdentifier(item, protocol);
        return identifier === requestedIdentifier || normalizeEmail(item.email) === requestedEmail;
    });
    if (!match) {
        throw createHttpError(404, '入站用户不存在');
    }

    const clientIdentifier = resolveClientIdentifier(match, protocol);
    const email = requestedEmail || normalizeEmail(match.email);

    const entitlement = mode === 'follow_policy'
        ? (() => {
            const policy = policyRepository.get(email);
            return {
                expiryTime: normalizeNonNegativeInt(policy.expiryTime, 0),
                limitIp: normalizeNonNegativeInt(policy.limitIp, 0),
                trafficLimitBytes: normalizeNonNegativeInt(policy.trafficLimitBytes, 0),
            };
        })()
        : {
            expiryTime: normalizeNonNegativeInt(payload.expiryTime, 0),
            limitIp: normalizeNonNegativeInt(payload.limitIp, 0),
            trafficLimitBytes: normalizeNonNegativeInt(payload.trafficLimitBytes, 0),
        };

    const updatedClient = applyEntitlementToClient(match, entitlement);
    await postUpdateClient(client, inbound.id, clientIdentifier, updatedClient);

    let overrideActive = false;
    if (mode === 'override') {
        overrideRepository.upsert({
            serverId,
            inboundId,
            clientIdentifier,
            email,
            ...entitlement,
        }, actor);
        overrideActive = true;
    } else {
        overrideRepository.remove(serverId, inboundId, clientIdentifier);
    }

    return {
        serverId,
        inboundId,
        email,
        clientIdentifier,
        overrideActive,
        entitlement,
    };
}

export { listEntitlementOverrides, updateClientEntitlement };
