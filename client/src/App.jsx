import React, { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import { ServerProvider } from './contexts/ServerContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { NotificationProvider } from './contexts/NotificationContext.jsx';
import { Toaster } from 'react-hot-toast';
import useMediaQuery from './hooks/useMediaQuery.js';
import { getLocaleMessage } from './i18n/messages.js';
import MobileBottomNav from './components/Layout/MobileBottomNav.jsx';
import SecurityBootstrapWizard from './components/System/SecurityBootstrapWizard.jsx';
import api from './api/client.js';
import useWebSocket from './hooks/useWebSocket.js';
import { applyAppBootstrapSnapshots } from './utils/appBootstrap.js';

const Login = lazy(() => import('./components/Login/Login.jsx'));
const Sidebar = lazy(() => import('./components/Layout/Sidebar.jsx'));
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard.jsx'));
const Inbounds = lazy(() => import('./components/Inbounds/Inbounds.jsx'));
const UsersHub = lazy(() => import('./components/Users/UsersHub.jsx'));
const UserDetail = lazy(() => import('./components/Users/UserDetail.jsx'));
const Subscriptions = lazy(() => import('./components/Subscriptions/Subscriptions.jsx'));
const DownloadsCenter = lazy(() => import('./components/Subscriptions/DownloadsCenter.jsx'));
const AccountCenter = lazy(() => import('./components/Account/AccountCenter.jsx'));
const Logs = lazy(() => import('./components/Logs/Logs.jsx'));
const Tools = lazy(() => import('./components/Tools/Tools.jsx'));
const Servers = lazy(() => import('./components/Servers/Servers.jsx'));
const ServerDetail = lazy(() => import('./components/Servers/ServerDetail.jsx'));
const Capabilities = lazy(() => import('./components/Capabilities/Capabilities.jsx'));
const AuditCenter = lazy(() => import('./components/Audit/AuditCenter.jsx'));
const SystemSettings = lazy(() => import('./components/System/SystemSettings.jsx'));


class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info?.componentStack);
    }

    render() {
        if (this.state.hasError) {
            const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
            return (
                <div style={{
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '16px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                }}>
                    <div style={{ fontSize: '18px', fontWeight: 600 }}>
                        {getLocaleMessage(locale, 'comp.common.errorBoundaryTitle')}
                    </div>
                    <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                        {getLocaleMessage(locale, 'comp.common.errorBoundarySubtitle')}
                    </div>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => window.location.reload()}
                    >
                        {getLocaleMessage(locale, 'comp.common.errorBoundaryAction')}
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

function PageFallback() {
    return (
        <div style={{
            height: '100%',
            minHeight: '220px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            <span className="spinner" style={{ width: '24px', height: '24px' }} />
        </div>
    );
}

function LazyPage({ children }) {
    return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function getWsUrl(ticket) {
    if (!ticket) return null;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = String(import.meta.env.VITE_WS_HOST || '').trim() || window.location.host;
    return `${proto}://${host}/ws?ticket=${encodeURIComponent(ticket)}`;
}

function ProtectedLayout() {
    const { user, token } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [rootWsTicket, setRootWsTicket] = useState('');
    const lastWsTicketFetchAtRef = useRef(0);
    const isMobile = useMediaQuery('(max-width: 768px)');
    const rootWsUrl = useMemo(
        () => (isAdmin ? getWsUrl(rootWsTicket) : null),
        [isAdmin, rootWsTicket]
    );
    const { status: rootWsStatus, lastMessage: rootWsLastMessage } = useWebSocket(rootWsUrl);

    useEffect(() => {
        if (!isMobile) {
            setSidebarOpen(false);
        }
    }, [isMobile]);

    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            try {
                const res = await api.get('/auth/bootstrap');
                if (cancelled) return;
                applyAppBootstrapSnapshots(res.data?.obj || {});
            } catch (error) {
                console.error('Failed to load app bootstrap:', error?.response?.data || error?.message || error);
            }
        }, 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [token]);

    const fetchRootWsTicket = useCallback(async ({ force = false } = {}) => {
        if (!isAdmin || !token) {
            setRootWsTicket('');
            return;
        }
        const now = Date.now();
        if (!force && now - lastWsTicketFetchAtRef.current < 30_000) {
            return;
        }
        lastWsTicketFetchAtRef.current = now;
        try {
            const res = await api.post('/ws/ticket');
            setRootWsTicket(String(res.data?.obj?.ticket || ''));
        } catch (error) {
            console.error('Failed to fetch root websocket ticket:', error?.response?.data || error?.message || error);
        }
    }, [isAdmin, token]);

    useEffect(() => {
        if (!isAdmin || !token) {
            setRootWsTicket('');
            return undefined;
        }
        fetchRootWsTicket({ force: true });
        const interval = setInterval(() => fetchRootWsTicket({ force: true }), 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchRootWsTicket, isAdmin, token]);

    useEffect(() => {
        if (!isAdmin || !token) return;
        if (rootWsStatus === 'reconnecting' || rootWsStatus === 'disconnected') {
            fetchRootWsTicket();
        }
    }, [fetchRootWsTicket, isAdmin, rootWsStatus, token]);

    const effectiveCollapsed = isMobile ? false : sidebarCollapsed;

    return (
        <ServerProvider>
        <NotificationProvider wsLastMessage={isAdmin ? rootWsLastMessage : null}>
            <div className="app-layout">
                <div
                    className={`sidebar-backdrop ${sidebarOpen ? 'show' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                />
                <Suspense fallback={null}>
                    <Sidebar
                        collapsed={effectiveCollapsed}
                        open={sidebarOpen}
                        isMobile={isMobile}
                        onClose={() => setSidebarOpen(false)}
                        onToggle={() => {
                            if (isMobile) {
                                setSidebarOpen((current) => !current);
                                return;
                            }
                            setSidebarCollapsed(!sidebarCollapsed);
                        }}
                    />
                </Suspense>
                <main className={`main-content ${effectiveCollapsed ? 'collapsed' : ''}`}>
                    <Routes>
                        <Route path="/" element={isAdmin ? <LazyPage><Dashboard /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/inbounds" element={isAdmin ? <LazyPage><Inbounds /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/clients" element={isAdmin ? <LazyPage><UsersHub /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/clients/:userId" element={isAdmin ? <LazyPage><UserDetail /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/subscriptions" element={<LazyPage><Subscriptions /></LazyPage>} />
                        <Route path="/downloads" element={isAdmin ? <Navigate to="/subscriptions" replace /> : <LazyPage><DownloadsCenter /></LazyPage>} />
                        <Route path="/account" element={<LazyPage><AccountCenter /></LazyPage>} />
                        <Route path="/logs" element={isAdmin ? <LazyPage><Logs /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/server" element={isAdmin ? <Navigate to="/settings?tab=console" replace /> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/tools" element={isAdmin ? <LazyPage><Tools /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/capabilities" element={isAdmin ? <LazyPage><Capabilities /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/tasks" element={isAdmin ? <Navigate to="/audit" replace /> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/audit" element={isAdmin ? <LazyPage><AuditCenter /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/servers" element={isAdmin ? <LazyPage><Servers /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/servers/:serverId" element={isAdmin ? <LazyPage><ServerDetail /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/accounts" element={isAdmin ? <Navigate to="/clients" replace /> : <Navigate to="/account" replace />} />
                        <Route path="/settings" element={isAdmin ? <LazyPage><SystemSettings /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="*" element={<Navigate to={isAdmin ? '/' : '/subscriptions'} replace />} />
                    </Routes>
                    {isMobile ? <MobileBottomNav onOpenMenu={() => setSidebarOpen(true)} /> : null}
                </main>
                {isAdmin ? <SecurityBootstrapWizard /> : null}
            </div>
        </NotificationProvider>
        </ServerProvider>
    );
}

export default function App() {
    const { isAuthenticated, loading } = useAuth();

    if (loading) {
        return (
            <div style={{
                height: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-primary)',
            }}>
                <span className="spinner" style={{ width: '32px', height: '32px' }} />
            </div>
        );
    }

    return (
        <ErrorBoundary>
        <ThemeProvider>
            <Toaster
                position="top-right"
                toastOptions={{
                    style: {
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '13px',
                    },
                    success: {
                        iconTheme: { primary: '#10b981', secondary: '#fff' },
                    },
                    error: {
                        iconTheme: { primary: '#ef4444', secondary: '#fff' },
                    },
                }}
            />
            <Routes>
                <Route
                    path="/login"
                    element={isAuthenticated ? <Navigate to="/" replace /> : <LazyPage><Login /></LazyPage>}
                />
                <Route path="/*" element={isAuthenticated ? <ProtectedLayout /> : <Navigate to="/login" replace />} />
            </Routes>
        </ThemeProvider>
        </ErrorBoundary>
    );
}
