import React, { useCallback, useMemo, useState } from 'react';
import {
    HiOutlineArrowDown,
    HiOutlineArrowUp,
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlinePlus,
    HiOutlineTrash,
} from 'react-icons/hi2';
import api from '../../../api/client';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useI18n } from '../../../contexts/LanguageContext';
import { getErrorMessage } from '../../../utils/format';
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
import {
    describeInbound,
    panelApiPath,
    splitList,
    usePanelAction,
    usePanelList,
    type PanelInboundOption,
} from './panelRequest';

type HostGroup = {
    groupId: string;
    inboundIds?: number[];
    hosts?: string[];
    sortOrder?: number;
    remark?: string;
    serverDescription?: string;
    isDisabled?: boolean;
    isHidden?: boolean;
    tags?: string[];
    port?: number;
    security?: string;
    sni?: string;
    hostHeader?: string;
    path?: string;
    alpn?: string[];
    fingerprint?: string;
    allowInsecure?: boolean;
    [key: string]: unknown;
};

type HostDraft = {
    remark: string;
    serverDescription: string;
    inboundIds: number[];
    hosts: string;
    port: string;
    enabled: boolean;
    isHidden: boolean;
    security: string;
    sni: string;
    hostHeader: string;
    path: string;
    alpn: string;
    fingerprint: string;
    allowInsecure: boolean;
    tags: string;
};

const SECURITY_OPTIONS = ['same', 'tls', 'reality', 'none'] as const;
const FINGERPRINTS = ['', 'chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized'];
const HOST_VISIBLE_LIMIT = 2;
const KNOWN_SECURITY = new Set(['tls', 'reality', 'none']);

function toDraft(row?: HostGroup): HostDraft {
    return {
        remark: String(row?.remark || ''),
        serverDescription: String(row?.serverDescription || ''),
        inboundIds: Array.isArray(row?.inboundIds) ? row!.inboundIds.map(Number) : [],
        hosts: Array.isArray(row?.hosts) ? row!.hosts.join('\n') : '',
        port: row?.port ? String(row.port) : '',
        enabled: row ? row.isDisabled !== true : true,
        isHidden: row?.isHidden === true,
        security: String(row?.security || 'same'),
        sni: String(row?.sni || ''),
        hostHeader: String(row?.hostHeader || ''),
        path: String(row?.path || ''),
        alpn: Array.isArray(row?.alpn) ? row!.alpn.join(', ') : '',
        fingerprint: String(row?.fingerprint || ''),
        allowInsecure: row?.allowInsecure === true,
        tags: Array.isArray(row?.tags) ? row!.tags.join(', ') : '',
    };
}

