import React, { useState, useEffect, useMemo } from 'react';
import { HiOutlineXMark, HiOutlineCheck, HiOutlineArrowPath } from 'react-icons/hi2';
import api from '../../api/client.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import {
    normalizeProtocol,
    UUID_PROTOCOLS, PASSWORD_PROTOCOLS,
} from '../../utils/protocol.js';
import { generateSecurePassword, generateUuidLocal, generateHexToken } from '../../utils/crypto.js';
import ModalShell from '../UI/ModalShell.jsx';
import toast from 'react-hot-toast';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import {
    bytesPerSecondToKilobytesInput,
    bytesToGigabytesInput,
    gigabytesInputToBytes,
    kilobytesInputToBytesPerSecond,
} from '../../utils/entitlements.js';

const BATCH_CLIENT_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);

function resolveResponseMsg(data, fallback = '') {
    if (!data || typeof data !== 'object') return fallback;
    const primary = String(data.msg || '').trim();
    if (primary) return primary;
    const secondary = String(data.message || '').trim();
    if (secondary) return secondary;
    return fallback;
}

function assertOperationSucceeded(response, fallbackMsg = 'Operation failed') {
    const data = response?.data;
    if (!data || typeof data !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(data, 'success') && data.success === false) {
        throw new Error(resolveResponseMsg(data, fallbackMsg));
    }
}

function resolveClientIdentifier(client = {}, protocol = '') {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return client.password || client.id || client.email || '';
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return client.id || client.password || client.email || '';
    }
    return client.id || client.password || client.email || '';
}

function buildStableSubId(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return '';
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36).padEnd(16, '0').slice(0, 16);
}

function toLocalDateTimeInput(timestampMs) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(input) {
    const text = String(input || '').trim();
    if (!text) return 0;
    const parsed = new Date(text);
    const ts = parsed.getTime();
    return Number.isFinite(ts) ? ts : 0;
}

function getTargetKey(target = {}) {
    const server = String(target.serverId || '').trim();
    const inbound = String(target.id || target.inboundId || '').trim();
    if (!server || !inbound) return '';
    return `${server}::${inbound}`;
}

