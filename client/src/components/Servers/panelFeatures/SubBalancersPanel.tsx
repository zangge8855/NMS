import React, { useCallback, useMemo, useState } from 'react';
import { HiOutlineCheck, HiOutlineNoSymbol, HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
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
    postPanelForm,
    usePanelAction,
    usePanelList,
    type PanelInboundOption,
} from './panelRequest';

export const BALANCER_STRATEGIES = ['random', 'roundRobin', 'leastPing', 'leastLoad'] as const;

type SubBalancer = {
    id: number;
    remark?: string;
    strategy?: string;
    inboundIds?: number[];
    memberWeights?: Record<string, number>;
    sortOrder?: number;
    enabled?: boolean;
};

type BalancerDraft = {
    remark: string;
    strategy: string;
    inboundIds: number[];
    weights: Record<number, string>;
    sortOrder: string;
    enabled: boolean;
};

function toDraft(row?: SubBalancer): BalancerDraft {
    const weights: Record<number, string> = {};
    for (const [key, value] of Object.entries(row?.memberWeights || {})) {
        weights[Number(key)] = String(value);
    }
    return {
        remark: String(row?.remark || ''),
        strategy: String(row?.strategy || 'random'),
        inboundIds: Array.isArray(row?.inboundIds) ? row!.inboundIds.map(Number) : [],
        weights,
        sortOrder: row?.sortOrder ? String(row.sortOrder) : '',
        enabled: row ? row.enabled !== false : true,
    };
}

/**
 * Form fields for POST /sub-balancers. Weights only travel with leastLoad (xray ignores
 * them otherwise); a member left blank weighs 1 on the panel side.
 */
export function buildBalancerForm(draft: BalancerDraft) {
    const fields: Record<string, unknown> = {
        remark: draft.remark.trim(),
        strategy: draft.strategy,
        inboundIds: draft.inboundIds,
        enabled: draft.enabled ? 'true' : 'false',
    };
    const sortOrder = Number.parseInt(draft.sortOrder, 10);
    if (Number.isFinite(sortOrder) && sortOrder >= 1) fields.sortOrder = sortOrder;
    if (draft.strategy === 'leastLoad') {
        const weights: Record<string, number> = {};
        for (const id of draft.inboundIds) {
            const raw = String(draft.weights[id] ?? '').trim();
            if (!raw) continue;
            weights[String(id)] = Number(raw);
        }
        fields.memberWeights = JSON.stringify(weights);
    }
    return fields;
}

/**
 * leastLoad picks lower weights more often, so each bar shows 1/weight relative to the
 * member the balancer favours most: the longest bar is the likeliest pick.
 */
export function memberShares(row: Pick<SubBalancer, 'inboundIds' | 'memberWeights'>) {
    const members = (row.inboundIds || []).map((rawId) => {
        const id = Number(rawId);
        const stored = Number(row.memberWeights?.[String(id)]);
        const weight = Number.isFinite(stored) && stored > 0 ? stored : 1;
        return { id, weight };
    });
    const strongest = Math.max(0, ...members.map((member) => 1 / member.weight));
    return members.map((member) => ({ ...member, share: strongest > 0 ? (1 / member.weight) / strongest : 0 }));
}

function invalidWeight(draft: BalancerDraft) {
    if (draft.strategy !== 'leastLoad') return false;
    return draft.inboundIds.some((id) => {
        const raw = String(draft.weights[id] ?? '').trim();
        if (!raw) return false;
        const value = Number(raw);
        return !Number.isFinite(value) || value <= 0;
    });
}

type SubBalancersPanelProps = {
    serverId: string;
    canManage: boolean;
    inbounds: PanelInboundOption[];
};

