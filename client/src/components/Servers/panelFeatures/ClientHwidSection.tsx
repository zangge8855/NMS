import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HiOutlineTrash, HiOutlineXMark } from 'react-icons/hi2';
import api from '../../../api/client';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useI18n } from '../../../contexts/LanguageContext';
import { formatDateTime, getErrorMessage } from '../../../utils/format';
import {
    assertPanelOk,
    isUnsupportedPanelEndpoint,
    panelApiPath,
    toMillis,
    usePanelAction,
    usePanelPermissions,
} from './panelRequest';

type HwidDevice = {
    id: number;
    firstSeen?: number;
    lastSeen?: number;
    userAgent?: string;
    deviceOs?: string;
    osVersion?: string;
    deviceModel?: string;
};

type ClientHwidSectionProps = {
    serverId: string;
    email: string;
};

export function describeDevice(device: HwidDevice, fallback: string) {
    const os = [device.deviceOs, device.osVersion].filter(Boolean).join(' ');
    const name = device.deviceModel || os || fallback;
    return { name, detail: device.deviceModel ? os : '' };
}

/**
 * Devices a 3x-ui v3 client has subscribed from, keyed by the HWID header its app
 * sends, plus the per-client device limit. Lives inside the node access IP dialog
 * so both "who connected" views sit together.
 */
