import React, { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import {
    HiOutlineArrowDown,
    HiOutlineArrowUp,
    HiOutlineCheck,
    HiOutlineNoSymbol,
    HiOutlinePencilSquare,
    HiOutlinePlus,
    HiOutlineTrash,
} from 'react-icons/hi2';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useI18n } from '../../../contexts/LanguageContext';
import { formatDateTime, formatRelativeTime, getErrorMessage } from '../../../utils/format';
import ActionsDropdown from '../../UI/ActionsDropdown';
import {
    PanelEmpty,
    PanelFeatureFrame,
    PanelField,
    PanelFormModal,
    PanelListSkeleton,
    PanelToggle,
} from './PanelFeatureFrame';
import { panelApiPath, postPanelForm, toMillis, usePanelAction, usePanelList } from './panelRequest';

type OutboundSub = {
    id: number;
    remark?: string;
    url?: string;
    enabled?: boolean;
    allowPrivate?: boolean;
    allowInsecure?: boolean;
    userAgent?: string;
    tagPrefix?: string;
    updateInterval?: number;
    prepend?: boolean;
    lastUpdated?: number;
    lastError?: string;
    outboundCount?: number;
};

type SubDraft = {
    remark: string;
    url: string;
    tagPrefix: string;
    userAgent: string;
    intervalMinutes: string;
    enabled: boolean;
    prepend: boolean;
    allowPrivate: boolean;
    allowInsecure: boolean;
};

type PreviewOutbound = { tag?: string; protocol?: string };

const DEFAULT_INTERVAL_SECONDS = 600;

function toDraft(row?: OutboundSub): SubDraft {
    const seconds = Number(row?.updateInterval || DEFAULT_INTERVAL_SECONDS);
    return {
        remark: String(row?.remark || ''),
        url: String(row?.url || ''),
        tagPrefix: String(row?.tagPrefix || ''),
        userAgent: String(row?.userAgent || ''),
        intervalMinutes: String(Math.max(1, Math.round(seconds / 60))),
        enabled: row ? row.enabled !== false : true,
        prepend: row?.prepend === true,
        allowPrivate: row?.allowPrivate === true,
        allowInsecure: row?.allowInsecure === true,
    };
}

/** The panel rewrites every field on update, so the form always carries all of them. */
export function buildOutboundSubForm(draft: SubDraft) {
    const minutes = Number.parseInt(draft.intervalMinutes, 10);
    return {
        remark: draft.remark.trim(),
        url: draft.url.trim(),
        tagPrefix: draft.tagPrefix.trim(),
        userAgent: draft.userAgent.trim(),
        updateInterval: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : DEFAULT_INTERVAL_SECONDS,
        enabled: draft.enabled ? 'true' : 'false',
        prepend: draft.prepend ? 'true' : 'false',
        allowPrivate: draft.allowPrivate ? 'true' : 'false',
        allowInsecure: draft.allowInsecure ? 'true' : 'false',
    };
}

/** Show where a subscription comes from without putting its access token on screen. */
export function describeSubscriptionSource(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.host || url;
    } catch {
        return url.length > 32 ? `${url.slice(0, 32)}…` : url;
    }
}

type OutboundSubsPanelProps = {
    serverId: string;
    canManage: boolean;
};

