import { checkAccountPassword } from '../lib/passwordValidator.js';
import { createHttpError } from '../lib/httpError.js';
import userRepository from '../repositories/userRepository.js';
import serverRepository from '../repositories/serverRepository.js';
import userPolicyRepository from '../repositories/userPolicyRepository.js';
import userGroupRepository from '../repositories/userGroupRepository.js';
import {
    getInboundScopeKey,
    isProtocolAllowedByPolicy,
    isServerAllowedByPolicy,
    normalizeStringList,
    resolveEffectivePolicy,
    sanitizePolicy,
} from '../lib/userPolicyResolver.js';
import subscriptionTokenRepository from '../repositories/subscriptionTokenRepository.js';
import {
    isValidEmail,
    normalizeEmailInput,
} from './emailAuthService.js';
import {
    autoDeployClients,
    autoSetManagedClientsEnabled,
    autoRemoveClients,
    ensurePersistentSubscriptionToken,
    migrateManagedSubscriptionEmail,
    provisionSubscriptionForUser,
} from './subscriptionSyncService.js';

function resolveUserSubscriptionEmail(user) {
    if (!user || typeof user !== 'object') return '';
    if (Object.prototype.hasOwnProperty.call(user, 'subscriptionEmail')) {
        return normalizeEmailInput(user.subscriptionEmail);
    }
    return normalizeEmailInput(user.email);
}

function normalizeExpiryTime(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizeManagedRole(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (text === 'admin') return 'admin';
    if (text === 'user' || text === 'operator' || text === 'viewer') return 'user';
    return '';
}

function shouldFollowLoginEmail(target, payload = {}) {
    if (!Object.prototype.hasOwnProperty.call(payload || {}, 'email')) return false;
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'subscriptionEmail')) return false;
    const currentEmail = normalizeEmailInput(target?.email);
    const currentSubscriptionEmail = resolveUserSubscriptionEmail(target);
    return !currentSubscriptionEmail || currentSubscriptionEmail === currentEmail;
}

function buildSafeSubscriptionMigrationError(result) {
    const details = Array.isArray(result?.details) ? result.details : [];
    if (details.some((item) => item?.error === 'target-email-client-exists')) {
        return createHttpError(409, '目标订阅邮箱在部分入站中已存在客户端，无法安全迁移');
    }
    if (Number(result?.rollbackFailed || 0) > 0) {
        return createHttpError(500, '订阅绑定迁移失败，且部分节点回滚失败，请先核查入站客户端');
    }
    if (Number(result?.failed || 0) > 0) {
        return createHttpError(500, '订阅绑定迁移失败，已停止本次更新');
    }
    return createHttpError(500, '订阅绑定迁移失败');
}

function resolveUpdateManagedUserArgs(actorOrDeps = 'admin', deps = {}) {
    if (actorOrDeps && typeof actorOrDeps === 'object' && !Array.isArray(actorOrDeps)) {
        return {
            actor: 'admin',
            deps: actorOrDeps,
        };
    }
    return {
        actor: String(actorOrDeps || 'admin'),
        deps,
    };
}

async function rollbackSubscriptionEmailTransition({
    fromEmail = '',
    toEmail = '',
    actor = 'admin',
    allServers = [],
    subscriptionMigration = null,
    policyMigration = null,
    tokenMigration = null,
}, deps = {}) {
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const tokenRepo = deps.subscriptionTokenRepository || subscriptionTokenRepository;
    const issues = [];

    if (tokenMigration?.moved > 0) {
        try {
            tokenRepo.reassignEmail(toEmail, fromEmail, {
                tokenIds: tokenMigration.tokenIds,
            });
        } catch (error) {
            issues.push(`token rollback failed: ${error.message || 'unknown'}`);
        }
    }

    if (policyMigration?.moved === true) {
        try {
            policyRepo.reassignEmail(toEmail, fromEmail, actor);
        } catch (error) {
            issues.push(`policy rollback failed: ${error.message || 'unknown'}`);
        }
    }

    if (Number(subscriptionMigration?.updated || 0) > 0) {
        try {
            const rollback = await migrateManagedSubscriptionEmail(toEmail, fromEmail, {
                allServers,
            }, deps);
            if (Number(rollback.failed || 0) > 0 || Number(rollback.rollbackFailed || 0) > 0) {
                issues.push('client rollback failed');
            }
        } catch (error) {
            issues.push(`client rollback failed: ${error.message || 'unknown'}`);
        }
    }

    return {
        ok: issues.length === 0,
        issues,
    };
}

function emptyClientSyncResult() {
    return { total: 0, updated: 0, skipped: 0, failed: 0, details: [] };
}

function emptyDeploymentResult() {
    return { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };
}

function buildManagedUserEmailAliases(targetUser = null, primaryEmail = '') {
    const normalizedPrimaryEmail = normalizeEmailInput(primaryEmail);
    return Array.from(new Set(
        [
            normalizeEmailInput(targetUser?.email),
            normalizeEmailInput(targetUser?.subscriptionEmail),
        ]
            .filter((item) => item && item !== normalizedPrimaryEmail)
    ));
}

function applyInboundRetryScope(policy = null, targetInboundKeys = []) {
    const keys = normalizeStringList(targetInboundKeys);
    if (keys.length === 0) return policy;
    if (!policy || typeof policy !== 'object') {
        return { allowedInboundKeys: keys };
    }

    const currentKeys = normalizeStringList(policy.allowedInboundKeys);
    const scopedKeys = currentKeys.length > 0
        ? keys.filter((key) => currentKeys.includes(key))
        : keys;

    return {
        ...policy,
        allowedInboundKeys: scopedKeys,
    };
}

function resolveUserGroupForPolicy(targetUser = null, deps = {}) {
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const groupId = String(targetUser?.groupId || '').trim();
    if (!groupId || typeof groupRepo.getById !== 'function') return null;
    return groupRepo.getById(groupId);
}

function resolveEffectivePolicyForUser(targetUser = null, rawPolicy = {}, deps = {}) {
    return resolveEffectivePolicy(
        targetUser,
        rawPolicy,
        resolveUserGroupForPolicy(targetUser, deps)
    );
}

function buildInboundScopeKey(serverId = '', inboundId = '') {
    return getInboundScopeKey(serverId, inboundId);
}

function isPolicyServerAllowed(policy = {}, serverId = '') {
    return isServerAllowedByPolicy(policy, serverId);
}

function isPolicyProtocolAllowed(policy = {}, protocol = '') {
    return isProtocolAllowedByPolicy(policy, protocol);
}

