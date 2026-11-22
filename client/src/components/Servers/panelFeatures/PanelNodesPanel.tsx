import React, { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import {
    HiOutlineArrowUpCircle,
    HiOutlineCheck,
    HiOutlineNoSymbol,
    HiOutlinePencilSquare,
    HiOutlinePlus,
    HiOutlineTrash,
} from 'react-icons/hi2';
import api from '../../../api/client';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useI18n } from '../../../contexts/LanguageContext';
import { formatDateTime, formatRelativeTime, formatUptime, getErrorMessage } from '../../../utils/format';
import ActionsDropdown from '../../UI/ActionsDropdown';
import {
    PanelEmpty,
    PanelFeatureFrame,
    PanelField,
    PanelFormModal,
    PanelListSkeleton,
    PanelToggle,
} from './PanelFeatureFrame';
import InboundPicker from './InboundPicker';
import { panelApiPath, toMillis, usePanelAction, usePanelList, type PanelInboundOption } from './panelRequest';

type PanelNode = {
    id: number;
    name?: string;
    remark?: string;
    scheme?: string;
    address?: string;
    port?: number;
    basePath?: string;
    enable?: boolean;
    allowPrivateAddress?: boolean;
    tlsVerifyMode?: string;
    pinnedCertSha256?: string;
    inboundSyncMode?: string;
    inboundTags?: string[];
    outboundTag?: string;
    status?: string;
    lastHeartbeat?: number;
    latencyMs?: number;
    xrayVersion?: string;
    panelVersion?: string;
    cpuPct?: number;
    memPct?: number;
    uptimeSecs?: number;
    netUp?: number;
    netDown?: number;
    lastError?: string;
    xrayState?: string;
    inboundCount?: number;
    clientCount?: number;
    onlineCount?: number;
    transitive?: boolean;
};

type ProbeResult = {
    status?: string;
    latencyMs?: number;
    xrayVersion?: string;
    panelVersion?: string;
    error?: string;
};

type NodeDraft = {
    id?: number;
    name: string;
    remark: string;
    scheme: string;
    address: string;
    port: string;
    basePath: string;
    apiToken: string;
    clearApiToken: boolean;
    enable: boolean;
    allowPrivateAddress: boolean;
    tlsVerifyMode: string;
    pinnedCertSha256: string;
    inboundSyncMode: string;
    inboundTags: string[];
    outboundTag: string;
};

const TLS_MODES = ['verify', 'skip', 'pin', 'mtls'] as const;

function toDraft(row?: PanelNode): NodeDraft {
    return {
        id: row?.id,
        name: String(row?.name || ''),
        remark: String(row?.remark || ''),
        scheme: String(row?.scheme || 'https'),
        address: String(row?.address || ''),
        port: row?.port ? String(row.port) : '',
        basePath: String(row?.basePath || ''),
        apiToken: '',
        clearApiToken: false,
        enable: row ? row.enable !== false : true,
        allowPrivateAddress: row?.allowPrivateAddress === true,
        tlsVerifyMode: String(row?.tlsVerifyMode || 'verify'),
        pinnedCertSha256: String(row?.pinnedCertSha256 || ''),
        inboundSyncMode: String(row?.inboundSyncMode || 'all'),
        inboundTags: Array.isArray(row?.inboundTags) ? row!.inboundTags.map(String) : [],
        outboundTag: String(row?.outboundTag || ''),
    };
}

/**
 * Body for nodes/add, update, test and inbounds. The API token is write-only: an
 * empty field keeps the stored one, so it is only sent when typed.
 */