export default function OutboundSubsPanel({ serverId, canManage }: OutboundSubsPanelProps) {
    const { t, locale } = useI18n();
    const tr = useCallback((key: string, params?: Record<string, any>) => t(`pages.panelFeatures.${key}`, params), [t]);
    const confirmAction = useConfirm();
    const base = panelApiPath(serverId, '/xray/outbound-subs');
    const { rows, loading, error, unsupported, reload } = usePanelList<OutboundSub>(
        base,
        (err) => getErrorMessage(err, tr('outboundSubs.loadFailed'), locale),
    );
    const { busyKey, run } = usePanelAction();
    const [editing, setEditing] = useState<{ original?: OutboundSub } | null>(null);
    const [draft, setDraft] = useState<SubDraft>(() => toDraft());
    const [formError, setFormError] = useState('');
    const [preview, setPreview] = useState<PreviewOutbound[] | null>(null);

    const update = <K extends keyof SubDraft>(key: K, value: SubDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

    const openEditor = (original?: OutboundSub) => {
        setDraft(toDraft(original));
        setFormError('');
        setPreview(null);
        setEditing({ original });
    };

    const validate = () => {
        if (!draft.url.trim()) {
            setFormError(tr('outboundSubs.urlRequired'));
            return false;
        }
        setFormError('');
        return true;
    };

    const runPreview = async () => {
        if (!validate()) return;
        const fields = buildOutboundSubForm(draft);
        const payload = await run('preview', () => postPanelForm(`${base}/parse`, {
            url: fields.url,
            userAgent: fields.userAgent,
            allowPrivate: fields.allowPrivate,
            allowInsecure: fields.allowInsecure,
        }), { failure: tr('outboundSubs.previewFailed') });
        if (payload) setPreview(Array.isArray(payload.obj) ? payload.obj : []);
    };

    const save = async () => {
        if (!editing || !validate()) return;
        const fields = buildOutboundSubForm(draft);
        const id = editing.original?.id;
        const name = fields.remark || describeSubscriptionSource(fields.url);
        const payload = await run('save', () => postPanelForm(id ? `${base}/${id}` : base, fields), {
            success: id ? tr('outboundSubs.saved', { name }) : tr('outboundSubs.created', { name }),
            failure: tr('outboundSubs.saveFailed'),
        });
        if (!payload) return;
        setEditing(null);
        reload();
    };

    const refreshNow = async (row: OutboundSub) => {
        const payload = await run(`row:${row.id}`, () => postPanelForm(`${base}/${row.id}/refresh`, {}), {
            failure: tr('outboundSubs.refreshFailed'),
        });
        if (!payload) {
            reload();
            return;
        }
        const count = Array.isArray(payload.obj) ? payload.obj.length : Number(row.outboundCount || 0);
        toast.success(tr('outboundSubs.refreshed', { count }));
        reload();
    };

    const setEnabled = async (row: OutboundSub, enabled: boolean) => {
        const fields = buildOutboundSubForm({ ...toDraft(row), enabled });
        const payload = await run(`row:${row.id}`, () => postPanelForm(`${base}/${row.id}`, fields), {
            failure: tr('outboundSubs.saveFailed'),
        });
        if (payload) reload();
    };

    const move = async (row: OutboundSub, dir: 'up' | 'down') => {
        const payload = await run(`row:${row.id}`, () => postPanelForm(`${base}/${row.id}/move`, { dir }), {
            failure: tr('outboundSubs.reorderFailed'),
        });
        if (payload) reload();
    };

    const remove = async (row: OutboundSub) => {
        const name = row.remark || describeSubscriptionSource(String(row.url || ''));
        const ok = await confirmAction({
            title: tr('outboundSubs.deleteTitle'),
            message: tr('outboundSubs.deleteMessage', { name }),
            confirmText: tr('common.delete'),
            tone: 'danger',
        });
        if (!ok) return;
        const payload = await run(`row:${row.id}`, () => postPanelForm(`${base}/${row.id}/del`, {}), {
            success: tr('outboundSubs.deleted', { name }),
            failure: tr('outboundSubs.deleteFailed'),
        });
        if (payload) reload();
    };

    const createButton = (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openEditor()}>
            <HiOutlinePlus /> {tr('outboundSubs.create')}
        </button>
    );

    return (
        <PanelFeatureFrame
            title={tr('outboundSubs.title')}
            description={tr('outboundSubs.description')}
            loading={loading}
            error={error}
            unsupported={unsupported}
            onRefresh={reload}
            actions={canManage ? createButton : null}
        >
            {loading && rows.length === 0 ? (
                <PanelListSkeleton />
            ) : rows.length === 0 ? (
                !error && <PanelEmpty title={tr('outboundSubs.emptyTitle')} hint={tr('outboundSubs.emptyHint')} action={canManage ? createButton : null} />
            ) : (
                <ul className="pf-list" aria-label={tr('outboundSubs.title')}>
                    {rows.map((row, index) => {
                        const disabled = row.enabled === false;
                        const rowBusy = busyKey === `row:${row.id}`;
                        const updatedAt = toMillis(row.lastUpdated);
                        const source = describeSubscriptionSource(String(row.url || ''));
                        return (
                            <li key={row.id} className={`pf-row${disabled ? ' is-muted' : ''}`}>
                                <div className="pf-row-main">
                                    <div className="pf-row-title">
                                        {row.remark || source}
                                        {disabled && <span className="badge badge-neutral">{tr('common.disabled')}</span>}
                                        {row.prepend && <span className="badge badge-neutral">{tr('outboundSubs.prependBadge')}</span>}
                                    </div>
                                    <div className="pf-row-sub pf-row-sub--split">
                                        {row.remark ? <span className="pf-machine">{source}</span> : null}
                                        {row.tagPrefix ? <span>{tr('outboundSubs.prefixShort', { prefix: row.tagPrefix })}</span> : null}
                                        {updatedAt ? (
                                            <time dateTime={new Date(updatedAt).toISOString()} title={formatDateTime(updatedAt, locale)}>
                                                {tr('outboundSubs.updatedAt', { time: formatRelativeTime(updatedAt, locale) })}
                                            </time>
                                        ) : (
                                            <span>{tr('outboundSubs.neverUpdated')}</span>
                                        )}
                                    </div>
                                    {row.lastError && !disabled ? <p className="pf-error-text">{tr('outboundSubs.lastError', { error: row.lastError })}</p> : null}
                                </div>
                                <div className="pf-row-figure">
                                    <span className={`pf-figure${Number(row.outboundCount || 0) === 0 ? ' pf-figure--idle' : ''}`}>{Number(row.outboundCount || 0)}</span>
                                    <span className="pf-figure-label">{tr('outboundSubs.outbounds')}</span>
                                </div>
                                {canManage && (
                                    <div className="pf-row-actions">
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => refreshNow(row)} disabled={rowBusy}>
                                            {busyKey === `row:${row.id}` ? <span className="spinner" /> : tr('outboundSubs.refreshNow')}
                                        </button>
                                        <ActionsDropdown
                                            actions={[
                                                { label: tr('common.edit'), icon: HiOutlinePencilSquare, onClick: () => openEditor(row), disabled: rowBusy },
                                                disabled
                                                    ? { label: tr('common.enable'), icon: HiOutlineCheck, onClick: () => setEnabled(row, true), disabled: rowBusy }
                                                    : { label: tr('common.disable'), icon: HiOutlineNoSymbol, onClick: () => setEnabled(row, false), disabled: rowBusy },
                                                { label: tr('common.moveUp'), icon: HiOutlineArrowUp, onClick: () => move(row, 'up'), disabled: rowBusy || index === 0 },
                                                { label: tr('common.moveDown'), icon: HiOutlineArrowDown, onClick: () => move(row, 'down'), disabled: rowBusy || index === rows.length - 1 },
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
                title={editing?.original ? tr('outboundSubs.editTitle', { name: editing.original.remark || describeSubscriptionSource(String(editing.original.url || '')) }) : tr('outboundSubs.createTitle')}
                description={tr('outboundSubs.editorHint')}
                submitLabel={editing?.original ? tr('common.save') : tr('outboundSubs.create')}
                saving={busyKey === 'save'}
                onClose={() => setEditing(null)}
                onSubmit={save}
            >
                {formError && <p className="pf-error-text" role="alert">{formError}</p>}
                <PanelField id="pf-osub-url" label={tr('outboundSubs.url')} hint={tr('outboundSubs.urlHint')}>
                    <div className="pf-inline-field">
                        <input
                            id="pf-osub-url"
                            className="form-input pf-machine"
                            type="url"
                            value={draft.url}
                            onChange={(e) => { update('url', e.target.value); setPreview(null); }}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="https://"
                        />
                        <button type="button" className="btn btn-secondary" onClick={runPreview} disabled={busyKey === 'preview'}>
                            {busyKey === 'preview' ? <span className="spinner" /> : tr('outboundSubs.preview')}
                        </button>
                    </div>
                </PanelField>
                {preview && (
                    <div className="pf-preview" role="status">
                        <p className="pf-preview-title">{tr('outboundSubs.previewCount', { count: preview.length })}</p>
                        {preview.length > 0 && (
                            <ul className="pf-chip-list">
                                {preview.slice(0, 24).map((item, index) => (
                                    <li key={`${item.tag || 'outbound'}-${index}`} className="pf-chip">
                                        <span className="pf-chip-text">{item.tag || `#${index + 1}`}</span>
                                        {item.protocol ? <span className="pf-chip-detail">{item.protocol}</span> : null}
                                    </li>
                                ))}
                                {preview.length > 24 ? <li className="pf-chip pf-chip--more">+{preview.length - 24}</li> : null}
                            </ul>
                        )}
                    </div>
                )}
                <div className="pf-form-grid">
                    <PanelField id="pf-osub-remark" label={tr('outboundSubs.remark')}>
                        <input id="pf-osub-remark" className="form-input" value={draft.remark} onChange={(e) => update('remark', e.target.value)} autoComplete="off" />
                    </PanelField>
                    <PanelField id="pf-osub-prefix" label={tr('outboundSubs.tagPrefix')} hint={tr('outboundSubs.tagPrefixHint')}>
                        <input id="pf-osub-prefix" className="form-input pf-machine" value={draft.tagPrefix} onChange={(e) => update('tagPrefix', e.target.value)} autoComplete="off" spellCheck={false} />
                    </PanelField>
                    <PanelField id="pf-osub-interval" label={tr('outboundSubs.interval')}>
                        <input id="pf-osub-interval" className="form-input" inputMode="numeric" value={draft.intervalMinutes} onChange={(e) => update('intervalMinutes', e.target.value.replace(/[^\d]/g, ''))} />
                    </PanelField>
                    <PanelField id="pf-osub-ua" label={tr('outboundSubs.userAgent')} hint={tr('outboundSubs.userAgentHint')}>
                        <input id="pf-osub-ua" className="form-input" value={draft.userAgent} onChange={(e) => update('userAgent', e.target.value)} autoComplete="off" spellCheck={false} />
                    </PanelField>
                </div>
                <div className="pf-toggle-stack">
                    <PanelToggle id="pf-osub-enabled" label={tr('outboundSubs.enabled')} checked={draft.enabled} onChange={(value) => update('enabled', value)} />
                    <PanelToggle id="pf-osub-prepend" label={tr('outboundSubs.prepend')} hint={tr('outboundSubs.prependHint')} checked={draft.prepend} onChange={(value) => update('prepend', value)} />
                    <PanelToggle id="pf-osub-private" label={tr('outboundSubs.allowPrivate')} hint={tr('outboundSubs.allowPrivateHint')} checked={draft.allowPrivate} onChange={(value) => update('allowPrivate', value)} />
                    <PanelToggle id="pf-osub-insecure" label={tr('outboundSubs.allowInsecure')} hint={tr('outboundSubs.allowInsecureHint')} checked={draft.allowInsecure} onChange={(value) => update('allowInsecure', value)} />
                </div>
            </PanelFormModal>
        </PanelFeatureFrame>
    );
}