function isPolicyInboundBlocked(policy = {}, serverId = '', inboundId = '') {
    const key = buildInboundScopeKey(serverId, inboundId);
    if (!key) return true;
    return normalizeStringList(policy?.blockedInboundKeys).includes(key);
}

async function syncAddedInboundsToExistingUsers(addedInbounds = [], actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const serverRepo = deps.serverRepository || serverRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const deployClients = deps.autoDeployClients || autoDeployClients;
    const candidates = Array.isArray(addedInbounds)
        ? addedInbounds
            .map((item) => ({
                serverId: String(item?.serverId || '').trim(),
                serverName: String(item?.serverName || '').trim(),
                inboundId: String(item?.inboundId || item?.id || '').trim(),
                inboundRemark: String(item?.inboundRemark || item?.remark || '').trim(),
                protocol: String(item?.protocol || '').trim().toLowerCase(),
                port: Number(item?.port || 0),
            }))
            .filter((item) => item.serverId && item.inboundId && item.protocol)
        : [];

    const result = {
        requestedInboundCount: candidates.length,
        totalUsers: 0,
        eligibleUsers: 0,
        syncedUsers: 0,
        skippedUsers: 0,
        failedUsers: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        details: [],
    };

    if (candidates.length === 0) {
        return result;
    }

    const allServers = Array.isArray(serverRepo.list()) ? serverRepo.list() : [];
    const serverMap = new Map(allServers.map((item) => [String(item?.id || '').trim(), item]));
    const users = (Array.isArray(userRepo.list()) ? userRepo.list() : []).filter((item) => item?.role !== 'admin');

    for (const targetUser of users) {
        result.totalUsers += 1;

        const subscriptionEmail = resolveUserSubscriptionEmail(targetUser);
        if (!subscriptionEmail) {
            result.skippedUsers += 1;
            result.details.push({
                userId: String(targetUser?.id || '').trim(),
                username: String(targetUser?.username || '').trim(),
                subscriptionEmail: '',
                status: 'skipped',
                reason: 'missing-subscription-email',
                actor,
                matchedInboundKeys: [],
            });
            continue;
        }

        const rawPolicy = policyRepo.get(subscriptionEmail);
        const policy = resolveEffectivePolicyForUser(targetUser, rawPolicy, deps);
        const explicitInboundKeys = new Set(normalizeStringList(policy?.allowedInboundKeys));
        const eligibleInbounds = candidates.filter((item) => {
            if (!isPolicyServerAllowed(policy, item.serverId)) return false;
            if (!isPolicyProtocolAllowed(policy, item.protocol)) return false;
            if (isPolicyInboundBlocked(policy, item.serverId, item.inboundId)) return false;
            return true;
        });

        if (eligibleInbounds.length === 0) {
            result.skippedUsers += 1;
            result.details.push({
                userId: String(targetUser?.id || '').trim(),
                username: String(targetUser?.username || '').trim(),
                subscriptionEmail,
                status: 'skipped',
                reason: 'policy-scope',
                actor,
                matchedInboundKeys: [],
            });
            continue;
        }

        result.eligibleUsers += 1;
        const allowedInboundKeys = eligibleInbounds
            .map((item) => buildInboundScopeKey(item.serverId, item.inboundId))
            .filter(Boolean);
        const targetServers = Array.from(new Set(eligibleInbounds.map((item) => item.serverId)))
            .map((serverId) => serverMap.get(serverId))
            .filter(Boolean);
        if (targetServers.length === 0) {
            result.skippedUsers += 1;
            result.details.push({
                userId: String(targetUser?.id || '').trim(),
                username: String(targetUser?.username || '').trim(),
                subscriptionEmail,
                status: 'skipped',
                reason: 'missing-server-context',
                actor,
                matchedInboundKeys: allowedInboundKeys,
            });
            continue;
        }

        try {
            const mergedInboundKeys = explicitInboundKeys.size > 0
                ? normalizeStringList([...explicitInboundKeys, ...allowedInboundKeys])
                : [];
            const policyNeedsInboundBackfill = rawPolicy?.inheritGroup !== true
                && explicitInboundKeys.size > 0
                && mergedInboundKeys.length > explicitInboundKeys.size;
            const effectivePolicy = policyNeedsInboundBackfill
                ? policyRepo.upsert(
                    subscriptionEmail,
                    {
                        ...rawPolicy,
                        allowedInboundKeys: mergedInboundKeys,
                    },
                    actor
                )
                : policy;
            const deploymentPolicy = targetUser?.groupId
                ? effectivePolicy
                : (policyNeedsInboundBackfill ? effectivePolicy : rawPolicy);

            const deployment = await deployClients(subscriptionEmail, deploymentPolicy, {
                allServers: targetServers,
                allowedInboundKeys,
                clientEnabled: targetUser?.enabled !== false,
            });
            result.created += Number(deployment?.created || 0);
            result.updated += Number(deployment?.updated || 0);
            result.skipped += Number(deployment?.skipped || 0);
            result.failed += Number(deployment?.failed || 0);

            if (Number(deployment?.failed || 0) > 0) {
                result.failedUsers += 1;
            } else {
                result.syncedUsers += 1;
            }

            result.details.push({
                userId: String(targetUser?.id || '').trim(),
                username: String(targetUser?.username || '').trim(),
                subscriptionEmail,
                status: Number(deployment?.failed || 0) > 0 ? 'partial_failure' : 'synced',
                actor,
                matchedInboundKeys: allowedInboundKeys,
                policyUpdated: policyNeedsInboundBackfill,
                created: Number(deployment?.created || 0),
                updated: Number(deployment?.updated || 0),
                skipped: Number(deployment?.skipped || 0),
                failed: Number(deployment?.failed || 0),
            });
        } catch (error) {
            result.failedUsers += 1;
            result.failed += 1;
            result.details.push({
                userId: String(targetUser?.id || '').trim(),
                username: String(targetUser?.username || '').trim(),
                subscriptionEmail,
                status: 'failed',
                actor,
                matchedInboundKeys: allowedInboundKeys,
                error: error.message || 'auto-deploy-failed',
            });
        }
    }

    return result;
}