export function buildNodeRequest(draft: NodeDraft) {
    const body: Record<string, unknown> = {
        name: draft.name.trim(),
        remark: draft.remark.trim(),
        scheme: draft.scheme,
        address: draft.address.trim(),
        port: Number.parseInt(draft.port, 10) || 0,
        basePath: draft.basePath.trim(),
        enable: draft.enable,
        allowPrivateAddress: draft.allowPrivateAddress,
        tlsVerifyMode: draft.scheme === 'https' ? draft.tlsVerifyMode : 'verify',
        pinnedCertSha256: draft.tlsVerifyMode === 'pin' ? draft.pinnedCertSha256.trim() : '',
        inboundSyncMode: draft.inboundSyncMode,
        inboundTags: draft.inboundSyncMode === 'selected' ? draft.inboundTags : [],
        outboundTag: draft.outboundTag.trim(),
    };
    if (draft.id) body.id = draft.id;
    const token = draft.apiToken.trim();
    if (token) body.apiToken = token;
    else if (draft.id && draft.clearApiToken) body.clearApiToken = true;
    return body;
}

function nodeEndpoint(row: PanelNode) {
    const scheme = row.scheme || 'https';
    const port = row.port ? `:${row.port}` : '';
    return `${scheme}://${row.address || '—'}${port}${row.basePath || ''}`;
}

function statusBadge(status: string | undefined) {
    if (status === 'online') return 'badge-success';
    if (status === 'offline') return 'badge-danger';
    return 'badge-neutral';
}

type PanelNodesPanelProps = {
    serverId: string;
};

