import crypto from 'crypto';
import {
    PASSWORD_PROTOCOLS,
    UUID_PROTOCOLS,
    applyEntitlementToClient,
    applyExtraProtocolCredentials,
    buildManagedClientData,
    normalizeNonNegativeInt,
    parseInboundClients,
    postAddClient,
    postUpdateClient,
    resolveClientIdentifier,
    resolveShadowsocksPassword,
} from '../lib/clientEntitlements.js';
import clientEntitlementOverrideRepository from '../repositories/clientEntitlementOverrideRepository.js';
import serverRepository from '../repositories/serverRepository.js';
import subscriptionTokenRepository from '../repositories/subscriptionTokenRepository.js';
import userGroupRepository from '../repositories/userGroupRepository.js';
import userPolicyRepository from '../repositories/userPolicyRepository.js';
import userRepository from '../repositories/userRepository.js';
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';
import { postDeleteClientFromInboundCompat } from '../lib/panelApiCompat.js';
import { listPanelInbounds } from './panelGateway.js';
import { isManagedClientProtocol, isSuiPanelContext } from '../lib/clientProtocols.js';
import {
    isInboundAllowedByPolicy,
    isProtocolAllowedByPolicy,
    isServerAllowedByPolicy,
    resolveEffectivePolicy,
} from '../lib/userPolicyResolver.js';

function redactCredentials(message: unknown): any {
    if (typeof message !== 'string') return message;
    let sanitized = message.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '[REDACTED_UUID]');
    sanitized = sanitized.replace(/\/delClient\/[^/\s?]+/g, '/delClient/[REDACTED]');
    return sanitized;
}

