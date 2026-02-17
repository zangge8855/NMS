import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import config from '../config.js';
import jobStore from '../store/jobStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import batchRiskTokenStore, {
    assessBatchRisk,
    buildBatchRiskOperationKey,
} from '../lib/batchRiskControl.js';

const router = Router();

const CLIENT_ACTIONS = new Set(['add', 'update', 'enable', 'disable', 'delete']);
const INBOUND_ACTIONS = new Set(['add', 'update', 'enable', 'disable', 'delete', 'resetTraffic']);
const FLOW_PROTOCOLS = new Set(['vless']);
const CLIENT_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);
const SENSITIVE_BATCH_ACTIONS = new Set(['delete', 'disable']);
const JOB_ID_PATTERN = '[0-9a-fA-F-]{36}';
const RETRY_GROUP_MODES = new Set(['none', 'server', 'error', 'server_error']);

function toStringValue(value) {
    if (value === undefined || value === null) return '';
    return String(value);
}

function toNumberValue(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProtocol(value) {
    return toStringValue(value).trim().toLowerCase();
}

function normalizeConcurrency(value, fallback = 5) {
    const parsed = toNumberValue(value, fallback);
    const bounded = Math.max(1, Math.floor(parsed));
    const maxConcurrency = Math.max(
        1,
        Number(systemSettingsStore.getJobs().maxConcurrency || config.jobs?.maxConcurrency || 10)
    );
    return Math.min(bounded, maxConcurrency);
}

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
        if (['0', 'false', 'no', 'off'].includes(lower)) return false;
    }
    return Boolean(value);
}

function normalizeClientIdentifier(target = {}, fallbackClient = {}, protocolHint = '') {
    if (target.clientIdentifier !== undefined && target.clientIdentifier !== null && String(target.clientIdentifier) !== '') {
        return toStringValue(target.clientIdentifier);
    }

    const protocol = normalizeProtocol(protocolHint || target.protocol || fallbackClient.protocol);
    if (PASSWORD_PROTOCOLS.has(protocol)) {
        return toStringValue(
            target.password
            || target.id
            || target.email
            || fallbackClient.password
            || fallbackClient.id
            || fallbackClient.email
        );
    }
    if (UUID_PROTOCOLS.has(protocol)) {
        return toStringValue(
            target.id
            || target.password
            || target.email
            || fallbackClient.id
            || fallbackClient.password
            || fallbackClient.email
        );
    }

    return toStringValue(
        target.id
        || target.password
        || target.email
        || fallbackClient.id
        || fallbackClient.password
        || fallbackClient.email
    );
}

function normalizeClientData(input = {}, fallbackIdentifier = '', options = {}) {
    const allowFlow = options.allowFlow !== false;
    const protocol = normalizeProtocol(options.protocol || input.protocol);
    const idValue = toStringValue(input.id);
    const passwordValue = toStringValue(input.password);
    const fallback = toStringValue(fallbackIdentifier);
    const legacyIdentifier = toStringValue(idValue || passwordValue || fallback);
    let normalizedId = '';
    let normalizedPassword = '';

    if (UUID_PROTOCOLS.has(protocol)) {
        normalizedId = toStringValue(idValue || fallback || passwordValue);
        normalizedPassword = passwordValue;
    } else if (PASSWORD_PROTOCOLS.has(protocol)) {
        normalizedId = idValue;
        normalizedPassword = toStringValue(passwordValue || fallback || idValue);
    } else {
        normalizedId = legacyIdentifier;
        normalizedPassword = toStringValue(passwordValue || legacyIdentifier);
    }

    const email = toStringValue(input.email);

    return {
        id: normalizedId,
        password: normalizedPassword,
        email,
        totalGB: toNumberValue(input.totalGB, 0),
        expiryTime: toNumberValue(input.expiryTime, 0),
        enable: normalizeBoolean(input.enable, true),
        tgId: toStringValue(input.tgId),
        subId: toStringValue(input.subId),
        limitIp: toNumberValue(input.limitIp, 0),
        flow: allowFlow ? toStringValue(input.flow) : '',
        comment: toStringValue(input.comment),
        reset: toNumberValue(input.reset, 0),
    };
}

function hasRequiredCredential(client = {}, protocol = '') {
    const normalizedProtocol = normalizeProtocol(protocol);
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return Boolean(toStringValue(client.id));
    }
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return Boolean(toStringValue(client.password));
    }
    return Boolean(toStringValue(client.id || client.password));
}