async function runManagedUserNodeSync(targetUser, actor = 'admin', options = {}, deps = {}) {
    const serverRepo = deps.serverRepository || serverRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const toggleClients = deps.autoSetManagedClientsEnabled || autoSetManagedClientsEnabled;
    const deployClients = deps.autoDeployClients || autoDeployClients;

    const enabled = options.enabled !== undefined ? !!options.enabled : (targetUser?.enabled !== false);
    const subscriptionEmail = resolveUserSubscriptionEmail(targetUser);
    if (!subscriptionEmail) {
        return {
            subscriptionEmail: '',
            policy: null,
            clientSync: emptyClientSyncResult(),
            deployment: emptyDeploymentResult(),
            partialFailure: false,
        };
    }
    const emailAliases = buildManagedUserEmailAliases(targetUser, subscriptionEmail);

    const targetServerIds = normalizeStringList(options.targetServerIds);
    const allServers = serverRepo.list();
    const scopedServers = targetServerIds.length > 0
        ? allServers.filter((item) => targetServerIds.includes(String(item?.id || '').trim()))
        : allServers;

    const basePolicy = options.policyOverride !== undefined
        ? options.policyOverride
        : policyRepo.get(subscriptionEmail);
    const effectivePolicy = resolveEffectivePolicyForUser(targetUser, basePolicy, deps);
    const scopedPolicy = applyInboundRetryScope(effectivePolicy, options.targetInboundKeys);

    let clientSync = emptyClientSyncResult();
    if (options.includeToggle === true) {
        try {
            const shouldResetBeforeDeploy = enabled && options.includeDeploy === true;
            clientSync = await toggleClients(subscriptionEmail, shouldResetBeforeDeploy ? false : enabled, {
                allServers: scopedServers,
                policy: shouldResetBeforeDeploy ? null : scopedPolicy,
                emailAliases,
            });
        } catch (error) {
            clientSync = {
                total: 0,
                updated: 0,
                skipped: 0,
                failed: 1,
                details: [{ status: 'failed', error: error.message || 'client-toggle-failed' }],
            };
        }
    }

    let deployment = emptyDeploymentResult();
    if (options.includeDeploy === true && scopedPolicy) {
        try {
            deployment = await deployClients(subscriptionEmail, scopedPolicy, {
                allServers: scopedServers,
                allowedInboundKeys: scopedPolicy.allowedInboundKeys,
                clientEnabled: enabled,
                emailAliases,
                forceExpiryTime: options.forceExpiryTime,
            });
        } catch (error) {
            deployment = {
                total: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                failed: 1,
                details: [{ status: 'failed', error: error.message || 'client-deploy-failed' }],
            };
        }
    }

    return {
        subscriptionEmail,
        policy: scopedPolicy || null,
        rawPolicy: basePolicy || null,
        clientSync,
        deployment,
        partialFailure: Number(clientSync.failed || 0) > 0 || Number(deployment.failed || 0) > 0,
    };
}

function flattenManagedUserSyncDetails(target, subscriptionEmail, enabled, group, stage) {
    const userId = String(target?.id || '').trim();
    const username = String(target?.username || '').trim();
    const normalizedStage = String(stage || '').trim();
    const details = Array.isArray(group?.details) ? group.details : [];

    return details.map((item) => {
        const success = String(item?.status || '').trim().toLowerCase() !== 'failed';
        return {
            success,
            retriable: !success,
            stage: normalizedStage,
            userId,
            username,
            subscriptionEmail: String(subscriptionEmail || '').trim(),
            enabled: Boolean(enabled),
            serverId: String(item?.serverId || '').trim(),
            serverName: String(item?.serverName || '').trim(),
            inboundId: item?.inboundId ?? null,
            inboundRemark: String(item?.inboundRemark || '').trim(),
            protocol: String(item?.protocol || '').trim(),
            msg: String(item?.error || item?.reason || item?.status || 'unknown').trim(),
        };
    });
}

function buildManagedUserSyncJobPayload({
    operation = '',
    target = null,
    subscriptionEmail = '',
    enabled = true,
    clientSync = null,
    deployment = null,
}) {
    const results = [
        ...flattenManagedUserSyncDetails(target, subscriptionEmail, enabled, clientSync, 'client_toggle'),
        ...flattenManagedUserSyncDetails(target, subscriptionEmail, enabled, deployment, 'client_deploy'),
    ];
    const summary = {
        total: results.length,
        success: results.filter((item) => item.success).length,
        failed: results.filter((item) => item.success === false).length,
    };

    return {
        action: String(operation || 'managed_sync'),
        output: {
            summary,
            results,
        },
        requestSnapshot: {
            operation: String(operation || 'managed_sync'),
            userId: String(target?.id || '').trim(),
        },
    };
}

async function resyncManagedUserNodes(id, payload = {}, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const target = userRepo.getById(id);

    if (!target) {
        throw createHttpError(404, '用户不存在');
    }
    if (target.role === 'admin') {
        throw createHttpError(400, '管理员账号无法执行节点同步');
    }

    const operation = String(payload?.operation || '').trim().toLowerCase();
    const enabled = target.enabled !== false;
    const includeToggle = Object.prototype.hasOwnProperty.call(payload || {}, 'includeToggle')
        ? payload.includeToggle === true
        : operation === 'set_enabled';
    const includeDeploy = Object.prototype.hasOwnProperty.call(payload || {}, 'includeDeploy')
        ? payload.includeDeploy === true
        : (
            operation === 'update_expiry'
            || operation === 'provision_subscription'
            || (operation === 'set_enabled' && enabled)
        );

    const sync = await runManagedUserNodeSync(
        target,
        actor,
        {
            enabled,
            includeToggle,
            includeDeploy,
            targetServerIds: payload.targetServerIds,
            targetInboundKeys: payload.targetInboundKeys,
        },
        deps
    );

    return {
        target,
        updated: stripSubscriptionAliasPath(target),
        enabled,
        ...sync,
    };
}

function buildCsvCell(value) {
    return `"${String(value || '').replace(/"/g, '""')}"`;
}

function stripSubscriptionAliasPath(user) {
    if (!user || typeof user !== 'object') return user;
    const next = { ...user };
    delete next.subscriptionAliasPath;
    return next;
}

function listUsers(deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const groups = new Map(
        (typeof groupRepo.list === 'function' ? groupRepo.list() : [])
            .map((item) => [String(item?.id || '').trim(), item])
    );
    return userRepo.list().map((item) => {
        const groupId = String(item?.groupId || '').trim();
        const group = groupId ? groups.get(groupId) : null;
        return stripSubscriptionAliasPath({
            ...item,
            groupId,
            groupName: group?.name || '',
        });
    });
}

