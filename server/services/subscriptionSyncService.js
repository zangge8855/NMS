import crypto from 'crypto';
import {
    CLIENT_PROTOCOLS as DEPLOY_CLIENT_PROTOCOLS,
    PASSWORD_PROTOCOLS,
    UUID_PROTOCOLS,
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
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';
import { listPanelInbounds } from './panelGateway.js';

function normalizeEmailInput(value) {
    return String(value || '').trim().toLowerCase();
}

function collectManagedEmailCandidates(primaryEmail = '', aliases = []) {
    const extraValues = Array.isArray(aliases) ? aliases : [aliases];
    return Array.from(new Set(
        [primaryEmail, ...extraValues]
            .map((item) => normalizeEmailInput(item))
            .filter(Boolean)
    ));
}

function findManagedClientByEmail(clients = [], emailCandidates = []) {
    const wanted = new Set(collectManagedEmailCandidates('', emailCandidates));
    if (wanted.size === 0) return null;
    return (Array.isArray(clients) ? clients : []).find((item) => wanted.has(normalizeEmailInput(item?.email))) || null;
}

function shouldCanonicalizeManagedClientEmail(client = {}, canonicalEmail = '') {
    const normalizedCanonicalEmail = normalizeEmailInput(canonicalEmail);
    return Boolean(normalizedCanonicalEmail) && normalizeEmailInput(client?.email) !== normalizedCanonicalEmail;
}

function markServerPanelSnapshotStale(serverId = '') {
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) return;
    invalidateServerPanelSnapshotCache(normalizedServerId);
}

function buildScopeTokenName(serverId = '') {
    return `auto-persistent:${serverId || 'all'}`;
}

function buildRandomSubId() {
    return crypto.randomBytes(8).toString('hex');
}

function createSharedCredentials() {
    return {
        uuid: crypto.randomUUID(),
        password: crypto.randomBytes(16).toString('hex'),
        subId: buildRandomSubId(),
    };
}

function applyManagedCredentialsToClient(clientRecord, {
    email,
    protocol,
    inbound,
    sharedCredentials,
    entitlement,
    resolveFlow,
}) {
    const normalizedProtocol = String(protocol || '').toLowerCase();
    const payload = applyEntitlementToClient({
        ...clientRecord,
        email,
        enable: true,
        id: String(sharedCredentials.uuid || '').trim() || String(clientRecord?.id || '').trim(),
        subId: String(sharedCredentials.subId || '').trim() || String(clientRecord?.subId || '').trim(),
    }, entitlement);

    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        payload.flow = resolveFlow(normalizedProtocol, inbound);
    }
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        payload.password = String(sharedCredentials.password || '').trim() || String(clientRecord?.password || '').trim();
    }

    return payload;
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

function normalizeScopeMode(value, fallback = 'all') {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return fallback;
    if (text === 'selected' || text === 'none' || text === 'all') return text;
    return fallback;
}

