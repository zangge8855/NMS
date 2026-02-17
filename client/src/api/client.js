import axios from 'axios';

const TOKEN_KEY = 'nms_token';
const LEGACY_TOKEN_KEY = 'xui_token';

function readLegacyToken() {
    const legacySessionValue = sessionStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacySessionValue) {
        sessionStorage.setItem(TOKEN_KEY, legacySessionValue);
        sessionStorage.removeItem(LEGACY_TOKEN_KEY);
        localStorage.removeItem(LEGACY_TOKEN_KEY);
        return legacySessionValue;
    }

    const legacyLocalValue = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacyLocalValue) {
        sessionStorage.setItem(TOKEN_KEY, legacyLocalValue);
        localStorage.removeItem(LEGACY_TOKEN_KEY);
        return legacyLocalValue;
    }

    return '';
}

export function getStoredToken() {
    const sessionValue = sessionStorage.getItem(TOKEN_KEY);
    if (sessionValue) return sessionValue;

    const legacyValue = localStorage.getItem(TOKEN_KEY);
    if (legacyValue) {
        sessionStorage.setItem(TOKEN_KEY, legacyValue);
        localStorage.removeItem(TOKEN_KEY);
    }
    if (legacyValue) return legacyValue;

    return readLegacyToken();
}

export function setStoredToken(token) {
    if (!token) return;
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function clearStoredToken() {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
}

const api = axios.create({
    baseURL: '/api',
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
    },
});

function shouldClearSessionOnUnauthorized(error) {
    if (error?.response?.status !== 401) return false;

    const requestUrl = String(error?.config?.url || '').trim();
    const errorCode = String(error?.response?.data?.code || '').trim();

    // Panel-side auth failures (3x-ui login/session) should not force logout NMS JWT.
    if (requestUrl.startsWith('/panel/') || errorCode.startsWith('PANEL_')) {
        return false;
    }

    return true;
}

// Request interceptor: attach JWT token
api.interceptors.request.use((config) => {
    const token = getStoredToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor: handle 401
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (shouldClearSessionOnUnauthorized(error)) {
            clearStoredToken();
            // Don't redirect if already on login
            if (!window.location.pathname.includes('/login')) {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

export default api;