function createManagedUser(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');
    const role = payload?.role;
    const email = normalizeEmailInput(payload?.email);
    const subscriptionEmail = Object.prototype.hasOwnProperty.call(payload || {}, 'subscriptionEmail')
        ? normalizeEmailInput(payload?.subscriptionEmail)
        : email;

    if (email && !isValidEmail(email)) {
        throw createHttpError(400, '邮箱格式不正确');
    }
    if (subscriptionEmail && !isValidEmail(subscriptionEmail)) {
        throw createHttpError(400, '订阅绑定邮箱格式不正确');
    }
    const groupId = String(payload?.groupId || '').trim();
    if (groupId && !groupRepo.getById(groupId)) {
        throw createHttpError(400, '用户分组不存在');
    }

    const passwordCheck = checkAccountPassword(password);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    const user = userRepo.add({
        username,
        password,
        role,
        email,
        subscriptionEmail,
        groupId,
        emailVerified: true,
        enabled: true,
    });

    return {
        user: stripSubscriptionAliasPath(user),
        audit: {
            targetUser: username,
            role,
            email,
            subscriptionEmail: user.subscriptionEmail || '',
            groupId,
        },
    };
}

async function bulkSetUsersEnabled(payload = {}, actor = 'admin', deps = {}) {
    const userIds = Array.isArray(payload?.userIds) ? payload.userIds : [];
    const enabled = !!payload?.enabled;
    const setUserEnabled = deps.setManagedUserEnabled || setManagedUserEnabled;

    if (userIds.length === 0) {
        throw createHttpError(400, '请提供用户ID列表');
    }

    const results = [];
    for (const uid of userIds) {
        try {
            const updated = await setUserEnabled(uid, { enabled }, actor, deps);
            results.push({
                id: uid,
                success: true,
                enabled: updated.enabled,
                target: updated.target,
                subscriptionEmail: updated.subscriptionEmail,
                partialFailure: updated.partialFailure === true,
                clientSync: updated.clientSync,
                deployment: updated.deployment,
            });
        } catch (error) {
            results.push({ id: uid, success: false, msg: error.message });
        }
    }

    return {
        enabled,
        total: userIds.length,
        successCount: results.filter((item) => item.success).length,
        partialFailureCount: results.filter((item) => item.partialFailure === true).length,
        results,
    };
}

function buildUsersCsv(deps = {}) {
    const users = listUsers(deps);
    const header = 'ID,用户名,邮箱,订阅邮箱,用户分组,角色,状态,邮箱已验证,创建时间,最后登录';
    const rows = users.map((user) => [
        user.id,
        buildCsvCell(user.username),
        buildCsvCell(user.email),
        buildCsvCell(user.subscriptionEmail),
        buildCsvCell(user.groupName || user.groupId || ''),
        user.role,
        user.enabled ? '启用' : '停用',
        user.emailVerified ? '是' : '否',
        user.createdAt || '',
        user.lastLoginAt || '',
    ].join(','));

    return '\uFEFF' + [header, ...rows].join('\n');
}

