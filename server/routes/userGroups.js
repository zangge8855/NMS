import { Router } from 'express';
import serverStore from '../store/serverStore.js';
import jobStore from '../store/jobStore.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import { toHttpError } from '../lib/httpError.js';
import {
    buildManagedUserSyncJobPayload,
    createUserGroup,
    deleteUserGroup,
    listUserGroups,
    syncUserGroupMembers,
    updateUserGroup,
} from '../services/userAdminService.js';

const router = Router();

function normalizeStringList(input = []) {
    return Array.from(new Set(
        (Array.isArray(input) ? input : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function normalizeGroupPayload(body = {}) {
    return {
        name: String(body?.name || '').trim(),
        description: String(body?.description || '').trim(),
        enabled: body?.enabled !== false,
        allowedServerIds: normalizeStringList(body?.allowedServerIds),
        blockedServerIds: normalizeStringList(body?.blockedServerIds),
        allowedProtocols: normalizeStringList(body?.allowedProtocols).map((item) => item.toLowerCase()),
        allowedInboundKeys: normalizeStringList(body?.allowedInboundKeys),
        blockedInboundKeys: normalizeStringList(body?.blockedInboundKeys),
        serverScopeMode: String(body?.serverScopeMode || '').trim().toLowerCase(),
        protocolScopeMode: String(body?.protocolScopeMode || '').trim().toLowerCase(),
        expiryTime: Math.max(0, Math.floor(Number(body?.expiryTime || 0))),
        limitIp: Math.max(0, Math.floor(Number(body?.limitIp || 0))),
        trafficLimitBytes: Math.max(0, Math.floor(Number(body?.trafficLimitBytes || 0))),
        trafficResetCycle: String(body?.trafficResetCycle || 'none').trim().toLowerCase(),
        ipLimitPolicy: String(body?.ipLimitPolicy || 'first-wins').trim().toLowerCase(),
    };
}

function validateServerIds(payload = {}) {
    const existing = new Set(serverStore.getAll().map((item) => item.id));
    const invalid = [
        ...normalizeStringList(payload.allowedServerIds),
        ...normalizeStringList(payload.blockedServerIds),
    ].filter((item) => !existing.has(item));
    if (invalid.length > 0) {
        const error = new Error(`Unknown server IDs: ${Array.from(new Set(invalid)).join(', ')}`);
        error.status = 400;
        throw error;
    }
}

function appendGroupSyncHistory(req, sync = {}, operation = 'group_policy_update') {
    const ids = [];
    const actor = req.user?.username || req.user?.role || 'admin';
    (Array.isArray(sync.details) ? sync.details : []).forEach((detail) => {
        const failed = detail?.status === 'partial_failure' || detail?.status === 'failed';
        if (!failed) return;
        const jobPayload = buildManagedUserSyncJobPayload({
            operation,
            target: {
                id: detail.userId,
                username: detail.username,
            },
            subscriptionEmail: detail.subscriptionEmail,
            enabled: true,
            clientSync: detail.clientSync,
            deployment: detail.deployment,
        });
        if (Number(jobPayload.output?.summary?.failed || 0) <= 0 && detail?.status !== 'failed') return;
        const entry = jobStore.appendBatch({
            type: 'user_sync',
            action: operation,
            output: jobPayload.output,
            actor,
            requestSnapshot: {
                ...jobPayload.requestSnapshot,
                groupId: sync.group?.id || '',
            },
        });
        ids.push(entry.id);
    });
    return ids;
}

router.get('/', (req, res) => {
    return res.json({
        success: true,
        obj: listUserGroups(),
    });
});

router.post('/', (req, res) => {
    try {
        const actor = req.user?.username || req.user?.role || 'admin';
        const payload = normalizeGroupPayload(req.body);
        validateServerIds(payload);
        const result = createUserGroup(payload, actor);
        appendSecurityAudit('user_group_created', req, {
            groupId: result.group.id,
            groupName: result.group.name,
        });
        return res.json({ success: true, obj: result });
    } catch (error) {
        const httpError = toHttpError(error, 400, '创建用户分组失败');
        return res.status(httpError.status).json({ success: false, msg: httpError.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const actor = req.user?.username || req.user?.role || 'admin';
        const payload = normalizeGroupPayload(req.body);
        validateServerIds(payload);
        const result = await updateUserGroup(req.params.id, payload, actor);
        const syncHistoryIds = appendGroupSyncHistory(req, result.sync, 'group_policy_update');
        appendSecurityAudit('user_group_updated', req, {
            groupId: result.group.id,
            groupName: result.group.name,
            syncedUsers: result.sync.syncedUsers,
            failedUsers: result.sync.failedUsers,
            syncHistoryIds,
        });
        return res.json({
            success: true,
            msg: result.sync.failedUsers > 0
                ? '用户分组已保存，但部分 3x-ui 节点同步失败，可在任务历史中重试'
                : '用户分组已保存',
            obj: {
                ...result,
                syncHistoryIds,
            },
        });
    } catch (error) {
        const httpError = toHttpError(error, 400, '更新用户分组失败');
        return res.status(httpError.status).json({ success: false, msg: httpError.message });
    }
});

router.post('/:id/sync', async (req, res) => {
    try {
        const actor = req.user?.username || req.user?.role || 'admin';
        const sync = await syncUserGroupMembers(req.params.id, actor);
        const syncHistoryIds = appendGroupSyncHistory(req, sync, 'group_policy_sync');
        appendSecurityAudit('user_group_synced', req, {
            groupId: sync.group.id,
            groupName: sync.group.name,
            syncedUsers: sync.syncedUsers,
            failedUsers: sync.failedUsers,
            syncHistoryIds,
        });
        return res.json({
            success: true,
            msg: sync.failedUsers > 0
                ? '分组同步已完成，但部分用户存在失败项'
                : '分组同步已完成',
            obj: {
                sync,
                syncHistoryIds,
            },
        });
    } catch (error) {
        const httpError = toHttpError(error, 400, '同步用户分组失败');
        return res.status(httpError.status).json({ success: false, msg: httpError.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const actor = req.user?.username || req.user?.role || 'admin';
        const result = await deleteUserGroup(req.params.id, actor);
        const syncHistoryIds = appendGroupSyncHistory(req, result.sync, 'group_policy_delete');
        appendSecurityAudit('user_group_deleted', req, {
            groupId: result.group.id,
            groupName: result.group.name,
            affectedUsers: result.sync.totalUsers,
            failedUsers: result.sync.failedUsers,
            syncHistoryIds,
        });
        return res.json({
            success: true,
            msg: result.sync.failedUsers > 0
                ? '用户分组已删除，但部分成员同步失败'
                : '用户分组已删除',
            obj: {
                ...result,
                syncHistoryIds,
            },
        });
    } catch (error) {
        const httpError = toHttpError(error, 400, '删除用户分组失败');
        return res.status(httpError.status).json({ success: false, msg: httpError.message });
    }
});

export default router;
