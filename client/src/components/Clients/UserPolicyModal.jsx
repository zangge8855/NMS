import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineCheck, HiOutlineXMark } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import { bytesToGigabytesInput, gigabytesInputToBytes, normalizeLimitIp } from '../../utils/entitlements.js';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import EmptyState from '../UI/EmptyState.jsx';

const PROTOCOL_OPTIONS = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
];
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
    const { t } = useI18n();
    const normalizedEmail = useMemo(() => String(email || '').trim().toLowerCase(), [email]);
    const validServerIdSet = useMemo(() => new Set((Array.isArray(servers) ? servers : []).map((item) => item.id)), [servers]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [noServerLimit, setNoServerLimit] = useState(true);
    const [noProtocolLimit, setNoProtocolLimit] = useState(true);
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const [selectedProtocols, setSelectedProtocols] = useState([]);
    const [limitIp, setLimitIp] = useState('0');
    const [trafficLimitGb, setTrafficLimitGb] = useState('0');
    const [speedLimitUp, setSpeedLimitUp] = useState('0');
    const [speedLimitDown, setSpeedLimitDown] = useState('0');

    useEffect(() => {
        if (!isOpen || !normalizedEmail) return;
        let cancelled = false;

        const loadPolicy = async () => {
            setLoading(true);
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
                const payload = res.data?.obj || {};
                const rawServerIds = Array.isArray(payload.allowedServerIds) ? payload.allowedServerIds : [];
                const serverIds = rawServerIds.filter((item) => validServerIdSet.has(item));
                const protocols = (Array.isArray(payload.allowedProtocols) ? payload.allowedProtocols : [])
                    .filter((item) => PROTOCOL_KEY_SET.has(String(item || '').trim().toLowerCase()));
                const serverScopeMode = normalizeScopeMode(payload.serverScopeMode, rawServerIds);
                const protocolScopeMode = normalizeScopeMode(payload.protocolScopeMode, protocols);
                if (cancelled) return;
                setSelectedServerIds(serverIds);
                setSelectedProtocols(protocols);
                setNoServerLimit(serverScopeMode === 'all');
                setNoProtocolLimit(protocolScopeMode === 'all');
                setLimitIp(String(normalizeLimitIp(payload.limitIp)));
                setTrafficLimitGb(bytesToGigabytesInput(payload.trafficLimitBytes));
                setSpeedLimitUp(String(Math.round(Number(payload.speedLimitUp || 0) / 1024)));
                setSpeedLimitDown(String(Math.round(Number(payload.speedLimitDown || 0) / 1024)));
            } catch (error) {
                if (!cancelled) {
                    const msg = error.response?.data?.msg || error.message || t('comp.userPolicy.loadFailed');
                    toast.error(msg);
                }
            }
            if (!cancelled) setLoading(false);
        };

        loadPolicy();
        return () => { cancelled = true; };
    }, [isOpen, normalizedEmail, t, validServerIdSet]);

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
            speedLimitUp: Number(speedLimitUp || 0) * 1024,
            speedLimitDown: Number(speedLimitDown || 0) * 1024,
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
                        <button type="submit" className="btn btn-primary" disabled={saving || loading}>
                            {saving ? <span className="spinner" /> : <><HiOutlineCheck /> {t('comp.userPolicy.savePolicy')}</>}
                        </button>
                    </div>
                </form>
            </div>
        </ModalShell>
    );
}