async function updateManagedUser(id, payload = {}, actorOrDeps = 'admin', deps = {}) {
    const resolved = resolveUpdateManagedUserArgs(actorOrDeps, deps);
    const actor = resolved.actor;
    const runtimeDeps = resolved.deps;
    const userRepo = runtimeDeps.userRepository || userRepository;
    const serverRepo = runtimeDeps.serverRepository || serverRepository;
    const policyRepo = runtimeDeps.userPolicyRepository || userPolicyRepository;
    const tokenRepo = runtimeDeps.subscriptionTokenRepository || subscriptionTokenRepository;
    const groupRepo = runtimeDeps.userGroupRepository || userGroupRepository;
    const target = userRepo.getById(id);

    if (!target) {
        throw createHttpError(404, '用户不存在');
    }

    const nextData = {};
    const currentUsername = String(target.username || '').trim();
    const currentEmail = normalizeEmailInput(target.email);
    const currentSubscriptionEmail = resolveUserSubscriptionEmail(target);

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'username')) {
        const username = String(payload?.username || '').trim();
        if (!username) {
            throw createHttpError(400, '用户名不能为空');
        }
        const existing = userRepo.getByUsername(username);
        if (existing && existing.id !== id) {
            throw createHttpError(400, `用户名 "${username}" 已存在`);
        }
        nextData.username = username;
    }

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'email')) {
        const email = normalizeEmailInput(payload?.email);
        if (email && !isValidEmail(email)) {
            throw createHttpError(400, '邮箱格式不正确');
        }
        const existing = email ? userRepo.getByEmail(email) : null;
        if (existing && existing.id !== id) {
            throw createHttpError(400, `邮箱 "${email}" 已被注册`);
        }
        nextData.email = email;
    }

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'role')) {
        const role = normalizeManagedRole(payload?.role);
        if (!role) {
            throw createHttpError(400, `无效角色: ${payload?.role}`);
        }
        nextData.role = role;
    }

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'groupId')) {
        const groupId = String(payload?.groupId || '').trim();
        if (groupId) {
            const group = groupRepo.getById(groupId);
            if (!group) {
                throw createHttpError(400, '用户分组不存在');
            }
        }
        nextData.groupId = groupId;
    }

    const password = String(payload?.password || '');
    if (password) {
        const passwordCheck = checkAccountPassword(password);
        if (!passwordCheck.valid) {
            throw createHttpError(400, passwordCheck.reason);
        }
        nextData.password = password;
    }

    let nextSubscriptionEmail = currentSubscriptionEmail;
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'subscriptionEmail')) {
        nextSubscriptionEmail = normalizeEmailInput(payload?.subscriptionEmail);
        if (nextSubscriptionEmail && !isValidEmail(nextSubscriptionEmail)) {
            throw createHttpError(400, '订阅绑定邮箱格式不正确');
        }
        nextData.subscriptionEmail = nextSubscriptionEmail;
    } else if (shouldFollowLoginEmail(target, payload)) {
        nextSubscriptionEmail = Object.prototype.hasOwnProperty.call(nextData, 'email')
            ? nextData.email
            : currentEmail;
        nextData.subscriptionEmail = nextSubscriptionEmail;
    }

    if (Object.prototype.hasOwnProperty.call(nextData, 'subscriptionEmail')) {
        const existing = nextSubscriptionEmail
            ? userRepo.getBySubscriptionEmail(nextSubscriptionEmail)
            : null;
        if (existing && existing.id !== id) {
            throw createHttpError(400, `订阅绑定邮箱 "${nextSubscriptionEmail}" 已被其他账号占用`);
        }
    }

    const migrationNeeded = currentSubscriptionEmail
        && nextSubscriptionEmail
        && nextSubscriptionEmail !== currentSubscriptionEmail;
    const allServers = serverRepo.list();
    let subscriptionMigration = {
        fromEmail: currentSubscriptionEmail,
        toEmail: nextSubscriptionEmail,
        total: 0,
        updated: 0,
        failed: 0,
        rolledBack: 0,
        rollbackFailed: 0,
        details: [],
    };
    let policyMigration = {
        moved: false,
        fromEmail: currentSubscriptionEmail,
        toEmail: nextSubscriptionEmail,
        policy: null,
    };
    let tokenMigration = {
        moved: 0,
        fromEmail: currentSubscriptionEmail,
        toEmail: nextSubscriptionEmail,
        tokenIds: [],
        publicTokenIds: [],
    };

    if (migrationNeeded) {
        subscriptionMigration = await migrateManagedSubscriptionEmail(
            currentSubscriptionEmail,
            nextSubscriptionEmail,
            { allServers },
            runtimeDeps
        );
        if (Number(subscriptionMigration.failed || 0) > 0 || Number(subscriptionMigration.rollbackFailed || 0) > 0) {
            throw buildSafeSubscriptionMigrationError(subscriptionMigration);
        }

        try {
            policyMigration = policyRepo.reassignEmail(currentSubscriptionEmail, nextSubscriptionEmail, actor);
        } catch (error) {
            await rollbackSubscriptionEmailTransition({
                fromEmail: currentSubscriptionEmail,
                toEmail: nextSubscriptionEmail,
                actor,
                allServers,
                subscriptionMigration,
            }, runtimeDeps);
            throw createHttpError(409, error.message || '订阅策略迁移失败');
        }

        try {
            tokenMigration = tokenRepo.reassignEmail(currentSubscriptionEmail, nextSubscriptionEmail);
        } catch (error) {
            const rollback = await rollbackSubscriptionEmailTransition({
                fromEmail: currentSubscriptionEmail,
                toEmail: nextSubscriptionEmail,
                actor,
                allServers,
                subscriptionMigration,
                policyMigration,
            }, runtimeDeps);
            const suffix = rollback.ok ? '' : `；回滚异常: ${rollback.issues.join('；')}`;
            throw createHttpError(500, `${error.message || '订阅令牌迁移失败'}${suffix}`);
        }
    }

    let user;
    try {
        user = userRepo.update(id, nextData);
    } catch (error) {
        if (migrationNeeded) {
            const rollback = await rollbackSubscriptionEmailTransition({
                fromEmail: currentSubscriptionEmail,
                toEmail: nextSubscriptionEmail,
                actor,
                allServers,
                subscriptionMigration,
                policyMigration,
                tokenMigration,
            }, runtimeDeps);
            const suffix = rollback.ok ? '' : `；回滚异常: ${rollback.issues.join('；')}`;
            throw createHttpError(400, `${error.message || '更新用户失败'}${suffix}`);
        }
        throw createHttpError(400, error.message || '更新用户失败');
    }

    if (!user) {
        throw createHttpError(404, '用户不存在');
    }

    let groupSync = null;
    if (Object.prototype.hasOwnProperty.call(nextData, 'groupId') && target.role !== 'admin') {
        try {
            groupSync = await runManagedUserNodeSync(user, actor, {
                enabled: user.enabled !== false,
                includeToggle: true,
                includeDeploy: user.enabled !== false,
            }, runtimeDeps);
        } catch (error) {
            groupSync = {
                subscriptionEmail: resolveUserSubscriptionEmail(user),
                partialFailure: true,
                clientSync: emptyClientSyncResult(),
                deployment: {
                    ...emptyDeploymentResult(),
                    failed: 1,
                    details: [{ status: 'failed', error: error.message || 'group-assignment-sync-failed' }],
                },
            };
        }
    }

    return {
        target: {
            id,
            username: currentUsername,
            email: currentEmail,
            subscriptionEmail: currentSubscriptionEmail,
        },
        user: stripSubscriptionAliasPath(user),
        subscriptionMigration,
        policyMigration,
        tokenMigration,
        groupSync,
    };
}

async function updateUserSubscriptionBinding(id, payload = {}, actorOrDeps = 'admin', deps = {}) {
    if (!Object.prototype.hasOwnProperty.call(payload || {}, 'subscriptionEmail')) {
        throw createHttpError(400, 'subscriptionEmail is required');
    }

    const result = await updateManagedUser(id, {
        subscriptionEmail: payload.subscriptionEmail,
    }, actorOrDeps, deps);

    return {
        target: result.target,
        updated: result.user,
        subscriptionMigration: result.subscriptionMigration,
    };
}

async function setManagedUserEnabled(id, payload = {}, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const ensurePersistentToken = deps.ensurePersistentSubscriptionToken || ensurePersistentSubscriptionToken;
    const target = userRepo.getById(id);

    if (!target) {
        throw createHttpError(404, '用户不存在');
    }
    if (target.role === 'admin') {
        throw createHttpError(400, '管理员账号无法停用');
    }

    const enabled = !!payload?.enabled;
    const updated = userRepo.setEnabled(id, enabled);
    const syncTarget = updated && typeof updated === 'object'
        ? { ...target, ...updated, enabled }
        : { ...target, enabled };
    const sync = await runManagedUserNodeSync(syncTarget, actor, {
        enabled,
        includeToggle: true,
        includeDeploy: enabled,
    }, deps);

    if (enabled && sync.subscriptionEmail && sync.policy) {
        try {
            ensurePersistentToken(sync.subscriptionEmail, actor);
        } catch {
            // best-effort
        }
    }

    return {
        target,
        updated,
        enabled,
        subscriptionEmail: sync.subscriptionEmail,
        clientSync: sync.clientSync,
        deployment: sync.deployment,
        partialFailure: sync.partialFailure,
    };
}

async function updateManagedUserExpiry(id, payload = {}, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const target = userRepo.getById(id);

    if (!target) {
        throw createHttpError(404, '用户不存在');
    }

    const subscriptionEmail = resolveUserSubscriptionEmail(target);
    if (!subscriptionEmail) {
        throw createHttpError(400, '该用户无订阅邮箱');
    }

    const expiryTime = normalizeExpiryTime(payload?.expiryTime);
    const currentPolicy = policyRepo.get(subscriptionEmail);
    const nextPolicy = policyRepo.upsert(
        subscriptionEmail,
        {
            ...currentPolicy,
            expiryTime,
            overrideFields: Array.from(new Set([
                ...normalizeStringList(currentPolicy.overrideFields),
                'expiryTime',
            ])),
        },
        actor
    );
    const sync = await runManagedUserNodeSync(target, actor, {
        enabled: target.enabled !== false,
        includeToggle: false,
        includeDeploy: true,
        policyOverride: nextPolicy,
        forceExpiryTime: expiryTime,
    }, deps);

    return {
        target,
        subscriptionEmail,
        expiryTime,
        deployment: sync.deployment,
    };
}