function splitComma(text: string) {
    return text.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

/** Merge the edited fields into the stored host so fields this form does not show survive. */
export function buildHostPayload(draft: HostDraft, original?: HostGroup): HostGroup {
    const port = Number.parseInt(draft.port, 10);
    return {
        ...(original || {}),
        groupId: original?.groupId || '',
        remark: draft.remark.trim(),
        serverDescription: draft.serverDescription.trim(),
        inboundIds: draft.inboundIds,
        hosts: splitList(draft.hosts),
        port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : 0,
        isDisabled: !draft.enabled,
        isHidden: draft.isHidden,
        security: draft.security,
        sni: draft.sni.trim(),
        hostHeader: draft.hostHeader.trim(),
        path: draft.path.trim(),
        alpn: splitComma(draft.alpn),
        fingerprint: draft.fingerprint,
        allowInsecure: draft.allowInsecure,
        tags: splitComma(draft.tags),
    };
}

type SubscriptionHostsPanelProps = {
    serverId: string;
    canManage: boolean;
    inbounds: PanelInboundOption[];
};

export default function SubscriptionHostsPanel({ serverId, canManage, inbounds }: SubscriptionHostsPanelProps) {
    const { t, locale } = useI18n();
    const tr = useCallback((key: string, params?: Record<string, any>) => t(`pages.panelFeatures.${key}`, params), [t]);
    const confirmAction = useConfirm();
    const base = panelApiPath(serverId, '/hosts');
    const { rows, loading, error, unsupported, reload } = usePanelList<HostGroup>(
        `${base}/list`,
        (err) => getErrorMessage(err, tr('hosts.loadFailed'), locale),
    );
    const { busyKey, run } = usePanelAction();
    const [editing, setEditing] = useState<{ original?: HostGroup } | null>(null);
    const [draft, setDraft] = useState<HostDraft>(() => toDraft());
    const [formError, setFormError] = useState('');
    const inboundById = useMemo(() => new Map(inbounds.map((item) => [Number(item.id), item])), [inbounds]);

    const update = <K extends keyof HostDraft>(key: K, value: HostDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

    const openEditor = (original?: HostGroup) => {
        setDraft(toDraft(original));
        setFormError('');
        setEditing({ original });
    };

    const save = async () => {
        if (!editing) return;
        if (!draft.remark.trim()) {
            setFormError(tr('hosts.remarkRequired'));
            return;
        }
        if (draft.inboundIds.length === 0) {
            setFormError(tr('hosts.inboundRequired'));
            return;
        }
        setFormError('');
        const body = buildHostPayload(draft, editing.original);
        const groupId = editing.original?.groupId;
        const payload = groupId
            ? await run('save', () => api.post(`${base}/update/${encodeURIComponent(groupId)}`, body), {
                success: tr('hosts.saved', { name: body.remark }),
                failure: tr('hosts.saveFailed'),
            })
            : await run('save', () => api.post(`${base}/add`, body), {
                success: tr('hosts.created', { name: body.remark }),
                failure: tr('hosts.saveFailed'),
            });
        if (!payload) return;
        setEditing(null);
        reload();
    };

    const setEnabled = async (row: HostGroup, enable: boolean) => {
        const payload = await run(`row:${row.groupId}`, () => api.post(`${base}/setEnable/${encodeURIComponent(row.groupId)}`, { enable }), {
            failure: tr('hosts.saveFailed'),
        });
        if (payload) reload();
    };

    const move = async (index: number, offset: number) => {
        const target = index + offset;
        if (target < 0 || target >= rows.length) return;
        const ids = rows.map((row) => row.groupId);
        [ids[index], ids[target]] = [ids[target], ids[index]];
        const payload = await run(`row:${rows[index].groupId}`, () => api.post(`${base}/reorder`, { ids }), {
            failure: tr('hosts.reorderFailed'),
        });
        if (payload) reload();
    };

    const remove = async (row: HostGroup) => {
        const name = row.remark || row.groupId;
        const ok = await confirmAction({
            title: tr('hosts.deleteTitle'),
            message: tr('hosts.deleteMessage', { name }),
            confirmText: tr('common.delete'),
            tone: 'danger',
        });
        if (!ok) return;
        const payload = await run(`row:${row.groupId}`, () => api.post(`${base}/del/${encodeURIComponent(row.groupId)}`), {
            success: tr('hosts.deleted', { name }),
            failure: tr('hosts.deleteFailed'),
        });
        if (payload) reload();
    };

    const createButton = (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openEditor()} disabled={inbounds.length === 0}>
            <HiOutlinePlus /> {tr('hosts.create')}
        </button>
    );

    return (
        <PanelFeatureFrame
            title={tr('hosts.title')}
            description={tr('hosts.description')}
            loading={loading}
            error={error}
            unsupported={unsupported}
            onRefresh={reload}
            actions={canManage ? createButton : null}
        >
            {loading && rows.length === 0 ? (
                <PanelListSkeleton />
            ) : rows.length === 0 ? (
                !error && <PanelEmpty title={tr('hosts.emptyTitle')} hint={tr('hosts.emptyHint')} action={canManage ? createButton : null} />
            ) : (
                <ul className="pf-list" aria-label={tr('hosts.title')}>
                    {rows.map((row, index) => {
                        const hosts = Array.isArray(row.hosts) ? row.hosts : [];
                        const inboundNames = (row.inboundIds || []).map((id) => describeInbound(inboundById.get(Number(id)), Number(id)));
                        const rowBusy = busyKey === `row:${row.groupId}`;
                        const disabled = row.isDisabled === true;
                        return (
                            <li key={row.groupId} className={`pf-row${disabled ? ' is-muted' : ''}`}>
                                <div className="pf-row-main">
                                    <div className="pf-row-title">
                                        {row.remark || row.groupId}
                                        {disabled && <span className="badge badge-neutral">{tr('common.disabled')}</span>}
                                        {row.isHidden && <span className="badge badge-neutral">{tr('hosts.hidden')}</span>}
                                    </div>
                                    {row.serverDescription ? <div className="pf-row-sub">{row.serverDescription}</div> : null}
                                    <div className="pf-row-meta">
                                        <span className="pf-meta-item">
                                            <span className="pf-meta-key">{tr('hosts.addresses')}</span>
                                            {hosts.length === 0 ? (
                                                <span>{tr('hosts.inheritAddress')}</span>
                                            ) : (
                                                <span>
                                                    <span className="pf-machine">{hosts.slice(0, HOST_VISIBLE_LIMIT).join(', ')}</span>
                                                    {hosts.length > HOST_VISIBLE_LIMIT ? <span className="pf-more">+{hosts.length - HOST_VISIBLE_LIMIT}</span> : null}
                                                </span>
                                            )}
                                        </span>
                                        {Number(row.port) > 0 ? (
                                            <span className="pf-meta-item"><span className="pf-meta-key">{tr('hosts.port')}</span><span>{row.port}</span></span>
                                        ) : null}
                                        {row.security && KNOWN_SECURITY.has(row.security) ? (
                                            <span className="pf-meta-item"><span className="pf-meta-key">{tr('hosts.security')}</span><span>{tr(`hosts.securityOptions.${row.security}`)}</span></span>
                                        ) : null}
                                        {row.sni ? (
                                            <span className="pf-meta-item"><span className="pf-meta-key">SNI</span><span className="pf-machine">{row.sni}</span></span>
                                        ) : null}
                                    </div>
                                    {inboundNames.length > 0 ? (
                                        <ul className="pf-chip-list" aria-label={tr('hosts.inbounds')}>
                                            {inboundNames.map((name, i) => (
                                                <li key={`${name}-${i}`} className="pf-chip"><span className="pf-chip-text">{name}</span></li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                                {canManage && (
                                    <div className="pf-row-actions">
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditor(row)} disabled={rowBusy}>
                                            {tr('common.edit')}
                                        </button>
                                        <ActionsDropdown
                                            actions={[
                                                disabled
                                                    ? { label: tr('common.enable'), icon: HiOutlineEye, onClick: () => setEnabled(row, true), disabled: rowBusy }
                                                    : { label: tr('common.disable'), icon: HiOutlineEyeSlash, onClick: () => setEnabled(row, false), disabled: rowBusy },
                                                { label: tr('common.moveUp'), icon: HiOutlineArrowUp, onClick: () => move(index, -1), disabled: rowBusy || index === 0 },
                                                { label: tr('common.moveDown'), icon: HiOutlineArrowDown, onClick: () => move(index, 1), disabled: rowBusy || index === rows.length - 1 },
                                                { label: tr('common.delete'), icon: HiOutlineTrash, onClick: () => remove(row), isDanger: true, disabled: rowBusy },
                                            ]}
                                        />
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <PanelFormModal
                isOpen={editing !== null}
                wide
                title={editing?.original ? tr('hosts.editTitle', { name: editing.original.remark || editing.original.groupId }) : tr('hosts.createTitle')}
                description={tr('hosts.editorHint')}
                submitLabel={editing?.original ? tr('common.save') : tr('hosts.create')}
                saving={busyKey === 'save'}
                onClose={() => setEditing(null)}
                onSubmit={save}
            >
                {formError && <p className="pf-error-text" role="alert">{formError}</p>}
                <div className="pf-form-grid">
                    <PanelField id="pf-host-remark" label={tr('hosts.remark')} hint={tr('hosts.remarkHint')}>
                        <input id="pf-host-remark" className="form-input" maxLength={256} value={draft.remark} onChange={(e) => update('remark', e.target.value)} autoComplete="off" />
                    </PanelField>
                    <PanelField id="pf-host-description" label={tr('hosts.serverDescription')} hint={tr('hosts.serverDescriptionHint')}>
                        <input id="pf-host-description" className="form-input" maxLength={64} value={draft.serverDescription} onChange={(e) => update('serverDescription', e.target.value)} autoComplete="off" />
                    </PanelField>
                    <PanelField id="pf-host-hosts" label={tr('hosts.addresses')} hint={tr('hosts.addressesHint')}>
                        <textarea id="pf-host-hosts" className="form-input pf-textarea pf-machine" rows={3} spellCheck={false} value={draft.hosts} onChange={(e) => update('hosts', e.target.value)} />
                    </PanelField>
                    <PanelField id="pf-host-port" label={tr('hosts.port')} hint={tr('hosts.portHint')}>
                        <input id="pf-host-port" className="form-input" inputMode="numeric" value={draft.port} onChange={(e) => update('port', e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
                    </PanelField>
                </div>

                <InboundPicker
                    id="pf-host-inbounds"
                    label={tr('hosts.inbounds')}
                    hint={tr('hosts.inboundsHint')}
                    inbounds={inbounds}
                    selected={draft.inboundIds}
                    onChange={(ids) => update('inboundIds', ids)}
                />

                <div className="pf-toggle-row">
                    <PanelToggle id="pf-host-enabled" label={tr('hosts.enabled')} checked={draft.enabled} onChange={(value) => update('enabled', value)} />
                    <PanelToggle id="pf-host-hidden" label={tr('hosts.hideInSub')} hint={tr('hosts.hideInSubHint')} checked={draft.isHidden} onChange={(value) => update('isHidden', value)} />
                </div>

                <details className="pf-disclosure" open={draft.security !== 'same' || Boolean(draft.sni || draft.hostHeader || draft.path)}>
                    <summary>{tr('hosts.transportSection')}</summary>
                    <div className="pf-form-grid">
                        <PanelField id="pf-host-security" label={tr('hosts.security')}>
                            <select id="pf-host-security" className="form-select" value={draft.security} onChange={(e) => update('security', e.target.value)}>
                                {SECURITY_OPTIONS.map((option) => <option key={option} value={option}>{tr(`hosts.securityOptions.${option}`)}</option>)}
                            </select>
                        </PanelField>
                        <PanelField id="pf-host-sni" label="SNI">
                            <input id="pf-host-sni" className="form-input pf-machine" value={draft.sni} onChange={(e) => update('sni', e.target.value)} autoComplete="off" spellCheck={false} />
                        </PanelField>
                        <PanelField id="pf-host-header" label={tr('hosts.hostHeader')}>
                            <input id="pf-host-header" className="form-input pf-machine" value={draft.hostHeader} onChange={(e) => update('hostHeader', e.target.value)} autoComplete="off" spellCheck={false} />
                        </PanelField>
                        <PanelField id="pf-host-path" label={tr('hosts.path')}>
                            <input id="pf-host-path" className="form-input pf-machine" value={draft.path} onChange={(e) => update('path', e.target.value)} autoComplete="off" spellCheck={false} />
                        </PanelField>
                        <PanelField id="pf-host-alpn" label="ALPN" hint={tr('hosts.commaHint')}>
                            <input id="pf-host-alpn" className="form-input pf-machine" value={draft.alpn} onChange={(e) => update('alpn', e.target.value)} placeholder="h2, http/1.1" autoComplete="off" spellCheck={false} />
                        </PanelField>
                        <PanelField id="pf-host-fingerprint" label={tr('hosts.fingerprint')}>
                            <select id="pf-host-fingerprint" className="form-select" value={draft.fingerprint} onChange={(e) => update('fingerprint', e.target.value)}>
                                {FINGERPRINTS.map((value) => <option key={value || 'inherit'} value={value}>{value || tr('hosts.inherit')}</option>)}
                            </select>
                        </PanelField>
                        <PanelField id="pf-host-tags" label={tr('hosts.tags')} hint={tr('hosts.tagsHint')}>
                            <input id="pf-host-tags" className="form-input pf-machine" value={draft.tags} onChange={(e) => update('tags', e.target.value)} autoComplete="off" spellCheck={false} />
                        </PanelField>
                    </div>
                    <PanelToggle id="pf-host-insecure" label={tr('hosts.allowInsecure')} hint={tr('hosts.allowInsecureHint')} checked={draft.allowInsecure} onChange={(value) => update('allowInsecure', value)} />
                </details>
            </PanelFormModal>
        </PanelFeatureFrame>
    );
}
