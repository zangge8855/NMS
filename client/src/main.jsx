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
import './styles/module-density.css';
import './styles/experience-upgrade.css';
import { resolveSiteBasePath } from './utils/sitePath.js';

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
