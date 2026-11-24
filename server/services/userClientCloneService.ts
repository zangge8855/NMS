import crypto from 'crypto';
import {
    PASSWORD_PROTOCOLS,
    applyEntitlementToClient,
    applyExtraProtocolCredentials,
    buildManagedClientData,
    normalizeEmail,
    normalizeNonNegativeInt,
    normalizeProtocol,
    parseInboundClients,
    postAddClient,
    resolveClientIdentifier,
    resolveShadowsocksPassword,
} from '../lib/clientEntitlements.js';
import { createHttpError } from '../lib/httpError.js';
import { isManagedClientProtocol, isSuiPanelContext } from '../lib/clientProtocols.js';
import { postDeleteClientFromInboundCompat } from '../lib/panelApiCompat.js';
import { normalizeAppLocale, pickLocalizedText } from '../lib/requestLocale.js';
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';
import { resolveEffectivePolicy } from '../lib/userPolicyResolver.js';
import clientEntitlementOverrideRepository from '../repositories/clientEntitlementOverrideRepository.js';
import serverRepository from '../repositories/serverRepository.js';
import userGroupRepository from '../repositories/userGroupRepository.js';
import userPolicyRepository from '../repositories/userPolicyRepository.js';
import userRepository from '../repositories/userRepository.js';
import { invalidatePublicSubCache } from '../routes/subscriptions.js';
import { listPanelInbounds } from './panelGateway.js';

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function createFreshCredentials() {
    return {
        uuid: crypto.randomUUID(),
        password: crypto.randomBytes(16).toString('hex'),
        ss2022Key16: crypto.randomBytes(16).toString('base64'),
        ss2022Key32: crypto.randomBytes(32).toString('base64'),
        subId: crypto.randomBytes(8).toString('hex'),
    };
}

function resolveFlowForInbound(protocol: string, inbound: any): string {
    if (protocol !== 'vless') return '';
    let stream: any = {};
    try {
        stream = typeof inbound?.streamSettings === 'string'
            ? JSON.parse(inbound.streamSettings)
            : (inbound?.streamSettings || {});
    } catch {
        // ignore malformed JSON
    }
    const network = String(stream.network || '').toLowerCase();
    const security = String(stream.security || '').toLowerCase();
    if ((!network || network === 'tcp' || network === 'raw') && (security === 'reality' || security === 'tls')) {
        return 'xtls-rprx-vision';
    }
    return '';
}

function buildAutoClientEmail(baseEmail: string, nodeLabel: string, existingEmailKeys: Set<string>): string {
    const cleanBase = normalizeText(baseEmail) || 'client';
    const asciiSlug = normalizeText(nodeLabel)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 16);
    const suffix = asciiSlug || 'pure';

    const firstCandidate = `${cleanBase}-${suffix}`;
    if (!existingEmailKeys.has(firstCandidate.toLowerCase())) {
        return firstCandidate;
    }

    for (let index = 2; index <= 99; index += 1) {
        const candidate = `${cleanBase}-${suffix}${index}`;
        if (!existingEmailKeys.has(candidate.toLowerCase())) {
            return candidate;
        }
    }

    return `${cleanBase}-${crypto.randomBytes(3).toString('hex')}`;
}

function isNotFoundPanelError(error: any): boolean {
    const status = Number(error?.response?.status || error?.status || 0);
    const msg = String(error?.response?.data?.msg || error?.message || '').toLowerCase();
    return status === 404
        || msg.includes('not found')
        || msg.includes('record not found')
        || msg.includes('does not exist');
}