export default function PanelNodesPanel({ serverId }: PanelNodesPanelProps) {
    const { t, locale } = useI18n();
    const tr = useCallback((key: string, params?: Record<string, any>) => t(`pages.panelFeatures.${key}`, params), [t]);
    const confirmAction = useConfirm();
    const base = panelApiPath(serverId, '/nodes');
    const { rows, loading, error, unsupported, reload } = usePanelList<PanelNode>(
        `${base}/list`,
        (err) => getErrorMessage(err, tr('nodes.loadFailed'), locale),
    );
    const { busyKey, run } = usePanelAction();
    const [editing, setEditing] = useState<{ original?: PanelNode } | null>(null);
    const [draft, setDraft] = useState<NodeDraft>(() => toDraft());
    const [formError, setFormError] = useState('');
    const [testResult, setTestResult] = useState<ProbeResult | null>(null);
    const [remoteInbounds, setRemoteInbounds] = useState<PanelInboundOption[] | null>(null);

    const update = <K extends keyof NodeDraft>(key: K, value: NodeDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

    const openEditor = (original?: PanelNode) => {
        setDraft(toDraft(original));
        setFormError('');
        setTestResult(null);
        setRemoteInbounds(null);
        setEditing({ original });
    };

    const validate = () => {
        const port = Number.parseInt(draft.port, 10);
        if (!draft.name.trim()) return setFormError(tr('nodes.nameRequired')), false;
        if (!draft.address.trim()) return setFormError(tr('nodes.addressRequired')), false;
        if (!Number.isFinite(port) || port < 1 || port > 65535) return setFormError(tr('nodes.portInvalid')), false;
        if (!draft.id && !draft.apiToken.trim() && draft.tlsVerifyMode !== 'mtls') return setFormError(tr('nodes.tokenRequired')), false;
        setFormError('');
        return true;
    };

    const testConnection = async () => {
        if (!validate()) return;
        setTestResult(null);
        const payload = await run('test', () => api.post(`${base}/test`, buildNodeRequest(draft)), { failure: tr('nodes.testFailed') });
        if (payload) setTestResult(payload.obj || {});
    };

    const fetchFingerprint = async () => {
        if (!draft.address.trim()) return setFormError(tr('nodes.addressRequired'));
        const payload = await run('fingerprint', () => api.post(`${base}/certFingerprint`, buildNodeRequest(draft)), { failure: tr('nodes.fingerprintFailed') });
        if (payload && payload.obj) update('pinnedCertSha256', String(payload.obj));
    };

    const loadRemoteInbounds = async () => {
        if (!validate()) return;
        const payload = await run('inbounds', () => api.post(`${base}/inbounds`, buildNodeRequest(draft)), { failure: tr('nodes.inboundsFailed') });
        if (!payload) return;
        const options = Array.isArray(payload.obj) ? payload.obj : [];
        setRemoteInbounds(options.map((item: any, index: number) => ({
            id: Number(item?.id || index + 1),
            remark: String(item?.remark || ''),
            tag: String(item?.tag || ''),
            protocol: String(item?.protocol || ''),
            port: item?.port,
        })));
    };

    const save = async () => {
        if (!editing || !validate()) return;
        const body = buildNodeRequest(draft);
        const id = editing.original?.id;
        const payload = await run('save', () => api.post(id ? `${base}/update/${id}` : `${base}/add`, body), {
            success: id ? tr('nodes.saved', { name: body.name }) : tr('nodes.created', { name: body.name }),
            failure: tr('nodes.saveFailed'),
        });
        if (!payload) return;
        setEditing(null);
        reload();
    };

    const probe = async (row: PanelNode) => {
        const payload = await run(`row:${row.id}`, () => api.post(`${base}/probe/${row.id}`), { failure: tr('nodes.testFailed') });
        if (payload) {
            const result: ProbeResult = payload.obj || {};
            if (result.status === 'online') toast.success(tr('nodes.probeOnline', { name: row.name || `#${row.id}`, latency: Number(result.latencyMs || 0) }));
            else toast.error(result.error || tr('nodes.probeOffline', { name: row.name || `#${row.id}` }));
        }
        reload();
    };

    const setEnabled = async (row: PanelNode, enable: boolean) => {
        const payload = await run(`row:${row.id}`, () => api.post(`${base}/setEnable/${row.id}`, { enable }), { failure: tr('nodes.saveFailed') });
        if (payload) reload();
    };

    const updatePanel = async (row: PanelNode) => {
        const name = row.name || `#${row.id}`;
        const ok = await confirmAction({
            title: tr('nodes.updatePanelTitle'),
            message: tr('nodes.updatePanelMessage', { name }),
            confirmText: tr('nodes.updatePanel'),
            tone: 'danger',
        });
        if (!ok) return;
        await run(`row:${row.id}`, () => api.post(`${base}/updatePanel`, { ids: [row.id], dev: false }), {
            success: tr('nodes.updateStarted', { name }),
            failure: tr('nodes.updateFailed'),
        });
    };

    const remove = async (row: PanelNode) => {
        const name = row.name || `#${row.id}`;
        const ok = await confirmAction({
            title: tr('nodes.deleteTitle'),
            message: tr('nodes.deleteMessage', { name }),
            confirmText: tr('common.delete'),
            tone: 'danger',
        });
        if (!ok) return;
        const payload = await run(`row:${row.id}`, () => api.post(`${base}/del/${row.id}`), {
            success: tr('nodes.deleted', { name }),
            failure: tr('nodes.deleteFailed'),
        });
        if (payload) reload();
    };

    const createButton = (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openEditor()}>
            <HiOutlinePlus /> {tr('nodes.create')}
        </button>
    );

    const tagOptions = remoteInbounds || [];
    const selectedTagIds = tagOptions.filter((item) => draft.inboundTags.includes(String(item.tag))).map((item) => Number(item.id));
    const unknownTags = draft.inboundTags.filter((tag) => !tagOptions.some((item) => item.tag === tag));

    return (
        <PanelFeatureFrame
            title={tr('nodes.title')}
            description={tr('nodes.description')}
            loading={loading}
            error={error}
            unsupported={unsupported}
            onRefresh={reload}
            actions={createButton}
        >
            {loading && rows.length === 0 ? (
                <PanelListSkeleton />
            ) : rows.length === 0 ? (
                !error && <PanelEmpty title={tr('nodes.emptyTitle')} hint={tr('nodes.emptyHint')} action={createButton} />
            ) : (
                <ul className="pf-list" aria-label={tr('nodes.title')}>
                    {rows.map((row) => {
                        const disabled = row.enable === false;
                        const rowBusy = busyKey === `row:${row.id}`;
                        const heartbeat = toMillis(row.lastHeartbeat);
                        const status = disabled ? 'disabled' : (row.status === 'online' || row.status === 'offline' ? row.status : 'unknown');
                        const live = status === 'online';
                        const latency = Number(row.latencyMs || 0);
                        const clientTotal = Number(row.clientCount || 0);
                        const inboundTotal = Number(row.inboundCount || 0);
                        return (
                            <li key={row.id} className={`pf-row${disabled ? ' is-muted' : ''}`}>
                                <div className="pf-row-main">
                                    <div className="pf-row-title">
                                        {row.name || `#${row.id}`}
                                        <span className={`badge ${disabled ? 'badge-neutral' : statusBadge(row.status)}`}>{tr(`nodes.status.${status}`)}</span>
                                        {row.transitive && <span className="badge badge-neutral">{tr('nodes.transitive')}</span>}
                                    </div>
                                    <div className="pf-row-sub pf-row-sub--split">
                                        <span className="pf-machine">{nodeEndpoint(row)}</span>
                                        {row.remark ? <span>{row.remark}</span> : null}
                                    </div>
                                    <div className="pf-row-meta">
                                        {row.panelVersion ? (
                                            <span className="pf-meta-item"><span className="pf-meta-key">{tr('nodes.panelVersion')}</span><span>{row.panelVersion}</span></span>
                                        ) : null}
                                        {row.xrayVersion ? (
                                            <span className="pf-meta-item"><span className="pf-meta-key">Xray</span><span>{row.xrayVersion}</span></span>
                                        ) : null}
                                        {clientTotal > 0 || inboundTotal > 0 ? (
                                            <span className="pf-meta-item">
                                                <span className="pf-meta-key">{tr('nodes.clients')}</span>
                                                <span>{tr('nodes.clientSummary', { online: Number(row.onlineCount || 0), total: clientTotal, inbounds: inboundTotal })}</span>
                                            </span>
                                        ) : null}
                                        {live && row.uptimeSecs ? (
                                            <span className="pf-meta-item"><span className="pf-meta-key">{tr('nodes.uptime')}</span><span>{formatUptime(Number(row.uptimeSecs), locale)}</span></span>
                                        ) : null}
                                        {!disabled && !live ? (
                                            <span className="pf-meta-item">
                                                <span className="pf-meta-key">{tr('nodes.heartbeat')}</span>
                                                {heartbeat ? (
                                                    <time dateTime={new Date(heartbeat).toISOString()} title={formatDateTime(heartbeat, locale)}>{formatRelativeTime(heartbeat, locale)}</time>
                                                ) : (
                                                    <span>{tr('nodes.never')}</span>
                                                )}
                                            </span>
                                        ) : null}
                                    </div>
                                    {row.lastError && !live && !disabled ? <p className="pf-error-text">{row.lastError}</p> : null}
                                </div>
                                <div className="pf-row-figure">
                                    {live && latency > 0 ? (
                                        <>
                                            <span className="pf-figure">{latency}<small>ms</small></span>
                                            <span className="pf-figure-label">{tr('nodes.load', { cpu: Math.round(Number(row.cpuPct || 0)), mem: Math.round(Number(row.memPct || 0)) })}</span>
                                        </>
                                    ) : null}
                                </div>
                                <div className="pf-row-actions">
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => probe(row)} disabled={rowBusy}>
                                        {rowBusy ? <span className="spinner" /> : tr('nodes.probe')}
                                    </button>
                                    <ActionsDropdown
                                        actions={[
                                            { label: tr('common.edit'), icon: HiOutlinePencilSquare, onClick: () => openEditor(row), disabled: rowBusy },
                                            disabled
                                                ? { label: tr('common.enable'), icon: HiOutlineCheck, onClick: () => setEnabled(row, true), disabled: rowBusy }
                                                : { label: tr('common.disable'), icon: HiOutlineNoSymbol, onClick: () => setEnabled(row, false), disabled: rowBusy },
                                            { label: tr('nodes.updatePanel'), icon: HiOutlineArrowUpCircle, onClick: () => updatePanel(row), disabled: rowBusy || disabled },
                                            { label: tr('common.delete'), icon: HiOutlineTrash, onClick: () => remove(row), isDanger: true, disabled: rowBusy },
                                        ]}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <PanelFormModal
                isOpen={editing !== null}
                wide
                title={editing?.original ? tr('nodes.editTitle', { name: editing.original.name || `#${editing.original.id}` }) : tr('nodes.createTitle')}
                description={tr('nodes.editorHint')}
                submitLabel={editing?.original ? tr('common.save') : tr('nodes.create')}
                saving={busyKey === 'save'}
                onClose={() => setEditing(null)}
                onSubmit={save}
            >
                {formError && <p className="pf-error-text" role="alert">{formError}</p>}
                <div className="pf-form-grid">
                    <PanelField id="pf-node-name" label={tr('nodes.name')}>
                        <input id="pf-node-name" className="form-input" value={draft.name} onChange={(e) => update('name', e.target.value)} placeholder={tr('nodes.namePlaceholder')} autoComplete="off" />
                    </PanelField>
                    <PanelField id="pf-node-remark" label={tr('nodes.remark')}>
                        <input id="pf-node-remark" className="form-input" value={draft.remark} onChange={(e) => update('remark', e.target.value)} autoComplete="off" />
                    </PanelField>
                </div>
                <div className="pf-endpoint-grid">
                    <PanelField id="pf-node-scheme" label={tr('nodes.scheme')}>
                        <select id="pf-node-scheme" className="form-select" value={draft.scheme} onChange={(e) => update('scheme', e.target.value)}>
                            <option value="https">https</option>
                            <option value="http">http</option>
                        </select>
                    </PanelField>
                    <PanelField id="pf-node-address" label={tr('nodes.address')}>
                        <input id="pf-node-address" className="form-input pf-machine" value={draft.address} onChange={(e) => update('address', e.target.value)} placeholder="panel.example.com" autoComplete="off" spellCheck={false} />
                    </PanelField>
                    <PanelField id="pf-node-port" label={tr('nodes.port')}>
                        <input id="pf-node-port" className="form-input" inputMode="numeric" value={draft.port} onChange={(e) => update('port', e.target.value.replace(/[^\d]/g, ''))} placeholder="2053" />
                    </PanelField>
                    <PanelField id="pf-node-path" label={tr('nodes.basePath')}>
                        <input id="pf-node-path" className="form-input pf-machine" value={draft.basePath} onChange={(e) => update('basePath', e.target.value)} placeholder="/" autoComplete="off" spellCheck={false} />
                    </PanelField>
                </div>
                <div className="pf-form-grid pf-form-grid--pair">
                    <PanelField
                        id="pf-node-token"
                        label={tr('nodes.apiToken')}
                        hint={editing?.original ? tr('nodes.apiTokenKeepHint') : tr('nodes.apiTokenHint')}
                    >
                        <input
                            id="pf-node-token"
                            className="form-input pf-machine"
                            type="password"
                            value={draft.apiToken}
                            onChange={(e) => update('apiToken', e.target.value)}
                            autoComplete="new-password"
                            spellCheck={false}
                            disabled={draft.clearApiToken}
                        />
                    </PanelField>
                    {draft.scheme === 'https' && (
                        <PanelField id="pf-node-tls" label={tr('nodes.tlsVerifyMode')} hint={tr(`nodes.tlsHints.${draft.tlsVerifyMode}`)}>
                            <select id="pf-node-tls" className="form-select" value={draft.tlsVerifyMode} onChange={(e) => update('tlsVerifyMode', e.target.value)}>
                                {TLS_MODES.map((mode) => <option key={mode} value={mode}>{tr(`nodes.tlsModes.${mode}`)}</option>)}
                            </select>
                        </PanelField>
                    )}
                    {draft.scheme === 'https' && draft.tlsVerifyMode === 'pin' && (
                        <PanelField id="pf-node-pin" label={tr('nodes.pinnedCert')} hint={tr('nodes.pinnedCertHint')} wide>
                            <div className="pf-inline-field">
                                <input id="pf-node-pin" className="form-input pf-machine" value={draft.pinnedCertSha256} onChange={(e) => update('pinnedCertSha256', e.target.value)} autoComplete="off" spellCheck={false} />
                                <button type="button" className="btn btn-secondary" onClick={fetchFingerprint} disabled={busyKey === 'fingerprint'}>
                                    {busyKey === 'fingerprint' ? <span className="spinner" /> : tr('nodes.fetchFingerprint')}
                                </button>
                            </div>
                        </PanelField>
                    )}
                </div>
                {editing?.original && (
                    <PanelToggle id="pf-node-clear-token" label={tr('nodes.clearApiToken')} hint={tr('nodes.clearApiTokenHint')} checked={draft.clearApiToken} onChange={(value) => update('clearApiToken', value)} />
                )}

                <div className="pf-form-grid pf-form-grid--pair">
                    <PanelField id="pf-node-sync" label={tr('nodes.inboundSync')} hint={tr('nodes.inboundSyncHint')}>
                        <select id="pf-node-sync" className="form-select" value={draft.inboundSyncMode} onChange={(e) => update('inboundSyncMode', e.target.value)}>
                            <option value="all">{tr('nodes.syncAll')}</option>
                            <option value="selected">{tr('nodes.syncSelected')}</option>
                        </select>
                    </PanelField>
                    <PanelField id="pf-node-outbound" label={tr('nodes.outboundTag')} hint={tr('nodes.outboundTagHint')}>
                        <input id="pf-node-outbound" className="form-input pf-machine" value={draft.outboundTag} onChange={(e) => update('outboundTag', e.target.value)} placeholder={tr('nodes.outboundTagPlaceholder')} autoComplete="off" spellCheck={false} />
                    </PanelField>
                </div>
                {draft.inboundSyncMode === 'selected' && (
                    remoteInbounds ? (
                        <InboundPicker
                            id="pf-node-inbound-tags"
                            label={tr('nodes.inboundTags')}
                            hint={unknownTags.length > 0 ? tr('nodes.unknownTags', { tags: unknownTags.join(', ') }) : tr('nodes.inboundTagsHint')}
                            inbounds={tagOptions}
                            selected={selectedTagIds}
                            onChange={(ids) => update('inboundTags', [
                                ...unknownTags,
                                ...tagOptions.filter((item) => ids.includes(Number(item.id))).map((item) => String(item.tag)),
                            ])}
                        />
                    ) : (
                        <div className="pf-inline-note">
                            <span>{draft.inboundTags.length > 0 ? tr('nodes.selectedTags', { tags: draft.inboundTags.join(', ') }) : tr('nodes.noTagsYet')}</span>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={loadRemoteInbounds} disabled={busyKey === 'inbounds'}>
                                {busyKey === 'inbounds' ? <span className="spinner" /> : tr('nodes.loadInbounds')}
                            </button>
                        </div>
                    )
                )}

                <div className="pf-toggle-row">
                    <PanelToggle id="pf-node-enable" label={tr('nodes.enabled')} checked={draft.enable} onChange={(value) => update('enable', value)} />
                    <PanelToggle id="pf-node-private" label={tr('nodes.allowPrivate')} hint={tr('nodes.allowPrivateHint')} checked={draft.allowPrivateAddress} onChange={(value) => update('allowPrivateAddress', value)} />
                </div>

                <div className="pf-test">
                    <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={busyKey === 'test'}>
                        {busyKey === 'test' ? <span className="spinner" /> : tr('nodes.test')}
                    </button>
                    {testResult && (
                        <p className={testResult.status === 'online' ? 'pf-test-ok' : 'pf-error-text'} role="status">
                            {testResult.status === 'online'
                                ? tr('nodes.testOk', { latency: Number(testResult.latencyMs || 0), version: testResult.panelVersion || '—' })
                                : (testResult.error || tr('nodes.testFailed'))}
                        </p>
                    )}
                </div>
            </PanelFormModal>
        </PanelFeatureFrame>
    );
}
