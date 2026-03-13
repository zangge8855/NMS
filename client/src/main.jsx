import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ConfirmProvider } from './contexts/ConfirmContext.jsx';
import { LanguageProvider } from './contexts/LanguageContext.jsx';
import './index.css';
import './styles/ui-tokens.css';
import './styles/layout-polish.css';
import './styles/interaction-polish.css';

function resolveSiteBasePath() {
    if (typeof window === 'undefined') return '/';
    const raw = String(window.__NMS_SITE_BASE_PATH__ || '/').trim();
    if (!raw || /[\s?#]/.test(raw)) return '/';
    const segments = raw
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean);
    if (segments.some((item) => item === '.' || item === '..')) return '/';
    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

const siteBasePath = resolveSiteBasePath();

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter basename={siteBasePath}>
            <LanguageProvider>
                <AuthProvider>
                    <ConfirmProvider>
                        <App />
                    </ConfirmProvider>
                </AuthProvider>
            </LanguageProvider>
        </BrowserRouter>
    </React.StrictMode>
);