export async function cloneUserClientOnServer(
    userId: string,
    payload: any = {},
    actor: string = 'admin',
    deps: any = {}
) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const usersRepo = deps.userRepository || userRepository;
    const serversRepo = deps.serverRepository || serverRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const overrideRepo = deps.overrideRepository || clientEntitlementOverrideRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const addClient = deps.postAddClient || postAddClient;

    const user = usersRepo.getById(String(userId || '').trim());
    if (!user) {
        throw createHttpError(404, pickLocalizedText(locale, '用户不存在', 'User not found'));
    }

    const subscriptionEmail = normalizeEmail(user.subscriptionEmail || user.email);
    const baseEmail = subscriptionEmail || normalizeText(user.username);
    if (!baseEmail) {
        throw createHttpError(400, pickLocalizedText(locale, '用户未配置订阅邮箱', 'User has no subscription email configured'));
    }

    const serverId = normalizeText(payload.serverId);
    const inboundId = normalizeText(payload.inboundId);
    if (!serverId || !inboundId) {
        throw createHttpError(400, pickLocalizedText(locale, '请选择目标服务器和入站', 'Target server and inbound are required'));
    }

    const server = serversRepo.getById(serverId);
    if (!server) {
        throw createHttpError(404, pickLocalizedText(locale, '服务器不存在', 'Server not found'));
    }

    const { client: panelClient, inbounds } = await listInbounds(serverId);
    const inbound = (Array.isArray(inbounds) ? inbounds : []).find((item: any) => String(item?.id) === inboundId);
    if (!inbound) {
        throw createHttpError(404, pickLocalizedText(locale, '目标入站不存在', 'Target inbound not found'));
    }

    const protocol = normalizeProtocol(payload.protocol || inbound.protocol);
    if (!isManagedClientProtocol(protocol, inbound)) {
        throw createHttpError(
            400,
            pickLocalizedText(
                locale,
                '当前入站协议不支持复制客户端',
                'Cloning clients is not supported for this inbound protocol'
            )
        );
    }

    // Collect every existing client email across the server to guarantee uniqueness
    // (3x-ui enforces panel-wide unique client emails; s-ui enforces unique client names).
    const existingEmailKeys = new Set<string>();
    for (const ib of Array.isArray(inbounds) ? inbounds : []) {
        for (const entry of parseInboundClients(ib)) {
            const key = normalizeEmail(entry?.email);
            if (key) existingEmailKeys.add(key);
        }
    }

    const inboundClients = parseInboundClients(inbound);
    const requestedSourceEmail = normalizeEmail(payload.sourceClientEmail);
    const requestedSourceId = normalizeText(payload.sourceClientIdentifier);
    const candidateEmails = new Set(
        [requestedSourceEmail, subscriptionEmail, normalizeEmail(user.email)].filter(Boolean)
    );
    const sourceClient = inboundClients.find((item: any) => {
        if (requestedSourceId && resolveClientIdentifier(item, protocol) === requestedSourceId) return true;
        return candidateEmails.has(normalizeEmail(item?.email));
    }) || null;

    const defaultNodeLabel = pickLocalizedText(locale, '纯净IP', 'Clean IP');
    const nodeLabel = normalizeText(payload.nodeLabel) || defaultNodeLabel;
    const requestedClientEmail = normalizeText(payload.clientEmail);
    const targetClientEmail = requestedClientEmail
        || buildAutoClientEmail(sourceClient?.email || baseEmail, nodeLabel, existingEmailKeys);

    if (!targetClientEmail) {
        throw createHttpError(400, pickLocalizedText(locale, '客户端名称不能为空', 'Client name cannot be empty'));
    }
    if (existingEmailKeys.has(targetClientEmail.toLowerCase())) {
        throw createHttpError(
            409,
            pickLocalizedText(
                locale,
                `该服务器已存在名为 "${targetClientEmail}" 的客户端，请更换名称`,
                `A client named "${targetClientEmail}" already exists on this server. Choose a different name.`
            )
        );
    }

    const rawPolicy = subscriptionEmail ? policyRepo.get(subscriptionEmail) : null;
    const group = user.groupId ? groupRepo.getById(user.groupId) : null;
    const effectivePolicy = resolveEffectivePolicy(user, rawPolicy, group);

    const hasExplicitTraffic = payload.trafficLimitBytes !== undefined && payload.trafficLimitBytes !== null && payload.trafficLimitBytes !== '';
    const hasExplicitExpiry = payload.expiryTime !== undefined && payload.expiryTime !== null && payload.expiryTime !== '';
    const hasExplicitLimitIp = payload.limitIp !== undefined && payload.limitIp !== null && payload.limitIp !== '';

    const entitlement = {
        trafficLimitBytes: hasExplicitTraffic
            ? normalizeNonNegativeInt(payload.trafficLimitBytes, 0)
            : normalizeNonNegativeInt(sourceClient?.totalGB, normalizeNonNegativeInt(effectivePolicy?.trafficLimitBytes, 0)),
        expiryTime: hasExplicitExpiry
            ? normalizeNonNegativeInt(payload.expiryTime, 0)
            : normalizeNonNegativeInt(sourceClient?.expiryTime, normalizeNonNegativeInt(effectivePolicy?.expiryTime, 0)),
        limitIp: hasExplicitLimitIp
            ? normalizeNonNegativeInt(payload.limitIp, 0)
            : normalizeNonNegativeInt(sourceClient?.limitIp, normalizeNonNegativeInt(effectivePolicy?.limitIp, 0)),
        speedLimitUp: payload.speedLimitUp !== undefined
            ? normalizeNonNegativeInt(payload.speedLimitUp, 0)
            : normalizeNonNegativeInt(sourceClient?.speedLimitUp, normalizeNonNegativeInt(effectivePolicy?.speedLimitUp, 0)),
        speedLimitDown: payload.speedLimitDown !== undefined
            ? normalizeNonNegativeInt(payload.speedLimitDown, 0)
            : normalizeNonNegativeInt(sourceClient?.speedLimitDown, normalizeNonNegativeInt(effectivePolicy?.speedLimitDown, 0)),
        tgId: payload.tgId !== undefined
            ? (Number(payload.tgId) || 0)
            : (Number(sourceClient?.tgId ?? effectivePolicy?.tgId) || 0),
        group: payload.group !== undefined
            ? normalizeText(payload.group)
            : normalizeText(sourceClient?.group ?? effectivePolicy?.group),
        comment: payload.comment !== undefined
            ? normalizeText(payload.comment)
            : (normalizeText(sourceClient?.comment) || nodeLabel),
        reset: payload.reset !== undefined
            ? (Number(payload.reset) || 0)
            : (Number(sourceClient?.reset ?? effectivePolicy?.reset) || 0),
    };

    const freshCredentials = createFreshCredentials();
    let newClientData: any;
    if (sourceClient) {
        newClientData = applyEntitlementToClient({
            ...sourceClient,
            email: targetClientEmail,
            enable: payload.enable !== false,
            id: freshCredentials.uuid,
            ...(protocol === 'tuic' ? { uuid: freshCredentials.uuid } : {}),
            subId: freshCredentials.subId,
            up: 0,
            down: 0,
        }, entitlement);
        delete newClientData.suiClientId;
        delete newClientData.links;

        if (isSuiPanelContext(inbound)) {
            newClientData.password = freshCredentials.password;
            newClientData.ss2022Key16 = freshCredentials.ss2022Key16;
            newClientData.ss2022Key32 = freshCredentials.ss2022Key32;
            newClientData.flow = normalizeText(sourceClient.flow) || resolveFlowForInbound('vless', inbound);
        } else {
            if (protocol === 'vmess' || protocol === 'vless') {
                newClientData.flow = sourceClient.flow !== undefined
                    ? String(sourceClient.flow || '')
                    : resolveFlowForInbound(protocol, inbound);
            }
            if (PASSWORD_PROTOCOLS.has(protocol)) {
                newClientData.password = protocol === 'shadowsocks'
                    ? resolveShadowsocksPassword(inbound, freshCredentials, sourceClient)
                    : freshCredentials.password;
            }
            applyExtraProtocolCredentials(newClientData, protocol, freshCredentials.password);
        }
    } else {
        newClientData = buildManagedClientData({
            email: targetClientEmail,
            protocol,
            inbound,
            sharedCredentials: freshCredentials,
            entitlement,
            resolveFlow: resolveFlowForInbound,
        });
        // Preserve exact case spelling when caller specified a mixed-case panel name.
        newClientData.email = targetClientEmail;
        newClientData.enable = payload.enable !== false;
    }

    await addClient(panelClient, inbound.id, newClientData, { protocol });

    const clientIdentifier = resolveClientIdentifier(newClientData, protocol);
    if (clientIdentifier) {
        overrideRepo.upsert({
            serverId,
            inboundId: String(inbound.id),
            clientIdentifier,
            email: targetClientEmail,
            ...entitlement,
        }, actor);
    }

    const binding = usersRepo.addExtraClient(user.id, {
        serverId,
        inboundId: String(inbound.id),
        clientEmail: targetClientEmail,
        nodeLabel,
        sourceClientEmail: normalizeText(sourceClient?.email || subscriptionEmail),
    });

    (deps.invalidateServerPanelSnapshotCache || invalidateServerPanelSnapshotCache)(serverId);
    const invalidateSub = deps.invalidatePublicSubCache || invalidatePublicSubCache;
    if (subscriptionEmail) invalidateSub(subscriptionEmail);
    invalidateSub();

    return {
        binding,
        serverId,
        serverName: server.name || '',
        inboundId: String(inbound.id),
        inboundRemark: inbound.remark || '',
        protocol,
        clientEmail: targetClientEmail,
        clientIdentifier,
        entitlement,
    };
}

