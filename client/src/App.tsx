import React, { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ServerProvider } from './contexts/ServerContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { Toaster } from 'react-hot-toast';
import useMediaQuery from './hooks/useMediaQuery';
import { getLocaleMessage } from './i18n/messages';
import { clearStoredToken } from './api/client';
import { clearAppSessionState } from './utils/appBootstrap';
import { HiOutlineBars3, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import MobileBottomNav from './components/Layout/MobileBottomNav';
import SecurityBootstrapWizard from './components/System/SecurityBootstrapWizard';
import CommandPalette from './components/UI/CommandPalette';
import api from './api/client';
import useWebSocket from './hooks/useWebSocket';
import { applyAppBootstrapSnapshots } from './utils/appBootstrap';
import { lazyWithRetry } from './utils/lazyWithRetry';

const Login = lazyWithRetry(() => import('./components/Login/Login'), 'Login');
const Sidebar = lazyWithRetry(() => import('./components/Layout/Sidebar'), 'Sidebar');
const loadDashboardPage = () => import('./components/Dashboard/Dashboard');
const loadInboundsPage = () => import('./components/Inbounds/Inbounds');
const loadUsersHubPage = () => import('./components/Users/UsersHub');

const Dashboard = lazyWithRetry(loadDashboardPage, 'Dashboard');
const Inbounds = lazyWithRetry(loadInboundsPage, 'Inbounds');
const UsersHub = lazyWithRetry(loadUsersHubPage, 'UsersHub');
const UserDetail = lazyWithRetry(() => import('./components/Users/UserDetail'), 'UserDetail');
const Subscriptions = lazyWithRetry(() => import('./components/Subscriptions/Subscriptions'), 'Subscriptions');
const DownloadsCenter = lazyWithRetry(() => import('./components/Subscriptions/DownloadsCenter'), 'DownloadsCenter');
const AccountCenter = lazyWithRetry(() => import('./components/Account/AccountCenter'), 'AccountCenter');
const Logs = lazyWithRetry(() => import('./components/Logs/Logs'), 'Logs');
const Tools = lazyWithRetry(() => import('./components/Tools/Tools'), 'Tools');
const Servers = lazyWithRetry(() => import('./components/Servers/Servers'), 'Servers');
const ServerDetail = lazyWithRetry(() => import('./components/Servers/ServerDetail'), 'ServerDetail');
const Capabilities = lazyWithRetry(() => import('./components/Capabilities/Capabilities'), 'Capabilities');
const AuditCenter = lazyWithRetry(() => import('./components/Audit/AuditCenter'), 'AuditCenter');
const SystemSettings = lazyWithRetry(() => import('./components/System/SystemSettings'), 'SystemSettings');
const XrayConsole = lazyWithRetry(() => import('./components/Xray/XrayConsole'), 'XrayConsole');

interface ErrorBoundaryProps {
    children: ReactNode;
    fallbackTitle?: string;
    inline?: boolean;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[ErrorBoundary]', error, info?.componentStack);
        const message = String(error?.message || '');
        const isChunkError = (
            message.includes('Failed to fetch dynamically imported module')
            || message.includes('Loading chunk')
            || message.includes('dynamically imported module')
            || error?.name === 'ChunkLoadError'
        );
        if (isChunkError) {
            const reloadKey = 'nms_auto_reload_chunk_error';
            const lastAttempt = Number(sessionStorage.getItem(reloadKey) || 0);
            if (Date.now() - lastAttempt > 10_000) {
                sessionStorage.setItem(reloadKey, String(Date.now()));
                window.location.reload();
            }
        }
    }

    handleReload = () => {
        window.location.reload();
    };

    handleGoHome = () => {
        window.location.href = '/';
    };

    handleResetAndRelogin = () => {
        try {
            clearStoredToken();
            clearAppSessionState();
            sessionStorage.clear();
        } catch {}
        window.location.href = '/login';
    };

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            const locale = typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
            const isEn = locale === 'en-US';
            const errorMessage = this.state.error?.message || '';
            const isChunkError = (
                errorMessage.includes('Failed to fetch dynamically imported module')
                || errorMessage.includes('Loading chunk')
                || errorMessage.includes('dynamically imported module')
            );
            const resolvedTitle = isChunkError
                ? (isEn ? 'New Version Available' : '发现系统新版本')
                : (this.props.fallbackTitle || getLocaleMessage(locale, 'comp.common.errorBoundaryTitle'));
            const resolvedSubtitle = isChunkError
                ? (isEn ? 'A new version has been deployed. Please refresh to load the latest application.' : '系统已部署最新版本，请刷新页面加载最新资源。')
                : getLocaleMessage(locale, 'comp.common.errorBoundarySubtitle');

            if (this.props.inline) {
                return (
                    <div className="page-error-boundary">
                        <div className="app-error-boundary-card">
                            <div className="app-error-boundary-icon">
                                <HiOutlineExclamationTriangle />
                            </div>
                            <div className="app-error-boundary-title">
                                {resolvedTitle}
                            </div>
                            <div className="app-error-boundary-subtitle">
                                {resolvedSubtitle}
                            </div>
                            {errorMessage ? (
                                <div className="app-error-boundary-detail">
                                    <code>{errorMessage}</code>
                                </div>
                            ) : null}
                            <div className="app-error-boundary-actions">
                                <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={this.handleReload}
                                >
                                    {getLocaleMessage(locale, 'comp.common.errorBoundaryAction')}
                                </button>
                                {!isChunkError && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={this.handleRetry}
                                    >
                                        {isEn ? 'Try Again' : '重试'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={this.handleGoHome}
                                >
                                    {isEn ? 'Go to Home' : '返回首页'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            return (
                <div className="app-error-boundary">
                    <div className="app-error-boundary-card">
                        <div className="app-error-boundary-icon">
                            <HiOutlineExclamationTriangle />
                        </div>
                        <div className="app-error-boundary-title">
                            {resolvedTitle}
                        </div>
                        <div className="app-error-boundary-subtitle">
                            {resolvedSubtitle}
                        </div>
                        {errorMessage ? (
                            <div className="app-error-boundary-detail">
                                <code>{errorMessage}</code>
                            </div>
                        ) : null}
                        <div className="app-error-boundary-actions">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={this.handleReload}
                            >
                                {getLocaleMessage(locale, 'comp.common.errorBoundaryAction')}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={this.handleGoHome}
                            >
                                {isEn ? 'Go to Home' : '返回首页'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={this.handleResetAndRelogin}
                            >
                                {isEn ? 'Clear Cache & Re-login' : '清除缓存并重新登录'}
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

function PageFallback() {
    return (
        <div className="app-page-fallback">
            <span className="spinner spinner-md" />
        </div>
    );
}

function LazyPage({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary inline>
            <Suspense fallback={<PageFallback />}>{children}</Suspense>
        </ErrorBoundary>
    );
}

function getWsUrl(ticket: string | null): string | null {
    if (!ticket) return null;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = String((import.meta as any).env?.VITE_WS_HOST || '').trim() || window.location.host;
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
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.altKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (isMobile) {
                    setSidebarOpen((current) => !current);
                } else {
                    setSidebarCollapsed((current) => !current);
                }
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [isMobile]);

    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            try {
                const res = await api.get('/auth/bootstrap', {
                    params: { profile: 'shell' },
                });
                if (cancelled) return;
                applyAppBootstrapSnapshots(res.data?.obj || {});
            } catch (error: any) {
                console.error('Failed to load app bootstrap:', error?.response?.data || error?.message || error);
            }
        }, 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [token]);

    useEffect(() => {
        if (!isAdmin || !token) return undefined;
        const preloadAdminWorkspaces = () => {
            loadUsersHubPage().catch(() => {});
            loadInboundsPage().catch(() => {});
        };
        if (typeof (window as any).requestIdleCallback === 'function') {
            const idleId = (window as any).requestIdleCallback(preloadAdminWorkspaces, { timeout: 2500 });
            return () => (window as any).cancelIdleCallback?.(idleId);
        }
        const timer = window.setTimeout(preloadAdminWorkspaces, 1200);
        return () => window.clearTimeout(timer);
    }, [isAdmin, token]);

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
        } catch (error: any) {
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
    const handleCloseSidebar = useCallback(() => setSidebarOpen(false), []);
    const handleToggleSidebar = useCallback(() => {
        if (isMobile) {
            setSidebarOpen((current) => !current);
            return;
        }
        setSidebarCollapsed((current) => !current);
    }, [isMobile]);

    return (
        <ServerProvider enabled={isAdmin}>
        <NotificationProvider enabled={isAdmin} wsLastMessage={isAdmin ? rootWsLastMessage : null}>
            <div className="app-layout">
                {isMobile && !sidebarOpen && (
                    <button
                        type="button"
                        className="mobile-menu-btn"
                        onClick={() => setSidebarOpen(true)}
                        aria-label="Open menu"
                    >
                        <HiOutlineBars3 style={{ width: '22px', height: '22px' }} />
                    </button>
                )}
                <div
                    className={`sidebar-backdrop ${sidebarOpen ? 'show' : ''}`}
                    onClick={handleCloseSidebar}
                    aria-hidden="true"
                />
                <Suspense fallback={null}>
                    <Sidebar
                        collapsed={effectiveCollapsed}
                        open={sidebarOpen}
                        isMobile={isMobile}
                        onClose={handleCloseSidebar}
                        onToggle={handleToggleSidebar}
                    />
                </Suspense>
                <main className={`main-content ${effectiveCollapsed ? 'collapsed' : ''}`}>
                    <div className="main-scroll-region">
                        <Routes>
                            <Route path="/" element={isAdmin ? <LazyPage><Dashboard /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/inbounds" element={isAdmin ? <LazyPage><Inbounds /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/clients" element={isAdmin ? <LazyPage><UsersHub /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/clients/:userId" element={isAdmin ? <LazyPage><UserDetail /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/users" element={isAdmin ? <Navigate to="/clients" replace /> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/users/:userId" element={isAdmin ? <Navigate to="/clients" replace /> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/subscriptions" element={<LazyPage><Subscriptions /></LazyPage>} />
                            <Route path="/downloads" element={isAdmin ? <Navigate to="/subscriptions" replace /> : <LazyPage><DownloadsCenter /></LazyPage>} />
                            <Route path="/account" element={<LazyPage><AccountCenter /></LazyPage>} />
                            <Route path="/logs" element={isAdmin ? <LazyPage><Logs /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/server" element={isAdmin ? <Navigate to="/settings?tab=console" replace /> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/tools" element={isAdmin ? <LazyPage><Tools /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/capabilities" element={isAdmin ? <LazyPage><Capabilities /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/xray" element={isAdmin ? <LazyPage><XrayConsole /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/tasks" element={isAdmin ? <Navigate to="/audit" replace /> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/audit" element={isAdmin ? <LazyPage><AuditCenter /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/servers" element={isAdmin ? <LazyPage><Servers /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/servers/:serverId" element={isAdmin ? <LazyPage><ServerDetail /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="/accounts" element={isAdmin ? <Navigate to="/clients" replace /> : <Navigate to="/account" replace />} />
                            <Route path="/settings" element={isAdmin ? <LazyPage><SystemSettings /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                            <Route path="*" element={<Navigate to={isAdmin ? '/' : '/subscriptions'} replace />} />
                        </Routes>
                    </div>
                    {isMobile ? <MobileBottomNav onOpenMenu={() => setSidebarOpen(true)} /> : null}
                </main>
                {isAdmin ? <SecurityBootstrapWizard /> : null}
                <CommandPalette />
            </div>
        </NotificationProvider>
        </ServerProvider>
    );
}

export default function App() {
    const { isAuthenticated, loading } = useAuth();
    const isMobile = useMediaQuery('(max-width: 768px)');

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
                <span className="spinner" style={{ width: '32px', height: '32px' }} />
            </div>
        );
    }

    return (
        <ErrorBoundary>
        <ThemeProvider>
            <Toaster
                position={isMobile ? 'bottom-center' : 'top-right'}
                containerStyle={isMobile ? {
                    bottom: 'calc(var(--mobile-bottom-nav-height, 78px) + env(safe-area-inset-bottom, 0px) + 14px)',
                    left: '12px',
                    right: '12px',
                } : {
                    // Keep desktop toasts below the fixed header so they never
                    // cover the search box / language toggle / notification bell.
                    top: 'calc(var(--header-height, 68px) + 12px)',
                }}
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
