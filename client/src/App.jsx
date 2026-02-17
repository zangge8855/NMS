import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import { ServerProvider } from './contexts/ServerContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { Toaster } from 'react-hot-toast';
import { HiOutlineBars3 } from 'react-icons/hi2';

const Login = lazy(() => import('./components/Login/Login.jsx'));
const Sidebar = lazy(() => import('./components/Layout/Sidebar.jsx'));
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard.jsx'));
const Inbounds = lazy(() => import('./components/Inbounds/Inbounds.jsx'));
const UsersHub = lazy(() => import('./components/Users/UsersHub.jsx'));
const Subscriptions = lazy(() => import('./components/Subscriptions/Subscriptions.jsx'));
const Logs = lazy(() => import('./components/Logs/Logs.jsx'));
const ServerManagement = lazy(() => import('./components/Server/Server.jsx'));
const Tools = lazy(() => import('./components/Tools/Tools.jsx'));
const Servers = lazy(() => import('./components/Servers/Servers.jsx'));
const Capabilities = lazy(() => import('./components/Capabilities/Capabilities.jsx'));
const Tasks = lazy(() => import('./components/Tasks/Tasks.jsx'));
const AuditCenter = lazy(() => import('./components/Audit/AuditCenter.jsx'));
const SystemSettings = lazy(() => import('./components/System/SystemSettings.jsx'));


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

function ProtectedLayout() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(
        typeof window !== 'undefined' ? window.innerWidth <= 1024 : false
    );

    useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth <= 1024;
            setIsMobile(mobile);
            if (!mobile) {
                setSidebarOpen(false);
            }
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const effectiveCollapsed = isMobile ? false : sidebarCollapsed;

    return (
        <ServerProvider>
            <div className="app-layout">
                <div
                    className={`sidebar-backdrop ${sidebarOpen ? 'show' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                />
                <Suspense fallback={null}>
                    <Sidebar
                        collapsed={effectiveCollapsed}
                        open={sidebarOpen}
                        onClose={() => setSidebarOpen(false)}
                        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                    />
                </Suspense>
                <main className={`main-content ${effectiveCollapsed ? 'collapsed' : ''}`}>
                    <button
                        className="mobile-menu-btn"
                        onClick={() => setSidebarOpen(true)}
                        aria-label="Open menu"
                    >
                        <HiOutlineBars3 />
                    </button>
                    <Routes>
                        <Route path="/" element={isAdmin ? <LazyPage><Dashboard /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/inbounds" element={isAdmin ? <LazyPage><Inbounds /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/clients" element={isAdmin ? <LazyPage><UsersHub /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/subscriptions" element={<LazyPage><Subscriptions /></LazyPage>} />
                        <Route path="/logs" element={isAdmin ? <LazyPage><Logs /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/server" element={isAdmin ? <LazyPage><ServerManagement /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/tools" element={isAdmin ? <LazyPage><Tools /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/capabilities" element={isAdmin ? <LazyPage><Capabilities /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/tasks" element={isAdmin ? <LazyPage><Tasks /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/audit" element={isAdmin ? <LazyPage><AuditCenter /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/servers" element={isAdmin ? <LazyPage><Servers /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/accounts" element={isAdmin ? <Navigate to="/clients" replace /> : <Navigate to="/subscriptions" replace />} />
                        <Route path="/settings" element={isAdmin ? <LazyPage><SystemSettings /></LazyPage> : <Navigate to="/subscriptions" replace />} />
                        <Route path="*" element={<Navigate to={isAdmin ? '/' : '/subscriptions'} replace />} />
                    </Routes>
                </main>
            </div>
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
    );
}
