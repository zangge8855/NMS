import crypto from 'crypto';
import {
    CLIENT_PROTOCOLS as DEPLOY_CLIENT_PROTOCOLS,
    applyEntitlementToClient,
    buildManagedClientData,
    normalizeNonNegativeInt,
    parseInboundClients,
    postAddClient,
    postUpdateClient,
    resolveClientIdentifier,
} from '../lib/clientEntitlements.js';
import clientEntitlementOverrideRepository from '../repositories/clientEntitlementOverrideRepository.js';
import serverRepository from '../repositories/serverRepository.js';
import subscriptionTokenRepository from '../repositories/subscriptionTokenRepository.js';
import userPolicyRepository from '../repositories/userPolicyRepository.js';
import { listPanelInbounds } from './panelGateway.js';

function normalizeEmailInput(value) {
    return String(value || '').trim().toLowerCase();
}

function buildScopeTokenName(serverId = '') {
    return `auto-persistent:${serverId || 'all'}`;
}

function buildStableSubId(email) {
    return crypto.createHash('sha256').update(normalizeEmailInput(email)).digest('hex').slice(0, 16);
}

function resolveDeployFlow(protocol, inbound) {
    if (protocol !== 'vless') return '';
    let stream = {};
    try {
        stream = typeof inbound.streamSettings === 'string'
            ? JSON.parse(inbound.streamSettings)
            : (inbound.streamSettings || {});
    } catch { /* ignore */ }
    const network = String(stream.network || '').toLowerCase();
    const security = String(stream.security || '').toLowerCase();
    if ((network === 'tcp' || network === 'http') && (security === 'reality' || security === 'tls')) {
        return 'xtls-rprx-vision';
    }
    return '';
}

function resolvePolicyEntitlement(policy = {}, options = {}) {
    return {
        expiryTime: normalizeNonNegativeInt(
            options.expiryTime,
            normalizeNonNegativeInt(policy.expiryTime, 0)
        ),
        limitIp: normalizeNonNegativeInt(options.limitIp, normalizeNonNegativeInt(policy.limitIp, 0)),
        trafficLimitBytes: normalizeNonNegativeInt(
            options.trafficLimitBytes,
            normalizeNonNegativeInt(policy.trafficLimitBytes, 0)
        ),
    };
}

function ensurePersistentSubscriptionToken(email, actor = 'admin', deps = {}) {
    const repository = deps.subscriptionTokenRepository || subscriptionTokenRepository;
    const scopeName = buildScopeTokenName('');
    const existing = repository.getFirstActiveTokenByName(email, scopeName);
    if (existing?.metadata?.id) {
        return {
            metadata: existing.metadata,
            autoIssued: false,
            issueError: null,
        };
    }

    try {
        const issued = repository.issue(email, {
            name: scopeName,
            noExpiry: true,
            ttlDays: 0,
            ignoreActiveLimit: true,
            createdBy: actor,
        });
        return {
            metadata: issued.metadata,
            autoIssued: true,
            issueError: null,
        };
    } catch (error) {
        return {
            metadata: null,
            autoIssued: false,
            issueError: error.message || 'Failed to issue persistent token',
        };
    }
}