async function updateManagedUserPolicyByEmail(email, payload = {}, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const serverRepo = deps.serverRepository || serverRepository;
    const toggleClients = deps.autoSetManagedClientsEnabled || autoSetManagedClientsEnabled;
    const deployClients = deps.autoDeployClients || autoDeployClients;

    const requestedEmail = normalizeEmailInput(email);
    if (!requestedEmail) {
        throw createHttpError(400, '订阅邮箱不能为空');
    }

    const target = userRepo.getBySubscriptionEmail(requestedEmail) || userRepo.getByEmail(requestedEmail) || null;
    const subscriptionEmail = normalizeEmailInput(target?.subscriptionEmail || target?.email || requestedEmail);
    const emailAliases = buildManagedUserEmailAliases(target, subscriptionEmail);
    const currentPolicy = policyRepo.get(subscriptionEmail);
    const hasAllowedInboundKeys = Object.prototype.hasOwnProperty.call(payload || {}, 'allowedInboundKeys');
    const nextPolicy = policyRepo.upsert(
        subscriptionEmail,
        {
            ...currentPolicy,
            ...payload,
            allowedInboundKeys: hasAllowedInboundKeys
                ? normalizeStringList(payload.allowedInboundKeys)
                : normalizeStringList(currentPolicy.allowedInboundKeys),
        },
        actor
    );

    if (requestedEmail !== subscriptionEmail) {
        try {
            policyRepo.remove(requestedEmail);
        } catch {
            // best-effort cleanup for legacy email-keyed policy records
        }
    }

    if (!target || target.role === 'admin') {
        return {
            requestedEmail,
            subscriptionEmail,
            target,
            policy: nextPolicy,
            effectivePolicy: target ? resolveEffectivePolicyForUser(target, nextPolicy, deps) : sanitizePolicy(nextPolicy),
            clientSync: emptyClientSyncResult(),
            deployment: emptyDeploymentResult(),
            partialFailure: false,
        };
    }

    const allServers = serverRepo.list();
    let clientSync = emptyClientSyncResult();
    let deployment = emptyDeploymentResult();

    try {
        clientSync = await toggleClients(subscriptionEmail, false, { allServers, emailAliases }, deps);
    } catch (error) {
        clientSync = {
            total: 0,
            updated: 0,
            skipped: 0,
            failed: 1,
            details: [{ status: 'failed', error: error.message || 'client-toggle-failed' }],
        };
    }

    const effectivePolicy = resolveEffectivePolicyForUser(target, nextPolicy, deps);

    if (target.enabled !== false && effectivePolicy.serverScopeMode !== 'none' && effectivePolicy.protocolScopeMode !== 'none') {
        try {
            deployment = await deployClients(subscriptionEmail, effectivePolicy, {
                allServers,
                allowedInboundKeys: effectivePolicy.allowedInboundKeys,
                clientEnabled: true,
                emailAliases,
            }, deps);
        } catch (error) {
            deployment = {
                total: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                failed: 1,
                details: [{ status: 'failed', error: error.message || 'client-deploy-failed' }],
            };
        }
    }

    return {
        requestedEmail,
        subscriptionEmail,
        target,
        policy: nextPolicy,
        effectivePolicy,
        clientSync,
        deployment,
        partialFailure: Number(clientSync.failed || 0) > 0 || Number(deployment.failed || 0) > 0,
    };
}

async function provisionManagedUserSubscription(id, payload = {}, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const provisionSubscription = deps.provisionSubscriptionForUser || provisionSubscriptionForUser;
    const target = userRepo.getById(id);
    if (!target) {
        throw createHttpError(404, '用户不存在');
    }
    if (target.role === 'admin') {
        throw createHttpError(400, '管理员账号无需开通订阅');
    }

    const requestedEmail = Object.prototype.hasOwnProperty.call(payload || {}, 'subscriptionEmail')
        ? payload?.subscriptionEmail
        : (target.subscriptionEmail || target.email);
    const subscriptionEmail = normalizeEmailInput(requestedEmail);
    if (!subscriptionEmail) {
        throw createHttpError(400, '订阅绑定邮箱不能为空，请先为该用户设置邮箱');
    }
    if (!isValidEmail(subscriptionEmail)) {
        throw createHttpError(400, '订阅绑定邮箱格式不正确');
    }

    const result = await provisionSubscription(
        target,
        {
            ...payload,
            subscriptionEmail,
        },
        actor,
        {
            userRepository: userRepo,
        }
    );

    return {
        target,
        ...result,
    };
}

function adminResetUserPassword(id, payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const newPassword = String(payload?.newPassword || '');
    if (!newPassword) {
        throw createHttpError(400, '新密码不能为空');
    }

    const passwordCheck = checkAccountPassword(newPassword);
    if (!passwordCheck.valid) {
        throw createHttpError(400, passwordCheck.reason);
    }

    const target = userRepo.getById(id);
    if (!target) {
        throw createHttpError(404, '用户不存在');
    }

    userRepo.update(id, { password: newPassword });
    userRepo.clearPasswordResetCode(id);
    return { target };
}