function buildScopedPolicyMeta(policy = {}) {
    const allowedServerIds = new Set(
        Array.isArray(policy.allowedServerIds)
            ? policy.allowedServerIds.map((item) => String(item || '').trim()).filter(Boolean)
            : []
    );
    const allowedProtocols = new Set(
        Array.isArray(policy.allowedProtocols)
            ? policy.allowedProtocols.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
            : []
    );
    const allowedInboundKeys = new Set(
        Array.isArray(policy.allowedInboundKeys)
            ? policy.allowedInboundKeys.map((item) => String(item || '').trim()).filter(Boolean)
            : []
    );

    return {
        serverScopeMode: normalizeScopeMode(policy.serverScopeMode, allowedServerIds.size > 0 ? 'selected' : 'all'),
        protocolScopeMode: normalizeScopeMode(policy.protocolScopeMode, allowedProtocols.size > 0 ? 'selected' : 'all'),
        allowedServerIds,
        allowedProtocols,
        allowedInboundKeys,
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

function buildPanelListFailureMessage(error) {
    return `${error?.code === 'PANEL_INBOUND_LIST_FAILED' ? 'List inbounds failed' : 'Auth failed'}: ${error.message}`;
}

function createEmailMigrationResult(sourceEmail = '', targetEmail = '') {
    return {
        fromEmail: sourceEmail,
        toEmail: targetEmail,
        total: 0,
        updated: 0,
        failed: 0,
        rolledBack: 0,
        rollbackFailed: 0,
        details: [],
    };
}

async function migrateManagedSubscriptionEmail(sourceEmail, targetEmail, options = {}, deps = {}) {
    const servers = deps.serverRepository || serverRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const updateClient = deps.postUpdateClient || postUpdateClient;

    const fromEmail = normalizeEmailInput(sourceEmail);
    const toEmail = normalizeEmailInput(targetEmail);
    const result = createEmailMigrationResult(fromEmail, toEmail);
    if (!fromEmail || !toEmail || fromEmail === toEmail) {
        return result;
    }

    const allServers = Array.isArray(options.allServers) ? options.allServers : servers.list();
    const plannedMigrations = [];

    for (const server of allServers) {
        let panelContext;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error) {
            result.failed += 1;
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: buildPanelListFailureMessage(error),
            });
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;
        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!DEPLOY_CLIENT_PROTOCOLS.has(protocol)) continue;

            const existingClients = parseInboundClients(inbound);
            const sourceMatch = existingClients.find((item) => normalizeEmailInput(item.email) === fromEmail);
            if (!sourceMatch) continue;

            result.total += 1;
            const targetMatch = existingClients.find((item) => normalizeEmailInput(item.email) === toEmail);
            if (targetMatch) {
                result.failed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'failed',
                    error: 'target-email-client-exists',
                });
                continue;
            }

            plannedMigrations.push({
                serverId: server.id,
                serverName: server.name,
                inboundId: inbound.id,
                inboundRemark: inbound.remark || '',
                protocol,
                client,
                clientIdentifier: resolveClientIdentifier(sourceMatch, protocol),
                sourceClient: sourceMatch,
            });
        }
    }

    if (result.failed > 0) {
        return result;
    }

    const appliedMigrations = [];
    for (const item of plannedMigrations) {
        const nextClient = {
            ...item.sourceClient,
            email: toEmail,
        };

        try {
            await updateClient(item.client, item.inboundId, item.clientIdentifier, nextClient);
            appliedMigrations.push(item);
            result.updated += 1;
            result.details.push({
                serverId: item.serverId,
                serverName: item.serverName,
                inboundId: item.inboundId,
                inboundRemark: item.inboundRemark,
                protocol: item.protocol,
                status: 'migrated',
            });
        } catch (error) {
            result.failed += 1;
            result.details.push({
                serverId: item.serverId,
                serverName: item.serverName,
                inboundId: item.inboundId,
                inboundRemark: item.inboundRemark,
                protocol: item.protocol,
                status: 'failed',
                error: error.message || 'client-email-migration-failed',
            });
            break;
        }
    }

    if (result.failed === 0) {
        return result;
    }

    for (const item of [...appliedMigrations].reverse()) {
        try {
            await updateClient(item.client, item.inboundId, item.clientIdentifier, item.sourceClient);
            result.rolledBack += 1;
            result.details.push({
                serverId: item.serverId,
                serverName: item.serverName,
                inboundId: item.inboundId,
                inboundRemark: item.inboundRemark,
                protocol: item.protocol,
                status: 'rolled_back',
            });
        } catch (error) {
            result.rollbackFailed += 1;
            result.details.push({
                serverId: item.serverId,
                serverName: item.serverName,
                inboundId: item.inboundId,
                inboundRemark: item.inboundRemark,
                protocol: item.protocol,
                status: 'rollback_failed',
                error: error.message || 'client-email-rollback-failed',
            });
        }
    }

    return result;
}