async function autoDeployClients(subscriptionEmail, policy, options = {}, deps = {}) {
    const servers = deps.serverRepository || serverRepository;
    const overrideRepository = deps.overrideRepository || clientEntitlementOverrideRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;

    const result = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;

    const allServers = Array.isArray(options.allServers) ? options.allServers : servers.list();
    const serverScopeMode = String(policy.serverScopeMode || 'all').toLowerCase();
    let targetServers = [];
    if (serverScopeMode === 'all') {
        targetServers = allServers;
    } else if (serverScopeMode === 'selected') {
        const allowed = new Set(Array.isArray(policy.allowedServerIds) ? policy.allowedServerIds : []);
        targetServers = allServers.filter((item) => allowed.has(item.id));
    }
    if (targetServers.length === 0) return result;

    const protocolScopeMode = String(policy.protocolScopeMode || 'all').toLowerCase();
    let allowedProtocols = null;
    if (protocolScopeMode === 'selected') {
        allowedProtocols = new Set(Array.isArray(policy.allowedProtocols) ? policy.allowedProtocols : []);
    } else if (protocolScopeMode === 'none') {
        return result;
    }

    const allowedInboundKeys = Array.isArray(options.allowedInboundKeys) && options.allowedInboundKeys.length > 0
        ? new Set(options.allowedInboundKeys)
        : null;

    const sharedCredentials = {
        uuid: crypto.randomUUID(),
        password: crypto.randomBytes(16).toString('hex'),
        subId: buildStableSubId(email),
    };
    const baseEntitlement = resolvePolicyEntitlement(policy, options);

    for (const server of targetServers) {
        let panelContext;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error) {
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: `${error?.code === 'PANEL_INBOUND_LIST_FAILED' ? 'List inbounds failed' : 'Auth failed'}: ${error.message}`,
            });
            result.failed += 1;
            result.total += 1;
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;

        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!DEPLOY_CLIENT_PROTOCOLS.has(protocol)) continue;
            if (inbound.enable === false) continue;
            if (allowedProtocols && !allowedProtocols.has(protocol)) continue;
            if (allowedInboundKeys && !allowedInboundKeys.has(`${server.id}:${inbound.id}`)) continue;

            result.total += 1;

            try {
                const existingClients = parseInboundClients(inbound);
                const match = existingClients.find((item) => normalizeEmailInput(item.email) === email);

                if (match) {
                    const clientIdentifier = resolveClientIdentifier(match, protocol);
                    const override = overrideRepository.get(server.id, inbound.id, clientIdentifier);
                    const targetEntitlement = override || baseEntitlement;
                    const updatedClient = applyEntitlementToClient(match, targetEntitlement);

                    const isSameEntitlement = Number(updatedClient.expiryTime || 0) === Number(match.expiryTime || 0)
                        && Number(updatedClient.limitIp || 0) === Number(match.limitIp || 0)
                        && Number(updatedClient.totalGB || 0) === Number(match.totalGB || 0);

                    if (isSameEntitlement) {
                        result.skipped += 1;
                        result.details.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: inbound.id,
                            inboundRemark: inbound.remark || '',
                            protocol,
                            status: 'skipped',
                            reason: override ? 'override-up-to-date' : 'policy-up-to-date',
                        });
                        continue;
                    }

                    await postUpdateClient(client, inbound.id, clientIdentifier, updatedClient);
                    result.updated += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: override ? 'override-updated' : 'updated',
                    });
                    continue;
                }

                const clientData = buildManagedClientData({
                    email,
                    protocol,
                    inbound,
                    sharedCredentials,
                    entitlement: baseEntitlement,
                    resolveFlow: resolveDeployFlow,
                });

                await postAddClient(client, inbound.id, clientData);
                result.created += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'created',
                });
            } catch (error) {
                result.failed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'failed',
                    error: error.message,
                });
            }
        }
    }

    return result;
}

async function autoRemoveClients(subscriptionEmail, options = {}, deps = {}) {
    const servers = deps.serverRepository || serverRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;

    const result = { total: 0, removed: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;

    const allServers = Array.isArray(options.allServers) ? options.allServers : servers.list();
    for (const server of allServers) {
        let panelContext;
        try {
            panelContext = await listInbounds(server.id);
        } catch {
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;
        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!DEPLOY_CLIENT_PROTOCOLS.has(protocol)) continue;

            const existingClients = parseInboundClients(inbound);
            const match = existingClients.find((item) => normalizeEmailInput(item.email) === email);
            if (!match) continue;

            result.total += 1;
            try {
                const clientIdentifier = resolveClientIdentifier(match, protocol);
                await client.post(
                    `/panel/api/inbounds/${encodeURIComponent(inbound.id)}/delClient/${encodeURIComponent(clientIdentifier)}`
                );
                result.removed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'removed',
                });
            } catch (error) {
                result.failed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'failed',
                    error: error.message,
                });
            }
        }
    }

    return result;
}