export default function ClientHwidSection({ serverId, email }: ClientHwidSectionProps) {
    const { t, locale } = useI18n();
    const tr = useCallback((key: string, params?: Record<string, any>) => t(`pages.panelFeatures.hwid.${key}`, params), [t]);
    const confirmAction = useConfirm();
    const { canManage } = usePanelPermissions();
    const { busyKey, run } = usePanelAction();
    const [devices, setDevices] = useState<HwidDevice[]>([]);
    const [limit, setLimit] = useState<number | null>(null);
    const [limitDraft, setLimitDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [unsupported, setUnsupported] = useState(false);
    const requestIdRef = useRef(0);
    const encodedEmail = encodeURIComponent(email);

    const load = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const [hwidRes, clientRes] = await Promise.all([
                api.post(panelApiPath(serverId, `/clients/hwids/${encodedEmail}`)),
                api.get(panelApiPath(serverId, `/clients/get/${encodedEmail}`)).catch(() => null),
            ]);
            if (requestId !== requestIdRef.current) return;
            const payload = assertPanelOk(hwidRes);
            setDevices(Array.isArray(payload.obj) ? payload.obj : []);
            const record = clientRes?.data?.success !== false ? clientRes?.data?.obj?.client : null;
            const nextLimit = record && Number.isFinite(Number(record.limitHwid)) ? Number(record.limitHwid) : null;
            setLimit(nextLimit);
            setLimitDraft(nextLimit === null ? '' : String(nextLimit));
            setUnsupported(false);
        } catch (err) {
            if (requestId !== requestIdRef.current) return;
            if (isUnsupportedPanelEndpoint(err)) setUnsupported(true);
            else setError(getErrorMessage(err, tr('loadFailed'), locale));
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [encodedEmail, locale, serverId, tr]);

    useEffect(() => {
        load();
        return () => { requestIdRef.current += 1; };
    }, [load]);

    const saveLimit = async () => {
        const next = Number.parseInt(limitDraft || '0', 10);
        if (!Number.isFinite(next) || next < 0) return;
        const payload = await run('limit', () => api.post(panelApiPath(serverId, '/clients/bulkAdjust'), { emails: [email], limitHwid: next }), {
            success: next === 0 ? tr('limitCleared') : tr('limitSaved', { count: next }),
            failure: tr('limitFailed'),
        });
        if (payload) setLimit(next);
    };

    const removeDevice = async (device: HwidDevice) => {
        const payload = await run(`device:${device.id}`, () => api.delete(panelApiPath(serverId, `/clients/hwids/${encodedEmail}/${device.id}`)), {
            failure: tr('removeFailed'),
        });
        if (payload) setDevices((current) => current.filter((item) => item.id !== device.id));
    };

    const clearDevices = async () => {
        const ok = await confirmAction({
            title: tr('clearTitle'),
            message: tr('clearMessage', { email }),
            confirmText: tr('clear'),
            tone: 'danger',
        });
        if (!ok) return;
        const payload = await run('clear', () => api.delete(panelApiPath(serverId, `/clients/hwids/${encodedEmail}`)), {
            success: tr('cleared'),
            failure: tr('removeFailed'),
        });
        if (payload) setDevices([]);
    };

    if (unsupported) {
        return (
            <section className="pf-hwid" aria-label={tr('title')}>
                <h4 className="pf-hwid-title">{tr('title')}</h4>
                <p className="pf-muted">{tr('unsupported')}</p>
            </section>
        );
    }

    const limitDirty = limit !== null && limitDraft !== '' && Number(limitDraft) !== limit;
    const atLimit = Boolean(limit && limit > 0 && devices.length >= limit);
    const summary = limit && limit > 0
        ? tr('summaryLimited', { count: devices.length, limit })
        : tr('summary', { count: devices.length });

    return (
        <section className="pf-hwid" aria-label={tr('title')} aria-busy={loading}>
            <header className="pf-hwid-head">
                <div>
                    <h4 className="pf-hwid-title">{tr('title')}</h4>
                    <p className={`pf-hwid-summary${!loading && atLimit ? ' is-full' : ''}`}>{loading ? tr('loading') : summary}</p>
                </div>
                {canManage && devices.length > 0 && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={clearDevices} disabled={busyKey === 'clear'}>
                        {busyKey === 'clear' ? <span className="spinner" /> : <><HiOutlineTrash /> {tr('clear')}</>}
                    </button>
                )}
            </header>

            {error && <p className="pf-error-text" role="alert">{error}</p>}

            {canManage && limit !== null && (
                <form
                    className="pf-hwid-limit"
                    onSubmit={(event) => { event.preventDefault(); saveLimit(); }}
                >
                    <label htmlFor={`pf-hwid-limit-${email}`} className="pf-hwid-limit-label">{tr('limit')}</label>
                    <input
                        id={`pf-hwid-limit-${email}`}
                        className="form-input pf-hwid-limit-input"
                        inputMode="numeric"
                        value={limitDraft}
                        onChange={(event) => setLimitDraft(event.target.value.replace(/[^\d]/g, ''))}
                        aria-describedby={`pf-hwid-limit-${email}-hint`}
                    />
                    <button type="submit" className="btn btn-secondary btn-sm" disabled={!limitDirty || busyKey === 'limit'}>
                        {busyKey === 'limit' ? <span className="spinner" /> : tr('saveLimit')}
                    </button>
                    <span className="pf-field-hint" id={`pf-hwid-limit-${email}-hint`}>{tr('limitHint')}</span>
                </form>
            )}

            {!loading && !error && devices.length === 0 ? (
                <p className="pf-muted">{tr('empty')}</p>
            ) : (
                <ul className="pf-device-list">
                    {devices.map((device) => {
                        const { name, detail } = describeDevice(device, tr('unknownDevice'));
                        const lastSeen = toMillis(device.lastSeen);
                        const firstSeen = toMillis(device.firstSeen);
                        return (
                            <li key={device.id} className="pf-device">
                                <div className="pf-device-main">
                                    <span className="pf-device-name">{name}</span>
                                    {detail ? <span className="pf-device-detail">{detail}</span> : null}
                                    {device.userAgent ? <span className="pf-device-agent pf-machine" title={device.userAgent}>{device.userAgent}</span> : null}
                                </div>
                                <div className="pf-device-times">
                                    <span>{tr('lastSeen', { time: lastSeen ? formatDateTime(lastSeen, locale) : '—' })}</span>
                                    {firstSeen ? <span className="pf-muted">{tr('firstSeen', { time: formatDateTime(firstSeen, locale) })}</span> : null}
                                </div>
                                {canManage && (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-sm btn-icon"
                                        onClick={() => removeDevice(device)}
                                        disabled={busyKey === `device:${device.id}`}
                                        aria-label={tr('remove', { name })}
                                        title={tr('remove', { name })}
                                    >
                                        {busyKey === `device:${device.id}` ? <span className="spinner" /> : <HiOutlineXMark />}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
