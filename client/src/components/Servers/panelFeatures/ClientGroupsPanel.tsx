import React, { useCallback, useState } from 'react';
import {
    HiOutlineArrowUturnLeft,
    HiOutlinePencilSquare,
    HiOutlinePlus,
    HiOutlineTrash,
    HiOutlineUserGroup,
} from 'react-icons/hi2';
import api from '../../../api/client';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useI18n } from '../../../contexts/LanguageContext';
import { formatBytes, getErrorMessage } from '../../../utils/format';
import ActionsDropdown from '../../UI/ActionsDropdown';
import {
    PanelEmpty,
    PanelFeatureFrame,
    PanelField,
    PanelFormModal,
    PanelListSkeleton,
} from './PanelFeatureFrame';
import { assertPanelOk, panelApiPath, splitList, usePanelAction, usePanelList } from './panelRequest';

type GroupRow = {
    name: string;
    clientCount?: number;
    trafficUsed?: number;
    up?: number;
    down?: number;
};

type MembersState = {
    name: string;
    emails: string[];
    loading: boolean;
    error: string;
};

type NameDialog = { mode: 'create' } | { mode: 'rename'; from: string };

type ClientGroupsPanelProps = {
    serverId: string;
    canManage: boolean;
};

export default function ClientGroupsPanel({ serverId, canManage }: ClientGroupsPanelProps) {
    const { t, locale } = useI18n();
    const tr = useCallback((key: string, params?: Record<string, any>) => t(`pages.panelFeatures.${key}`, params), [t]);
    const confirmAction = useConfirm();
    const base = panelApiPath(serverId, '/clients/groups');
    const { rows, loading, error, unsupported, reload } = usePanelList<GroupRow>(
        base,
        (err) => getErrorMessage(err, tr('groups.loadFailed'), locale),
    );
    const { busyKey, run } = usePanelAction();
    const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
    const [nameValue, setNameValue] = useState('');
    const [assignOpen, setAssignOpen] = useState(false);
    const [assignEmails, setAssignEmails] = useState('');
    const [assignTarget, setAssignTarget] = useState('');
    const [members, setMembers] = useState<MembersState | null>(null);

    const loadMembers = useCallback(async (name: string) => {
        setMembers({ name, emails: [], loading: true, error: '' });
        try {
            const payload = assertPanelOk(await api.get(`${base}/${encodeURIComponent(name)}/emails`));
            const emails = Array.isArray(payload.obj) ? payload.obj.map(String) : [];
            setMembers((current) => (current?.name === name ? { name, emails, loading: false, error: '' } : current));
        } catch (err) {
            const message = getErrorMessage(err, tr('groups.membersFailed'), locale);
            setMembers((current) => (current?.name === name ? { name, emails: [], loading: false, error: message } : current));
        }
    }, [base, locale, tr]);

    const toggleMembers = (name: string) => {
        if (members?.name === name) {
            setMembers(null);
            return;
        }
        loadMembers(name);
    };

    const openNameDialog = (dialog: NameDialog) => {
        setNameDialog(dialog);
        setNameValue(dialog.mode === 'rename' ? dialog.from : '');
    };

    const submitName = async () => {
        const name = nameValue.trim();
        if (!nameDialog) return;
        if (!name) {
            setNameValue('');
            return;
        }
        const payload = nameDialog.mode === 'create'
            ? await run('name', () => api.post(`${base}/create`, { name }), {
                success: tr('groups.created', { name }),
                failure: tr('groups.createFailed'),
            })
            : await run('name', () => api.post(`${base}/rename`, { oldName: nameDialog.from, newName: name }), {
                success: tr('groups.renamed', { name }),
                failure: tr('groups.renameFailed'),
            });
        if (!payload) return;
        if (nameDialog.mode === 'rename' && members?.name === nameDialog.from) setMembers(null);
        setNameDialog(null);
        reload();
    };

    const resetTraffic = async (row: GroupRow) => {
        const ok = await confirmAction({
            title: tr('groups.resetTitle'),
            message: tr('groups.resetMessage', { name: row.name }),
            confirmText: tr('groups.reset'),
            tone: 'danger',
        });
        if (!ok) return;
        const payload = await run(`reset:${row.name}`, () => api.post(`${base}/resetTraffic`, { name: row.name }), {
            success: tr('groups.resetDone', { name: row.name }),
            failure: tr('groups.resetFailed'),
        });
        if (payload) reload();
    };

    const deleteGroup = async (row: GroupRow) => {
        const ok = await confirmAction({
            title: tr('groups.deleteTitle'),
            message: tr('groups.deleteMessage', { name: row.name }),
            confirmText: tr('common.delete'),
            tone: 'danger',
        });
        if (!ok) return;
        const payload = await run(`delete:${row.name}`, () => api.post(`${base}/delete`, { name: row.name }), {
            success: tr('groups.deleted', { name: row.name }),
            failure: tr('groups.deleteFailed'),
        });
        if (!payload) return;
        if (members?.name === row.name) setMembers(null);
        reload();
    };

    const removeMember = async (group: string, email: string) => {
        const payload = await run(`member:${email}`, () => api.post(`${base}/bulkRemove`, { emails: [email] }), {
            success: tr('groups.memberRemoved', { email }),
            failure: tr('groups.assignFailed'),
        });
        if (!payload) return;
        loadMembers(group);
        reload();
    };

    const openAssign = (target = '') => {
        setAssignEmails('');
        setAssignTarget(target || rows[0]?.name || '');
        setAssignOpen(true);
    };

    const submitAssign = async () => {
        const emails = splitList(assignEmails);
        if (emails.length === 0) return;
        const removing = assignTarget === '';
        const payload = removing
            ? await run('assign', () => api.post(`${base}/bulkRemove`, { emails }), {
                success: tr('groups.removedCount', { count: emails.length }),
                failure: tr('groups.assignFailed'),
            })
            : await run('assign', () => api.post(`${base}/bulkAdd`, { emails, group: assignTarget }), {
                success: tr('groups.assignedCount', { count: emails.length, name: assignTarget }),
                failure: tr('groups.assignFailed'),
            });
        if (!payload) return;
        setAssignOpen(false);
        if (members) loadMembers(members.name);
        reload();
    };

    const assignCount = splitList(assignEmails).length;

    return (
        <PanelFeatureFrame
            title={tr('groups.title')}
            description={tr('groups.description')}
            loading={loading}
            error={error}
            unsupported={unsupported}
            onRefresh={reload}
            actions={canManage ? (
                <>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAssign()} disabled={rows.length === 0}>
                        <HiOutlineUserGroup /> {tr('groups.assign')}
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => openNameDialog({ mode: 'create' })}>
                        <HiOutlinePlus /> {tr('groups.create')}
                    </button>
                </>
            ) : null}
        >
            {loading && rows.length === 0 ? (
                <PanelListSkeleton />
            ) : rows.length === 0 ? (
                !error && (
                    <PanelEmpty
                        title={tr('groups.emptyTitle')}
                        hint={tr('groups.emptyHint')}
                        action={canManage ? (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openNameDialog({ mode: 'create' })}>
                                <HiOutlinePlus /> {tr('groups.create')}
                            </button>
                        ) : null}
                    />
                )
            ) : (
                <ul className="pf-list" aria-label={tr('groups.title')}>
                    {rows.map((row) => {
                        const used = Number(row.trafficUsed ?? (Number(row.up || 0) + Number(row.down || 0)));
                        const expanded = members?.name === row.name;
                        const rowBusy = busyKey.endsWith(`:${row.name}`);
                        return (
                            <li key={row.name} className={`pf-row${expanded ? ' is-expanded' : ''}`}>
                                <div className="pf-row-main">
                                    <div className="pf-row-title">{row.name}</div>
                                    <div className="pf-row-sub">
                                        {tr('groups.clientCount', { count: Number(row.clientCount || 0) })}
                                    </div>
                                </div>
                                <div className="pf-row-figure">
                                    <span className={`pf-figure${used > 0 ? '' : ' pf-figure--idle'}`}>{formatBytes(used)}</span>
                                    {Number(row.up || 0) > 0 || Number(row.down || 0) > 0 ? (
                                        <span className="pf-figure-label">
                                            {tr('groups.trafficSplit', { up: formatBytes(Number(row.up || 0)), down: formatBytes(Number(row.down || 0)) })}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="pf-row-actions">
                                    <button
                                        type="button"
                                        className={`btn btn-secondary btn-sm${expanded ? ' is-on' : ''}`}
                                        aria-expanded={expanded}
                                        onClick={() => toggleMembers(row.name)}
                                    >
                                        {tr('groups.members')}
                                    </button>
                                    {canManage && (
                                        <ActionsDropdown
                                            actions={[
                                                { label: tr('groups.rename'), icon: HiOutlinePencilSquare, onClick: () => openNameDialog({ mode: 'rename', from: row.name }), disabled: rowBusy },
                                                { label: tr('groups.assignHere'), icon: HiOutlineUserGroup, onClick: () => openAssign(row.name), disabled: rowBusy },
                                                { label: tr('groups.reset'), icon: HiOutlineArrowUturnLeft, onClick: () => resetTraffic(row), disabled: rowBusy },
                                                { label: tr('common.delete'), icon: HiOutlineTrash, onClick: () => deleteGroup(row), isDanger: true, disabled: rowBusy },
                                            ]}
                                        />
                                    )}
                                </div>
                                {expanded && members && (
                                    <div className="pf-row-detail">
                                        {members.loading ? (
                                            <p className="pf-muted">{tr('common.loading')}</p>
                                        ) : members.error ? (
                                            <p className="pf-error-text" role="alert">{members.error}</p>
                                        ) : members.emails.length === 0 ? (
                                            <p className="pf-muted">{tr('groups.membersEmpty')}</p>
                                        ) : (
                                            <ul className="pf-chip-list" aria-label={tr('groups.membersOf', { name: row.name })}>
                                                {members.emails.map((email) => (
                                                    <li key={email} className="pf-chip">
                                                        <span className="pf-chip-text">{email}</span>
                                                        {canManage && (
                                                            <button
                                                                type="button"
                                                                className="pf-chip-remove"
                                                                onClick={() => removeMember(row.name, email)}
                                                                disabled={busyKey === `member:${email}`}
                                                                aria-label={tr('groups.removeMember', { email })}
                                                                title={tr('groups.removeMember', { email })}
                                                            >
                                                                ×
                                                            </button>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <PanelFormModal
                isOpen={nameDialog !== null}
                title={nameDialog?.mode === 'rename' ? tr('groups.renameTitle', { name: nameDialog.from }) : tr('groups.createTitle')}
                description={nameDialog?.mode === 'rename' ? tr('groups.renameHint') : tr('groups.createHint')}
                submitLabel={nameDialog?.mode === 'rename' ? tr('groups.rename') : tr('groups.create')}
                saving={busyKey === 'name'}
                onClose={() => setNameDialog(null)}
                onSubmit={submitName}
            >
                <PanelField id="pf-group-name" label={tr('groups.name')}>
                    <input
                        id="pf-group-name"
                        className="form-input"
                        value={nameValue}
                        maxLength={64}
                        autoComplete="off"
                        autoFocus
                        required
                        onChange={(event) => setNameValue(event.target.value)}
                    />
                </PanelField>
            </PanelFormModal>

            <PanelFormModal
                isOpen={assignOpen}
                title={tr('groups.assignTitle')}
                description={tr('groups.assignHint')}
                submitLabel={assignTarget ? tr('groups.assignSubmit', { count: assignCount }) : tr('groups.removeSubmit', { count: assignCount })}
                saving={busyKey === 'assign'}
                onClose={() => setAssignOpen(false)}
                onSubmit={submitAssign}
            >
                <PanelField id="pf-group-assign-emails" label={tr('groups.emails')} hint={tr('groups.emailsHint')}>
                    <textarea
                        id="pf-group-assign-emails"
                        className="form-input pf-textarea"
                        rows={5}
                        value={assignEmails}
                        spellCheck={false}
                        onChange={(event) => setAssignEmails(event.target.value)}
                    />
                </PanelField>
                <PanelField id="pf-group-assign-target" label={tr('groups.target')}>
                    <select
                        id="pf-group-assign-target"
                        className="form-select"
                        value={assignTarget}
                        onChange={(event) => setAssignTarget(event.target.value)}
                    >
                        {rows.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
                        <option value="">{tr('groups.targetNone')}</option>
                    </select>
                </PanelField>
            </PanelFormModal>
        </PanelFeatureFrame>
    );
}