function requiredCredentialLabel(protocol = '') {
    const normalizedProtocol = normalizeProtocol(protocol);
    if (UUID_PROTOCOLS.has(normalizedProtocol)) return 'Missing client UUID';
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) return 'Missing client password';
    return 'Missing client id/password';
}

function buildFormBody(data = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
        } else {
            params.append(key, String(value));
        }
    }
    return params.toString();
}

async function postForm(client, path, data) {
    return client.post(path, buildFormBody(data), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
}

function normalizeInboundSnapshot(input = {}, enableOverride = null) {
    const normalizeJson = (value, fallback) => {
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
    };

    const enable = enableOverride === null
        ? normalizeBoolean(input.enable, true)
        : Boolean(enableOverride);
    const hasStreamSettings = Object.prototype.hasOwnProperty.call(input, 'streamSettings');

    return {
        id: toNumberValue(input.id),
        remark: toStringValue(input.remark),
        protocol: toStringValue(input.protocol),
        port: toNumberValue(input.port),
        listen: toStringValue(input.listen),
        total: toNumberValue(input.total, 0),
        expiryTime: toNumberValue(input.expiryTime, 0),
        settings: normalizeJson(input.settings, '{}'),
        streamSettings: hasStreamSettings ? normalizeJson(input.streamSettings, '{}') : undefined,
        sniffing: normalizeJson(
            input.sniffing,
            JSON.stringify({ enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'], metadataOnly: false, routeOnly: false })
        ),
        enable,
    };
}

async function runWithConcurrency(items, worker, concurrency = 5) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];

    const size = Math.max(1, Math.min(concurrency, list.length));
    const results = new Array(list.length);
    let cursor = 0;

    const runners = Array.from({ length: size }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= list.length) break;
            results[index] = await worker(list[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}

function summarizeBatchResults(action, results) {
    const total = results.length;
    const success = results.filter((item) => item.success).length;
    const failed = total - success;
    return {
        action,
        summary: { total, success, failed },
        results,
    };
}

function defaultConcurrencyFallback() {
    return Math.max(1, Number(systemSettingsStore.getJobs().defaultConcurrency || 5));
}

function safeClone(value) {
    if (value === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function pushBatchHistory(type, action, output, req, requestSnapshot, extra = {}) {
    return jobStore.appendBatch({
        type,
        action,
        output,
        actor: req.user?.role || 'unknown',
        requestSnapshot: safeClone(requestSnapshot),
        retryOf: extra.retryOf || null,
        risk: safeClone(extra.risk || null),
        retryStrategy: safeClone(extra.retryStrategy || null),
    });
}

function toHistoryItem(entry, includeResults = false) {
    return {
        id: entry.id,
        type: entry.type,
        action: entry.action,
        status: entry.status || 'unknown',
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt || entry.createdAt,
        canceledAt: entry.canceledAt || null,
        actor: entry.actor,
        summary: entry.summary,
        retryOf: entry.retryOf,
        risk: entry.risk || null,
        retryStrategy: entry.retryStrategy || null,
        failureGroups: Array.isArray(entry.failureGroups) ? entry.failureGroups : [],
        results: includeResults ? entry.results : undefined,
    };
}

async function executeClientAction({ action, target, globalClient }) {
    const targetProtocol = normalizeProtocol(target.protocol);
    const clientIdentifier = normalizeClientIdentifier(target, globalClient, targetProtocol);
    const baseResult = {
        action,
        serverId: target.serverId || null,
        serverName: target.serverName || '',
        inboundId: target.inboundId || null,
        email: target.email || target.client?.email || globalClient?.email || '',
        protocol: targetProtocol || '',
        clientIdentifier,
    };

    try {
        if (!target.serverId) throw new Error('Missing serverId');
        if (!target.inboundId) throw new Error('Missing inboundId');

        const client = await ensureAuthenticated(target.serverId);

        if (targetProtocol && !CLIENT_PROTOCOLS.has(targetProtocol)) {
            throw new Error(`Unsupported client protocol for batch clients action: ${targetProtocol}`);
        }
        const allowFlow = !targetProtocol || FLOW_PROTOCOLS.has(targetProtocol);

        if (action === 'add') {
            const clientData = normalizeClientData(
                target.client || globalClient || {},
                clientIdentifier,
                { allowFlow, protocol: targetProtocol }
            );
            if (!hasRequiredCredential(clientData, targetProtocol)) {
                throw new Error(requiredCredentialLabel(targetProtocol));
            }

            await postForm(client, '/panel/api/inbounds/addClient', {
                id: target.inboundId,
                settings: { clients: [clientData] },
            });

            return {
                ...baseResult,
                success: true,
                msg: 'Client added',
            };
        }

        if (action === 'delete') {
            // 3x-ui delClient API always matches by client UUID (id field),
            // regardless of protocol. Use target.id first, fall back to clientIdentifier.
            const deleteId = toStringValue(target.id) || clientIdentifier;
            if (!deleteId) throw new Error('Missing client identifier');

            const encoded = encodeURIComponent(deleteId);
            try {
                await client.post(`/panel/api/inbounds/${target.inboundId}/delClient/${encoded}`);
            } catch {
                await client.post(`/panel/api/inbounds/delClient/${target.inboundId}`, {
                    id: deleteId,
                });
            }

            return {
                ...baseResult,
                success: true,
                msg: 'Client deleted',
            };
        }

        if (!clientIdentifier) throw new Error('Missing client identifier');

        const normalizedClient = normalizeClientData(
            target.client || globalClient || {},
            clientIdentifier,
            { allowFlow, protocol: targetProtocol }
        );
        if (!hasRequiredCredential(normalizedClient, targetProtocol)) {
            throw new Error(requiredCredentialLabel(targetProtocol));
        }

        if (action === 'enable') normalizedClient.enable = true;
        if (action === 'disable') normalizedClient.enable = false;

        const encoded = encodeURIComponent(clientIdentifier);
        try {
            await postForm(client, `/panel/api/inbounds/updateClient/${encoded}`, {
                id: target.inboundId,
                settings: { clients: [normalizedClient] },
            });
        } catch {
            await client.post(`/panel/api/inbounds/updateClient/${encoded}`, normalizedClient);
        }

        return {
            ...baseResult,
            success: true,
            msg: action === 'update'
                ? 'Client updated'
                : (action === 'enable' ? 'Client enabled' : 'Client disabled'),
        };
    } catch (error) {
        return {
            ...baseResult,
            success: false,
            retriable: true,
            msg: error.message,
        };
    }
}

async function executeInboundAction({ action, target, payload }) {
    const baseResult = {
        action,
        serverId: target.serverId || null,
        serverName: target.serverName || '',
        inboundId: target.id || target.inboundId || null,
        remark: target.remark || '',
        protocol: target.protocol || '',
        port: target.port || null,
    };

    try {
        if (!target.serverId) throw new Error('Missing serverId');
        const client = await ensureAuthenticated(target.serverId);

        if (action === 'add') {
            const inboundData = normalizeInboundSnapshot(payload || {});
            if (!inboundData.protocol) throw new Error('Missing protocol');
            if (!inboundData.port) throw new Error('Missing port');

            await postForm(client, '/panel/api/inbounds/add', {
                ...inboundData,
                id: undefined,
            });

            return {
                ...baseResult,
                success: true,
                msg: 'Inbound added',
            };
        }

        const inboundId = target.id || target.inboundId;
        if (!inboundId) throw new Error('Missing inbound id');

        if (action === 'delete') {
            await client.post(`/panel/api/inbounds/del/${inboundId}`);
            return {
                ...baseResult,
                success: true,
                msg: 'Inbound deleted',
            };
        }

        if (action === 'resetTraffic') {
            await client.post(`/panel/api/inbounds/resetTraffic/${inboundId}`);
            return {
                ...baseResult,
                success: true,
                msg: 'Inbound traffic reset',
            };
        }

        const enableOverride = action === 'enable'
            ? true
            : (action === 'disable' ? false : null);
        const merged = {
            ...target,
            ...(payload || {}),
        };
        const inboundData = normalizeInboundSnapshot(merged, enableOverride);

        await postForm(client, `/panel/api/inbounds/update/${inboundId}`, inboundData);

        return {
            ...baseResult,
            success: true,
            msg: action === 'update'
                ? 'Inbound updated'
                : (action === 'enable' ? 'Inbound enabled' : 'Inbound disabled'),
        };
    } catch (error) {
        return {
            ...baseResult,
            success: false,
            retriable: true,
            msg: error.message,
        };
    }
}

async function performClientBatch({ action, targets, concurrency, globalClient }) {
    if (!CLIENT_ACTIONS.has(action)) {
        return {
            error: {
                status: 400,
                msg: `Unsupported client action: ${action}`,
            },
        };
    }
    if (!Array.isArray(targets) || targets.length === 0) {
        return {
            error: {
                status: 400,
                msg: 'targets is required',
            },
        };
    }

    const results = await runWithConcurrency(
        targets,
        (target) => executeClientAction({
            action,
            target,
            globalClient,
        }),
        concurrency
    );
    return { output: summarizeBatchResults(action, results) };
}

async function performInboundBatch({ action, targets, payload, serverIds, concurrency }) {
    if (!INBOUND_ACTIONS.has(action)) {
        return {
            error: {
                status: 400,
                msg: `Unsupported inbound action: ${action}`,
            },
        };
    }

    if (action === 'add') {
        const addTargets = Array.isArray(targets) && targets.length > 0
            ? targets
            : (Array.isArray(serverIds)
                ? serverIds.map((serverId) => ({ serverId }))
                : []);

        if (addTargets.length === 0) {
            return {
                error: {
                    status: 400,
                    msg: 'targets or serverIds is required for add action',
                },
            };
        }

        const results = await runWithConcurrency(
            addTargets,
            (target) => executeInboundAction({
                action,
                target,
                payload: target.payload || payload,
            }),
            concurrency
        );
        return { output: summarizeBatchResults(action, results) };
    }

    if (!Array.isArray(targets) || targets.length === 0) {
        return {
            error: {
                status: 400,
                msg: 'targets is required',
            },
        };
    }

    const results = await runWithConcurrency(
        targets,
        (target) => executeInboundAction({ action, target, payload }),
        concurrency
    );
    return { output: summarizeBatchResults(action, results) };
}

function buildClientTargetKey(target = {}) {
    return [
        toStringValue(target.serverId),
        toStringValue(target.inboundId),
        toStringValue(normalizeClientIdentifier(target) || target.email),
    ].join('|');
}

function buildInboundTargetKey(target = {}) {
    const inboundId = target.id ?? target.inboundId;
    return [
        toStringValue(target.serverId),
        toStringValue(inboundId),
    ].join('|');
}

function normalizeRetryGroupBy(value) {
    const text = toStringValue(value).trim().toLowerCase();
    if (!text || !RETRY_GROUP_MODES.has(text)) return 'none';
    return text;
}

function buildRetryGroupKey(item, groupBy) {
    const serverId = toStringValue(item?.serverId || item?.serverName || 'unknown-server');
    const error = toStringValue(item?.msg || 'unknown-error');
    if (groupBy === 'server') return `server:${serverId}`;
    if (groupBy === 'error') return `error:${error}`;
    if (groupBy === 'server_error') return `server_error:${serverId}|${error}`;
    return 'all';
}

function buildRetryGroups(failedResults, groupBy) {
    if (groupBy === 'none') return [];
    const map = new Map();
    failedResults.forEach((item) => {
        const key = buildRetryGroupKey(item, groupBy);
        if (!map.has(key)) {
            map.set(key, {
                key,
                count: 0,
                serverId: toStringValue(item?.serverId || ''),
                serverName: toStringValue(item?.serverName || ''),
                error: toStringValue(item?.msg || ''),
            });
        }
        map.get(key).count += 1;
    });

    return Array.from(map.values())
        .sort((a, b) => b.count - a.count);
}

function filterFailedResultsByGroup(failedResults, groupBy, groupKey) {
    if (!groupKey || groupBy === 'none') return failedResults;
    return failedResults.filter((item) => buildRetryGroupKey(item, groupBy) === groupKey);
}

function buildRetryRequestSnapshot(entry, options = {}) {
    const failedOnly = options.failedOnly !== false;
    const overrideConcurrency = options.overrideConcurrency;
    const groupBy = normalizeRetryGroupBy(options.groupBy);
    const requestedGroupKey = toStringValue(options.groupKey);

    const snapshot = safeClone(entry.request) || {};
    const results = Array.isArray(entry.results) ? entry.results : [];

    if (overrideConcurrency !== null && overrideConcurrency !== undefined) {
        snapshot.concurrency = overrideConcurrency;
    }

    const failed = results.filter((item) => item && item.success === false);
    const groups = buildRetryGroups(failed, groupBy);
    const validGroupKeys = new Set(groups.map((item) => item.key));
    const groupKey = requestedGroupKey || '';
    const selectedFailed = requestedGroupKey && !validGroupKeys.has(requestedGroupKey)
        ? []
        : filterFailedResultsByGroup(failed, groupBy, groupKey);

    if (!failedOnly) {
        return {
            snapshot,
            failedOnly,
            groupBy,
            groupKey,
            groups,
            totalFailedCount: failed.length,
            selectedFailedCount: selectedFailed.length,
        };
    }

    if (selectedFailed.length === 0) {
        return {
            snapshot: {
                ...snapshot,
                targets: [],
                serverIds: [],
            },
            failedOnly,
            groupBy,
            groupKey,
            groups,
            totalFailedCount: failed.length,
            selectedFailedCount: 0,
        };
    }

    if (entry.type === 'clients') {
        const failedKeys = new Set(selectedFailed.map((item) => buildClientTargetKey(item)));
        const currentTargets = Array.isArray(snapshot.targets) ? snapshot.targets : [];
        snapshot.targets = currentTargets.filter((target) => failedKeys.has(buildClientTargetKey(target)));
    } else if (entry.type === 'inbounds') {
        if (entry.action === 'add') {
            const failedServerIds = new Set(selectedFailed.map((item) => toStringValue(item.serverId)));
            if (Array.isArray(snapshot.targets) && snapshot.targets.length > 0) {
                snapshot.targets = snapshot.targets.filter((target) => failedServerIds.has(toStringValue(target.serverId)));
            } else if (Array.isArray(snapshot.serverIds)) {
                snapshot.serverIds = snapshot.serverIds.filter((id) => failedServerIds.has(toStringValue(id)));
            }
        } else {
            const failedKeys = new Set(selectedFailed.map((item) => buildInboundTargetKey(item)));
            const currentTargets = Array.isArray(snapshot.targets) ? snapshot.targets : [];
            snapshot.targets = currentTargets.filter((target) => failedKeys.has(buildInboundTargetKey(target)));
        }
    }

    return {
        snapshot,
        failedOnly,
        groupBy,
        groupKey,
        groups,
        totalFailedCount: failed.length,
        selectedFailedCount: selectedFailed.length,
    };
}

function inferInboundTargetCount(action, targets = [], serverIds = []) {
    if (action === 'add') {
        if (Array.isArray(targets) && targets.length > 0) return targets.length;
        if (Array.isArray(serverIds) && serverIds.length > 0) return serverIds.length;
        return 0;
    }
    return Array.isArray(targets) ? targets.length : 0;
}

function buildRiskEnvelope({ type, action, targetCount, isRetry = false }) {
    return assessBatchRisk({
        type,
        action,
        targetCount,
        isRetry,
        securitySettings: systemSettingsStore.getSecurity(),
    });
}

function consumeRiskTokenIfRequired(req, { type, action, targetCount, isRetry = false }) {
    const risk = buildRiskEnvelope({
        type,
        action,
        targetCount,
        isRetry,
    });
    if (!risk.requiresToken) {
        return { risk, error: null };
    }

    const token = toStringValue(req.body?.confirmToken);
    const operationKey = buildBatchRiskOperationKey({
        type,
        action,
        isRetry,
    });
    const consumed = batchRiskTokenStore.consume({
        token,
        actor: {
            userId: req.user?.userId,
            username: req.user?.username,
            role: req.user?.role,
        },
        operationKey,
    });
    if (!consumed.ok) {
        return {
            risk,
            error: {
                status: 403,
                msg: 'High-risk action requires a valid confirmation token',
                reason: consumed.reason,
            },
        };
    }
    return { risk, error: null };
}

router.use(authMiddleware);

function getHistoryEntry(id) {
    return jobStore.getById(id);
}

function buildHistoryListResponse(req, options = {}) {
    const includeResults = normalizeBoolean(
        options.includeResults !== undefined
            ? options.includeResults
            : req.query.includeResults,
        false
    );
    const listResult = jobStore.list({
        page: options.page !== undefined ? options.page : req.query.page,
        pageSize: options.pageSize !== undefined ? options.pageSize : req.query.pageSize,
        limit: options.limit !== undefined ? options.limit : req.query.limit,
        type: options.type !== undefined ? options.type : req.query.type,
        action: options.action !== undefined ? options.action : req.query.action,
        status: options.status !== undefined ? options.status : req.query.status,
    });
    return {
        success: true,
        obj: {
            total: listResult.total,
            page: listResult.page,
            pageSize: listResult.pageSize,
            totalPages: listResult.totalPages,
            items: listResult.items.map((entry) => toHistoryItem(entry, includeResults)),
        },
    };
}

async function retryHistoryItem(historyItem, req) {
    if (!historyItem?.request) {
        return {
            error: {
                status: 400,
                msg: 'This batch item cannot be retried',
            },
        };
    }

    const failedOnly = normalizeBoolean(req.body?.failedOnly, true);
    const overrideConcurrency = req.body?.concurrency !== undefined
        ? normalizeConcurrency(req.body?.concurrency, defaultConcurrencyFallback())
        : undefined;
    const retrySelection = buildRetryRequestSnapshot(historyItem, {
        failedOnly,
        overrideConcurrency,
        groupBy: req.body?.groupBy,
        groupKey: req.body?.groupKey,
    });
    const retryRequest = retrySelection.snapshot;

    if (
        failedOnly
        && normalizeRetryGroupBy(req.body?.groupBy) !== 'none'
        && req.body?.groupKey
        && retrySelection.selectedFailedCount === 0
    ) {
        return {
            error: {
                status: 400,
                msg: 'No failed items matched the selected retry group',
            },
        };
    }

    if (historyItem.type === 'clients' && (!Array.isArray(retryRequest.targets) || retryRequest.targets.length === 0)) {
        return {
            error: {
                status: 400,
                msg: 'No retryable client targets',
            },
        };
    }

    if (historyItem.type === 'inbounds') {
        const addMode = historyItem.action === 'add';
        const hasTargets = Array.isArray(retryRequest.targets) && retryRequest.targets.length > 0;
        const hasServerIds = Array.isArray(retryRequest.serverIds) && retryRequest.serverIds.length > 0;
        if ((addMode && !hasTargets && !hasServerIds) || (!addMode && !hasTargets)) {
            return {
                error: {
                    status: 400,
                    msg: 'No retryable inbound targets',
                },
            };
        }
    }

    const targetCount = historyItem.type === 'clients'
        ? (Array.isArray(retryRequest.targets) ? retryRequest.targets.length : 0)
        : inferInboundTargetCount(historyItem.action, retryRequest.targets, retryRequest.serverIds);
    const riskCheck = consumeRiskTokenIfRequired(req, {
        type: historyItem.type,
        action: historyItem.action,
        targetCount,
        isRetry: true,
    });
    if (riskCheck.error) {
        return {
            error: {
                status: riskCheck.error.status,
                msg: riskCheck.error.msg,
            },
            risk: riskCheck.risk,
        };
    }

    let run;
    if (historyItem.type === 'clients') {
        run = await performClientBatch({
            action: historyItem.action,
            targets: retryRequest.targets || [],
            concurrency: normalizeConcurrency(retryRequest.concurrency, defaultConcurrencyFallback()),
            globalClient: retryRequest.client,
        });
    } else if (historyItem.type === 'inbounds') {
        run = await performInboundBatch({
            action: historyItem.action,
            targets: retryRequest.targets || [],
            payload: retryRequest.payload || null,
            serverIds: retryRequest.serverIds || [],
            concurrency: normalizeConcurrency(retryRequest.concurrency, defaultConcurrencyFallback()),
        });
    } else {
        return {
            error: {
                status: 400,
                msg: `Unsupported history type: ${historyItem.type}`,
            },
        };
    }

    if (run.error) {
        return {
            error: {
                status: run.error.status,
                msg: run.error.msg,
            },
        };
    }

    return {
        run: run.output,
        retryRequest,
        failedOnly,
        risk: riskCheck.risk,
        retryGroups: retrySelection.groups,
        groupBy: retrySelection.groupBy,
        groupKey: retrySelection.groupKey,
        retryStrategy: {
            groupBy: retrySelection.groupBy,
            groupKey: retrySelection.groupKey,
            totalFailedCount: retrySelection.totalFailedCount,
            selectedFailedCount: retrySelection.selectedFailedCount,
        },
    };
}

router.get('/history', (req, res) => {
    return res.json(buildHistoryListResponse(req, {
        limit: Math.max(1, Math.min(toNumberValue(req.query.limit, 50), 500)),
    }));
});

router.get('/history/:id', (req, res) => {
    const item = getHistoryEntry(req.params.id);
    if (!item) {
        return res.status(404).json({
            success: false,
            msg: 'Batch history item not found',
        });
    }
    return res.json({
        success: true,
        obj: toHistoryItem(item, true),
    });
});

router.delete('/history', (req, res) => {
    const cleared = jobStore.clear();
    appendSecurityAudit('batch_history_cleared', req, { cleared });
    return res.json({
        success: true,
        msg: `Cleared ${cleared} batch history records`,
    });
});

router.post('/clients', async (req, res) => {
    const action = String(req.body?.action || '').trim();
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const concurrency = normalizeConcurrency(req.body?.concurrency, defaultConcurrencyFallback());
    if (!CLIENT_ACTIONS.has(action)) {
        return res.status(400).json({
            success: false,
            msg: `Unsupported client action: ${action}`,
        });
    }
    if (targets.length === 0) {
        return res.status(400).json({
            success: false,
            msg: 'targets is required',
        });
    }

    const riskCheck = consumeRiskTokenIfRequired(req, {
        type: 'clients',
        action,
        targetCount: targets.length,
        isRetry: false,
    });
    if (riskCheck.error) {
        return res.status(riskCheck.error.status).json({
            success: false,
            msg: riskCheck.error.msg,
        });
    }

    const run = await performClientBatch({
        action,
        targets,
        concurrency,
        globalClient: req.body?.client,
    });
    if (run.error) {
        return res.status(run.error.status).json({
            success: false,
            msg: run.error.msg,
        });
    }

    const output = {
        ...run.output,
        risk: riskCheck.risk,
    };
    const historyEntry = pushBatchHistory(
        'clients',
        action,
        output,
        req,
        {
            action,
            targets,
            client: req.body?.client,
            concurrency,
        },
        { risk: riskCheck.risk }
    );
    if (SENSITIVE_BATCH_ACTIONS.has(action)) {
        appendSecurityAudit('batch_clients_sensitive_action', req, {
            action,
            total: output.summary.total,
            failed: output.summary.failed,
            historyId: historyEntry.id,
            riskLevel: riskCheck.risk.level,
        });
    } else if (riskCheck.risk.level === 'high') {
        appendSecurityAudit('batch_clients_high_risk_action', req, {
            action,
            total: output.summary.total,
            failed: output.summary.failed,
            historyId: historyEntry.id,
            riskLevel: riskCheck.risk.level,
        });
    }
    return res.status(output.summary.failed > 0 ? 207 : 200).json({
        success: output.summary.failed === 0,
        obj: {
            ...output,
            historyId: historyEntry.id,
        },
    });
});

router.post('/inbounds', async (req, res) => {
    const action = String(req.body?.action || '').trim();
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const payload = req.body?.payload || null;
    const serverIds = Array.isArray(req.body?.serverIds) ? req.body.serverIds : [];
    const concurrency = normalizeConcurrency(req.body?.concurrency, defaultConcurrencyFallback());
    if (!INBOUND_ACTIONS.has(action)) {
        return res.status(400).json({
            success: false,
            msg: `Unsupported inbound action: ${action}`,
        });
    }
    if (action === 'add') {
        if (targets.length === 0 && serverIds.length === 0) {
            return res.status(400).json({
                success: false,
                msg: 'targets or serverIds is required for add action',
            });
        }
    } else if (targets.length === 0) {
        return res.status(400).json({
            success: false,
            msg: 'targets is required',
        });
    }

    const riskCheck = consumeRiskTokenIfRequired(req, {
        type: 'inbounds',
        action,
        targetCount: inferInboundTargetCount(action, targets, serverIds),
        isRetry: false,
    });
    if (riskCheck.error) {
        return res.status(riskCheck.error.status).json({
            success: false,
            msg: riskCheck.error.msg,
        });
    }

    const run = await performInboundBatch({
        action,
        targets,
        payload,
        serverIds,
        concurrency,
    });
    if (run.error) {
        return res.status(run.error.status).json({
            success: false,
            msg: run.error.msg,
        });
    }

    const output = {
        ...run.output,
        risk: riskCheck.risk,
    };
    const historyEntry = pushBatchHistory(
        'inbounds',
        action,
        output,
        req,
        {
            action,
            targets,
            payload,
            serverIds,
            concurrency,
        },
        { risk: riskCheck.risk }
    );
    if (SENSITIVE_BATCH_ACTIONS.has(action)) {
        appendSecurityAudit('batch_inbounds_sensitive_action', req, {
            action,
            total: output.summary.total,
            failed: output.summary.failed,
            historyId: historyEntry.id,
            riskLevel: riskCheck.risk.level,
        });
    } else if (riskCheck.risk.level === 'high') {
        appendSecurityAudit('batch_inbounds_high_risk_action', req, {
            action,
            total: output.summary.total,
            failed: output.summary.failed,
            historyId: historyEntry.id,
            riskLevel: riskCheck.risk.level,
        });
    }
    return res.status(output.summary.failed > 0 ? 207 : 200).json({
        success: output.summary.failed === 0,
        obj: {
            ...output,
            historyId: historyEntry.id,
        },
    });
});

router.post('/history/:id/retry', async (req, res) => {
    const historyItem = getHistoryEntry(req.params.id);
    if (!historyItem) {
        return res.status(404).json({
            success: false,
            msg: 'Batch history item not found',
        });
    }

    const retried = await retryHistoryItem(historyItem, req);
    if (retried.error) {
        return res.status(retried.error.status).json({
            success: false,
            msg: retried.error.msg,
        });
    }

    const output = retried.run;
    const historyEntry = pushBatchHistory(
        historyItem.type,
        historyItem.action,
        output,
        req,
        retried.retryRequest,
        {
            retryOf: historyItem.id,
            risk: retried.risk || null,
            retryStrategy: retried.retryStrategy || null,
        }
    );
    if (SENSITIVE_BATCH_ACTIONS.has(historyItem.action)) {
        appendSecurityAudit('batch_sensitive_retry', req, {
            type: historyItem.type,
            action: historyItem.action,
            sourceHistoryId: historyItem.id,
            retryHistoryId: historyEntry.id,
            total: output.summary.total,
            failed: output.summary.failed,
            riskLevel: retried.risk?.level || 'unknown',
        });
    } else if (retried.risk?.level === 'high') {
        appendSecurityAudit('batch_high_risk_retry', req, {
            type: historyItem.type,
            action: historyItem.action,
            sourceHistoryId: historyItem.id,
            retryHistoryId: historyEntry.id,
            total: output.summary.total,
            failed: output.summary.failed,
            riskLevel: retried.risk.level,
        });
    }

    return res.status(output.summary.failed > 0 ? 207 : 200).json({
        success: output.summary.failed === 0,
        obj: {
            ...output,
            risk: retried.risk || null,
            retryGroups: retried.retryGroups || [],
            retryStrategy: retried.retryStrategy || null,
            historyId: historyEntry.id,
            retriedFrom: historyItem.id,
            failedOnly: retried.failedOnly,
        },
    });
});

router.post('/history/:id/cancel', (req, res) => {
    const canceled = jobStore.markCanceled(req.params.id);
    if (!canceled) {
        return res.status(409).json({
            success: false,
            msg: 'Job is not cancellable',
        });
    }
    appendSecurityAudit('batch_history_canceled', req, {
        historyId: req.params.id,
    });
    return res.json({
        success: true,
        obj: toHistoryItem(canceled, true),
    });
});

// Job-style aliases for /api/jobs mount.
router.get('/', (req, res) => {
    return res.json(buildHistoryListResponse(req));
});

router.get(`/:id(${JOB_ID_PATTERN})`, (req, res) => {
    const item = getHistoryEntry(req.params.id);
    if (!item) {
        return res.status(404).json({
            success: false,
            msg: 'Job not found',
        });
    }
    return res.json({
        success: true,
        obj: toHistoryItem(item, true),
    });
});

router.post(`/:id(${JOB_ID_PATTERN})/retry`, async (req, res) => {
    const historyItem = getHistoryEntry(req.params.id);
    if (!historyItem) {
        return res.status(404).json({
            success: false,
            msg: 'Job not found',
        });
    }

    const retried = await retryHistoryItem(historyItem, req);
    if (retried.error) {
        return res.status(retried.error.status).json({
            success: false,
            msg: retried.error.msg,
        });
    }

    const historyEntry = pushBatchHistory(
        historyItem.type,
        historyItem.action,
        retried.run,
        req,
        retried.retryRequest,
        {
            retryOf: historyItem.id,
            risk: retried.risk || null,
            retryStrategy: retried.retryStrategy || null,
        }
    );
    if (retried.risk?.level === 'high') {
        appendSecurityAudit('batch_high_risk_retry', req, {
            type: historyItem.type,
            action: historyItem.action,
            sourceHistoryId: historyItem.id,
            retryHistoryId: historyEntry.id,
            total: retried.run.summary.total,
            failed: retried.run.summary.failed,
            riskLevel: retried.risk.level,
        });
    }
    return res.status(retried.run.summary.failed > 0 ? 207 : 200).json({
        success: retried.run.summary.failed === 0,
        obj: {
            ...retried.run,
            risk: retried.risk || null,
            retryGroups: retried.retryGroups || [],
            retryStrategy: retried.retryStrategy || null,
            historyId: historyEntry.id,
            retriedFrom: historyItem.id,
            failedOnly: retried.failedOnly,
        },
    });
});

router.post(`/:id(${JOB_ID_PATTERN})/cancel`, (req, res) => {
    const canceled = jobStore.markCanceled(req.params.id);
    if (!canceled) {
        return res.status(409).json({
            success: false,
            msg: 'Job is not cancellable',
        });
    }
    return res.json({
        success: true,
        obj: toHistoryItem(canceled, true),
    });
});

export default router;