async function provisionSubscriptionForUser(targetUser, payload = {}, actor = 'admin', deps = {}) {
    const users = deps.userRepository;
    const policies = deps.userPolicyRepository || userPolicyRepository;
    const servers = deps.serverRepository || serverRepository;
    const tokenRepo = deps.subscriptionTokenRepository || subscriptionTokenRepository;

    const requestedEmail = Object.prototype.hasOwnProperty.call(payload, 'subscriptionEmail')
        ? payload.subscriptionEmail
        : (targetUser.subscriptionEmail || targetUser.email);
    const subscriptionEmail = normalizeEmailInput(requestedEmail);

    const allowedServerIds = Array.isArray(payload.allowedServerIds)
        ? Array.from(new Set(payload.allowedServerIds.map((item) => String(item || '').trim()).filter(Boolean)))
        : [];
    const existingServerIds = new Set(servers.list().map((item) => item.id));
    const invalidServerIds = allowedServerIds.filter((item) => !existingServerIds.has(item));
    if (invalidServerIds.length > 0) {
        throw new Error(`Unknown server IDs: ${invalidServerIds.join(', ')}`);
    }

    const allowedProtocols = Array.isArray(payload.allowedProtocols)
        ? Array.from(new Set(
            payload.allowedProtocols
                .map((item) => String(item || '').trim().toLowerCase())
                .filter(Boolean)
        ))
        : [];

    let expiryTime = 0;
    const rawExpiryTime = Number(payload.expiryTime || 0);
    const rawExpiryDays = Number(payload.expiryDays || 0);
    if (rawExpiryTime > 0) {
        expiryTime = Math.floor(rawExpiryTime);
    } else if (rawExpiryDays > 0) {
        expiryTime = Date.now() + Math.floor(rawExpiryDays) * 24 * 60 * 60 * 1000;
    }

    const limitIp = normalizeNonNegativeInt(payload.limitIp, 0);
    const trafficLimitBytes = normalizeNonNegativeInt(payload.trafficLimitBytes, 0);
    const user = users.setSubscriptionEmail(targetUser.id, subscriptionEmail);
    const policy = policies.upsert(
        subscriptionEmail,
        {
            allowedServerIds,
            allowedProtocols,
            serverScopeMode: payload.serverScopeMode,
            protocolScopeMode: payload.protocolScopeMode,
            expiryTime,
            limitIp,
            trafficLimitBytes,
        },
        actor
    );
    const tokenState = ensurePersistentSubscriptionToken(subscriptionEmail, actor, {
        subscriptionTokenRepository: tokenRepo,
    });

    const allowedInboundKeys = Array.isArray(payload.allowedInboundKeys)
        ? payload.allowedInboundKeys.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    let deployment = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    try {
        deployment = await autoDeployClients(subscriptionEmail, policy, {
            expiryTime,
            limitIp,
            trafficLimitBytes,
            allowedInboundKeys,
            allServers: servers.list(),
        }, deps);
    } catch (error) {
        deployment.error = error.message || 'Auto-deploy failed';
    }

    return {
        user,
        policy,
        subscription: {
            email: subscriptionEmail,
            status: subscriptionEmail ? 'active' : 'pending',
            fetchPath: `/api/subscriptions/${encodeURIComponent(subscriptionEmail)}`,
            token: {
                currentTokenId: tokenState.metadata?.id || '',
                autoIssued: tokenState.autoIssued,
                issueError: tokenState.issueError,
            },
        },
        deployment,
        context: {
            subscriptionEmail,
            expiryTime,
            limitIp,
            trafficLimitBytes,
            allowedServerIds,
            allowedProtocols,
            tokenState,
        },
    };
}

export {
    autoDeployClients,
    autoRemoveClients,
    ensurePersistentSubscriptionToken,
    provisionSubscriptionForUser,
};
