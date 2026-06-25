import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ClientIpModal from '../UI/ClientIpModal.jsx';
import Capabilities from '../Capabilities/Capabilities.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { formatBytes, formatDateTime, formatUptime, getErrorMessage } from '../../utils/format.js';
import { isUnsupportedPanelClientIpsError, normalizePanelClientIps } from '../../utils/panelClientIps.js';
import { readSessionSnapshot, writeSessionSnapshot } from '../../utils/sessionSnapshot.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import InboundRemarkPill from '../UI/InboundRemarkPill.jsx';
import {
    HiOutlineArrowLeft,
    HiOutlineArrowPath,
    HiOutlineCpuChip,
    HiOutlineCircleStack,
    HiOutlineClock,
    HiOutlineGlobeAlt,
    HiOutlineServerStack,
} from 'react-icons/hi2';

const SERVER_DETAIL_SNAPSHOT_TTL_MS = 2 * 60_000;
const SERVER_DETAIL_TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'inbounds', label: 'Inbounds' },
    { key: 'onlines', label: 'Online Users' },
    { key: 'capabilities', label: 'Capabilities' },
    { key: 'audit', label: 'Audit Log' },
];
const SERVER_DETAIL_TAB_KEYS = new Set(SERVER_DETAIL_TABS.map((tab) => tab.key));

function getServerDetailTab(searchParams) {
    const tab = String(searchParams?.get('tab') || '').trim();
    return SERVER_DETAIL_TAB_KEYS.has(tab) ? tab : 'overview';
}

function buildServerDetailSnapshotKey(serverId) {
    return `server_detail_v1:${String(serverId || '').trim()}`;
}

