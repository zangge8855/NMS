import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    HiOutlineArrowPath,
    HiOutlineCheckCircle,
    HiOutlineExclamationTriangle,
    HiOutlineWrenchScrewdriver,
} from 'react-icons/hi2';
import api from '../../api/client.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import { formatBytes } from '../../utils/format.js';
import {
    buildClientConflictReport,
    buildClientEntryLocator,
    findConflictSourceEntry,
    getClientIdentifier,
    getConflictTypeLabels,
} from '../../utils/clientConflict.js';

const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

function normalizeProtocol(value) {
    return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatExpiry(value) {
    const ts = toNumber(value, 0);
    if (!ts) return '永久';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN');
}

function buildClientPayload(entry = {}) {
    const protocol = normalizeProtocol(entry.protocol);
    const payload = {
        id: '',
        password: '',
        email: entry.email || '',
        totalGB: toNumber(entry.totalGB, 0),
        expiryTime: toNumber(entry.expiryTime, 0),
        enable: entry.enable !== false,
        tgId: entry.tgId || '',
        subId: entry.subId || '',
        limitIp: toNumber(entry.limitIp, 0),
        flow: entry.flow || '',
    };

    if (UUID_PROTOCOLS.has(protocol)) {
        payload.id = entry.id || entry.password || '';
        payload.password = entry.password || '';
        return payload;
    }

    if (PASSWORD_PROTOCOLS.has(protocol)) {
        payload.id = entry.id || '';
        payload.password = entry.password || entry.id || '';
        return payload;
    }

    payload.id = entry.id || entry.password || entry.email || '';
    payload.password = entry.password || entry.id || entry.email || '';
    return payload;
}

function selectionKey(groupKey, protocol) {
    return `${groupKey}::${protocol}`;
}

export default function ConflictScannerModal({
    isOpen,
    onClose,
    clients = [],
    onRefreshClients,
    onShowBatchResult,
}) {
    const [report, setReport] = useState(() => buildClientConflictReport([]));
    const [selectionMap, setSelectionMap] = useState({});
    const [scanning, setScanning] = useState(false);
    const [resolvingKey, setResolvingKey] = useState('');

    const conflictGroups = report?.groups || [];

    const summary = useMemo(() => {
        const base = report?.summary || { conflictGroups: 0, high: 0, medium: 0 };
        return {
            conflictGroups: base.conflictGroups || 0,
            high: base.high || 0,
            medium: base.medium || 0,
        };
    }, [report]);

    const runScan = (sourceClients) => {
        setScanning(true);
        const next = buildClientConflictReport(sourceClients);
        setReport(next);
        setScanning(false);
    };

    useEffect(() => {
        if (!isOpen) return;
        runScan(clients);
    }, [isOpen, clients]);

    useEffect(() => {
        if (!isOpen) return;
        setSelectionMap((prev) => {
            const next = { ...prev };
            conflictGroups.forEach((group) => {
                (group.protocols || []).forEach((protocolGroup) => {
                    const key = selectionKey(group.groupKey, protocolGroup.protocol);
                    if (!next[key]) {
                        next[key] = protocolGroup.recommendedSourceKey || '';
                    }
                });
            });
            return next;
        });
    }, [conflictGroups, isOpen]);

    const refreshFromServer = async () => {
        if (!onRefreshClients) {
            runScan(clients);
            return;
        }
        setScanning(true);
        try {
            const latest = await onRefreshClients();
            runScan(Array.isArray(latest) ? latest : clients);
        } catch {
            runScan(clients);
        } finally {
            setScanning(false);
        }
    };

    const resolveProtocolConflict = async (group, protocolGroup) => {
        const key = selectionKey(group.groupKey, protocolGroup.protocol);
        const sourceKey = selectionMap[key] || protocolGroup.recommendedSourceKey;
        const sourceEntry = findConflictSourceEntry(protocolGroup, sourceKey);
        if (!sourceEntry) {
            toast.error('未找到可用来源记录');
            return;
        }

        const sourceLocator = buildClientEntryLocator(sourceEntry);
        const targets = (protocolGroup.entries || [])
            .filter((entry) => buildClientEntryLocator(entry) !== sourceLocator)
            .map((entry) => ({
                serverId: entry.serverId,
                serverName: entry.serverName,
                inboundId: entry.inboundId,
                protocol: entry.protocol,
                email: entry.email || '',
                clientIdentifier: getClientIdentifier(entry),
            }));

        if (targets.length === 0) {
            toast.error('没有需要修复的目标');
            return;
        }

        const clientPayload = buildClientPayload(sourceEntry);
        if (!targets.every((target) => String(target.clientIdentifier || '').trim())) {
            toast.error('存在空标识目标，无法自动修复');
            return;
        }

        setResolvingKey(key);
        try {
            const requestBody = {
                action: 'update',
                targets,
                client: clientPayload,
            };
            const payload = await attachBatchRiskToken(requestBody, {
                type: 'clients',
                action: 'update',
                targetCount: targets.length,
            });
            const res = await api.post('/batch/clients', payload);
            const output = res.data?.obj || null;
            const summaryInfo = output?.summary || { success: 0, total: targets.length, failed: targets.length };

            if (onShowBatchResult && output) {
                onShowBatchResult('冲突修复结果', output);
            }

            if (summaryInfo.failed > 0) {
                toast.error(`修复完成：${summaryInfo.success}/${summaryInfo.total} 成功`);
            } else {
                toast.success(`修复完成：${summaryInfo.success}/${summaryInfo.total} 成功`);
            }

            await refreshFromServer();
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '修复失败');
        } finally {
            setResolvingKey('');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-wide glass-panel" style={{ maxWidth: '1200px' }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">冲突扫描与修复</h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>

                <div className="modal-body">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="badge badge-neutral">冲突组 {summary.conflictGroups}</span>
                            <span className="badge badge-danger">高风险 {summary.high}</span>
                            <span className="badge badge-warning">中风险 {summary.medium}</span>
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={refreshFromServer} disabled={scanning}>
                            {scanning ? <span className="spinner" /> : <><HiOutlineArrowPath /> 重新扫描</>}
                        </button>
                    </div>

                    {scanning ? (
                        <div className="table-pad-64 text-center"><span className="spinner" /></div>
                    ) : conflictGroups.length === 0 ? (
                        <div className="empty-state empty-state-compact">
                            <div className="empty-state-icon"><HiOutlineCheckCircle /></div>
                            <div className="empty-state-text">未检测到可识别冲突</div>
                            <div className="empty-state-sub">同一身份在同协议下未发现参数分歧。</div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {conflictGroups.map((group) => (
                                <div key={group.groupKey} className="card p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <div className="font-semibold text-white">{group.displayIdentity}</div>
                                            <div className="text-sm text-muted">
                                                {group.entryCount} 条记录 / {group.serverCount} 节点
                                            </div>
                                        </div>
                                        <span className={`badge ${group.severity === 'high' ? 'badge-danger' : 'badge-warning'}`}>
                                            <HiOutlineExclamationTriangle /> {group.severity === 'high' ? '高风险' : '中风险'}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {getConflictTypeLabels(group.conflictTypes).map((label) => (
                                            <span key={`${group.groupKey}-${label}`} className="badge badge-neutral">
                                                {label}
                                            </span>
                                        ))}
                                    </div>

                                    <div className="flex flex-col gap-3 mt-4">
                                        {(group.protocols || []).map((protocolGroup) => {
                                            const key = selectionKey(group.groupKey, protocolGroup.protocol);
                                            const selectedSourceKey = selectionMap[key] || protocolGroup.recommendedSourceKey || '';
                                            const resolving = resolvingKey === key;

                                            return (
                                                <div key={key} className="glass-panel p-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                        <div className="font-medium">
                                                            协议 {String(protocolGroup.protocol || '').toUpperCase()} · {protocolGroup.entryCount} 条
                                                        </div>
                                                        <div className="text-xs text-muted">
                                                            差异字段: {protocolGroup.diffFields.join(', ') || '-'}
                                                        </div>
                                                    </div>

                                                    <div className="grid-auto-220 mb-3" style={{ alignItems: 'center' }}>
                                                        <select
                                                            className="form-select"
                                                            value={selectedSourceKey}
                                                            onChange={(e) => {
                                                                const value = e.target.value;
                                                                setSelectionMap((prev) => ({ ...prev, [key]: value }));
                                                            }}
                                                        >
                                                            {(protocolGroup.sourceCandidates || []).map((candidate) => (
                                                                <option key={candidate.sourceKey} value={candidate.sourceKey}>
                                                                    {candidate.serverName} / {candidate.inboundRemark || '-'} / {candidate.identifier || '(空标识)'}
                                                                </option>
                                                            ))}
                                                        </select>

                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => resolveProtocolConflict(group, protocolGroup)}
                                                            disabled={resolving || scanning}
                                                        >
                                                            {resolving ? <span className="spinner" /> : <><HiOutlineWrenchScrewdriver /> 按来源覆盖其他节点</>}
                                                        </button>
                                                    </div>

                                                    <div className="table-container">
                                                        <table className="table">
                                                            <thead>
                                                                <tr>
                                                                    <th>节点</th>
                                                                    <th>入站</th>
                                                                    <th>标识</th>
                                                                    <th>启用</th>
                                                                    <th>有效期</th>
                                                                    <th>总量</th>
                                                                    <th>来源</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(protocolGroup.entries || []).map((entry) => {
                                                                    const locator = buildClientEntryLocator(entry);
                                                                    const isSource = locator === selectedSourceKey;
                                                                    return (
                                                                        <tr key={`${locator}-${entry.uiKey || ''}`}>
                                                                            <td data-label="节点">{entry.serverName || entry.serverId}</td>
                                                                            <td data-label="入站">{entry.inboundRemark || entry.inboundId}</td>
                                                                            <td data-label="标识" className="font-mono text-xs">
                                                                                {getClientIdentifier(entry) || '-'}
                                                                            </td>
                                                                            <td data-label="启用">
                                                                                <span className={`badge ${entry.enable === false ? 'badge-danger' : 'badge-success'}`}>
                                                                                    {entry.enable === false ? '停用' : '启用'}
                                                                                </span>
                                                                            </td>
                                                                            <td data-label="有效期">{formatExpiry(entry.expiryTime)}</td>
                                                                            <td data-label="总量">{formatBytes(toNumber(entry.totalGB, 0))}</td>
                                                                            <td data-label="来源">
                                                                                {isSource ? <span className="badge badge-info">来源</span> : '-'}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    );
}

