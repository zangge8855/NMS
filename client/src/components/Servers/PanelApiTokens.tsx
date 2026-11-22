import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useI18n } from '../../contexts/LanguageContext';
import { copyToClipboard, formatDateTime, getErrorMessage } from '../../utils/format';
import EmptyState from '../UI/EmptyState';
import SectionHeader from '../UI/SectionHeader';
import SkeletonTable from '../UI/SkeletonTable';
import { HiOutlineArrowPath, HiOutlineClipboardDocument, HiOutlinePlus } from 'react-icons/hi2';

const TOKEN_SCOPES = ['admin', 'monitor', 'node-sync', 'node-admin'] as const;
const EXPIRY_PRESETS = [0, 7, 30, 90, 365];
const DAY_MS = 86_400_000;
// 3x-ui returns createdAt in seconds; older builds stored milliseconds.
const MS_TIMESTAMP_THRESHOLD = 100_000_000_000;

type PanelApiTokensProps = {
    serverId: string;
    isSui: boolean;
};

type TokenRow = {
    id: string | number;
    name?: string;
    scope?: string;
    enabled?: boolean;
    createdAt?: number;
    expiresAt?: number;
    tokenPreview?: string;
};

function toMillis(value: unknown) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n >= MS_TIMESTAMP_THRESHOLD ? n : n * 1000;
}

// Panels report failures as HTTP 200 with `success: false`; turn those into errors.
function assertPanelOk(res: any) {
    const payload = res?.data || {};
    if (payload.success === false) {
        throw Object.assign(new Error(String(payload.msg || '')), { response: { status: res?.status, data: payload } });
    }
    return payload;
}

function scopeKey(scope: string) {
    return scope.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()).replace(/^./, (ch) => ch.toUpperCase());
}