export default function SubBalancersPanel({ serverId, canManage, inbounds }: SubBalancersPanelProps) {
    const { t, locale } = useI18n();
    const tr = useCallback((key: string, params?: Record<string, any>) => t(`pages.panelFeatures.${key}`, params), [t]);
    const confirmAction = useConfirm();
    const base = panelApiPath(serverId, '/sub-balancers');
    const { rows, loading, error, unsupported, reload } = usePanelList<SubBalancer>(
        base,
        (err) => getErrorMessage(err, tr('balancers.loadFailed'), locale),
    );
    const { busyKey, run } = usePanelAction();
    const [editing, setEditing] = useState<{ original?: SubBalancer } | null>(null);
    const [draft, setDraft] = useState<BalancerDraft>(() => toDraft());
    const [formError, setFormError] = useState('');
    const inboundById = useMemo(() => new Map(inbounds.map((item) => [Number(item.id), item])), [inbounds]);

    const update = <K extends keyof BalancerDraft>(key: K, value: BalancerDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

    const openEditor = (original?: SubBalancer) => {
        setDraft(toDraft(original));
        setFormError('');
        setEditing({ original });
    };

    const save = async () => {
        if (!editing) return;
        if (!draft.remark.trim()) return setFormError(tr('balancers.remarkRequired'));
        if (draft.inboundIds.length === 0) return setFormError(tr('balancers.inboundRequired'));
        if (invalidWeight(draft)) return setFormError(tr('balancers.weightInvalid'));
        setFormError('');
        const fields = buildBalancerForm(draft);
        const id = editing.original?.id;
        const payload = await run('save', () => postPanelForm(id ? `${base}/${id}` : base, fields), {
            success: id ? tr('balancers.saved', { name: fields.remark }) : tr('balancers.created', { name: fields.remark }),
            failure: tr('balancers.saveFailed'),
        });
        if (!payload) return;
        setEditing(null);
        reload();
    };

    const setEnabled = async (row: SubBalancer, enabled: boolean) => {
        const fields = buildBalancerForm({ ...toDraft(row), enabled });
        const payload = await run(`row:${row.id}`, () => postPanelForm(`${base}/${row.id}`, fields), {
            failure: tr('balancers.saveFailed'),
        });
        if (payload) reload();
    };

    const remove = async (row: SubBalancer) => {
        const name = row.remark || `#${row.id}`;
        const ok = await confirmAction({
            title: tr('balancers.deleteTitle'),
            message: tr('balancers.deleteMessage', { name }),
            confirmText: tr('common.delete'),
            tone: 'danger',
        });
        if (!ok) return;
        const payload = await run(`row:${row.id}`, () => postPanelForm(`${base}/${row.id}/del`, {}), {
            success: tr('balancers.deleted', { name }),
            failure: tr('balancers.deleteFailed'),
        });
        if (payload) reload();
    };

    const createButton = (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openEditor()} disabled={inbounds.length === 0}>
            <HiOutlinePlus /> {tr('balancers.create')}
        </button>
    );

    return (
        <PanelFeatureFrame
            title={tr('balancers.title')}
            description={tr('balancers.description')}
            loading={loading}
            error={error}
            unsupported={unsupported}
            onRefresh={reload}
            actions={canManage ? createButton : null}
        >
            {loading && rows.length === 0 ? (
                <PanelListSkeleton />
            ) : rows.length === 0 ? (
                !error && <PanelEmpty title={tr('balancers.emptyTitle')} hint={tr('balancers.emptyHint')} action={canManage ? createButton : null} />
            ) : (
                <ul className="pf-list" aria-label={tr('balancers.title')}>
                    {rows.map((row) => {
                        const disabled = row.enabled === false;
                        const leastLoad = row.strategy === 'leastLoad';
                        const rowBusy = busyKey === `row:${row.id}`;
                        return (
                            <li key={row.id} className={`pf-row${disabled ? ' is-muted' : ''}`}>
                                <div className="pf-row-main">
                                    <div className="pf-row-title">
                                        {row.remark || `#${row.id}`}
                                        {disabled && <span className="badge badge-neutral">{tr('common.disabled')}</span>}
                                    </div>
                                    <div className="pf-row-sub pf-row-sub--split">
                                        <span>{tr(`balancers.strategies.${row.strategy || 'random'}`)}</span>
                                        {row.sortOrder ? <span>{tr('balancers.positionShort', { position: row.sortOrder })}</span> : null}
                                    </div>
                                    {leastLoad ? (
                                        <ul className="pf-weights" aria-label={tr('balancers.members')}>
                                            {memberShares(row).map(({ id, weight, share }) => (
                                                <li key={id} className="pf-weight">
                                                    <span className="pf-weight-name">{describeInbound(inboundById.get(id), id)}</span>
                                                    <span className="pf-weight-track" aria-hidden="true">
                                                        <span className="pf-weight-fill" style={{ inlineSize: `${Math.max(4, Math.round(share * 100))}%` }} />
                                                    </span>
                                                    <span className="pf-weight-value">{tr('balancers.weightValue', { value: weight })}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <ul className="pf-chip-list" aria-label={tr('balancers.members')}>
                                            {(row.inboundIds || []).map((id) => (
                                                <li key={id} className="pf-chip">
                                                    <span className="pf-chip-text">{describeInbound(inboundById.get(Number(id)), Number(id))}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                {canManage && (
                                    <div className="pf-row-actions">
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditor(row)} disabled={rowBusy}>
                                            {tr('common.edit')}
                                        </button>
                                        <ActionsDropdown
                                            actions={[
                                                disabled
                                                    ? { label: tr('common.enable'), icon: HiOutlineCheck, onClick: () => setEnabled(row, true), disabled: rowBusy }
                                                    : { label: tr('common.disable'), icon: HiOutlineNoSymbol, onClick: () => setEnabled(row, false), disabled: rowBusy },
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
                title={editing?.original ? tr('balancers.editTitle', { name: editing.original.remark || `#${editing.original.id}` }) : tr('balancers.createTitle')}
                description={tr('balancers.description')}
                submitLabel={editing?.original ? tr('common.save') : tr('balancers.create')}
                saving={busyKey === 'save'}
                onClose={() => setEditing(null)}
                onSubmit={save}
            >
                {formError && <p className="pf-error-text" role="alert">{formError}</p>}
                <div className="pf-form-grid">
                    <PanelField id="pf-balancer-remark" label={tr('balancers.remark')}>
                        <input id="pf-balancer-remark" className="form-input" maxLength={256} value={draft.remark} onChange={(e) => update('remark', e.target.value)} autoComplete="off" />
                    </PanelField>
                    <PanelField id="pf-balancer-strategy" label={tr('balancers.strategy')} hint={tr(`balancers.strategyHints.${draft.strategy}`)}>
                        <select id="pf-balancer-strategy" className="form-select" value={draft.strategy} onChange={(e) => update('strategy', e.target.value)}>
                            {BALANCER_STRATEGIES.map((value) => <option key={value} value={value}>{tr(`balancers.strategies.${value}`)}</option>)}
                        </select>
                    </PanelField>
                    <PanelField id="pf-balancer-order" label={tr('balancers.position')} hint={tr('balancers.positionHint')}>
                        <input id="pf-balancer-order" className="form-input" inputMode="numeric" value={draft.sortOrder} onChange={(e) => update('sortOrder', e.target.value.replace(/[^\d]/g, ''))} placeholder="1" />
                    </PanelField>
                </div>
                <InboundPicker
                    id="pf-balancer-inbounds"
                    label={tr('balancers.members')}
                    hint={draft.strategy === 'leastLoad' ? tr('balancers.weightHint') : tr('balancers.membersHint')}
                    inbounds={inbounds}
                    selected={draft.inboundIds}
                    onChange={(ids) => update('inboundIds', ids)}
                    renderExtra={draft.strategy === 'leastLoad' ? (inbound) => {
                        const id = Number(inbound.id);
                        return (
                            <input
                                className="form-input pf-weight-input"
                                inputMode="decimal"
                                aria-label={tr('balancers.weightFor', { name: inbound.remark || `#${id}` })}
                                placeholder="1"
                                value={draft.weights[id] ?? ''}
                                onChange={(e) => update('weights', { ...draft.weights, [id]: e.target.value.replace(/[^\d.]/g, '') })}
                            />
                        );
                    } : undefined}
                />
                <PanelToggle id="pf-balancer-enabled" label={tr('balancers.enabled')} checked={draft.enabled} onChange={(value) => update('enabled', value)} />
            </PanelFormModal>
        </PanelFeatureFrame>
    );
}
