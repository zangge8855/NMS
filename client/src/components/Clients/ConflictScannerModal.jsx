import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    HiOutlineArrowPath,
    HiOutlineCheckCircle,
    HiOutlineExclamationTriangle,
    HiOutlineWrenchScrewdriver,
    HiOutlineXMark,
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
import { useI18n } from '../../contexts/LanguageContext.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import Table from '../UI/Table.jsx';

const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

function normalizeProtocol(value) {
    return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatExpiry(value, permanentLabel = 'Permanent', locale = 'en-US') {
    const ts = toNumber(value, 0);
    if (!ts) return permanentLabel;
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(locale === 'en-US' ? 'en-US' : 'zh-CN');
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
        comment: entry.comment || '',
        reset: toNumber(entry.reset, 0),
        speedLimitUp: toNumber(entry.speedLimitUp, 0),
        speedLimitDown: toNumber(entry.speedLimitDown, 0),
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
    const { t, locale } = useI18n();
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
            toast.error(t('comp.clients.conflictNoSource'));
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
            toast.error(t('comp.clients.conflictNoTargets'));
            return;
        }

        const clientPayload = buildClientPayload(sourceEntry);
        if (!targets.every((target) => String(target.clientIdentifier || '').trim())) {
            toast.error(t('comp.clients.conflictEmptyIdentifier'));
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
                onShowBatchResult(t('comp.clients.conflictRepairResult'), output);
            }

            const doneMsg = t('comp.clients.conflictRepairDone', {
                success: summaryInfo.success,
                total: summaryInfo.total,
            });
            if (summaryInfo.failed > 0) {
                toast.error(doneMsg);
            } else {
                toast.success(doneMsg);
            }

            await refreshFromServer();
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('comp.clients.conflictRepairFailed'));
        } finally {
            setResolvingKey('');
        }
    };

    if (!isOpen) return null;

    return (
        <ModalShell isOpen={isOpen} onClose={onClose} ariaLabel={t('comp.clients.conflictTitle')}>
            <div className="modal modal-wide glass-panel conflict-scanner-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">{t('comp.clients.conflictTitle')}</h3>
                    <button type="button" className="modal-close" onClick={onClose} aria-label={t('comp.common.close')} title={t('comp.common.close')}><HiOutlineXMark /></button>
                </div>

                <div className="modal-body">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="badge badge-neutral">{t('comp.clients.conflictGroupsBadge', { count: summary.conflictGroups })}</span>
                            <span className="badge badge-danger">{t('comp.clients.conflictHighBadge', { count: summary.high })}</span>
                            <span className="badge badge-warning">{t('comp.clients.conflictMediumBadge', { count: summary.medium })}</span>
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={refreshFromServer} disabled={scanning}>
                            {scanning ? <span className="spinner" /> : <><HiOutlineArrowPath /> {t('comp.clients.rescan')}</>}
                        </button>
                    </div>

                    {scanning ? (
                        <div className="glass-panel p-4">
                            <SkeletonTable rows={4} cols={4} />
                        </div>
                    ) : conflictGroups.length === 0 ? (
                        <EmptyState
                            title={t('comp.clients.noConflictTitle')}
                            subtitle={t('comp.clients.noConflictSubtitle')}
                            icon={<HiOutlineCheckCircle />}
                            size="compact"
                            surface
                            action={(
                                <button type="button" className="btn btn-secondary btn-sm" onClick={refreshFromServer} disabled={scanning}>
                                    <HiOutlineArrowPath /> {t('comp.clients.rescan')}
                                </button>
                            )}
                        />
                    ) : (
                        <div className="flex flex-col gap-4">
                            {conflictGroups.map((group) => (
                                <div key={group.groupKey} className="card p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <div className="font-semibold text-white">{group.displayIdentity}</div>
                                            <div className="text-sm text-muted">
                                                {t('comp.clients.recordsOnNodes', { entries: group.entryCount, servers: group.serverCount })}
                                            </div>
                                        </div>
                                        <span className={`badge ${group.severity === 'high' ? 'badge-danger' : 'badge-warning'}`}>
                                            <HiOutlineExclamationTriangle /> {group.severity === 'high' ? t('comp.clients.severityHigh') : t('comp.clients.severityMedium')}
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
                                                            {t('comp.clients.protocolEntries', { protocol: String(protocolGroup.protocol || '').toUpperCase(), count: protocolGroup.entryCount })}
                                                        </div>
                                                        <div className="text-xs text-muted">
                                                            {t('comp.clients.diffFields', { fields: protocolGroup.diffFields.join(', ') || '-' })}
                                                        </div>
                                                    </div>

                                                    <div className="grid-auto-220 mb-3 conflict-resolution-row">
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
                                                                    {candidate.serverName} / {candidate.inboundRemark || '-'} / {candidate.identifier || `(${t('comp.clients.emptyIdentifier')})`}
                                                                </option>
                                                            ))}
                                                        </select>

                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => resolveProtocolConflict(group, protocolGroup)}
                                                            disabled={resolving || scanning}
                                                        >
                                                            {resolving ? <span className="spinner" /> : <><HiOutlineWrenchScrewdriver /> {t('comp.clients.applySource')}</>}
                                                        </button>
                                                    </div>

                                                    <Table
                                                        tableClassName="conflict-scanner-table"
                                                        headers={[
                                                            <th key="node">{t('comp.clients.colNode')}</th>,
                                                            <th key="inbound">{t('comp.clients.colInbound')}</th>,
                                                            <th key="ident">{t('comp.clients.colIdentifier')}</th>,
                                                            <th key="enabled" className="table-cell-center conflict-scanner-enabled-column">{t('comp.clients.colEnabled')}</th>,
                                                            <th key="expiry" className="table-cell-center conflict-scanner-expiry-column">{t('comp.clients.colExpiry')}</th>,
                                                            <th key="total" className="table-cell-right conflict-scanner-total-column">{t('comp.clients.colTotal')}</th>,
                                                            <th key="source" className="table-cell-center conflict-scanner-source-column">{t('comp.clients.colSource')}</th>
                                                        ]}
                                                    >
                                                        {(protocolGroup.entries || []).map((entry) => {
                                                            const locator = buildClientEntryLocator(entry);
                                                            const isSource = locator === selectedSourceKey;
                                                            return (
                                                                <tr key={`${locator}-${entry.uiKey || ''}`}>
                                                                    <td data-label={t('comp.clients.colNode')}>{entry.serverName || entry.serverId}</td>
                                                                    <td data-label={t('comp.clients.colInbound')}>{entry.inboundRemark || entry.inboundId}</td>
                                                                    <td data-label={t('comp.clients.colIdentifier')} className="font-mono text-xs">
                                                                        {getClientIdentifier(entry) || '-'}
                                                                    </td>
                                                                    <td data-label={t('comp.clients.colEnabled')} className="table-cell-center conflict-scanner-enabled-cell">
                                                                        <span className={`badge ${entry.enable === false ? 'badge-danger' : 'badge-success'}`}>
                                                                            {entry.enable === false ? t('comp.common.disabled') : t('comp.common.enabled')}
                                                                        </span>
                                                                    </td>
                                                                    <td data-label={t('comp.clients.colExpiry')} className="table-cell-center cell-mono conflict-scanner-expiry-cell">{formatExpiry(entry.expiryTime, t('comp.clients.permanent'), locale)}</td>
                                                                    <td data-label={t('comp.clients.colTotal')} className="table-cell-right cell-mono-right conflict-scanner-total-cell">{formatBytes(toNumber(entry.totalGB, 0))}</td>
                                                                    <td data-label={t('comp.clients.colSource')} className="table-cell-center conflict-scanner-source-cell">
                                                                        {isSource ? <span className="badge badge-info">{t('comp.clients.sourceBadge')}</span> : '-'}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </Table>
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
                    <button className="btn btn-secondary" onClick={onClose}>{t('comp.common.close')}</button>
                </div>
            </div>
        </ModalShell>
    );
}