function normalizeEmailInput(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function collectManagedEmailCandidates(primaryEmail: string = '', aliases: any = []): string[] {
    const extraValues = Array.isArray(aliases) ? aliases : [aliases];
    return Array.from(new Set(
        [primaryEmail, ...extraValues]
            .map((item) => normalizeEmailInput(item))
            .filter(Boolean)
    ));
}

function findManagedClientByEmail(clients: any[] = [], emailCandidates: string[] = []) {
    const wanted = new Set(collectManagedEmailCandidates('', emailCandidates));
    if (wanted.size === 0) return null;
    return (Array.isArray(clients) ? clients : []).find((item) => wanted.has(normalizeEmailInput(item?.email))) || null;
}

function normalizeExtraClientsForInbound(extraClients: any = [], serverId: string = '', inboundId: unknown = ''): any[] {
    if (!Array.isArray(extraClients) || extraClients.length === 0) return [];
    const sid = String(serverId || '').trim();
    const iid = String(inboundId ?? '').trim();
    return extraClients.filter((binding: any) => {
        if (!binding || typeof binding !== 'object') return false;
        const bindingServerId = String(binding.serverId || '').trim();
        const bindingInboundId = String(binding.inboundId || '').trim();
        const bindingEmail = normalizeEmailInput(binding.clientEmail);
        if (!bindingEmail) return false;
        if (bindingServerId && bindingServerId !== sid) return false;
        if (bindingInboundId && iid && bindingInboundId !== iid) return false;
        return true;
    });
}

function collectManagedClientsForInbound(
    clients: any[] = [],
    {
        emailCandidates = [],
        extraBindings = [],
        onlyExtraClients = false,
        protocol = '',
    }: {
        emailCandidates?: string[];
        extraBindings?: any[];
        onlyExtraClients?: boolean;
        protocol?: string;
    } = {}
): Array<{ client: any; isExtra: boolean; binding: any | null }> {
    const wantedPrimary = new Set(onlyExtraClients ? [] : collectManagedEmailCandidates('', emailCandidates));
    const extraByEmail = new Map<string, any>();
    (Array.isArray(extraBindings) ? extraBindings : []).forEach((binding) => {
        const key = normalizeEmailInput(binding?.clientEmail);
        if (key && !extraByEmail.has(key)) {
            extraByEmail.set(key, binding);
        }
    });

    const matched: Array<{ client: any; isExtra: boolean; binding: any | null }> = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(clients) ? clients : []) {
        const keyEmail = normalizeEmailInput(item?.email);
        const isPrimary = !onlyExtraClients && Boolean(keyEmail) && wantedPrimary.has(keyEmail);
        const matchedBinding = !isPrimary && Boolean(keyEmail) ? (extraByEmail.get(keyEmail) || null) : null;
        if (!isPrimary && !matchedBinding) continue;

        const dedupKey = `${resolveClientIdentifier(item, protocol)}:${keyEmail}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        matched.push({
            client: item,
            isExtra: !isPrimary,
            binding: matchedBinding,
        });
    }
    return matched;
}

function shouldCanonicalizeManagedClientEmail(client: any = {}, canonicalEmail: string = ''): boolean {
    const normalizedCanonicalEmail = normalizeEmailInput(canonicalEmail);
    return Boolean(normalizedCanonicalEmail) && normalizeEmailInput(client?.email) !== normalizedCanonicalEmail;
}

// Panels match client names case-sensitively, so updates keep the stored
// spelling (e.g. `PH-x`) unless the name really changes, instead of
// silently renaming the client to NMS's lowercased subscription email.
function resolveManagedClientEmail(client: any = {}, canonicalEmail: string = ''): string {
    if (shouldCanonicalizeManagedClientEmail(client, canonicalEmail)) return canonicalEmail;
    return String(client?.email || '').trim() || canonicalEmail;
}

function markServerPanelSnapshotStale(serverId: string = ''): void {
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) return;
    invalidateServerPanelSnapshotCache(normalizedServerId);
}

function buildScopeTokenName(serverId: string = ''): string {
    return `auto-persistent:${serverId || 'all'}`;
}

function buildRandomSubId(): string {
    return crypto.randomBytes(8).toString('hex');
}

function createSharedCredentials() {
    return {
        uuid: crypto.randomUUID(),
        password: crypto.randomBytes(16).toString('hex'),
        ss2022Key16: crypto.randomBytes(16).toString('base64'),
        ss2022Key32: crypto.randomBytes(32).toString('base64'),
        subId: buildRandomSubId(),
    };
}

function applyManagedCredentialsToClient(clientRecord: any, {
    email,
    protocol,
    inbound,
    sharedCredentials,
    entitlement,
    resolveFlow,
}: {
    email: string;
    protocol: string;
    inbound: any;
    sharedCredentials: any;
    entitlement: any;
    resolveFlow: (protocol: string, inbound: any) => string;
}) {
    const normalizedProtocol = String(protocol || '').toLowerCase();
    const resolvedUuid = String(sharedCredentials.uuid || '').trim() || String(clientRecord?.id || clientRecord?.uuid || '').trim();
    const payload = applyEntitlementToClient({
        ...clientRecord,
        email,
        enable: true,
        id: resolvedUuid,
        ...(normalizedProtocol === 'tuic' && resolvedUuid ? { uuid: resolvedUuid } : {}),
        subId: String(sharedCredentials.subId || '').trim() || String(clientRecord?.subId || '').trim(),
    }, entitlement);

    if (normalizedProtocol === 'vmess' || normalizedProtocol === 'vless') {
        payload.flow = resolveFlow(normalizedProtocol, inbound);
    }
    // s-ui clients hold one password for every protocol, so keep it in step even on uuid inbounds.
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol) || isSuiPanelContext(inbound)) {
        const nextPassword = normalizedProtocol === 'shadowsocks' && !isSuiPanelContext(inbound)
            ? resolveShadowsocksPassword(inbound, sharedCredentials, clientRecord)
            : String(sharedCredentials.password || '').trim();
        payload.password = nextPassword || String(clientRecord?.password || '').trim();
    }
    if (isSuiPanelContext(inbound)) {
        const ss2022Key16 = String(sharedCredentials.ss2022Key16 || '').trim();
        const ss2022Key32 = String(sharedCredentials.ss2022Key32 || '').trim();
        if (ss2022Key16) payload.ss2022Key16 = ss2022Key16;
        if (ss2022Key32) payload.ss2022Key32 = ss2022Key32;
    } else {
        applyExtraProtocolCredentials(payload, normalizedProtocol, String(sharedCredentials.password || '').trim(), clientRecord || {});
    }

    return payload;
}

function resolveDeployFlow(protocol: string, inbound: any): string {
    if (protocol !== 'vless') return '';
    let stream: any = {};
    try {
        stream = typeof inbound.streamSettings === 'string'
            ? JSON.parse(inbound.streamSettings)
            : (inbound.streamSettings || {});
    } catch { /* ignore */ }
    const network = String(stream.network || '').toLowerCase();
    const security = String(stream.security || '').toLowerCase();
    if ((!network || network === 'tcp' || network === 'raw') && (security === 'reality' || security === 'tls')) {
        return 'xtls-rprx-vision';
    }
    return '';
}

function resolvePolicyEntitlement(policy: any = {}, options: any = {}) {
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
        speedLimitUp: normalizeNonNegativeInt(
            options.speedLimitUp,
            normalizeNonNegativeInt(policy.speedLimitUp, 0)
        ),
        speedLimitDown: normalizeNonNegativeInt(
            options.speedLimitDown,
            normalizeNonNegativeInt(policy.speedLimitDown, 0)
        ),
        tgId: options.tgId !== undefined ? Number(options.tgId) || 0 : (Number(policy.tgId) || 0),
        group: options.group !== undefined ? String(options.group || '').trim() : String(policy.group || '').trim(),
        comment: options.comment !== undefined ? String(options.comment || '').trim() : String(policy.comment || '').trim(),
        reset: options.reset !== undefined ? Number(options.reset) || 0 : (Number(policy.reset) || 0),
    };
}

function normalizeScopeMode(value: unknown, fallback: string = 'all'): string {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return fallback;
    if (text === 'selected' || text === 'none' || text === 'all') return text;
    return fallback;
}

function buildScopedPolicyMeta(policy: any = {}) {
    const allowedServerIds = new Set(
        Array.isArray(policy.allowedServerIds)
            ? policy.allowedServerIds.map((item: any) => String(item || '').trim()).filter(Boolean)
            : []
    );
    const allowedProtocols = new Set(
        Array.isArray(policy.allowedProtocols)
            ? policy.allowedProtocols.map((item: any) => String(item || '').trim().toLowerCase()).filter(Boolean)
            : []
    );
    const allowedInboundKeys = new Set(
        Array.isArray(policy.allowedInboundKeys)
            ? policy.allowedInboundKeys.map((item: any) => String(item || '').trim()).filter(Boolean)
            : []
    );
    const blockedServerIds = new Set(
        Array.isArray(policy.blockedServerIds)
            ? policy.blockedServerIds.map((item: any) => String(item || '').trim()).filter(Boolean)
            : []
    );
    const blockedInboundKeys = new Set(
        Array.isArray(policy.blockedInboundKeys)
            ? policy.blockedInboundKeys.map((item: any) => String(item || '').trim()).filter(Boolean)
            : []
    );

    return {
        serverScopeMode: normalizeScopeMode(policy.serverScopeMode, allowedServerIds.size > 0 ? 'selected' : 'all'),
        protocolScopeMode: normalizeScopeMode(policy.protocolScopeMode, allowedProtocols.size > 0 ? 'selected' : 'all'),
        allowedServerIds,
        allowedProtocols,
        allowedInboundKeys,
        blockedServerIds,
        blockedInboundKeys,
    };
}

function ensurePersistentSubscriptionToken(email: string, actor: string = 'admin', deps: any = {}) {
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
    } catch (error: any) {
        return {
            metadata: null,
            autoIssued: false,
            issueError: error.message || 'Failed to issue persistent token',
        };
    }
}

function buildPanelListFailureMessage(error: any): string {
    const reason = String(error?.message || '').trim();
    const prefix = error?.code === 'PANEL_INBOUND_LIST_FAILED'
        ? '节点入站列表读取失败，请确认节点在线并重试'
        : '节点认证失败，请重新保存面板用户名/密码';
    return reason ? `${prefix}：${reason}` : prefix;
}

function createEmailMigrationResult(sourceEmail: string = '', targetEmail: string = '') {
    return {
        fromEmail: sourceEmail,
        toEmail: targetEmail,
        total: 0,
        updated: 0,
        failed: 0,
        rolledBack: 0,
        rollbackFailed: 0,
        details: [] as any[],
    };
}

async function migrateManagedSubscriptionEmail(sourceEmail: string, targetEmail: string, options: any = {}, deps: any = {}): Promise<any> {
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
    const plannedMigrations: any[] = [];

    for (const server of allServers) {
        let panelContext: any;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error) {
            result.failed += 1;
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: redactCredentials(buildPanelListFailureMessage(error)),
            });
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;
        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!isManagedClientProtocol(protocol, inbound)) continue;

            const existingClients = parseInboundClients(inbound);
            const sourceMatch = existingClients.find((item: any) => normalizeEmailInput(item.email) === fromEmail);
            if (!sourceMatch) continue;

            result.total += 1;
            const targetMatch = existingClients.find((item: any) => normalizeEmailInput(item.email) === toEmail);
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

    const appliedMigrations: any[] = [];
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
        } catch (error: any) {
            result.failed += 1;
            result.details.push({
                serverId: item.serverId,
                serverName: item.serverName,
                inboundId: item.inboundId,
                inboundRemark: item.inboundRemark,
                protocol: item.protocol,
                status: 'failed',
                error: redactCredentials(error.message || 'client-email-migration-failed'),
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
        } catch (error: any) {
            result.rollbackFailed += 1;
            result.details.push({
                serverId: item.serverId,
                serverName: item.serverName,
                inboundId: item.inboundId,
                inboundRemark: item.inboundRemark,
                protocol: item.protocol,
                status: 'rollback_failed',
                error: redactCredentials(error.message || 'client-email-rollback-failed'),
            });
        }
    }

    return result;
}

async function autoDeployClients(subscriptionEmail: string, policy: any, options: any = {}, deps: any = {}): Promise<any> {
    const servers = deps.serverRepository || serverRepository;
    const overrideRepository = deps.overrideRepository || clientEntitlementOverrideRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const addClient = deps.postAddClient || postAddClient;
    const updateClient = deps.postUpdateClient || postUpdateClient;

    const result: any = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    if (!email) return result;
    const emailCandidates = collectManagedEmailCandidates(email, options.emailAliases);

    const allServers = Array.isArray(options.allServers) ? options.allServers : servers.list();
    const allowedInboundKeys = Array.isArray(options.allowedInboundKeys) && options.allowedInboundKeys.length > 0
        ? new Set(options.allowedInboundKeys)
        : null;

    const sharedCredentials = options.sharedCredentials || createSharedCredentials();
    const baseEntitlement = resolvePolicyEntitlement(policy, options);
    const forcedExpiryTime = options.forceExpiryTime === undefined
        ? undefined
        : normalizeNonNegativeInt(options.forceExpiryTime, 0);
    const forceCredentialRotation = options.forceCredentialRotation === true;
    const clientEnabled = options.clientEnabled;
    const protocolScopeMode = String(policy.protocolScopeMode || 'all').toLowerCase();
    const isGlobalProtocolDenied = protocolScopeMode === 'none';

    for (const server of allServers) {
        const isServerAllowed = isServerAllowedByPolicy(policy, server.id);

        let panelContext: any;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error) {
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: redactCredentials(buildPanelListFailureMessage(error)),
            });
            result.failed += 1;
            result.total += 1;
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;

        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!isManagedClientProtocol(protocol, inbound)) continue;

            const isProtocolAllowed = !isGlobalProtocolDenied && isProtocolAllowedByPolicy(policy, protocol);
            const isInboundInDeploymentScope = !allowedInboundKeys || allowedInboundKeys.has(`${server.id}:${inbound.id}`);
            const isPolicyInboundAllowed = isInboundAllowedByPolicy(policy, server.id, inbound.id);
            const isPolicyAllowed = isServerAllowed && isProtocolAllowed && isPolicyInboundAllowed;

            const existingClients = parseInboundClients(inbound);
            const match = findManagedClientByEmail(existingClients, emailCandidates);

            if (!isPolicyAllowed) {
                if (match) {
                    result.total += 1;
                    try {
                        const clientIdentifier = resolveClientIdentifier(match, protocol);
                        await postDeleteClientFromInboundCompat(client, inbound.id, clientIdentifier, {
                            email: match.email,
                            protocol,
                            sourceClient: match,
                        });
                        markServerPanelSnapshotStale(server.id);
                        result.removed = (result.removed || 0) + 1;
                        result.details.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: inbound.id,
                            inboundRemark: inbound.remark || '',
                            protocol,
                            status: 'removed',
                            reason: 'excluded-by-policy',
                        });
                    } catch (error: any) {
                        result.failed += 1;
                        result.details.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: inbound.id,
                            inboundRemark: inbound.remark || '',
                            protocol,
                            status: 'failed',
                            error: redactCredentials(error.message),
                        });
                    }
                }
                continue;
            }

            if (!isInboundInDeploymentScope) continue;

            if (inbound.enable === false) continue;

            result.total += 1;

            try {
                if (match) {
                    const clientIdentifier = resolveClientIdentifier(match, protocol);
                    const clientEmail = resolveManagedClientEmail(match, email);
                    const override = overrideRepository.get(server.id, inbound.id, clientIdentifier);
                    const targetEntitlement = forcedExpiryTime === undefined
                        ? (override || baseEntitlement)
                        : {
                            ...(override || baseEntitlement),
                            expiryTime: forcedExpiryTime,
                        };
                    const updatedClientBase = forceCredentialRotation
                        ? applyManagedCredentialsToClient(match, {
                            email: clientEmail,
                            protocol,
                            inbound,
                            sharedCredentials,
                            entitlement: targetEntitlement,
                            resolveFlow: resolveDeployFlow,
                        })
                        : {
                            ...applyEntitlementToClient(match, targetEntitlement),
                            email: clientEmail,
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
                        && Number(updatedClient.totalGB || 0) === Number(match.totalGB || 0)
                        && Number(updatedClient.speedLimitUp || 0) === Number(match.speedLimitUp || 0)
                        && Number(updatedClient.speedLimitDown || 0) === Number(match.speedLimitDown || 0)
                        && Number(updatedClient.tgId || 0) === Number(match.tgId || 0)
                        && String(updatedClient.group || '') === String(match.group || '')
                        && String(updatedClient.comment || '') === String(match.comment || '')
                        && Number(updatedClient.reset || 0) === Number(match.reset || 0);
                    const isSameEnableState = clientEnabled === undefined
                        ? true
                        : ((match.enable !== false) === Boolean(clientEnabled));
                    const isSameCredentials = !forceCredentialRotation || (
                        String(updatedClient.id || updatedClient.uuid || '') === String(match.id || match.uuid || '')
                        && String(updatedClient.password || '') === String(match.password || '')
                        && String(updatedClient.subId || '') === String(match.subId || '')
                        && !(
                            isSuiPanelContext(inbound)
                            && protocol === 'shadowsocks'
                            && (updatedClient.ss2022Key16 || updatedClient.ss2022Key32)
                            && resolveShadowsocksPassword(inbound, sharedCredentials, match) !== String(match.password || '')
                        )
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

                    await updateClient(client, inbound.id, clientIdentifier, updatedClient, { protocol });
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
                    entitlement: forcedExpiryTime === undefined
                        ? baseEntitlement
                        : {
                            ...baseEntitlement,
                            expiryTime: forcedExpiryTime,
                        },
                    resolveFlow: resolveDeployFlow,
                });
                if (clientEnabled !== undefined) {
                    clientData.enable = Boolean(clientEnabled);
                }

                await addClient(client, inbound.id, clientData, { protocol });
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
            } catch (error: any) {
                result.failed += 1;
                result.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    inboundId: inbound.id,
                    inboundRemark: inbound.remark || '',
                    protocol,
                    status: 'failed',
                    error: redactCredentials(error.message),
                });
            }
        }
    }

    return result;
}

async function rotateManagedSubscriptionCredentials(subscriptionEmail: string, policy: any = {}, options: any = {}, deps: any = {}): Promise<any> {
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

    const usersRepo = deps.userRepository || userRepository;
    const serversRepo = deps.serverRepository || serverRepository;
    const overrideRepository = deps.overrideRepository || clientEntitlementOverrideRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const updateClient = deps.postUpdateClient || postUpdateClient;

    const ownerUser = !Array.isArray(options.extraClients)
        ? (usersRepo?.getBySubscriptionEmail?.(normalizedEmail) || usersRepo?.getByEmail?.(normalizedEmail) || null)
        : null;
    const rawExtraClients = Array.isArray(options.extraClients)
        ? options.extraClients
        : (Array.isArray(ownerUser?.extraClients) ? ownerUser.extraClients : []);
    const targetServerFilter = String(options.serverId || '').trim();
    const scopedExtraClients = targetServerFilter
        ? rawExtraClients.filter((item: any) => String(item?.serverId || '').trim() === targetServerFilter)
        : rawExtraClients;

    if (scopedExtraClients.length > 0) {
        const allServers = Array.isArray(options.allServers) ? options.allServers : serversRepo.list();
        const serverMap = new Map(allServers.map((srv: any) => [String(srv?.id || '').trim(), srv]));
        const byServer = new Map<string, any[]>();
        scopedExtraClients.forEach((binding: any) => {
            const sid = String(binding?.serverId || '').trim();
            if (!sid) return;
            const list = byServer.get(sid) || [];
            list.push(binding);
            byServer.set(sid, list);
        });

        for (const [serverId, bindings] of byServer.entries()) {
            const server: any = serverMap.get(serverId);
            if (!server) continue;
            let panelContext: any;
            try {
                panelContext = await listInbounds(server.id);
            } catch (error) {
                deployment.failed += 1;
                deployment.total += 1;
                deployment.details.push({
                    serverId: server.id,
                    serverName: server.name,
                    status: 'failed',
                    error: redactCredentials(buildPanelListFailureMessage(error)),
                });
                continue;
            }

            const panelClient = panelContext.client;
            const inbounds = Array.isArray(panelContext.inbounds) ? panelContext.inbounds : [];
            for (const inbound of inbounds) {
                const protocol = String(inbound.protocol || '').toLowerCase();
                if (!isManagedClientProtocol(protocol, inbound)) continue;
                const inboundBindings = normalizeExtraClientsForInbound(bindings, server.id, inbound.id);
                if (inboundBindings.length === 0) continue;

                const existingClients = parseInboundClients(inbound);
                const matchedItems = collectManagedClientsForInbound(existingClients, {
                    extraBindings: inboundBindings,
                    onlyExtraClients: true,
                    protocol,
                });

                for (const matched of matchedItems) {
                    const match = matched.client;
                    deployment.total += 1;
                    try {
                        const oldIdentifier = resolveClientIdentifier(match, protocol);
                        const existingOverride = overrideRepository?.get?.(server.id, inbound.id, oldIdentifier) || null;
                        const preservedEntitlement = existingOverride || {
                            expiryTime: normalizeNonNegativeInt(match.expiryTime, 0),
                            limitIp: normalizeNonNegativeInt(match.limitIp, 0),
                            trafficLimitBytes: normalizeNonNegativeInt(match.totalGB, 0),
                            speedLimitUp: normalizeNonNegativeInt(match.speedLimitUp, 0),
                            speedLimitDown: normalizeNonNegativeInt(match.speedLimitDown, 0),
                            tgId: Number(match.tgId) || 0,
                            group: String(match.group || '').trim(),
                            comment: String(match.comment || '').trim(),
                            reset: Number(match.reset) || 0,
                        };
                        const freshExtraCredentials = createSharedCredentials();
                        const rotatedClient = applyManagedCredentialsToClient(match, {
                            email: String(match.email || '').trim(),
                            protocol,
                            inbound,
                            sharedCredentials: freshExtraCredentials,
                            entitlement: preservedEntitlement,
                            resolveFlow: resolveDeployFlow,
                        });
                        rotatedClient.enable = match.enable !== false;

                        await updateClient(panelClient, inbound.id, oldIdentifier, rotatedClient, { protocol });
                        const nextIdentifier = resolveClientIdentifier(rotatedClient, protocol);
                        if (existingOverride && nextIdentifier && nextIdentifier !== oldIdentifier) {
                            overrideRepository.remove(server.id, String(inbound.id), oldIdentifier);
                            overrideRepository.upsert({
                                ...existingOverride,
                                serverId: server.id,
                                inboundId: String(inbound.id),
                                clientIdentifier: nextIdentifier,
                                email: String(match.email || '').trim(),
                            }, 'credential-rotation');
                        }
                        markServerPanelSnapshotStale(server.id);
                        deployment.updated += 1;
                        deployment.details.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: inbound.id,
                            inboundRemark: inbound.remark || '',
                            protocol,
                            status: 'extra-credentials-rotated',
                        });
                    } catch (error: any) {
                        deployment.failed += 1;
                        deployment.details.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: inbound.id,
                            inboundRemark: inbound.remark || '',
                            protocol,
                            status: 'failed',
                            error: redactCredentials(error.message),
                        });
                    }
                }
            }
        }
    }

    return {
        ...deployment,
        sharedCredentials,
    };
}

async function autoRemoveClients(subscriptionEmail: string, options: any = {}, deps: any = {}): Promise<any> {
    const servers = deps.serverRepository || serverRepository;
    const overrideRepository = deps.overrideRepository || clientEntitlementOverrideRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;

    const result: any = { total: 0, removed: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    const extraClients = Array.isArray(options.extraClients) ? options.extraClients : [];
    if (!email && extraClients.length === 0) return result;
    const emailCandidates = collectManagedEmailCandidates(email, options.emailAliases);

    const allServers = Array.isArray(options.allServers) ? options.allServers : servers.list();
    for (const server of allServers) {
        let panelContext: any;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error: any) {
            // Record unreachable panels instead of skipping silently: the
            // client credentials stay live on that node until a later sync.
            result.failed += 1;
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                reason: redactCredentials(`panel-unreachable: ${String(error?.message || error)}`),
            });
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;
        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!isManagedClientProtocol(protocol, inbound)) continue;

            const existingClients = parseInboundClients(inbound);
            const inboundExtraBindings = normalizeExtraClientsForInbound(extraClients, server.id, inbound.id);
            const matchedItems = collectManagedClientsForInbound(existingClients, {
                emailCandidates,
                extraBindings: inboundExtraBindings,
                onlyExtraClients: !email,
                protocol,
            });
            if (matchedItems.length === 0) continue;

            for (const matched of matchedItems) {
                const match = matched.client;
                result.total += 1;
                try {
                    const clientIdentifier = resolveClientIdentifier(match, protocol);
                    await postDeleteClientFromInboundCompat(client, inbound.id, clientIdentifier, {
                        email: match.email,
                        protocol,
                        sourceClient: match,
                    });
                    if (clientIdentifier && typeof overrideRepository?.remove === 'function') {
                        overrideRepository.remove(server.id, String(inbound.id), clientIdentifier);
                    }
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
                } catch (error: any) {
                    result.failed += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: 'failed',
                        error: redactCredentials(error.message),
                    });
                }
            }
        }
    }

    return result;
}

async function autoSetManagedClientsEnabled(subscriptionEmail: string, enabled: boolean, options: any = {}, deps: any = {}): Promise<any> {
    const servers = deps.serverRepository || serverRepository;
    const listInbounds = deps.listPanelInbounds || listPanelInbounds;
    const updateClient = deps.postUpdateClient || postUpdateClient;

    const result: any = { total: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    const email = normalizeEmailInput(subscriptionEmail);
    const extraClients = Array.isArray(options.extraClients) ? options.extraClients : [];
    const onlyExtraClients = options.onlyExtraClients === true;
    if (!email && extraClients.length === 0) return result;
    const emailCandidates = collectManagedEmailCandidates(email, options.emailAliases);

    const allServers = Array.isArray(options.allServers) ? options.allServers : servers.list();
    const scopedPolicy = buildScopedPolicyMeta(options.policy || {});
    for (const server of allServers) {
        let panelContext: any;
        try {
            panelContext = await listInbounds(server.id);
        } catch (error) {
            result.failed += 1;
            result.details.push({
                serverId: server.id,
                serverName: server.name,
                status: 'failed',
                error: redactCredentials(buildPanelListFailureMessage(error)),
            });
            continue;
        }

        const client = panelContext.client;
        const inbounds = panelContext.inbounds;
        for (const inbound of inbounds) {
            const protocol = String(inbound.protocol || '').toLowerCase();
            if (!isManagedClientProtocol(protocol, inbound)) continue;
            if (enabled && inbound.enable === false) continue;

            const existingClients = parseInboundClients(inbound);
            const inboundExtraBindings = normalizeExtraClientsForInbound(extraClients, server.id, inbound.id);
            const matchedItems = collectManagedClientsForInbound(existingClients, {
                emailCandidates,
                extraBindings: inboundExtraBindings,
                onlyExtraClients,
                protocol,
            });
            if (matchedItems.length === 0) continue;

            for (const matched of matchedItems) {
                const match = matched.client;
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
                    if (scopedPolicy.blockedServerIds.has(server.id)) {
                        result.skipped += 1;
                        result.details.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: inbound.id,
                            inboundRemark: inbound.remark || '',
                            protocol,
                            status: 'skipped',
                            reason: 'server-blocked',
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
                    if (scopedPolicy.blockedInboundKeys.has(`${server.id}:${inbound.id}`)) {
                        result.skipped += 1;
                        result.details.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: inbound.id,
                            inboundRemark: inbound.remark || '',
                            protocol,
                            status: 'skipped',
                            reason: 'inbound-blocked',
                        });
                        continue;
                    }
                }
                const needsEmailCanonicalization = !matched.isExtra && shouldCanonicalizeManagedClientEmail(match, email);
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
                        email: matched.isExtra
                            ? String(match.email || '').trim()
                            : resolveManagedClientEmail(match, email),
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
                } catch (error: any) {
                    result.failed += 1;
                    result.details.push({
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: inbound.id,
                        inboundRemark: inbound.remark || '',
                        protocol,
                        status: 'failed',
                        error: redactCredentials(error.message),
                    });
                }
            }
        }
    }

    return result;
}

async function provisionSubscriptionForUser(targetUser: any, payload: any = {}, actor: string = 'admin', deps: any = {}): Promise<any> {
    const users = deps.userRepository || userRepository;
    const groupsRepo = deps.userGroupRepository || userGroupRepository;
    const policies = deps.userPolicyRepository || userPolicyRepository;
    const servers = deps.serverRepository || serverRepository;
    const tokenRepo = deps.subscriptionTokenRepository || subscriptionTokenRepository;

    const requestedEmail = Object.prototype.hasOwnProperty.call(payload, 'subscriptionEmail')
        ? payload.subscriptionEmail
        : (targetUser.subscriptionEmail || targetUser.email);
    const subscriptionEmail = normalizeEmailInput(requestedEmail);

    const allowedServerIds = Array.isArray(payload.allowedServerIds)
        ? Array.from(new Set(payload.allowedServerIds.map((item: any) => String(item || '').trim()).filter(Boolean)))
        : [];
    const existingServerIds = new Set(servers.list().map((item: any) => item.id));
    const invalidServerIds = allowedServerIds.filter((item: any) => !existingServerIds.has(item));
    if (invalidServerIds.length > 0) {
        throw new Error(`Unknown server IDs: ${invalidServerIds.join(', ')}`);
    }

    const allowedProtocols = Array.isArray(payload.allowedProtocols)
        ? Array.from(new Set(
            payload.allowedProtocols
                .map((item: any) => String(item || '').trim().toLowerCase())
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
        ? payload.allowedInboundKeys.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];
    const limitIp = normalizeNonNegativeInt(payload.limitIp, 0);
    const trafficLimitBytes = normalizeNonNegativeInt(payload.trafficLimitBytes, 0);
    const speedLimitUp = normalizeNonNegativeInt(payload.speedLimitUp, 0);
    const speedLimitDown = normalizeNonNegativeInt(payload.speedLimitDown, 0);
    const user = users.setSubscriptionEmail(targetUser.id, subscriptionEmail);
    const storedUser = typeof users?.getById === 'function' ? users.getById(targetUser.id) : null;
    const resolvedUser = {
        ...targetUser,
        ...(user && typeof user === 'object' ? user : {}),
        ...(storedUser && typeof storedUser === 'object' ? storedUser : {}),
    };
    const existingPolicy = typeof policies.get === 'function' ? policies.get(subscriptionEmail) : null;
    const inheritGroup = payload.inheritGroup !== undefined
        ? Boolean(payload.inheritGroup)
        : (existingPolicy?.updatedAt ? existingPolicy.inheritGroup === true : Boolean(resolvedUser?.groupId));
    const overrideFields = Array.isArray(payload.overrideFields)
        ? payload.overrideFields
        : (Array.isArray(existingPolicy?.overrideFields) ? existingPolicy.overrideFields : []);
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
            speedLimitUp,
            speedLimitDown,
            tgId: Number(payload.tgId) || 0,
            group: String(payload.group || '').trim(),
            comment: String(payload.comment || '').trim(),
            reset: Number(payload.reset) || 0,
            inheritGroup,
            overrideFields,
        },
        actor
    );
    const group = resolvedUser?.groupId ? groupsRepo?.getById?.(resolvedUser.groupId) : null;
    const resolvedPolicy = resolveEffectivePolicy(resolvedUser, policy, group);
    const effectivePolicy = {
        ...policy,
        ...resolvedPolicy,
    };
    const tokenState = ensurePersistentSubscriptionToken(subscriptionEmail, actor, {
        subscriptionTokenRepository: tokenRepo,
    });

    let deployment: any = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    try {
        deployment = await autoDeployClients(subscriptionEmail, effectivePolicy, {
            allowedInboundKeys: effectivePolicy.allowedInboundKeys,
            allServers: servers.list(),
            clientEnabled: resolvedUser?.enabled !== false,
            emailAliases: [resolvedUser?.email, resolvedUser?.subscriptionEmail],
        }, deps);
    } catch (error: any) {
        deployment.error = error.message || 'Auto-deploy failed';
    }

    return {
        user,
        policy: effectivePolicy,
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
            expiryTime: effectivePolicy.expiryTime,
            limitIp: effectivePolicy.limitIp,
            trafficLimitBytes: effectivePolicy.trafficLimitBytes,
            allowedServerIds: effectivePolicy.allowedServerIds,
            allowedProtocols: effectivePolicy.allowedProtocols,
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
