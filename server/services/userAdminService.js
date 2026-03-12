import { checkAccountPassword } from '../lib/passwordValidator.js';
import { createHttpError } from '../lib/httpError.js';
import userRepository from '../repositories/userRepository.js';
import serverRepository from '../repositories/serverRepository.js';
import userPolicyRepository from '../repositories/userPolicyRepository.js';
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
    return userRepo.list().map((item) => stripSubscriptionAliasPath(item));
}

function createManagedUser(payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
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
    const header = 'ID,用户名,邮箱,订阅邮箱,角色,状态,邮箱已验证,创建时间,最后登录';
    const rows = users.map((user) => [
        user.id,
        buildCsvCell(user.username),
        buildCsvCell(user.email),
        buildCsvCell(user.subscriptionEmail),
        user.role,
        user.enabled ? '启用' : '停用',
        user.emailVerified ? '是' : '否',
        user.createdAt || '',
        user.lastLoginAt || '',
    ].join(','));

    return '\uFEFF' + [header, ...rows].join('\n');
}

function updateManagedUser(id, payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const { username, password, role } = payload;
    const nextData = { username, password, role };

    if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
        const email = normalizeEmailInput(payload?.email);
        if (email && !isValidEmail(email)) {
            throw createHttpError(400, '邮箱格式不正确');
        }
        nextData.email = email;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'subscriptionEmail')) {
        const subscriptionEmail = normalizeEmailInput(payload?.subscriptionEmail);
        if (subscriptionEmail && !isValidEmail(subscriptionEmail)) {
            throw createHttpError(400, '订阅绑定邮箱格式不正确');
        }
        nextData.subscriptionEmail = subscriptionEmail;
    }

    if (password) {
        const passwordCheck = checkAccountPassword(password);
        if (!passwordCheck.valid) {
            throw createHttpError(400, passwordCheck.reason);
        }
    }

    const user = userRepo.update(id, nextData);
    if (!user) {
        throw createHttpError(404, '用户不存在');
    }

    return { user: stripSubscriptionAliasPath(user) };
}

function updateUserSubscriptionBinding(id, payload = {}, deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    if (!Object.prototype.hasOwnProperty.call(payload || {}, 'subscriptionEmail')) {
        throw createHttpError(400, 'subscriptionEmail is required');
    }

    const subscriptionEmail = normalizeEmailInput(payload?.subscriptionEmail);
    if (subscriptionEmail && !isValidEmail(subscriptionEmail)) {
        throw createHttpError(400, '订阅绑定邮箱格式不正确');
    }

    const target = userRepo.getById(id);
    if (!target) {
        throw createHttpError(404, '用户不存在');
    }

    const updated = userRepo.setSubscriptionEmail(id, subscriptionEmail);
    return {
        target,
        updated,
    };
}

async function setManagedUserEnabled(id, payload = {}, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const serverRepo = deps.serverRepository || serverRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const toggleClients = deps.autoSetManagedClientsEnabled || autoSetManagedClientsEnabled;
    const deployClients = deps.autoDeployClients || autoDeployClients;
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
    const subscriptionEmail = resolveUserSubscriptionEmail(target);
    const allServers = serverRepo.list();
    const policy = subscriptionEmail ? policyRepo.get(subscriptionEmail) : null;
    let clientSync = { total: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    let deployment = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, details: [] };

    if (subscriptionEmail) {
        try {
            clientSync = await toggleClients(subscriptionEmail, enabled, {
                allServers,
                policy,
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

    if (enabled && subscriptionEmail) {
        if (policy) {
            try {
                deployment = await deployClients(subscriptionEmail, policy, { allServers });
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
            try {
                ensurePersistentToken(subscriptionEmail, actor);
            } catch {
                // best-effort
            }
        }
    }

    return {
        target,
        updated,
        enabled,
        clientSync,
        deployment,
        partialFailure: Number(clientSync.failed || 0) > 0 || Number(deployment.failed || 0) > 0,
    };
}

async function updateManagedUserExpiry(id, payload = {}, actor = 'admin', deps = {}) {
    const userRepo = deps.userRepository || userRepository;
    const policyRepo = deps.userPolicyRepository || userPolicyRepository;
    const serverRepo = deps.serverRepository || serverRepository;
    const deployClients = deps.autoDeployClients || autoDeployClients;
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
        },
        actor
    );
    const deployment = await deployClients(subscriptionEmail, nextPolicy, {
        expiryTime,
        allServers: serverRepo.list(),
    });

    return {
        target,
        subscriptionEmail,
        expiryTime,
        deployment,
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
        } catch {
            // best-effort
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

function buildUsersExportFilename(now = new Date()) {
    return `users_${now.toISOString().slice(0, 10)}.csv`;
}

export {
    listUsers,
    createManagedUser,
    bulkSetUsersEnabled,
    buildUsersCsv,
    updateManagedUser,
    updateUserSubscriptionBinding,
    setManagedUserEnabled,
    updateManagedUserExpiry,
    provisionManagedUserSubscription,
    adminResetUserPassword,
    deleteManagedUser,
    buildUsersExportFilename,
};