async function deleteManagedUser(id, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const tokenRepo = deps.subscriptionTokenRepository || subscriptionTokenRepository;
    const serverRepo = deps.serverRepository || serverRepository;
    const removeClients = deps.autoRemoveClients || autoRemoveClients;
    const targetUser = userRepo.getById(id);

    if (!targetUser) {
        throw createHttpError(404, '用户不存在');
    }
    if (targetUser.role === 'admin') {
        throw createHttpError(400, '管理员账号不支持在此处删除');
    }

    const cleanupEmails = Array.from(new Set([
        normalizeEmailInput(targetUser.email),
        resolveUserSubscriptionEmail(targetUser),
    ].filter(Boolean)));

    const ok = userRepo.remove(id);
    if (!ok) {
        throw createHttpError(404, '用户不存在');
    }

    let revokedTokenCount = 0;
    const removedPolicyEmails = [];
    let cleanupError = '';
    for (const email of cleanupEmails) {
        try {
            revokedTokenCount += tokenRepo.revokeAllByEmail(email, 'user-deleted');
            const removed = policyRepo.remove(email);
            if (removed) removedPolicyEmails.push(email);
        } catch (error) {
            cleanupError = error.message || 'cleanup-failed';
        }
    }

    let clientCleanup = { total: 0, removed: 0, failed: 0 };
    const allServers = serverRepo.list();
    for (const email of cleanupEmails) {
        try {
            const removal = await removeClients(email, { allServers });
            clientCleanup.total += removal.total;
            clientCleanup.removed += removal.removed;
            clientCleanup.failed += removal.failed;
            if (removal.failed > 0) {
                cleanupError = `部分面板不可达或客户端删除失败，部分客户端可能残留，请手动检查`;
            }
        } catch (error) {
            cleanupError = error.message || 'cleanup-failed';
        }
    }

    return {
        targetUser,
        cleanupEmails,
        revokedTokenCount,
        removedPolicyEmails,
        cleanupError,
        clientCleanup,
    };
}

function summarizeGroupMembers(groupId = '', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const normalizedGroupId = String(groupId || '').trim();
    return (Array.isArray(userRepo.list()) ? userRepo.list() : [])
        .filter((item) => item?.role !== 'admin' && String(item?.groupId || '').trim() === normalizedGroupId);
}

function normalizeUserIdList(input = []) {
    return normalizeStringList(input);
}

function listUserGroups(deps = {}) {
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const userRepo = deps.userRepository || userRepository;
    const users = Array.isArray(userRepo.list()) ? userRepo.list() : [];
    return groupRepo.list().map((group) => {
        const members = users
            .filter((user) => user?.role !== 'admin' && String(user?.groupId || '').trim() === group.id)
            .map((user) => ({
                id: user.id,
                username: user.username,
                email: user.email || '',
                subscriptionEmail: user.subscriptionEmail || '',
                enabled: user.enabled !== false,
            }));
        return {
            ...group,
            memberCount: members.length,
            memberIds: members.map((item) => item.id),
            members,
        };
    });
}

function buildPolicyForGroupAssignment(currentPolicy = {}) {
    if (currentPolicy?.updatedAt) {
        return {
            ...currentPolicy,
            inheritGroup: true,
            overrideFields: [],
        };
    }
    return {
        ...currentPolicy,
        allowedServerIds: [],
        blockedServerIds: [],
        allowedProtocols: [],
        allowedInboundKeys: [],
        blockedInboundKeys: [],
        serverScopeMode: 'none',
        protocolScopeMode: 'none',
        expiryTime: 0,
        limitIp: 0,
        trafficLimitBytes: 0,
        trafficResetCycle: 'none',
        ipLimitPolicy: 'first-wins',
        inheritGroup: true,
        overrideFields: [],
    };
}

function setUserGroupPolicyInheritance(targetUser, inheritGroup, actor = 'admin', deps = {}) {
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    if (!policyRepo || typeof policyRepo.get !== 'function' || typeof policyRepo.upsert !== 'function') return null;
    const subscriptionEmail = resolveUserSubscriptionEmail(targetUser);
    if (!subscriptionEmail) return null;
    const currentPolicy = policyRepo.get(subscriptionEmail);
    const payload = inheritGroup
        ? buildPolicyForGroupAssignment(currentPolicy)
        : {
            ...currentPolicy,
            inheritGroup: false,
        };
    return policyRepo.upsert(subscriptionEmail, payload, actor);
}

function applyUserGroupMembership(groupId = '', memberUserIds = null, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    if (!Array.isArray(memberUserIds)) {
        return {
            requested: false,
            memberIds: [],
            assignedUsers: [],
            removedUsers: [],
            changedUsers: [],
        };
    }

    const normalizedGroupId = String(groupId || '').trim();
    const desiredIds = normalizeUserIdList(memberUserIds);
    const users = (Array.isArray(userRepo.list()) ? userRepo.list() : [])
        .filter((item) => item?.role !== 'admin');
    const userById = new Map(users.map((item) => [String(item?.id || '').trim(), item]));
    const invalidIds = desiredIds.filter((id) => !userById.has(id));
    if (invalidIds.length > 0) {
        throw createHttpError(400, `用户不存在或不能加入分组: ${invalidIds.join(', ')}`);
    }

    const desiredSet = new Set(desiredIds);
    const assignedUsers = [];
    const removedUsers = [];
    const changedUsers = [];

    users.forEach((user) => {
        const userId = String(user?.id || '').trim();
        const currentGroupId = String(user?.groupId || '').trim();
        const shouldBeMember = desiredSet.has(userId);
        if (shouldBeMember) {
            const updated = currentGroupId === normalizedGroupId
                ? user
                : (userRepo.update(userId, { groupId: normalizedGroupId }) || { ...user, groupId: normalizedGroupId });
            setUserGroupPolicyInheritance(updated, true, actor, deps);
            assignedUsers.push(updated);
            if (currentGroupId !== normalizedGroupId) changedUsers.push(updated);
            return;
        }

        if (currentGroupId === normalizedGroupId) {
            const updated = userRepo.update(userId, { groupId: '' }) || { ...user, groupId: '' };
            setUserGroupPolicyInheritance(updated, false, actor, deps);
            removedUsers.push(updated);
            changedUsers.push(updated);
        }
    });

    return {
        requested: true,
        memberIds: desiredIds,
        assignedUsers,
        removedUsers,
        changedUsers,
    };
}

function createEmptyGroupSyncResult(group = null) {
    return {
        group,
        totalUsers: 0,
        syncedUsers: 0,
        failedUsers: 0,
        clientSync: emptyClientSyncResult(),
        deployment: emptyDeploymentResult(),
        details: [],
    };
}

function addSyncGroupTotals(target, source) {
    target.totalUsers += Number(source?.totalUsers || 0);
    target.syncedUsers += Number(source?.syncedUsers || 0);
    target.failedUsers += Number(source?.failedUsers || 0);
    target.clientSync.total += Number(source?.clientSync?.total || 0);
    target.clientSync.updated += Number(source?.clientSync?.updated || 0);
    target.clientSync.skipped += Number(source?.clientSync?.skipped || 0);
    target.clientSync.failed += Number(source?.clientSync?.failed || 0);
    target.deployment.total += Number(source?.deployment?.total || 0);
    target.deployment.created += Number(source?.deployment?.created || 0);
    target.deployment.updated += Number(source?.deployment?.updated || 0);
    target.deployment.skipped += Number(source?.deployment?.skipped || 0);
    target.deployment.failed += Number(source?.deployment?.failed || 0);
    target.details.push(...(Array.isArray(source?.details) ? source.details : []));
}