function readServerDetailSnapshot(serverId) {
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) return null;

    const snapshot = readSessionSnapshot(buildServerDetailSnapshotKey(normalizedServerId), {
        maxAgeMs: SERVER_DETAIL_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    return {
        server: snapshot?.server || null,
        status: snapshot?.status || null,
        inbounds: Array.isArray(snapshot?.inbounds) ? snapshot.inbounds : [],
        onlines: Array.isArray(snapshot?.onlines) ? snapshot.onlines : [],
        lastOnline: snapshot?.lastOnline && typeof snapshot.lastOnline === 'object' && !Array.isArray(snapshot.lastOnline) ? snapshot.lastOnline : {},
        auditEvents: Array.isArray(snapshot?.auditEvents) ? snapshot.auditEvents : [],
    };
}

function StatMini({ label, value, suffix }) {
    const animated = useAnimatedCounter(typeof value === 'number' ? value : 0);
    const displayValue = value === null || value === undefined
        ? '...'
        : (typeof value === 'number' ? `${animated}${suffix || ''}` : `${value}${suffix || ''}`);
    return (
        <div className="stat-mini-card">
            <div className="stat-mini-value" title={displayValue}>
                <span className="stat-mini-value-text">{displayValue}</span>
            </div>
            <div className="stat-mini-label">{label}</div>
        </div>
    );
}

function formatTime(ts, locale = 'zh-CN') {
    return formatDateTime(ts, locale);
}

function ServerDetailInboundMobileList({ inbounds = [] }) {
    const { t } = useI18n();
    return (
        <div className="server-detail-mobile-list">
            {inbounds.map((ib) => {
                let clients = 0;
                try {
                    const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : (ib.settings || {});
                    clients = (settings.clients || []).length;
                } catch {}
                return (
                    <div key={ib.id} className="server-detail-mobile-card">
                        <div className="server-detail-mobile-card-head">
                            <div className="server-detail-mobile-card-copy">
                                <div className="server-detail-mobile-card-title">
                                    <InboundRemarkPill remark={ib.remark} protocol={ib.protocol} />
                                </div>
                                <div className="server-detail-mobile-card-subtitle">
                                    <span className="badge badge-neutral">{ib.protocol}</span>
                                    <span className="server-detail-mobile-card-port">:{ib.port}</span>
                                </div>
                            </div>
                            <span className={`badge ${ib.enable !== false ? 'badge-success' : 'badge-danger'}`}>
                                {ib.enable !== false ? t('comp.common.enabled') : t('comp.common.disabled')}
                            </span>
                        </div>
                        <div className="server-detail-mobile-card-grid">
                            <div className="server-detail-mobile-card-item">
                                <span className="server-detail-mobile-card-label">{t('pages.serverDetail.clientsCount')}</span>
                                <span className="server-detail-mobile-card-value">{clients}</span>
                            </div>
                            <div className="server-detail-mobile-card-item">
                                <span className="server-detail-mobile-card-label">{t('pages.serverDetail.traffic')}</span>
                                <span className="server-detail-mobile-card-value">{formatBytes((ib.up || 0) + (ib.down || 0))}</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function normalizePanelTimestamp(value) {
    const timestamp = Number(value || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
    return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatLastOnline(value, locale = 'zh-CN') {
    const timestamp = normalizePanelTimestamp(value);
    return timestamp > 0 ? formatDateTime(timestamp, locale) : '-';
}

function ServerDetailOnlineMobileList({ onlineUsers = [], onLoadClientIps, clientIpSupport, locale = 'zh-CN' }) {
    const { t } = useI18n();
    return (
        <div className="server-detail-mobile-list">
            {onlineUsers.map((item, index) => (
                <div key={item.email} className="server-detail-mobile-card">
                    <div className="server-detail-mobile-card-head">
                        <div className="server-detail-mobile-card-copy">
                            <div className="server-detail-mobile-card-title">{item.email}</div>
                            <div className="server-detail-mobile-card-subtitle">#{index + 1}</div>
                        </div>
                        <span className="badge badge-success">{t('pages.serverDetail.sessionsCount', { count: item.sessions })}</span>
                    </div>
                    <div className="server-detail-mobile-card-grid">
                        <div className="server-detail-mobile-card-item">
                            <span className="server-detail-mobile-card-label">{t('pages.serverDetail.lastOnline')}</span>
                            <span className="server-detail-mobile-card-value">{formatLastOnline(item.lastOnline, locale)}</span>
                        </div>
                    </div>
                    <div className="server-detail-mobile-card-actions">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onLoadClientIps(item.email)}
                            disabled={clientIpSupport.supported === false}
                            title={clientIpSupport.supported === false ? clientIpSupport.reason : t('pages.serverDetail.tooltips.viewClientIps')}
                        >
                            <HiOutlineGlobeAlt /> {t('pages.serverDetail.nodeIp')}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function ServerDetail() {
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const { serverId } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const confirmAction = useConfirm();
    const detailBootstrapRef = useRef(readServerDetailSnapshot(serverId));
    const tabs = useMemo(() => SERVER_DETAIL_TABS.map(tab => ({
        ...tab,
        label: t(`pages.serverDetail.tabs.${tab.key}`),
    })), [t]);
    const snapshotRequestIdRef = useRef(0);
    const auditRequestIdRef = useRef(0);
    const clientIpRequestIdRef = useRef(0);

    const [loading, setLoading] = useState(() => detailBootstrapRef.current?.server == null);
    const [server, setServer] = useState(() => detailBootstrapRef.current?.server || null);
    const [status, setStatus] = useState(() => detailBootstrapRef.current?.status || null);
    const [inbounds, setInbounds] = useState(() => detailBootstrapRef.current?.inbounds || []);
    const [onlines, setOnlines] = useState(() => detailBootstrapRef.current?.onlines || []);
    const [lastOnline, setLastOnline] = useState(() => detailBootstrapRef.current?.lastOnline || {});
    const [inboundsLoading, setInboundsLoading] = useState(() => detailBootstrapRef.current?.inbounds == null);
    const [onlinesLoading, setOnlinesLoading] = useState(() => detailBootstrapRef.current?.onlines == null);
    const [auditEvents, setAuditEvents] = useState(() => detailBootstrapRef.current?.auditEvents || []);
    const [activeTab, setActiveTab] = useState(() => getServerDetailTab(searchParams));
    const [clientIpSupport, setClientIpSupport] = useState({ supported: true, reason: '' });
    const [clientIpModal, setClientIpModal] = useState({
        open: false,
        email: '',
        items: [],
        loading: false,
        clearing: false,
        error: '',
    });

    const fetchSnapshot = async (options = {}) => {
        const preserveCurrent = options.preserveCurrent === true;
        const force = options.force === true;
        const requestId = snapshotRequestIdRef.current + 1;
        snapshotRequestIdRef.current = requestId;
        if (!preserveCurrent) {
            setLoading(true);
            setInboundsLoading(true);
            setOnlinesLoading(true);
        }
        try {
            const res = await api.get(`/servers/${encodeURIComponent(serverId)}/snapshot`, {
                params: force ? { refresh: true } : undefined,
            });
            if (requestId !== snapshotRequestIdRef.current) return;
            if (res.data?.success) {
                const payload = res.data?.obj || {};
                setServer(payload.server || null);
                setStatus(payload.status || null);
                setInbounds(Array.isArray(payload.inbounds) ? payload.inbounds : []);
                setOnlines(Array.isArray(payload.onlines) ? payload.onlines : []);
                setLastOnline(payload.lastOnline && typeof payload.lastOnline === 'object' && !Array.isArray(payload.lastOnline) ? payload.lastOnline : {});
            } else {
                toast.error(t('pages.serverDetail.errors.serverNotFound'));
            }
        } catch (err) {
            if (requestId !== snapshotRequestIdRef.current) return;
            if (!preserveCurrent) {
                toast.error(getErrorMessage(err, t('pages.serverDetail.errors.loadSnapshotFailed'), locale));
                setServer(null);
                setStatus(null);
                setInbounds([]);
                setOnlines([]);
            }
        } finally {
            if (requestId === snapshotRequestIdRef.current) {
                setLoading(false);
                setInboundsLoading(false);
                setOnlinesLoading(false);
            }
        }
    };

    const fetchAudit = async () => {
        const requestId = auditRequestIdRef.current + 1;
        auditRequestIdRef.current = requestId;
        try {
            const res = await api.get('/audit/events', { params: { serverId, pageSize: 20 } });
            if (requestId !== auditRequestIdRef.current) return;
            setAuditEvents(res.data?.obj?.items || []);
        } catch { /* ignore */ }
    };

    useEffect(() => {
        auditRequestIdRef.current += 1;
        clientIpRequestIdRef.current += 1;
        const snapshot = readServerDetailSnapshot(serverId);
        detailBootstrapRef.current = snapshot;
        setLoading(snapshot?.server == null);
        setServer(snapshot?.server || null);
        setStatus(snapshot?.status || null);
        setInbounds(snapshot?.inbounds || []);
        setOnlines(snapshot?.onlines || []);
        setLastOnline(snapshot?.lastOnline || {});
        setInboundsLoading(snapshot?.inbounds == null);
        setOnlinesLoading(snapshot?.onlines == null);
        setAuditEvents(snapshot?.auditEvents || []);
        setClientIpSupport({ supported: true, reason: '' });
        closeClientIpModal();
        fetchSnapshot({ preserveCurrent: snapshot?.server != null });
    }, [serverId]);

    useEffect(() => {
        if (activeTab === 'onlines') fetchSnapshot({ preserveCurrent: true, force: true });
        if (activeTab === 'audit') fetchAudit();
    }, [activeTab, serverId]);

    useEffect(() => {
        const nextTab = getServerDetailTab(searchParams);
        setActiveTab((current) => (current === nextTab ? current : nextTab));
    }, [searchParams]);

    useEffect(() => {
        if (!server) return;
        writeSessionSnapshot(buildServerDetailSnapshotKey(serverId), {
            server,
            status,
            inbounds,
            onlines,
            lastOnline,
            auditEvents,
        });
    }, [auditEvents, inbounds, lastOnline, onlines, server, serverId, status]);

    const totalTraffic = useMemo(() => {
        return inbounds.reduce((sum, ib) => sum + (ib.up || 0) + (ib.down || 0), 0);
    }, [inbounds]);

    const activeInbounds = useMemo(() => inbounds.filter(ib => ib.enable !== false).length, [inbounds]);
    const onlineUsers = useMemo(() => {
        const grouped = new Map();
        onlines.forEach((item) => {
            const email = String(item || '').trim();
            if (!email) return;
            const normalizedEmail = email.toLowerCase();
            const current = grouped.get(normalizedEmail) || { email, sessions: 0, lastOnline: lastOnline?.[normalizedEmail] || 0 };
            current.sessions += 1;
            current.lastOnline = Math.max(Number(current.lastOnline || 0), Number(lastOnline?.[normalizedEmail] || 0));
            grouped.set(normalizedEmail, current);
        });
        return Array.from(grouped.values()).sort((a, b) => {
            if (b.sessions !== a.sessions) return b.sessions - a.sessions;
            return a.email.localeCompare(b.email, 'zh-CN');
        });
    }, [lastOnline, onlines]);

    const clientCount = useMemo(() => {
        let count = 0;
        for (const ib of inbounds) {
            try {
                const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : (ib.settings || {});
                count += (settings.clients || []).length;
            } catch { /* ignore */ }
        }
        return count;
    }, [inbounds]);

    const refreshAll = () => {
        fetchSnapshot({ force: true });
        if (activeTab === 'audit') {
            fetchAudit();
        }
    };

    const selectTab = (tabKey) => {
        setActiveTab(tabKey);
        const nextParams = new URLSearchParams(searchParams);
        if (tabKey === 'overview') {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', tabKey);
        }
        setSearchParams(nextParams);
    };

    const closeClientIpModal = () => {
        clientIpRequestIdRef.current += 1;
        setClientIpModal({
            open: false,
            email: '',
            items: [],
            loading: false,
            clearing: false,
            error: '',
        });
    };

    const loadClientIps = async (email, options = {}) => {
        const normalizedEmail = String(email || '').trim();
        if (!normalizedEmail || clientIpSupport.supported === false) return;
        const requestId = clientIpRequestIdRef.current + 1;
        clientIpRequestIdRef.current = requestId;

        if (options.preserveOpen !== true) {
            setClientIpModal({
                open: true,
                email: normalizedEmail,
                items: [],
                loading: true,
                clearing: false,
                error: '',
            });
        } else {
            setClientIpModal((prev) => ({
                ...prev,
                loading: true,
                error: '',
            }));
        }

        try {
            const res = await api.post(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/clientIps/${encodeURIComponent(normalizedEmail)}`);
            if (requestId !== clientIpRequestIdRef.current) return;
            const items = normalizePanelClientIps(res.data?.obj);
            setClientIpSupport({ supported: true, reason: '' });
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                email: normalizedEmail,
                items,
                loading: false,
                error: '',
            }));
        } catch (err) {
            if (requestId !== clientIpRequestIdRef.current) return;
            const msg = getErrorMessage(err, t('pages.serverDetail.errors.loadClientIpsFailed'), locale);
            if (isUnsupportedPanelClientIpsError(err)) {
                setClientIpSupport({
                    supported: false,
                    reason: msg || t('pages.serverDetail.errors.unsupportedClientIps'),
                });
            }
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                loading: false,
                error: msg,
                items: [],
            }));
            toast.error(msg);
        }
    };

    const clearClientIps = async () => {
        if (!clientIpModal.email) return;
        const ok = await confirmAction({
            title: t('pages.serverDetail.clearClientIps.title'),
            message: t('pages.serverDetail.clearClientIps.message', { email: clientIpModal.email }),
            confirmText: t('pages.serverDetail.clearClientIps.confirmText'),
            tone: 'danger',
        });
        if (!ok) return;

        setClientIpModal((prev) => ({
            ...prev,
            clearing: true,
            error: '',
        }));

        try {
            await api.post(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/clearClientIps/${encodeURIComponent(clientIpModal.email)}`);
            toast.success(t('pages.serverDetail.clearClientIps.success'));
            await loadClientIps(clientIpModal.email, { preserveOpen: true });
        } catch (err) {
            const msg = getErrorMessage(err, t('pages.serverDetail.clearClientIps.failed'), locale);
            setClientIpModal((prev) => ({
                ...prev,
                clearing: false,
                error: msg,
            }));
            toast.error(msg);
            return;
        }

        setClientIpModal((prev) => ({
            ...prev,
            clearing: false,
        }));
    };

    if (loading) {
        return (
            <>
                <Header
                    title={t('pages.serverDetail.title')}
                />
                <div className="page-content page-content--wide page-enter server-detail-page">
                    <div className="glass-panel p-6">
                        <SkeletonTable rows={3} cols={4} />
                    </div>
                </div>
            </>
        );
    }

    if (!server) {
        return (
            <>
                <Header
                    title={t('pages.serverDetail.title')}
                />
                <div className="page-content page-content--wide page-enter server-detail-page">
                    <EmptyState title={t('pages.serverDetail.errors.serverNotFound')} subtitle={t('pages.serverDetail.errors.serverDeleted')} action={
                        <button className="btn btn-secondary" onClick={() => navigate('/servers')}>
                            <HiOutlineArrowLeft /> {t('pages.serverDetail.backToServerList')}
                        </button>
                    } />
                </div>
            </>
        );
    }

    const envLabel = {
        production: t('pages.serverDetail.environments.production'),
        staging: t('pages.serverDetail.environments.staging'),
        development: t('pages.serverDetail.environments.development'),
        testing: t('pages.serverDetail.environments.testing'),
        dr: t('pages.serverDetail.environments.dr'),
        sandbox: t('pages.serverDetail.environments.sandbox'),
    };
    const healthLabel = {
        healthy: t('pages.serverDetail.healthStatus.healthy'),
        degraded: t('pages.serverDetail.healthStatus.degraded'),
        unreachable: t('pages.serverDetail.healthStatus.unreachable'),
        maintenance: t('pages.serverDetail.healthStatus.maintenance'),
    };
    const healthBadge = { healthy: 'badge-success', degraded: 'badge-warning', unreachable: 'badge-danger', maintenance: 'badge-info' };
    const showInboundStats = !inboundsLoading || inbounds.length > 0;
    const showOnlineStats = !onlinesLoading || onlineUsers.length > 0 || onlines.length > 0;
    const hasEnvironment = String(server.environment || '').trim() && String(server.environment || '').trim() !== 'unknown';

    return (
        <>
            <Header
                title={t('pages.serverDetail.titleWithName', { name: server.name })}
                allowTitleWrap
            />
            <div className="page-content page-content--wide page-enter server-detail-page">
                <button className="btn btn-secondary btn-sm mb-4 page-back-link" onClick={() => navigate('/servers')}>
                    <HiOutlineArrowLeft /> {t('pages.serverDetail.backToServerList')}
                </button>

                {/* Server Profile Card */}
                <div className="glass-panel mb-6 detail-hero-panel detail-hero-panel--server">
                    <div className="user-profile-card detail-hero-card detail-hero-card--server">
                        <div className="user-avatar user-avatar-lg" style={{ background: 'var(--gradient-success)' }}>
                            <HiOutlineServerStack />
                        </div>
                        <div className="user-profile-info">
                            <div className="user-profile-name">{server.name}</div>
                            <div className="user-profile-email font-mono">{server.url}</div>
                            <div className="user-profile-badges">
                                <span className={`badge ${healthBadge[server.health] || 'badge-neutral'}`}>
                                    {healthLabel[server.health] || t('comp.common.unknown')}
                                </span>
                                {hasEnvironment && (
                                    <span className="badge badge-neutral">{envLabel[server.environment] || server.environment}</span>
                                )}
                                {server.group && <span className="badge badge-info">{server.group}</span>}
                            </div>
                            <div className="user-profile-meta">
                                {status && (
                                    <>
                                        <div className="user-profile-meta-item"><HiOutlineCpuChip /> {t('pages.serverDetail.xrayLabels.cpu')} {status.cpu?.toFixed(1)}%</div>
                                        <div className="user-profile-meta-item"><HiOutlineCircleStack /> {t('pages.serverDetail.xrayLabels.memory')} {status.mem ? `${((status.mem.current / status.mem.total) * 100).toFixed(1)}%` : '-'}</div>
                                        <div className="user-profile-meta-item"><HiOutlineClock /> {t('pages.serverDetail.xrayLabels.uptime')} {status.uptime ? formatUptime(status.uptime, locale) : '-'}</div>
                                    </>
                                )}
                                {!status && <div className="user-profile-meta-item text-muted">{t('pages.serverDetail.loadingStatus')}</div>}
                            </div>
                        </div>
                        <div className="user-profile-actions">
                            <button className="btn btn-secondary btn-sm" onClick={refreshAll}>
                                <HiOutlineArrowPath /> {t('pages.serverDetail.refresh')}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="stat-mini-grid detail-stats-grid mb-6">
                    <StatMini label={t('pages.serverDetail.inboundRules')} value={showInboundStats ? activeInbounds : null} suffix={showInboundStats ? ` / ${inbounds.length}` : ''} />
                    <StatMini label={t('pages.serverDetail.clientsCount')} value={showInboundStats ? clientCount : null} />
                    <StatMini label={t('pages.serverDetail.onlineUsers')} value={showOnlineStats ? onlineUsers.length : null} suffix={showOnlineStats && onlines.length > onlineUsers.length ? t('pages.serverDetail.sessionsSuffix', { count: onlines.length }) : ''} />
                    <StatMini label={t('pages.serverDetail.totalTraffic')} value={showInboundStats ? formatBytes(totalTraffic) : null} />
                </div>
                {onlinesLoading && onlineUsers.length === 0 && (
                    <div className="text-xs text-muted mb-6">{t('pages.serverDetail.loadingOnlineUsers')}</div>
                )}

                {/* Tabs */}
                <div className="user-detail-tabs detail-tabs">
                    <div className="tabs">
                        {tabs.map(t => (
                            <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => selectTab(t.key)}>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="user-detail-tab-content tab-content-enter" key={activeTab}>
                        {/* Overview Tab */}
                        {activeTab === 'overview' && (
                            <div>
                                <div className="card mb-4">
                                    <h4 className="card-title mb-3">{t('pages.serverDetail.serverInfo')}</h4>
                                    <div className="grid grid-cols-2 gap-4 text-sm server-detail-overview-grid">
                                        <div><span className="text-muted">{t('pages.serverDetail.infoLabels.name')}</span> {server.name}</div>
                                        <div><span className="text-muted">{t('pages.serverDetail.infoLabels.url')}</span> <span className="font-mono">{server.url}</span></div>
                                        <div><span className="text-muted">{t('pages.serverDetail.infoLabels.username')}</span> {server.username}</div>
                                        {hasEnvironment && <div><span className="text-muted">{t('pages.serverDetail.infoLabels.environment')}</span> {envLabel[server.environment] || server.environment}</div>}
                                        <div><span className="text-muted">{t('pages.serverDetail.infoLabels.group')}</span> {server.group || t('pages.serverDetail.infoLabels.noGroup')}</div>
                                        <div><span className="text-muted">{t('pages.serverDetail.infoLabels.health')}</span> {healthLabel[server.health] || t('comp.common.unknown')}</div>
                                        {server.basePath && <div><span className="text-muted">{t('pages.serverDetail.infoLabels.basePath')}</span> <span className="font-mono">{server.basePath}</span></div>}
                                    </div>
                                    {Array.isArray(server.tags) && server.tags.length > 0 && (
                                        <div className="flex gap-2 mt-3">
                                            {server.tags.map(tag => <span key={tag} className="badge badge-info">{tag}</span>)}
                                        </div>
                                    )}
                                </div>
                                {status && (
                                    <div className="card">
                                        <h4 className="card-title mb-3">{t('pages.serverDetail.xrayStatus')}</h4>
                                        <div className="grid grid-cols-2 gap-4 text-sm server-detail-overview-grid">
                                            <div><span className="text-muted">{t('pages.serverDetail.xrayLabels.version')}</span> {status.xray?.version || '-'}</div>
                                            <div><span className="text-muted">{t('pages.serverDetail.xrayLabels.uptime')}</span> {formatUptime(status.uptime, locale)}</div>
                                            <div><span className="text-muted">{t('pages.serverDetail.xrayLabels.cpu')}</span> {status.cpu?.toFixed(1)}%</div>
                                            <div><span className="text-muted">{t('pages.serverDetail.xrayLabels.memory')}</span> {status.mem ? `${formatBytes(status.mem.current)} / ${formatBytes(status.mem.total)}` : '-'}</div>
                                            <div><span className="text-muted">{t('pages.serverDetail.xrayLabels.disk')}</span> {status.disk ? `${formatBytes(status.disk.current)} / ${formatBytes(status.disk.total)}` : '-'}</div>
                                            <div><span className="text-muted">{t('pages.serverDetail.xrayLabels.tcpCount')}</span> {status.tcpCount || '-'}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Inbounds Tab */}
                        {activeTab === 'inbounds' && (
                            <div>
                                {inbounds.length === 0 ? (
                                    <EmptyState
                                        title={t('pages.serverDetail.empty.noInboundsTitle')}
                                        subtitle={t('pages.serverDetail.empty.noInboundsSubtitle')}
                                        action={(
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchSnapshot({ preserveCurrent: true, force: true })}>
                                                <HiOutlineArrowPath /> {t('pages.serverDetail.empty.refreshAction')}
                                            </button>
                                        )}
                                    />
                                ) : isCompactLayout ? (
                                    <ServerDetailInboundMobileList inbounds={inbounds} />
                                ) : (
                                    <div className="table-container">
                                        <table className="table server-detail-inbounds-table">
                                            <thead>
                                                <tr>
                                                    <th>{t('pages.serverDetail.inboundCols.remark')}</th>
                                                    <th className="table-cell-center server-detail-protocol-column">{t('pages.serverDetail.inboundCols.protocol')}</th>
                                                    <th className="table-cell-right server-detail-port-column">{t('pages.serverDetail.inboundCols.port')}</th>
                                                    <th className="table-cell-center server-detail-clients-column">{t('pages.serverDetail.inboundCols.clients')}</th>
                                                    <th className="table-cell-right server-detail-traffic-column">{t('pages.serverDetail.inboundCols.traffic')}</th>
                                                    <th className="table-cell-center server-detail-status-column">{t('pages.serverDetail.inboundCols.status')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {inbounds.map(ib => {
                                                    let clients = 0;
                                                    try {
                                                        const s = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : (ib.settings || {});
                                                        clients = (s.clients || []).length;
                                                    } catch {}
                                                    return (
                                                        <tr key={ib.id}>
                                                            <td data-label={t('pages.serverDetail.inboundCols.remark')} className="server-detail-remark-cell">
                                                                <InboundRemarkPill remark={ib.remark} protocol={ib.protocol} />
                                                            </td>
                                                            <td data-label={t('pages.serverDetail.inboundCols.protocol')} className="table-cell-center server-detail-protocol-cell"><span className="badge badge-neutral">{ib.protocol}</span></td>
                                                            <td data-label={t('pages.serverDetail.inboundCols.port')} className="table-cell-right cell-mono-right server-detail-port-cell">{ib.port}</td>
                                                            <td data-label={t('pages.serverDetail.inboundCols.clients')} className="table-cell-center cell-mono server-detail-clients-cell">{clients}</td>
                                                            <td data-label={t('pages.serverDetail.inboundCols.traffic')} className="table-cell-right cell-mono-right server-detail-traffic-cell">{formatBytes((ib.up || 0) + (ib.down || 0))}</td>
                                                            <td data-label={t('pages.serverDetail.inboundCols.status')} className="table-cell-center server-detail-status-cell"><span className={`badge ${ib.enable !== false ? 'badge-success' : 'badge-danger'}`}>{ib.enable !== false ? t('comp.common.enabled') : t('comp.common.disabled')}</span></td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Online Users Tab */}
                        {activeTab === 'onlines' && (
                            <div>
                                <SectionHeader
                                    className="mb-4"
                                    compact
                                    title={t('pages.serverDetail.onlineUsers')}
                                    meta={(
                                        <div className="text-sm text-muted">
                                            {t('pages.serverDetail.onlineUsersSummary', { users: onlineUsers.length, sessions: onlines.length })}
                                            {clientIpSupport.supported === false ? t('pages.serverDetail.errors.clientIpsUnavailable', { reason: clientIpSupport.reason }) : ''}
                                        </div>
                                    )}
                                    actions={(
                                        <button className="btn btn-secondary btn-sm" onClick={() => fetchSnapshot({ preserveCurrent: true, force: true })}><HiOutlineArrowPath /> {t('pages.serverDetail.refresh')}</button>
                                    )}
                                />
                                {onlinesLoading ? (
                                    <SkeletonTable rows={4} cols={3} />
                                ) : onlineUsers.length === 0 ? (
                                    <EmptyState
                                        title={t('pages.serverDetail.empty.noOnlineUsersTitle')}
                                        subtitle={t('pages.serverDetail.empty.noOnlineUsersSubtitle')}
                                        action={(
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchSnapshot({ preserveCurrent: true, force: true })}>
                                                <HiOutlineArrowPath /> {t('pages.serverDetail.empty.refreshAction')}
                                            </button>
                                        )}
                                    />
                                ) : isCompactLayout ? (
                                    <ServerDetailOnlineMobileList
                                        onlineUsers={onlineUsers}
                                        onLoadClientIps={loadClientIps}
                                        clientIpSupport={clientIpSupport}
                                        locale={locale}
                                    />
                                ) : (
                                    <div className="table-container">
                                        <table className="table server-detail-online-table">
                                            <thead><tr><th className="table-cell-center server-detail-sequence-column">#</th><th>{t('pages.serverDetail.onlineCols.user')}</th><th className="table-cell-right server-detail-sessions-column">{t('pages.serverDetail.onlineCols.sessions')}</th><th>{t('pages.serverDetail.onlineCols.lastOnline')}</th><th className="table-cell-actions server-detail-online-actions-column">{t('pages.serverDetail.onlineCols.actions')}</th></tr></thead>
                                            <tbody>
                                                {onlineUsers.map((item, i) => (
                                                    <tr key={item.email}>
                                                        <td data-label={t('pages.serverDetail.onlineCols.sequence')} className="table-cell-center cell-mono server-detail-sequence-cell">{i + 1}</td>
                                                        <td data-label={t('pages.serverDetail.onlineCols.user')} className="font-mono">{item.email}</td>
                                                        <td data-label={t('pages.serverDetail.onlineCols.sessions')} className="table-cell-right cell-mono-right server-detail-sessions-cell">{item.sessions}</td>
                                                        <td data-label={t('pages.serverDetail.onlineCols.lastOnline')} className="cell-mono">{formatLastOnline(item.lastOnline, locale)}</td>
                                                        <td data-label={t('pages.serverDetail.onlineCols.actions')} className="table-cell-actions">
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => loadClientIps(item.email)}
                                                                disabled={clientIpSupport.supported === false}
                                                                title={clientIpSupport.supported === false ? clientIpSupport.reason : t('pages.serverDetail.tooltips.viewClientIps')}
                                                            >
                                                                <HiOutlineGlobeAlt /> {t('pages.serverDetail.nodeIp')}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Capabilities Tab */}
                        {activeTab === 'capabilities' && (
                            <Capabilities embedded serverId={serverId} />
                        )}

                        {/* Audit Tab */}
                        {activeTab === 'audit' && (
                            <div>
                                {auditEvents.length === 0 ? (
                                    <EmptyState
                                        title={t('pages.serverDetail.empty.noAuditTitle')}
                                        subtitle={t('pages.serverDetail.empty.noAuditSubtitle')}
                                        action={(
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchSnapshot({ preserveCurrent: true, force: true })}>
                                                <HiOutlineArrowPath /> {t('pages.serverDetail.empty.refreshAction')}
                                            </button>
                                        )}
                                    />
                                ) : (
                                    <div className="timeline-list">
                                        {auditEvents.map((e, i) => (
                                            <div key={i} className="timeline-item">
                                                <div className={`timeline-dot ${e.outcome === 'success' ? 'success' : e.outcome === 'failed' ? 'danger' : 'info'}`} />
                                                <div className="timeline-content">
                                                    <div className="timeline-head">
                                                        <span className="font-medium">{e.eventType}</span>
                                                        <span className="timeline-time">{formatTime(e.ts, locale)}</span>
                                                    </div>
                                                    {e.actor && <div className="text-sm text-muted">{t('pages.serverDetail.auditLabels.actor')} {e.actor}</div>}
                                                    {e.path && <div className="text-xs text-muted truncate">{e.path}</div>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ClientIpModal
                isOpen={clientIpModal.open}
                title={`${t('pages.serverDetail.nodeIp')} — ${server?.name || serverId}`}
                subtitle={clientIpModal.email ? `${clientIpModal.email} · ${t('pages.serverDetail.nodeRecord')}` : ''}
                loading={clientIpModal.loading}
                clearing={clientIpModal.clearing}
                items={clientIpModal.items}
                error={clientIpModal.error}
                onClose={closeClientIpModal}
                onRefresh={() => loadClientIps(clientIpModal.email, { preserveOpen: true })}
                onClear={clientIpSupport.supported === false ? undefined : clearClientIps}
            />
        </>
    );
}