export function updateUserExtraClientBinding(
    userId: string,
    bindingId: string,
    payload: any = {},
    deps: any = {}
) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const usersRepo = deps.userRepository || userRepository;
    const user = usersRepo.getById(String(userId || '').trim());
    if (!user) {
        throw createHttpError(404, pickLocalizedText(locale, '用户不存在', 'User not found'));
    }
    const updated = usersRepo.updateExtraClient(user.id, bindingId, {
        ...(payload.nodeLabel !== undefined ? { nodeLabel: normalizeText(payload.nodeLabel) } : {}),
    });
    if (!updated) {
        throw createHttpError(404, pickLocalizedText(locale, '未找到对应的复制客户端绑定', 'Cloned client binding not found'));
    }
    const subscriptionEmail = normalizeEmail(user.subscriptionEmail || user.email);
    const invalidateSub = deps.invalidatePublicSubCache || invalidatePublicSubCache;
    if (subscriptionEmail) invalidateSub(subscriptionEmail);
    invalidateSub();
    return updated;
}

export async function removeUserExtraClientBinding(
    userId: string,
    bindingId: string,
    deps: any = {}
) {
    const locale = normalizeAppLocale(deps?.locale, 'zh-CN');
    const usersRepo = deps.userRepository || userRepository;
    const serversRepo = deps.serverRepository || serverRepository;
    const overrideRepo = deps.overrideRepository || clientEntitlementOverrideRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const deleteClient = deps.postDeleteClientFromInboundCompat || postDeleteClientFromInboundCompat;

    const user = usersRepo.getById(String(userId || '').trim());
    if (!user) {
        throw createHttpError(404, pickLocalizedText(locale, '用户不存在', 'User not found'));
    }

    const bindings = usersRepo.listExtraClients(user.id);
    const target = bindings.find((item: any) => item.id === String(bindingId || '').trim());
    if (!target) {
        throw createHttpError(404, pickLocalizedText(locale, '未找到对应的复制客户端绑定', 'Cloned client binding not found'));
    }

    let panelRemoved = false;
    let panelWarning = '';
    const server = serversRepo.getById(target.serverId);
    if (server) {
        try {
            const { client: panelClient, inbounds } = await listInbounds(target.serverId);
            const inbound = (Array.isArray(inbounds) ? inbounds : []).find((item: any) => String(item?.id) === String(target.inboundId));
            if (inbound) {
                const protocol = normalizeProtocol(inbound.protocol);
                const clients = parseInboundClients(inbound);
                const match = clients.find((item: any) => normalizeText(item?.email) === target.clientEmail)
                    || clients.find((item: any) => normalizeEmail(item?.email) === normalizeEmail(target.clientEmail));
                if (match) {
                    const clientIdentifier = resolveClientIdentifier(match, protocol);
                    await deleteClient(panelClient, inbound.id, clientIdentifier, {
                        email: match.email,
                        protocol,
                        sourceClient: match,
                    });
                    if (clientIdentifier) {
                        overrideRepo.remove(target.serverId, String(inbound.id), clientIdentifier);
                    }
                    panelRemoved = true;
                }
            }
        } catch (error: any) {
            if (!isNotFoundPanelError(error)) {
                panelWarning = String(error?.response?.data?.msg || error?.message || 'panel delete failed');
            }
        }
    }

    const removed = usersRepo.removeExtraClient(user.id, target.id);
    (deps.invalidateServerPanelSnapshotCache || invalidateServerPanelSnapshotCache)(target.serverId);
    const subscriptionEmail = normalizeEmail(user.subscriptionEmail || user.email);
    const invalidateSub = deps.invalidatePublicSubCache || invalidatePublicSubCache;
    if (subscriptionEmail) invalidateSub(subscriptionEmail);
    invalidateSub();

    return {
        removed,
        panelRemoved,
        panelWarning,
    };
}
