import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HiOutlineCheck, HiOutlineXMark } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import api from '../../api/client';
import {
    bytesPerSecondToKilobytesInput,
    bytesToGigabytesInput,
    gigabytesInputToBytes,
    kilobytesInputToBytesPerSecond,
    normalizeLimitIp,
} from '../../utils/entitlements';
import { useI18n } from '../../contexts/LanguageContext';
import ModalShell from '../UI/ModalShell';
import { POLICY_PROTOCOL_OPTIONS } from '../../utils/protocol';
import EmptyState from '../UI/EmptyState';

const PROTOCOL_OPTIONS = POLICY_PROTOCOL_OPTIONS;
const PROTOCOL_KEY_SET = new Set(PROTOCOL_OPTIONS.map((item) => item.key));

function normalizeScopeMode(mode, selectedItems = []) {
    const hasSelected = Array.isArray(selectedItems) && selectedItems.length > 0;
    const fallback = hasSelected ? 'selected' : 'all';
    const text = String(mode || '').trim().toLowerCase();
    if (!text) return fallback;
    if (!['all', 'selected', 'none'].includes(text)) return fallback;
    if (text === 'selected' && !hasSelected) return 'none';
    return text;
}

export default function UserPolicyModal({ isOpen, email, servers = [], onClose }) {
    const { t, locale } = useI18n();
    const normalizedEmail = useMemo(() => String(email || '').trim().toLowerCase(), [email]);
    const validServerIdSet = useMemo(() => new Set((Array.isArray(servers) ? servers : []).map((item) => item.id)), [servers]);
    const validServerIdSetRef = useRef(validServerIdSet);
    validServerIdSetRef.current = validServerIdSet;
    const tRef = useRef(t);
    tRef.current = t;
    const requestIdRef = useRef(0);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [policyLoaded, setPolicyLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [noServerLimit, setNoServerLimit] = useState(true);
    const [noProtocolLimit, setNoProtocolLimit] = useState(true);
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const [selectedProtocols, setSelectedProtocols] = useState([]);
    const [limitIp, setLimitIp] = useState('0');
    const [trafficLimitGb, setTrafficLimitGb] = useState('0');
    const [speedLimitUp, setSpeedLimitUp] = useState('0');
    const [speedLimitDown, setSpeedLimitDown] = useState('0');

    const loadPolicy = useCallback(async () => {
        if (!normalizedEmail) return;
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setLoadError('');
        setPolicyLoaded(false);
        setSelectedServerIds([]);
        setSelectedProtocols([]);
        setNoServerLimit(true);
        setNoProtocolLimit(true);
        setLimitIp('0');
        setTrafficLimitGb('0');
        setSpeedLimitUp('0');
        setSpeedLimitDown('0');
        try {
            const res = await api.get(`/user-policy/${encodeURIComponent(normalizedEmail)}`);
            if (requestIdRef.current !== requestId) return;
            const payload = res.data?.obj || {};
            const rawServerIds = Array.isArray(payload.allowedServerIds) ? payload.allowedServerIds : [];
            const serverIds = rawServerIds.filter((item) => validServerIdSetRef.current.has(item));
            const protocols = (Array.isArray(payload.allowedProtocols) ? payload.allowedProtocols : [])
                .filter((item) => PROTOCOL_KEY_SET.has(String(item || '').trim().toLowerCase()));
            const serverScopeMode = normalizeScopeMode(payload.serverScopeMode, rawServerIds);
            const protocolScopeMode = normalizeScopeMode(payload.protocolScopeMode, protocols);
            setSelectedServerIds(serverIds);
            setSelectedProtocols(protocols);
            setNoServerLimit(serverScopeMode === 'all');
            setNoProtocolLimit(protocolScopeMode === 'all');
            setLimitIp(String(normalizeLimitIp(payload.limitIp)));
            setTrafficLimitGb(bytesToGigabytesInput(payload.trafficLimitBytes));
            setSpeedLimitUp(bytesPerSecondToKilobytesInput(payload.speedLimitUp));
            setSpeedLimitDown(bytesPerSecondToKilobytesInput(payload.speedLimitDown));
            setPolicyLoaded(true);
        } catch (error) {
            if (requestIdRef.current !== requestId) return;
            const msg = error.response?.data?.msg || error.message || tRef.current('comp.userPolicy.loadFailed');
            setLoadError(msg);
            toast.error(msg);
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [normalizedEmail]);

    useEffect(() => {
        if (!isOpen || !normalizedEmail) {
            requestIdRef.current += 1;
            setLoading(false);
            setLoadError('');
            setPolicyLoaded(false);
            return;
        }
        void loadPolicy();
        return () => {
            requestIdRef.current += 1;
        };
    }, [isOpen, normalizedEmail, loadPolicy]);

    const toggleServerId = (serverId, checked) => {
        setSelectedServerIds((prev) => {
            if (checked) return Array.from(new Set([...prev, serverId]));
            return prev.filter((item) => item !== serverId);
        });
    };

    const toggleProtocol = (protocol, checked) => {
        setSelectedProtocols((prev) => {
            if (checked) return Array.from(new Set([...prev, protocol]));
            return prev.filter((item) => item !== protocol);
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!policyLoaded || loadError) return;
        if (!normalizedEmail) {
            toast.error(t('comp.userPolicy.emptyEmail'));
            return;
        }

        const normalizedServerIds = selectedServerIds.filter((item) => validServerIdSet.has(item));
        const normalizedProtocols = selectedProtocols
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => PROTOCOL_KEY_SET.has(item));
        const serverScopeMode = noServerLimit ? 'all' : (normalizedServerIds.length > 0 ? 'selected' : 'none');
        const protocolScopeMode = noProtocolLimit ? 'all' : (normalizedProtocols.length > 0 ? 'selected' : 'none');
        const payload = {
            allowedServerIds: serverScopeMode === 'selected' ? normalizedServerIds : [],
            allowedProtocols: protocolScopeMode === 'selected' ? normalizedProtocols : [],
            serverScopeMode,
            protocolScopeMode,
            limitIp: normalizeLimitIp(limitIp),
            trafficLimitBytes: gigabytesInputToBytes(trafficLimitGb),
            // Speed limits are stored and forwarded as B/s (UI shows KB/s) — match UsersHub / ClientModal.
            speedLimitUp: kilobytesInputToBytesPerSecond(speedLimitUp),
            speedLimitDown: kilobytesInputToBytesPerSecond(speedLimitDown),
        };

        setSaving(true);
        try {
            await api.put(`/user-policy/${encodeURIComponent(normalizedEmail)}`, payload);
            toast.success(t('comp.userPolicy.saved'));
            onClose();
        } catch (error) {
            const msg = error.response?.data?.msg || error.message || t('comp.common.saveFailed');
            toast.error(msg);
        }
        setSaving(false);
    };

    if (!isOpen) return null;

    return (
        <ModalShell isOpen={isOpen} onClose={onClose} ariaLabel={t('comp.userPolicy.title')}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">{t('comp.userPolicy.title')}</h3>
                    <button
                        type="button"
                        className="modal-close"
                        onClick={onClose}
                        aria-label={t('comp.common.close')}
                        title={t('comp.common.close')}
                    >
                        <HiOutlineXMark />
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div className="mb-4 p-3 rounded bg-surface-soft border border-stroke-soft text-sm">
                            {t('comp.userPolicy.userLabel')}<strong>{normalizedEmail || '-'}</strong>
                        </div>

                        {loading ? (
                            <div className="text-center p-6"><span className="spinner" /></div>
                        ) : loadError ? (
                            <div className="p-6 text-center space-y-3" role="alert">
                                <div className="text-sm text-danger">{loadError}</div>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => void loadPolicy()}
                                >
                                    {locale === 'en-US' ? 'Retry' : '重试'}
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="card mb-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="card-title">{t('comp.userPolicy.serversTitle')}</span>
                                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={noServerLimit}
                                                onChange={(e) => setNoServerLimit(e.target.checked)}
                                            />
                                            {t('comp.common.noLimit')}
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {servers.map((server) => (
                                            <label key={server.id} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    disabled={noServerLimit}
                                                    checked={selectedServerIds.includes(server.id)}
                                                    onChange={(e) => toggleServerId(server.id, e.target.checked)}
                                                />
                                                <span>{server.name}</span>
                                            </label>
                                        ))}
                                        {servers.length === 0 && (
                                            <EmptyState title={t('comp.userPolicy.noServers')} size="compact" />
                                        )}
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="card-title">{t('comp.userPolicy.protocolsTitle')}</span>
                                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={noProtocolLimit}
                                                onChange={(e) => setNoProtocolLimit(e.target.checked)}
                                            />
                                            {t('comp.common.noLimit')}
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {PROTOCOL_OPTIONS.map((item) => (
                                            <label key={item.key} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    disabled={noProtocolLimit}
                                                    checked={selectedProtocols.includes(item.key)}
                                                    onChange={(e) => toggleProtocol(item.key, e.target.checked)}
                                                />
                                                <span>{item.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="card mt-4">
                                    <div className="card-title mb-3">{t('comp.userPolicy.quotasTitle')}</div>
                                    <div className="form-group">
                                        <label className="form-label">{t('comp.userPolicy.limitIp')}</label>
                                        <input
                                            className="form-input"
                                            type="number"
                                            min={0}
                                            value={limitIp}
                                            onChange={(e) => setLimitIp(e.target.value)}
                                        />
                                        <div className="text-xs text-muted mt-1">{t('comp.userPolicy.limitIpHelp')}</div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t('comp.userPolicy.trafficLimit')}</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                className="form-input"
                                                type="number"
                                                min={0}
                                                step="0.5"
                                                value={trafficLimitGb}
                                                onChange={(e) => setTrafficLimitGb(e.target.value)}
                                            />
                                            <span className="text-sm text-muted">GB</span>
                                        </div>
                                        <div className="text-xs text-muted mt-1">{t('comp.userPolicy.trafficLimitHelp')}</div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="form-group">
                                            <label className="form-label">{t('comp.userPolicy.speedUp')}</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    className="form-input"
                                                    type="number"
                                                    min={0}
                                                    value={speedLimitUp}
                                                    onChange={(e) => setSpeedLimitUp(e.target.value)}
                                                />
                                                <span className="text-sm text-muted">KB/s</span>
                                            </div>
                                            <div className="text-xs text-muted mt-1">{t('comp.userPolicy.speedHelp')}</div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">{t('comp.userPolicy.speedDown')}</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    className="form-input"
                                                    type="number"
                                                    min={0}
                                                    value={speedLimitDown}
                                                    onChange={(e) => setSpeedLimitDown(e.target.value)}
                                                />
                                                <span className="text-sm text-muted">KB/s</span>
                                            </div>
                                            <div className="text-xs text-muted mt-1">{t('comp.userPolicy.speedHelp')}</div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            {t('comp.common.cancel')}
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={saving || loading || !policyLoaded || Boolean(loadError)}>
                            {saving ? <span className="spinner" /> : <><HiOutlineCheck /> {t('comp.userPolicy.savePolicy')}</>}
                        </button>
                    </div>
                </form>
            </div>
        </ModalShell>
    );
}
