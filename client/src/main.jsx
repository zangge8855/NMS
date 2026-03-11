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

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter>
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