async function autoDeployClients(subscriptionEmail, policy, options = {}, deps = {}) {
    const servers = deps.serverRepository || serverRepository;
    const overrideRepository = deps.overrideRepository || clientEntitlementOverrideRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const addClient = deps.postAddClient || postAddClient;
    const updateClient = deps.postUpdateClient || postUpdateClient;

    const result = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;
    const emailCandidates = collectManagedEmailCandidates(email, options.emailAliases);

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

    const sharedCredentials = options.sharedCredentials || createSharedCredentials();
    const baseEntitlement = resolvePolicyEntitlement(policy, options);
    const forceCredentialRotation = options.forceCredentialRotation === true;
    const clientEnabled = options.clientEnabled;

    for (const server of targetServers) {
        let panelContext;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error) {
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: buildPanelListFailureMessage(error),
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
                const match = findManagedClientByEmail(existingClients, emailCandidates);

                if (match) {
                    const clientIdentifier = resolveClientIdentifier(match, protocol);
                    const override = overrideRepository.get(server.id, inbound.id, clientIdentifier);
                    const targetEntitlement = override || baseEntitlement;
                    const updatedClientBase = forceCredentialRotation
                        ? applyManagedCredentialsToClient(match, {
                            email,
                            protocol,
                            inbound,
                            sharedCredentials,
                            entitlement: targetEntitlement,
                            resolveFlow: resolveDeployFlow,
                        })
                        : {
                            ...applyEntitlementToClient(match, targetEntitlement),
                            email,
                        };
                    const updatedClient = clientEnabled === undefined
                        ? updatedClientBase
                        : {
                            ...updatedClientBase,
                            enable: Boolean(clientEnabled),
                        };
                    const needsEmailCanonicalization = shouldCanonicalizeManagedClientEmail(match, email);

                    const isSameEntitlement = Number(updatedClient.expiryTime || 0) === Number(match.expiryTime || 0)
                        && Number(updatedClient.limitIp || 0) === Number(match.limitIp || 0)
                        && Number(updatedClient.totalGB || 0) === Number(match.totalGB || 0);
                    const isSameEnableState = clientEnabled === undefined
                        ? true
                        : ((match.enable !== false) === Boolean(clientEnabled));
                    const isSameCredentials = !forceCredentialRotation || (
                        String(updatedClient.id || '') === String(match.id || '')
                        && String(updatedClient.password || '') === String(match.password || '')
                        && String(updatedClient.subId || '') === String(match.subId || '')
                    );

                    if (isSameEntitlement && isSameCredentials && isSameEnableState && !needsEmailCanonicalization) {
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

                    await updateClient(client, inbound.id, clientIdentifier, updatedClient);
                    markServerPanelSnapshotStale(server.id);
                    result.updated += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: forceCredentialRotation
                            ? (override ? 'override-credentials-rotated' : 'credentials-rotated')
                            : (override ? 'override-updated' : 'updated'),
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
                if (clientEnabled !== undefined) {
                    clientData.enable = Boolean(clientEnabled);
                }

                await addClient(client, inbound.id, clientData);
                markServerPanelSnapshotStale(server.id);
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

async function rotateManagedSubscriptionCredentials(subscriptionEmail, policy = {}, options = {}, deps = {}) {
    const normalizedEmail = normalizeEmailInput(subscriptionEmail);
    if (!normalizedEmail) {
        return {
            total: 0,
            created: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            details: [],
            sharedCredentials: null,
        };
    }

    const sharedCredentials = options.sharedCredentials || createSharedCredentials();
    const deployment = await autoDeployClients(normalizedEmail, policy, {
        ...options,
        sharedCredentials,
        forceCredentialRotation: true,
    }, deps);

    return {
        ...deployment,
        sharedCredentials,
    };
}

async function autoRemoveClients(subscriptionEmail, options = {}, deps = {}) {
    const servers = deps.serverRepository || serverRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;

    const result = { total: 0, removed: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;
    const emailCandidates = collectManagedEmailCandidates(email, options.emailAliases);

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
            const match = findManagedClientByEmail(existingClients, emailCandidates);
            if (!match) continue;

            result.total += 1;
            try {
                const clientIdentifier = resolveClientIdentifier(match, protocol);
                await client.post(
                    `/panel/api/inbounds/${encodeURIComponent(inbound.id)}/delClient/${encodeURIComponent(clientIdentifier)}`
                );
                markServerPanelSnapshotStale(server.id);
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

async function autoSetManagedClientsEnabled(subscriptionEmail, enabled, options = {}, deps = {}) {
    const servers = deps.serverRepository || serverRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const updateClient = deps.postUpdateClient || postUpdateClient;

    const result = { total: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;
    const emailCandidates = collectManagedEmailCandidates(email, options.emailAliases);

    const allServers = Array.isArray(options.allServers) ? options.allServers : servers.list();
    const scopedPolicy = buildScopedPolicyMeta(options.policy || {});
    for (const server of allServers) {
        let panelContext;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error) {
            result.failed += 1;
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: buildPanelListFailureMessage(error),
            });
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;
        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!DEPLOY_CLIENT_PROTOCOLS.has(protocol)) continue;
            if (enabled && inbound.enable === false) continue;

            const existingClients = parseInboundClients(inbound);
            const match = findManagedClientByEmail(existingClients, emailCandidates);
            if (!match) continue;

            result.total += 1;
            if (enabled) {
                if (scopedPolicy.serverScopeMode === 'none' || scopedPolicy.protocolScopeMode === 'none') {
                    result.skipped += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: 'skipped',
                        reason: 'blocked-by-policy',
                    });
                    continue;
                }
                if (scopedPolicy.serverScopeMode === 'selected' && !scopedPolicy.allowedServerIds.has(server.id)) {
                    result.skipped += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: 'skipped',
                        reason: 'server-not-allowed',
                    });
                    continue;
                }
                if (scopedPolicy.protocolScopeMode === 'selected' && !scopedPolicy.allowedProtocols.has(protocol)) {
                    result.skipped += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: 'skipped',
                        reason: 'protocol-not-allowed',
                    });
                    continue;
                }
                if (scopedPolicy.allowedInboundKeys.size > 0 && !scopedPolicy.allowedInboundKeys.has(`${server.id}:${inbound.id}`)) {
                    result.skipped += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: 'skipped',
                        reason: 'inbound-not-allowed',
                    });
                    continue;
                }
            }
            const needsEmailCanonicalization = shouldCanonicalizeManagedClientEmail(match, email);
            if ((match.enable !== false) === Boolean(enabled) && !needsEmailCanonicalization) {
                result.skipped += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'skipped',
                    reason: enabled ? 'already-enabled' : 'already-disabled',
                });
                continue;
            }

            try {
                const clientIdentifier = resolveClientIdentifier(match, protocol);
                await updateClient(client, inbound.id, clientIdentifier, {
                    ...match,
                    email,
                    enable: Boolean(enabled),
                });
                markServerPanelSnapshotStale(server.id);
                result.updated += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: enabled ? 'enabled' : 'disabled',
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

    const allowedInboundKeys = Array.isArray(payload.allowedInboundKeys)
        ? payload.allowedInboundKeys.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const limitIp = normalizeNonNegativeInt(payload.limitIp, 0);
    const trafficLimitBytes = normalizeNonNegativeInt(payload.trafficLimitBytes, 0);
    const user = users.setSubscriptionEmail(targetUser.id, subscriptionEmail);
    const policy = policies.upsert(
        subscriptionEmail,
        {
            allowedServerIds,
            allowedProtocols,
            allowedInboundKeys,
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

    let deployment = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    try {
        deployment = await autoDeployClients(subscriptionEmail, policy, {
            expiryTime,
            limitIp,
            trafficLimitBytes,
            allowedInboundKeys,
            allServers: servers.list(),
            clientEnabled: targetUser?.enabled !== false,
            emailAliases: [targetUser?.email, targetUser?.subscriptionEmail],
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
    autoSetManagedClientsEnabled,
    createSharedCredentials,
    ensurePersistentSubscriptionToken,
    migrateManagedSubscriptionEmail,
    provisionSubscriptionForUser,
    rotateManagedSubscriptionCredentials,
};