export default function ClientModal({
    isOpen,
    onClose,
    inboundId,
    serverId,
    inboundProtocol = '',
    targets = [],
    editingClient = null,
    onSuccess,
    onBatchResult,
}) {
    const { locale, t } = useI18n();
    const [loading, setLoading] = useState(false);

    const [email, setEmail] = useState('');
    const [uuid, setUuid] = useState('');
    const [password, setPassword] = useState('');
    const [subId, setSubId] = useState('');
    const [totalGB, setTotalGB] = useState(0);
    const [_expiryTime, setExpiryTime] = useState(0);
    const [expiryMode, setExpiryMode] = useState('never');
    const [expiryDateTime, setExpiryDateTime] = useState('');
    const [expiryAfterDays, setExpiryAfterDays] = useState('');
    const [enable, setEnable] = useState(true);
    const [limitIp, setLimitIp] = useState(0);
    const [speedLimitUp, setSpeedLimitUp] = useState(0);
    const [speedLimitDown, setSpeedLimitDown] = useState(0);
    const [tgId, setTgId] = useState('');
    const [comment, setComment] = useState('');
    const [reset, setReset] = useState(0);
    const [flow, setFlow] = useState('');
    const [editTargets, setEditTargets] = useState([]);
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const [selectedInboundKeys, setSelectedInboundKeys] = useState([]);
    const [baseFlowOptions, setBaseFlowOptions] = useState(['', 'xtls-rprx-vision']);
    const [flowProtocols, setFlowProtocols] = useState(['vless']);
    const flowOptions = useMemo(() => {
        if (flow && !baseFlowOptions.includes(flow)) {
            return [...baseFlowOptions, flow];
        }
        return baseFlowOptions;
    }, [flow, baseFlowOptions]);

    useEffect(() => {
        if (isOpen) {
            if (editingClient) {
                const editScopeTargets = Array.isArray(editingClient.editTargets) && editingClient.editTargets.length > 0
                    ? editingClient.editTargets
                    : [editingClient];
                const protocolSet = new Set(
                    editScopeTargets.map((item) => normalizeProtocol(item?.protocol)).filter(Boolean)
                );
                const needsUuid = protocolSet.size === 0 || Array.from(protocolSet).some((item) => UUID_PROTOCOLS.has(item));
                const needsPassword = Array.from(protocolSet).some((item) => PASSWORD_PROTOCOLS.has(item));
                const currentId = String(editingClient.id || '').trim();
                const currentPassword = String(editingClient.password || '').trim();

                setEmail(editingClient.email);
                setUuid(currentId || (needsUuid ? currentPassword : ''));
                setPassword(currentPassword || (needsPassword ? currentId : ''));
                setSubId(editingClient.subId || '');
                setTotalGB(bytesToGigabytesInput(editingClient.totalGB));
                {
                    const rawExpiry = Number(editingClient.expiryTime || 0);
                    setExpiryTime(rawExpiry);
                    if (rawExpiry > 0) {
                        setExpiryMode('datetime');
                        setExpiryDateTime(toLocalDateTimeInput(rawExpiry));
                    } else {
                        setExpiryMode('never');
                        setExpiryDateTime('');
                    }
                    setExpiryAfterDays('');
                }
                setEnable(editingClient.enable !== false);
                setLimitIp(editingClient.limitIp || 0);
                setSpeedLimitUp(bytesPerSecondToKilobytesInput(editingClient.speedLimitUp));
                setSpeedLimitDown(bytesPerSecondToKilobytesInput(editingClient.speedLimitDown));
                setTgId(String(editingClient.tgId || ''));
                setComment(String(editingClient.comment || ''));
                setReset(Number(editingClient.reset || 0));
                setFlow(editingClient.flow || '');
                setEditTargets(Array.isArray(editingClient.editTargets) ? editingClient.editTargets : []);
                setSelectedServerIds([]);
                setSelectedInboundKeys([]);
            } else {
                const addProtocolSet = new Set((targets || []).map((item) => normalizeProtocol(item?.protocol)).filter(Boolean));
                const normalizedInboundProtocol = normalizeProtocol(inboundProtocol);
                if (addProtocolSet.size === 0 && normalizedInboundProtocol) {
                    addProtocolSet.add(normalizedInboundProtocol);
                }
                const needsUuid = addProtocolSet.size === 0 || Array.from(addProtocolSet).some((item) => UUID_PROTOCOLS.has(item));
                const needsPassword = Array.from(addProtocolSet).some((item) => PASSWORD_PROTOCOLS.has(item));

                setEmail('user_' + Math.random().toString(36).substring(7));
                setUuid(needsUuid ? generateUuidLocal() : '');
                setPassword(needsPassword ? generateSecurePassword() : '');
                setSubId('');
                setTotalGB(0);
                setExpiryTime(0);
                setExpiryMode('never');
                setExpiryDateTime('');
                setExpiryAfterDays('');
                setEnable(true);
                setLimitIp(0);
                setTgId('');
                setComment('');
                setReset(0);
                setFlow('');
                setEditTargets([]);
                const uniqueServerIds = Array.from(new Set((targets || []).map((t) => t.serverId).filter(Boolean)));
                setSelectedServerIds(uniqueServerIds);
                setSelectedInboundKeys((targets || []).map((item) => getTargetKey(item)).filter(Boolean));
            }
        }
    }, [editingClient, inboundProtocol, isOpen, targets]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const loadFlowOptions = async () => {
            try {
                const res = await api.get('/protocol-schemas');
                const options = Array.isArray(res.data?.obj?.clientFlowOptions)
                    ? res.data.obj.clientFlowOptions
                    : [];
                const normalized = options.map((item) => String(item));
                if (!cancelled && normalized.length > 0) {
                    setBaseFlowOptions(normalized);
                }
                const protocolList = Array.isArray(res.data?.obj?.clientFlowProtocols)
                    ? res.data.obj.clientFlowProtocols.map((item) => String(item))
                    : [];
                if (!cancelled && protocolList.length > 0) {
                    setFlowProtocols(protocolList);
                }
            } catch {
                if (!cancelled) {
                    setBaseFlowOptions(['', 'xtls-rprx-vision']);
                    setFlowProtocols(['vless']);
                }
            }
        };
        loadFlowOptions();
        return () => { cancelled = true; };
    }, [isOpen]);

    const generateUUID = async () => {
        if (serverId) {
            try {
                const res = await api.get(`/panel/${serverId}/panel/api/server/getNewUUID`);
                if (res.data?.obj) {
                    setUuid(res.data.obj);
                    return;
                }
            } catch { }
        }
        setUuid(generateUuidLocal());
    };

    const availableServers = useMemo(() => {
        const map = new Map();
        (targets || []).forEach((item) => {
            if (!item?.serverId) return;
            if (!map.has(item.serverId)) {
                map.set(item.serverId, item.serverName || String(item.serverId));
            }
        });
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [targets]);

    const targetKeysByServer = useMemo(() => {
        const map = new Map();
        (targets || []).forEach((item) => {
            const server = String(item?.serverId || '').trim();
            const key = getTargetKey(item);
            if (!server || !key) return;
            if (!map.has(server)) map.set(server, []);
            map.get(server).push(key);
        });
        return map;
    }, [targets]);

    const visibleTargets = useMemo(() => {
        if (!Array.isArray(targets) || targets.length === 0) return [];
        if (selectedServerIds.length === 0) return [];
        const selectedSet = new Set(selectedServerIds);
        return targets.filter((item) => selectedSet.has(item.serverId));
    }, [targets, selectedServerIds]);

    const visibleTargetKeys = useMemo(
        () => visibleTargets.map((item) => getTargetKey(item)).filter(Boolean),
        [visibleTargets]
    );

    const filteredTargets = useMemo(() => {
        if (visibleTargets.length === 0) return [];
        if (selectedInboundKeys.length === 0) return [];
        const selectedSet = new Set(selectedInboundKeys);
        return visibleTargets.filter((item) => selectedSet.has(getTargetKey(item)));
    }, [selectedInboundKeys, visibleTargets]);

    const activeProtocols = useMemo(() => {
        const protocols = [];
        if (editingClient && editTargets.length > 0) {
            protocols.push(...editTargets.map((item) => item?.protocol));
        } else if (!editingClient && filteredTargets.length > 0) {
            protocols.push(...filteredTargets.map((item) => item?.protocol));
        } else if (editingClient?.protocol) {
            protocols.push(editingClient.protocol);
        } else if (inboundProtocol) {
            protocols.push(inboundProtocol);
        }

        return Array.from(new Set(protocols.map((item) => normalizeProtocol(item)).filter(Boolean)));
    }, [editingClient, editTargets, filteredTargets, inboundProtocol]);

    const requiresUuidCredential = useMemo(() => {
        if (activeProtocols.length === 0) return true;
        return activeProtocols.some((item) => UUID_PROTOCOLS.has(item));
    }, [activeProtocols]);

    const requiresPasswordCredential = useMemo(
        () => activeProtocols.some((item) => PASSWORD_PROTOCOLS.has(item)),
        [activeProtocols]
    );

    const hasMixedCredentialTypes = requiresUuidCredential && requiresPasswordCredential;

    const flowProtocolSet = useMemo(
        () => new Set((flowProtocols || []).map((item) => String(item || '').toLowerCase()).filter(Boolean)),
        [flowProtocols]
    );

    const isFlowSupported = useMemo(() => {
        if (editingClient && editTargets.length > 0) {
            return editTargets.some((item) => flowProtocolSet.has(String(item.protocol || '').toLowerCase()));
        }
        if (!editingClient && filteredTargets.length > 0) {
            return filteredTargets.some((item) => flowProtocolSet.has(String(item.protocol || '').toLowerCase()));
        }
        if (editingClient && editingClient.protocol) {
            return flowProtocolSet.has(String(editingClient.protocol).toLowerCase());
        }
        if (inboundProtocol) {
            return flowProtocolSet.has(String(inboundProtocol).toLowerCase());
        }
        return false;
    }, [editingClient, editTargets, filteredTargets, flowProtocolSet, inboundProtocol]);

    useEffect(() => {
        if (!isFlowSupported && flow) {
            setFlow('');
        }
    }, [isFlowSupported, flow]);

    useEffect(() => {
        if (!isOpen || editingClient) return;
        if (requiresUuidCredential && !uuid) {
            setUuid(generateUuidLocal());
        }
        if (requiresPasswordCredential && !password) {
            setPassword(generateSecurePassword());
        }
    }, [editingClient, isOpen, password, requiresPasswordCredential, requiresUuidCredential, uuid]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        const isBatch = targets.length > 0;
        const isBatchEdit = !!editingClient && editTargets.length > 0;
        if (!isBatch && (!inboundId || !serverId)) {
            if (!isBatchEdit) {
                toast.error(t('comp.clients.missingServerOrInbound'));
                return;
            }
        }

        setLoading(true);

        try {
            if (isBatch) {
                const unsupported = filteredTargets.filter((item) => !BATCH_CLIENT_PROTOCOLS.has(String(item.protocol || '').toLowerCase()));
                if (unsupported.length > 0) {
                    toast.error(t('comp.clients.unsupportedBatchProtocol'));
                    setLoading(false);
                    return;
                }
            }

            if (isBatchEdit) {
                const unsupported = editTargets.filter((item) => !BATCH_CLIENT_PROTOCOLS.has(String(item.protocol || '').toLowerCase()));
                if (unsupported.length > 0) {
                    toast.error(t('comp.clients.unsupportedBatchEditProtocol'));
                    setLoading(false);
                    return;
                }
            }

            const normalizedUuid = String(uuid || '').trim();
            const normalizedPassword = String(password || '').trim();
            if (requiresUuidCredential && !normalizedUuid) {
                toast.error(t('comp.clients.uuidRequired'));
                setLoading(false);
                return;
            }
            if (requiresPasswordCredential && !normalizedPassword) {
                toast.error(t('comp.clients.passwordRequired'));
                setLoading(false);
                return;
            }

            let resolvedExpiryTime = 0;
            if (expiryMode === 'datetime') {
                resolvedExpiryTime = fromLocalDateTimeInput(expiryDateTime);
                if (!resolvedExpiryTime) {
                    toast.error(t('comp.clients.invalidExpiryDateTime'));
                    setLoading(false);
                    return;
                }
            } else if (expiryMode === 'days') {
                const days = Number(expiryAfterDays || 0);
                if (!Number.isFinite(days) || days <= 0) {
                    toast.error(t('comp.clients.invalidExpiryDays'));
                    setLoading(false);
                    return;
                }
                resolvedExpiryTime = Date.now() + (Math.floor(days) * 24 * 60 * 60 * 1000);
            } else {
                resolvedExpiryTime = 0;
            }

            const derivedSubId = subId || buildStableSubId(email);
            const clientData = {
                id: normalizedUuid,
                password: normalizedPassword,
                email,
                totalGB: gigabytesInputToBytes(totalGB),
                expiryTime: Math.max(0, Number(resolvedExpiryTime || 0)),
                enable,
                tgId: String(tgId || '').trim(),
                subId: derivedSubId,
                comment: String(comment || '').trim(),
                reset: Math.max(0, Number(reset || 0)),
                limitIp: Number(limitIp),
                speedLimitUp: kilobytesInputToBytesPerSecond(speedLimitUp),
                speedLimitDown: kilobytesInputToBytesPerSecond(speedLimitDown),
                flow: isFlowSupported ? flow : '',
            };

            if (editingClient) {
                if (isBatchEdit) {
                    const updateTargets = editTargets.map((item) => {
                        const isTotalGBChanged = gigabytesInputToBytes(totalGB) !== Number(editingClient.totalGB || 0);
                        const isExpiryTimeChanged = Math.max(0, Number(resolvedExpiryTime || 0)) !== Number(editingClient.expiryTime || 0);
                        const isEnableChanged = enable !== (editingClient.enable !== false);
                        const isTgIdChanged = String(tgId || '').trim() !== String(editingClient.tgId || '').trim();
                        const isSubIdChanged = derivedSubId !== String(editingClient.subId || '').trim();
                        const isCommentChanged = String(comment || '').trim() !== String(editingClient.comment || '').trim();
                        const isResetChanged = Number(reset || 0) !== Number(editingClient.reset || 0);
                        const isLimitIpChanged = Number(limitIp || 0) !== Number(editingClient.limitIp || 0);
                        const isSpeedLimitUpChanged = kilobytesInputToBytesPerSecond(speedLimitUp) !== Number(editingClient.speedLimitUp || 0);
                        const isSpeedLimitDownChanged = kilobytesInputToBytesPerSecond(speedLimitDown) !== Number(editingClient.speedLimitDown || 0);
                        const isFlowChanged = flow !== (editingClient.flow || '');

                        const mergedClient = {
                            ...item,
                            id: item.id || normalizedUuid,
                            password: item.password || normalizedPassword,
                            email: item.email || email,
                            totalGB: isTotalGBChanged ? gigabytesInputToBytes(totalGB) : (item.totalGB || 0),
                            expiryTime: isExpiryTimeChanged ? Math.max(0, Number(resolvedExpiryTime || 0)) : (item.expiryTime || 0),
                            enable: isEnableChanged ? enable : (item.enable !== false),
                            tgId: isTgIdChanged ? String(tgId || '').trim() : String(item.tgId || '').trim(),
                            subId: isSubIdChanged ? derivedSubId : String(item.subId || '').trim(),
                            comment: isCommentChanged ? String(comment || '').trim() : String(item.comment || '').trim(),
                            reset: isResetChanged ? Number(reset || 0) : Number(item.reset || 0),
                            limitIp: isLimitIpChanged ? Number(limitIp || 0) : Number(item.limitIp || 0),
                            speedLimitUp: isSpeedLimitUpChanged ? kilobytesInputToBytesPerSecond(speedLimitUp) : (item.speedLimitUp || 0),
                            speedLimitDown: isSpeedLimitDownChanged ? kilobytesInputToBytesPerSecond(speedLimitDown) : (item.speedLimitDown || 0),
                            flow: isFlowChanged ? flow : (item.flow || ''),
                        };

                        if (!flowProtocolSet.has(String(item.protocol || '').toLowerCase())) {
                            mergedClient.flow = '';
                        }

                        return {
                            serverId: item.serverId,
                            serverName: item.serverName,
                            inboundId: item.inboundId,
                            protocol: item.protocol,
                            email: item.email || clientData.email,
                            clientIdentifier: item.clientIdentifier || resolveClientIdentifier(item, item.protocol),
                            client: mergedClient,
                        };
                    });

                    const batchPayload = await attachBatchRiskToken({
                        action: 'update',
                        targets: updateTargets,
                        client: clientData,
                    }, {
                        type: 'clients',
                        action: 'update',
                        targetCount: updateTargets.length,
                    });
                    const res = await api.post('/batch/clients', batchPayload);
                    assertOperationSucceeded(res, t('comp.clients.batchUpdateFailed'));

                    const output = res.data?.obj;
                    const summary = output?.summary || {
                        success: 0,
                        total: updateTargets.length,
                        failed: updateTargets.length,
                    };
                    onBatchResult?.(t('comp.clients.batchUpdateResult'), output || null);

                    const doneMsg = t('comp.clients.batchUpdateDone', {
                        success: summary.success,
                        total: summary.total,
                    });
                    if (summary.failed === 0) {
                        toast.success(doneMsg);
                    } else {
                        toast.error(doneMsg);
                    }
                    onSuccess();
                    onClose();
                    setLoading(false);
                    return;
                }

                const clientIdentifier = resolveClientIdentifier(editingClient, editingClient.protocol || inboundProtocol);
                if (!clientIdentifier) {
                    throw new Error(t('comp.clients.missingClientId'));
                }

                const params = new URLSearchParams();
                params.append('id', inboundId);
                params.append('settings', JSON.stringify({ clients: [clientData] }));

                let updateMsg = t('comp.clients.userUpdated');
                try {
                    const updateRes = await api.post(
                        `/panel/${serverId}/panel/api/inbounds/updateClient/${encodeURIComponent(clientIdentifier)}`,
                        params,
                        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                    );
                    assertOperationSucceeded(updateRes, t('comp.clients.updateFailed'));
                    updateMsg = resolveResponseMsg(updateRes.data, updateMsg);
                } catch {
                    // Backward compatibility for older/forked 3x-ui update payloads.
                    const fallbackRes = await api.post(
                        `/panel/${serverId}/panel/api/inbounds/updateClient/${encodeURIComponent(clientIdentifier)}`,
                        clientData
                    );
                    assertOperationSucceeded(fallbackRes, t('comp.clients.updateFailed'));
                    updateMsg = resolveResponseMsg(fallbackRes.data, updateMsg);
                }
                toast.success(updateMsg);
            } else {
                // Add mode
                if (isBatch) {
                    if (filteredTargets.length === 0) {
                        toast.error(t('comp.clients.selectInboundFirst'));
                        setLoading(false);
                        return;
                    }

                    const batchTargets = filteredTargets.map((target) => ({
                        serverId: target.serverId,
                        serverName: target.serverName,
                        inboundId: target.id,
                        protocol: target.protocol,
                        email: clientData.email,
                        client: {
                            ...clientData,
                            flow: flowProtocolSet.has(String(target.protocol || '').toLowerCase()) ? clientData.flow : '',
                        },
                    }));

                    const batchPayload = await attachBatchRiskToken({
                        action: 'add',
                        targets: batchTargets,
                        client: clientData,
                    }, {
                        type: 'clients',
                        action: 'add',
                        targetCount: batchTargets.length,
                    });
                    const res = await api.post('/batch/clients', batchPayload);
                    assertOperationSucceeded(res, t('comp.clients.batchAddFailed'));

                    const output = res.data?.obj;
                    const summary = output?.summary || {
                        success: 0,
                        total: filteredTargets.length,
                        failed: filteredTargets.length,
                    };
                    onBatchResult?.(t('comp.clients.batchAddResult'), output || null);

                    if (summary.failed === 0) {
                        toast.success(t('comp.clients.batchAddDone', { success: summary.success }));
                    } else {
                        toast.error(t('comp.clients.batchPartial', {
                            success: summary.success,
                            failed: summary.failed,
                        }));
                    }

                } else {
                    // Single Add
                    const settings = { clients: [clientData] };
                    const params = new URLSearchParams();
                    params.append('id', inboundId);
                    params.append('settings', JSON.stringify(settings));

                    const addRes = await api.post(`/panel/${serverId}/panel/api/inbounds/addClient`, params, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                    assertOperationSucceeded(addRes, t('comp.clients.addFailed'));
                    toast.success(resolveResponseMsg(addRes?.data, t('comp.clients.userAdded')));
                }
            }
            onSuccess();
            onClose();
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || t('comp.common.unknownError');
            toast.error(editingClient
                ? t('comp.clients.updateFailedWithMsg', { msg })
                : t('comp.clients.addFailedWithMsg', { msg }));
        }
        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <ModalShell isOpen={isOpen} onClose={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">
                        {editingClient
                            ? (editTargets.length > 0
                                ? t('comp.clients.modalBatchEditTitle', { count: editTargets.length })
                                : t('comp.clients.modalEditTitle'))
                            : (targets.length > 0
                                ? t('comp.clients.modalBatchAddTitle', {
                                    selected: filteredTargets.length,
                                    total: targets.length,
                                })
                                : t('comp.clients.modalAddTitle'))}
                    </h3>
                    <button type="button" className="modal-close" onClick={onClose} aria-label={t('comp.common.close')} title={t('comp.common.close')}><HiOutlineXMark /></button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {targets.length > 0 && !editingClient && (
                            <div className="mb-4 p-3 rounded bg-surface-soft text-xs text-secondary border border-stroke-soft">
                                <div className="mb-2">
                                    <strong>{t('comp.clients.targetNodes', {
                                        selected: selectedServerIds.length,
                                        total: availableServers.length,
                                    })}</strong>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={availableServers.length > 0 && selectedServerIds.length === availableServers.length}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedServerIds(availableServers.map((item) => item.id));
                                                    setSelectedInboundKeys((targets || []).map((item) => getTargetKey(item)).filter(Boolean));
                                                } else {
                                                    setSelectedServerIds([]);
                                                    setSelectedInboundKeys([]);
                                                }
                                            }}
                                        />
                                        <span>{t('comp.clients.selectAll')}</span>
                                    </label>
                                    {availableServers.map((item) => (
                                        <label key={item.id} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                            checked={selectedServerIds.includes(item.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedServerIds((prev) => [...new Set([...prev, item.id])]);
                                                    setSelectedInboundKeys((prev) => {
                                                        const next = new Set(prev);
                                                        const serverKeys = targetKeysByServer.get(item.id) || [];
                                                        serverKeys.forEach((key) => next.add(key));
                                                        return Array.from(next);
                                                    });
                                                } else {
                                                    setSelectedServerIds((prev) => prev.filter((id) => id !== item.id));
                                                    setSelectedInboundKeys((prev) => {
                                                        const removeSet = new Set(targetKeysByServer.get(item.id) || []);
                                                        return prev.filter((key) => !removeSet.has(key));
                                                    });
                                                }
                                            }}
                                        />
                                        <span>{item.name}</span>
                                    </label>
                                ))}
                            </div>
                                <div className="mb-2">
                                    <strong>{t('comp.clients.targetInbounds', {
                                        selected: filteredTargets.length,
                                        total: visibleTargets.length,
                                    })}</strong>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={visibleTargets.length > 0 && filteredTargets.length === visibleTargets.length}
                                            onChange={(e) => {
                                                const visibleSet = new Set(visibleTargetKeys);
                                                if (e.target.checked) {
                                                    setSelectedInboundKeys((prev) => Array.from(new Set([...prev, ...visibleTargetKeys])));
                                                } else {
                                                    setSelectedInboundKeys((prev) => prev.filter((key) => !visibleSet.has(key)));
                                                }
                                            }}
                                        />
                                        <span>{t('comp.clients.selectAllInboundsOnNode')}</span>
                                    </label>
                                </div>
                                <div className="max-h-48 overflow-y-auto border border-white/10 rounded p-2">
                                    {visibleTargets.length === 0 ? (
                                        <div className="text-muted">{t('comp.clients.selectNodeFirst')}</div>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            {visibleTargets.map((target) => {
                                                const key = getTargetKey(target);
                                                const checked = selectedInboundKeys.includes(key);
                                                return (
                                                    <label
                                                        key={key}
                                                        className="flex items-center gap-2 cursor-pointer"
                                                        title={`[${target.serverName}] ${target.remark} (${target.protocol}:${target.port})`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedInboundKeys((prev) => [...new Set([...prev, key])]);
                                                                } else {
                                                                    setSelectedInboundKeys((prev) => prev.filter((item) => item !== key));
                                                                }
                                                            }}
                                                        />
                                                        <span>
                                                            [{target.serverName}] {target.remark} ({target.protocol}:{target.port})
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {editingClient && editTargets.length > 0 && (
                            <div className="mb-4 p-3 rounded bg-surface-soft text-xs text-secondary border border-stroke-soft">
                                <strong>{t('comp.clients.syncToInstances')}</strong>
                                <ul className="mt-1 list-disc list-inside">
                                    {editTargets.map((t, idx) => (
                                        <li key={`${t.serverId}-${t.inboundId}-${idx}`}>
                                            [{t.serverName}] {t.inboundRemark || t.protocol} ({t.inboundPort})
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <input className="form-input" value={email} onChange={e => setEmail(e.target.value)} required />
                        </div>

                        {requiresUuidCredential && (
                            <div className="form-group">
                                <label className="form-label">UUID</label>
                                <div className="flex gap-2">
                                    <input className="form-input font-mono" value={uuid} onChange={e => setUuid(e.target.value)} required={requiresUuidCredential} />
                                    <button type="button" className="btn btn-secondary btn-icon" onClick={generateUUID} title={t('comp.clients.genUuidTitle')} aria-label={t('comp.clients.genUuidTitle')}>
                                        <HiOutlineArrowPath />
                                    </button>
                                </div>
                            </div>
                        )}

                        {requiresPasswordCredential && (
                            <div className="form-group">
                                <label className="form-label">{t('comp.clients.passwordLabel')}</label>
                                <div className="flex gap-2">
                                    <input className="form-input font-mono" value={password} onChange={e => setPassword(e.target.value)} required={requiresPasswordCredential} />
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-icon"
                                        onClick={() => setPassword(generateSecurePassword())}
                                        title={t('comp.clients.genPasswordTitle')}
                                        aria-label={t('comp.clients.genPasswordTitle')}
                                    >
                                        <HiOutlineArrowPath />
                                    </button>
                                </div>
                            </div>
                        )}

                        {hasMixedCredentialTypes && (
                            <div className="text-xs text-muted mb-4">
                                {t('comp.clients.mixedCredentialHint')}
                            </div>
                        )}

                        <div className="form-group">
                            <label className="form-label">{t('comp.clients.subIdLabel')}</label>
                            <div className="flex gap-2">
                                <input
                                    className="form-input font-mono text-xs text-muted"
                                    value={subId || `(${t('comp.clients.autoGenerated')})`}
                                    readOnly
                                    title={t('comp.clients.subIdTitle')}
                                />
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-xs whitespace-nowrap"
                                    onClick={() => {
                                        setSubId(generateHexToken(8));
                                        toast.success(t('comp.clients.subIdRegenerated'));
                                    }}
                                >
                                    <HiOutlineArrowPath /> {t('comp.clients.subIdReset')}
                                </button>
                            </div>
                            <div className="text-xs text-muted mt-1">
                                {t('comp.clients.subIdResetHint')}
                            </div>
                        </div>

                        {isFlowSupported ? (
                            <div className="form-group">
                                <label className="form-label">{t('comp.clients.flowLabel')}</label>
                                <select className="form-select" value={flow} onChange={e => setFlow(e.target.value)}>
                                    {flowOptions.map((item) => (
                                        <option key={item || '__empty'} value={item}>
                                            {item ? item : t('comp.clients.notSet')}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="form-group">
                                <label className="form-label">{t('comp.clients.flowLabel')}</label>
                                <input className="form-input" value={t('comp.clients.flowUnsupported')} disabled />
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="form-group">
                                <label className="form-label">{t('comp.clients.trafficLimitGb')}</label>
                                <input className="form-input" type="number" value={totalGB} onChange={e => setTotalGB(e.target.value)} placeholder={t('comp.clients.unlimitedZero')} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">{t('comp.clients.expiryPolicy')}</label>
                                <select className="form-select mb-2" value={expiryMode} onChange={(e) => setExpiryMode(e.target.value)}>
                                    <option value="never">{t('comp.clients.expiryNever')}</option>
                                    <option value="datetime">{t('comp.clients.expiryDatetime')}</option>
                                    <option value="days">{t('comp.clients.expiryDays')}</option>
                                </select>
                                {expiryMode === 'datetime' && (
                                    <input
                                        className="form-input"
                                        type="datetime-local"
                                        value={expiryDateTime}
                                        onChange={(e) => setExpiryDateTime(e.target.value)}
                                    />
                                )}
                                {expiryMode === 'days' && (
                                    <input
                                        className="form-input"
                                        type="number"
                                        min={1}
                                        value={expiryAfterDays}
                                        onChange={(e) => setExpiryAfterDays(e.target.value)}
                                        placeholder={t('comp.clients.expiryDaysPlaceholder')}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="form-group">
                                <label className="form-label">{t('comp.clients.ipLimit')}</label>
                                <input className="form-input" type="number" value={limitIp} onChange={e => setLimitIp(e.target.value)} />
                            </div>
                            <div className="form-group flex items-center pt-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={enable} onChange={e => setEnable(e.target.checked)} />
                                    {t('comp.clients.enableUser')}
                                </label>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="form-group">
                                <label className="form-label">{locale === 'en-US' ? 'Upload Speed Limit (KB/s)' : '上行限速 (KB/s)'}</label>
                                <input className="form-input" type="number" min={0} value={speedLimitUp} onChange={e => setSpeedLimitUp(e.target.value)} />
                                <div className="text-xs text-muted mt-1">{locale === 'en-US' ? '0 = Unlimited' : '0 为不限速'}</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">{locale === 'en-US' ? 'Download Speed Limit (KB/s)' : '下行限速 (KB/s)'}</label>
                                <input className="form-input" type="number" min={0} value={speedLimitDown} onChange={e => setSpeedLimitDown(e.target.value)} />
                                <div className="text-xs text-muted mt-1">{locale === 'en-US' ? '0 = Unlimited' : '0 为不限速'}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="form-group">
                                <label className="form-label">Telegram ID</label>
                                <input
                                    className="form-input"
                                    inputMode="numeric"
                                    pattern="[0-9-]*"
                                    value={tgId}
                                    placeholder={t('comp.clients.telegramPlaceholder')}
                                    onChange={e => setTgId(e.target.value.replace(/[^0-9-]/g, ''))}
                                />
                                <div className="text-xs text-muted mt-1">{t('comp.clients.telegramHint')}</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">{t('comp.clients.trafficResetPeriod')}</label>
                                <select
                                    className="form-select"
                                    value={reset}
                                    onChange={e => setReset(Number(e.target.value))}
                                >
                                    <option value={0}>{t('comp.clients.resetNever')}</option>
                                    <option value={1}>{t('comp.clients.resetDaily')}</option>
                                    <option value={7}>{t('comp.clients.resetWeekly')}</option>
                                    <option value={30}>{t('comp.clients.resetMonthly')}</option>
                                    <option value={90}>{t('comp.clients.resetQuarterly')}</option>
                                </select>
                                <div className="text-xs text-muted mt-1">{t('comp.clients.resetNeverHelp')}</div>
                            </div>
                        </div>

                        <div className="form-group mb-4">
                            <label className="form-label">{t('comp.clients.commentLabel')}</label>
                            <textarea
                                className="form-input"
                                rows={2}
                                value={comment}
                                placeholder={t('comp.clients.commentPlaceholder')}
                                onChange={e => setComment(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>{t('comp.common.cancel')}</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? <span className="spinner" /> : <><HiOutlineCheck /> {t('comp.common.save')}</>}
                        </button>
                    </div>
                </form>
            </div>
        </ModalShell>
    );
}
