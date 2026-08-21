import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { LanguageProvider } from './contexts/LanguageContext';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './index.css';
import './styles/restrained-ui.css';
import './styles/overlay-restore.css';
import './styles/flagship-console.css';
import { resolveSiteBasePath } from './utils/sitePath';

// Gracefully handle dynamic import chunk failures after new deployments
if (typeof window !== 'undefined') {
    window.addEventListener('vite:preloadError', (event) => {
        const key = 'nms_vite_preload_reload_attempt';
        const lastReload = Number(sessionStorage.getItem(key) || 0);
        if (Date.now() - lastReload > 10_000) {
            sessionStorage.setItem(key, String(Date.now()));
            window.location.reload();
        }
    });
}

const siteBasePath = resolveSiteBasePath();

const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
            <BrowserRouter
                basename={siteBasePath}
                future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            >
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
}