async function syncManagedUsersWithEffectivePolicies(members = [], actor = 'admin', deps = {}, detailDefaults = {}) {
    const result = createEmptyGroupSyncResult(null);

    for (const member of (Array.isArray(members) ? members : [])) {
        result.totalUsers += 1;
        const subscriptionEmail = resolveUserSubscriptionEmail(member);
        if (!subscriptionEmail) {
            result.details.push({
                userId: member.id,
                username: member.username,
                status: 'skipped',
                reason: 'missing-subscription-email',
                ...detailDefaults,
            });
            continue;
        }

        try {
            const sync = await runManagedUserNodeSync(member, actor, {
                enabled: member.enabled !== false,
                includeToggle: true,
                includeDeploy: member.enabled !== false,
            }, deps);
            result.clientSync.total += Number(sync.clientSync?.total || 0);
            result.clientSync.updated += Number(sync.clientSync?.updated || 0);
            result.clientSync.skipped += Number(sync.clientSync?.skipped || 0);
            result.clientSync.failed += Number(sync.clientSync?.failed || 0);
            result.deployment.total += Number(sync.deployment?.total || 0);
            result.deployment.created += Number(sync.deployment?.created || 0);
            result.deployment.updated += Number(sync.deployment?.updated || 0);
            result.deployment.skipped += Number(sync.deployment?.skipped || 0);
            result.deployment.failed += Number(sync.deployment?.failed || 0);
            if (sync.partialFailure) {
                result.failedUsers += 1;
            } else {
                result.syncedUsers += 1;
            }
            result.details.push({
                userId: member.id,
                username: member.username,
                subscriptionEmail,
                status: sync.partialFailure ? 'partial_failure' : 'synced',
                clientSync: sync.clientSync,
                deployment: sync.deployment,
                ...detailDefaults,
            });
        } catch (error) {
            result.failedUsers += 1;
            result.details.push({
                userId: member.id,
                username: member.username,
                subscriptionEmail,
                status: 'failed',
                error: error.message || 'group-member-sync-failed',
                ...detailDefaults,
            });
        }
    }

    return result;
}

async function createUserGroup(payload = {}, actor = 'admin', deps = {}) {
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const created = groupRepo.add(payload, actor);
    const membership = applyUserGroupMembership(created.id, payload.memberUserIds, actor, deps);
    const sync = membership.requested
        ? {
            ...(await syncUserGroupMembers(created.id, actor, deps)),
            membership,
        }
        : createEmptyGroupSyncResult(created);
    return {
        group: created,
        membership,
        sync,
    };
}

async function syncUserGroupMembers(groupId = '', actor = 'admin', deps = {}) {
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const group = groupRepo.getById(groupId);
    if (!group) {
        throw createHttpError(404, '用户分组不存在');
    }

    const members = summarizeGroupMembers(group.id, deps);
    const result = await syncManagedUsersWithEffectivePolicies(members, actor, deps, { membership: 'member' });
    result.group = group;

    return result;
}

async function updateUserGroup(id, payload = {}, actor = 'admin', deps = {}) {
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const updated = groupRepo.update(id, payload, actor);
    if (!updated) {
        throw createHttpError(404, '用户分组不存在');
    }
    const membership = applyUserGroupMembership(updated.id, payload.memberUserIds, actor, deps);
    const sync = createEmptyGroupSyncResult(updated);
    const memberSync = await syncUserGroupMembers(updated.id, actor, deps);
    addSyncGroupTotals(sync, memberSync);
    if (membership.removedUsers.length > 0) {
        const removedSync = await syncManagedUsersWithEffectivePolicies(
            membership.removedUsers,
            actor,
            deps,
            { membership: 'removed' }
        );
        addSyncGroupTotals(sync, removedSync);
    }
    sync.membership = membership;
    return {
        group: updated,
        membership,
        sync,
    };
}

async function deleteUserGroup(id, actor = 'admin', deps = {}) {
    const groupRepo = deps.userGroupRepository || userGroupRepository;
    const userRepo = deps.userRepository || userRepository;
    const group = groupRepo.getById(id);
    if (!group) {
        throw createHttpError(404, '用户分组不存在');
    }

    const members = summarizeGroupMembers(group.id, deps);
    members.forEach((member) => {
        userRepo.update(member.id, { groupId: '' });
        setUserGroupPolicyInheritance(member, false, actor, deps);
    });
    groupRepo.remove(group.id);

    const sync = {
        group,
        totalUsers: members.length,
        syncedUsers: 0,
        failedUsers: 0,
        details: [],
    };
    for (const member of members) {
        const updatedMember = userRepo.getById(member.id) || { ...member, groupId: '' };
        try {
            const result = await runManagedUserNodeSync(updatedMember, actor, {
                enabled: updatedMember.enabled !== false,
                includeToggle: true,
                includeDeploy: updatedMember.enabled !== false,
            }, deps);
            if (result.partialFailure) sync.failedUsers += 1;
            else sync.syncedUsers += 1;
            sync.details.push({
                userId: updatedMember.id,
                username: updatedMember.username,
                subscriptionEmail: result.subscriptionEmail,
                status: result.partialFailure ? 'partial_failure' : 'synced',
                clientSync: result.clientSync,
                deployment: result.deployment,
            });
        } catch (error) {
            sync.failedUsers += 1;
            sync.details.push({
                userId: updatedMember.id,
                username: updatedMember.username,
                status: 'failed',
                error: error.message || 'group-delete-sync-failed',
            });
        }
    }

    return {
        group,
        sync,
    };
}

function buildUsersExportFilename(now = new Date()) {
    return `users_${now.toISOString().slice(0, 10)}.csv`;
}

export {
    buildManagedUserSyncJobPayload,
    listUsers,
    listUserGroups,
    createUserGroup,
    updateUserGroup,
    deleteUserGroup,
    syncUserGroupMembers,
    createManagedUser,
    bulkSetUsersEnabled,
    buildUsersCsv,
    resyncManagedUserNodes,
    syncAddedInboundsToExistingUsers,
    updateManagedUser,
    updateManagedUserPolicyByEmail,
    updateUserSubscriptionBinding,
    setManagedUserEnabled,
    updateManagedUserExpiry,
    provisionManagedUserSubscription,
    adminResetUserPassword,
    deleteManagedUser,
    buildUsersExportFilename,
};