export default function PanelApiTokens({ serverId, isSui }: PanelApiTokensProps) {
    const { locale, t } = useI18n();
    const confirmAction = useConfirm();
    const [rows, setRows] = useState<TokenRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [unsupported, setUnsupported] = useState('');
    const [busyId, setBusyId] = useState('');
    const [name, setName] = useState('');
    const [scope, setScope] = useState<string>('admin');
    const [expiryDays, setExpiryDays] = useState(0);
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
    const requestIdRef = useRef(0);
    const basePath = `/servers/${encodeURIComponent(serverId)}/panel-api-tokens`;

    const load = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const res = await api.get(basePath);
            if (requestId !== requestIdRef.current) return;
            assertPanelOk(res);
            setRows(Array.isArray(res.data?.obj) ? res.data.obj : []);
            setUnsupported('');
        } catch (err: any) {
            if (requestId !== requestIdRef.current) return;
            if (err?.response?.status === 501) {
                const detail = String(err.response.data?.detail || '').trim();
                setUnsupported([err.response.data?.msg, detail].filter(Boolean).join(' — '));
                setRows([]);
            } else {
                setError(getErrorMessage(err, t('pages.serverDetail.apiTokensLoadFailed'), locale));
            }
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [basePath, locale, t]);

    useEffect(() => {
        load();
        return () => { requestIdRef.current += 1; };
    }, [load]);

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            toast.error(t('pages.serverDetail.apiTokensNameRequired'));
            return;
        }
        setCreating(true);
        try {
            const expiresAt = expiryDays > 0 ? Date.now() + expiryDays * DAY_MS : 0;
            const res = await api.post(basePath, {
                name: trimmed,
                scope: isSui ? 'admin' : scope,
                expiresAt,
            });
            const payload = assertPanelOk(res);
            const plaintext = String(payload.obj?.token || '').trim();
            setCreated(plaintext ? { name: trimmed, token: plaintext } : null);
            setName('');
            setExpiryDays(0);
            toast.success(t('pages.serverDetail.apiTokensCreated'));
            load();
        } catch (err) {
            toast.error(getErrorMessage(err, t('pages.serverDetail.apiTokensCreateFailed'), locale));
        } finally {
            setCreating(false);
        }
    };

    const handleToggle = async (row: TokenRow) => {
        const id = String(row.id);
        setBusyId(id);
        try {
            assertPanelOk(await api.patch(`${basePath}/${encodeURIComponent(id)}`, {
                enabled: row.enabled === false,
                expectedScope: row.scope,
            }));
            load();
        } catch (err) {
            toast.error(getErrorMessage(err, t('pages.serverDetail.apiTokensUpdateFailed'), locale));
        } finally {
            setBusyId('');
        }
    };

    const handleDelete = async (row: TokenRow) => {
        const ok = await confirmAction({
            title: t('pages.serverDetail.apiTokensDeleteTitle'),
            message: t('pages.serverDetail.apiTokensDeleteMessage', { name: row.name || String(row.id) }),
            confirmText: t('pages.serverDetail.apiTokensDelete'),
            tone: 'danger',
        });
        if (!ok) return;
        const id = String(row.id);
        setBusyId(id);
        try {
            assertPanelOk(await api.delete(`${basePath}/${encodeURIComponent(id)}`, {
                data: { expectedScope: row.scope },
            }));
            toast.success(t('pages.serverDetail.apiTokensDeleted'));
            load();
        } catch (err) {
            toast.error(getErrorMessage(err, t('pages.serverDetail.apiTokensDeleteFailed'), locale));
        } finally {
            setBusyId('');
        }
    };

    const handleCopy = async () => {
        if (!created) return;
        const copied = await copyToClipboard(created.token);
        if (copied) toast.success(t('pages.serverDetail.apiTokensCopied'));
        else toast.error(t('pages.serverDetail.apiTokensCopyFailed'));
    };

    const formatExpiry = (row: TokenRow) => {
        const expiresAt = Number(row.expiresAt || 0);
        if (!expiresAt) return t('pages.serverDetail.apiTokensNever');
        const label = formatDateTime(expiresAt, locale);
        return expiresAt <= Date.now() ? `${label} · ${t('pages.serverDetail.apiTokensExpired')}` : label;
    };

    return (
        <div>
            <SectionHeader
                className="mb-4"
                compact
                title={t('pages.serverDetail.apiTokensTitle')}
                subtitle={t('pages.serverDetail.apiTokensSubtitle')}
                actions={(
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()} disabled={loading}>
                        <HiOutlineArrowPath /> {t('pages.serverDetail.refresh')}
                    </button>
                )}
            />

            {isSui && <div className="text-xs text-muted mb-4">{t('pages.serverDetail.apiTokensSuiNote')}</div>}

            {unsupported ? (
                <EmptyState title={t('pages.serverDetail.apiTokensUnsupported')} subtitle={unsupported} />
            ) : (
                <>
                    <form className="card p-4 mb-4" onSubmit={handleCreate} aria-label={t('pages.serverDetail.apiTokensCreate')}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="form-group">
                                <label htmlFor="panel-api-token-name" className="form-label">{t('pages.serverDetail.apiTokensName')}</label>
                                <input
                                    id="panel-api-token-name"
                                    name="panelApiTokenName"
                                    className="form-input"
                                    maxLength={64}
                                    autoComplete="off"
                                    value={name}
                                    placeholder={t('pages.serverDetail.apiTokensNamePlaceholder')}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="panel-api-token-expiry" className="form-label">{t('pages.serverDetail.apiTokensExpiry')}</label>
                                <select
                                    id="panel-api-token-expiry"
                                    name="panelApiTokenExpiry"
                                    className="form-select"
                                    value={expiryDays}
                                    onChange={(e) => setExpiryDays(Number(e.target.value) || 0)}
                                >
                                    {EXPIRY_PRESETS.map((days) => (
                                        <option key={days} value={days}>
                                            {days === 0 ? t('pages.serverDetail.apiTokensNever') : t('pages.serverDetail.apiTokensDays', { count: days })}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {!isSui && (
                            <div className="form-group">
                                <label htmlFor="panel-api-token-scope" className="form-label">{t('pages.serverDetail.apiTokensScope')}</label>
                                <select
                                    id="panel-api-token-scope"
                                    name="panelApiTokenScope"
                                    className="form-select"
                                    value={scope}
                                    onChange={(e) => setScope(e.target.value)}
                                >
                                    {TOKEN_SCOPES.map((item) => (
                                        <option key={item} value={item}>{t(`pages.serverDetail.apiTokensScope${scopeKey(item)}`)}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="flex justify-end mt-2">
                            <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>
                                <HiOutlinePlus /> {creating ? t('pages.serverDetail.apiTokensCreating') : t('pages.serverDetail.apiTokensCreate')}
                            </button>
                        </div>
                    </form>

                    {created && (
                        <div className="card p-4 mb-4" role="status">
                            <div className="font-medium mb-1">{t('pages.serverDetail.apiTokensPlaintextTitle', { name: created.name })}</div>
                            <div className="text-xs text-muted mb-2">{t('pages.serverDetail.apiTokensPlaintextHint')}</div>
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="cell-mono text-sm" style={{ wordBreak: 'break-all', flex: '1 1 16rem' }}>{created.token}</code>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
                                    <HiOutlineClipboardDocument /> {t('pages.serverDetail.apiTokensCopy')}
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreated(null)}>
                                    {t('pages.serverDetail.apiTokensDismiss')}
                                </button>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 p-3 rounded-lg border border-danger/25 bg-danger/10 text-sm text-danger flex flex-wrap items-center justify-between gap-2" role="alert">
                            <span>{error}</span>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>
                                <HiOutlineArrowPath /> {t('pages.serverDetail.empty.refreshAction')}
                            </button>
                        </div>
                    )}

                    {loading && rows.length === 0 ? (
                        <SkeletonTable rows={3} cols={6} />
                    ) : rows.length === 0 ? (
                        !error && <EmptyState title={t('pages.serverDetail.apiTokensEmpty')} subtitle={t('pages.serverDetail.apiTokensEmptyHint')} />
                    ) : (
                        <div className="table-container" role="region" aria-label={t('pages.serverDetail.apiTokensTitle')} tabIndex={0}>
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>{t('pages.serverDetail.apiTokensName')}</th>
                                        <th>{t('pages.serverDetail.apiTokensScope')}</th>
                                        <th>{t('pages.serverDetail.apiTokensCreatedAt')}</th>
                                        <th>{t('pages.serverDetail.apiTokensExpiry')}</th>
                                        <th className="table-cell-center">{t('pages.serverDetail.inboundCols.status')}</th>
                                        <th className="table-cell-right">{t('pages.serverDetail.apiTokensActions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => {
                                        const id = String(row.id);
                                        const createdAt = toMillis(row.createdAt);
                                        const busy = busyId === id;
                                        return (
                                            <tr key={id}>
                                                <td data-label={t('pages.serverDetail.apiTokensName')}>
                                                    <div className="font-medium">{row.name || id}</div>
                                                    {row.tokenPreview && row.tokenPreview !== 'configured' && (
                                                        <div className="text-xs text-muted cell-mono">{row.tokenPreview}</div>
                                                    )}
                                                </td>
                                                <td data-label={t('pages.serverDetail.apiTokensScope')}><span className="badge badge-neutral">{row.scope || 'admin'}</span></td>
                                                <td data-label={t('pages.serverDetail.apiTokensCreatedAt')} className="cell-mono">{createdAt ? formatDateTime(createdAt, locale) : '—'}</td>
                                                <td data-label={t('pages.serverDetail.apiTokensExpiry')} className="cell-mono">{formatExpiry(row)}</td>
                                                <td data-label={t('pages.serverDetail.inboundCols.status')} className="table-cell-center">
                                                    <span className={`badge ${row.enabled !== false ? 'badge-success' : 'badge-danger'}`}>
                                                        {row.enabled !== false ? t('comp.common.enabled') : t('comp.common.disabled')}
                                                    </span>
                                                </td>
                                                <td data-label={t('pages.serverDetail.apiTokensActions')} className="table-cell-right">
                                                    <div className="flex justify-end gap-2">
                                                        {!isSui && (
                                                            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => handleToggle(row)}>
                                                                {row.enabled !== false ? t('pages.serverDetail.apiTokensDisable') : t('pages.serverDetail.apiTokensEnable')}
                                                            </button>
                                                        )}
                                                        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => handleDelete(row)}>
                                                            {t('pages.serverDetail.apiTokensDelete')}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
