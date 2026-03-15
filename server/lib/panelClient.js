import axios from 'axios';
import serverStore from '../store/serverStore.js';

export function createPanelAuthError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    error.isPanelAuthError = true;
    if (cause) error.cause = cause;
    return error;
}

function createPanelCompatibilityError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    error.isPanelCompatibilityError = true;
    if (cause) error.cause = cause;
    return error;
}

export function normalizePanelErrorMessage(error, fallback = 'Panel request failed') {
    return String(
        error?.response?.data?.msg
        || error?.message
        || fallback
    ).trim();
}

export function isUnsupportedPanelStatusError(error) {
    const status = Number(error?.response?.status || 0);
    if ([404, 405, 410, 501].includes(status)) return true;
    const message = normalizePanelErrorMessage(error, '').toLowerCase();
    return message.includes('method not allowed')
        || message.includes('not found')
        || message.includes('unsupported')
        || message.includes('not support')
        || message.includes('not implemented');
}

export function derivePanelHealthFromStatus(statusPayload) {
    const xrayState = String(statusPayload?.obj?.xray?.state || '').trim().toLowerCase();
    if (!xrayState || xrayState === 'running') {
        return {
            health: 'healthy',
            reasonCode: 'none',
            reasonMessage: '',
            retryable: false,
        };
    }
    return {
        health: 'degraded',
        reasonCode: 'xray_not_running',
        reasonMessage: String(statusPayload?.obj?.xray?.errorMsg || `xray=${xrayState}`).trim(),
        retryable: true,
    };
}

export function classifyPanelError(error, options = {}) {
    const message = normalizePanelErrorMessage(error, 'Panel request failed');
    const lower = message.toLowerCase();
    const code = String(error?.code || '').trim();
    const status = Number(error?.response?.status || 0);
    const context = String(options.context || '').trim();

    if (code === 'PANEL_CREDENTIAL_MISSING') {
        return {
            reasonCode: 'credentials_missing',
            reasonMessage: message || 'Panel credentials are missing.',
            retryable: false,
            health: 'degraded',
        };
    }

    if (code === 'PANEL_CREDENTIAL_UNREADABLE') {
        return {
            reasonCode: 'credentials_unreadable',
            reasonMessage: message || 'Stored panel credentials cannot be decrypted.',
            retryable: false,
            health: 'degraded',
        };
    }

    if (code === 'PANEL_LOGIN_FAILED' || status === 401 || status === 403) {
        return {
            reasonCode: 'auth_failed',
            reasonMessage: message,
            retryable: false,
            health: 'degraded',
        };
    }

    if (code === 'PANEL_STATUS_UNSUPPORTED' || (context === 'server_status' && isUnsupportedPanelStatusError(error))) {
        return {
            reasonCode: 'status_unsupported',
            reasonMessage: message || 'This 3x-ui build does not expose a compatible server status endpoint.',
            retryable: false,
            health: 'degraded',
        };
    }

    if (
        ['ENOTFOUND', 'EAI_AGAIN'].includes(code)
        || lower.includes('enotfound')
        || lower.includes('getaddrinfo')
        || lower.includes('dns')
    ) {
        return {
            reasonCode: 'dns_error',
            reasonMessage: message,
            retryable: true,
            health: 'unreachable',
        };
    }

    if (
        ['ECONNABORTED', 'ETIMEDOUT'].includes(code)
        || lower.includes('timeout')
        || lower.includes('timed out')
    ) {
        return {
            reasonCode: 'connect_timeout',
            reasonMessage: message,
            retryable: true,
            health: 'unreachable',
        };
    }

    if (
        code === 'ECONNREFUSED'
        || lower.includes('econnrefused')
        || lower.includes('connection refused')
    ) {
        return {
            reasonCode: 'connection_refused',
            reasonMessage: message,
            retryable: true,
            health: 'unreachable',
        };
    }

    if (
        ['ERR_NETWORK', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code)
        || lower.includes('network error')
        || lower.includes('socket hang up')
        || lower.includes('ehostunreach')
        || lower.includes('network is unreachable')
    ) {
        return {
            reasonCode: 'network_error',
            reasonMessage: message,
            retryable: true,
            health: 'unreachable',
        };
    }

    return {
        reasonCode: 'panel_request_failed',
        reasonMessage: message,
        retryable: true,
        health: 'degraded',
    };
}

export async function fetchPanelServerStatus(client) {
    let getError = null;
    try {
        return await client.get('/panel/api/server/status');
    } catch (error) {
        getError = error;
    }

    try {
        return await client.post('/panel/api/server/status');
    } catch (postError) {
        const getUnsupported = isUnsupportedPanelStatusError(getError);
        const postUnsupported = isUnsupportedPanelStatusError(postError);

        if (getUnsupported && postUnsupported) {
            throw createPanelCompatibilityError(
                'PANEL_STATUS_UNSUPPORTED',
                'Panel status endpoint is not supported by this 3x-ui build.',
                postError
            );
        }

        if (postUnsupported && !getUnsupported) {
            throw getError;
        }

        if (!postUnsupported) {
            throw postError;
        }

        throw getError || postError;
    }
}

/**
 * Create an axios instance configured for a specific 3x-ui panel server.
 * Handles session cookie management automatically.
 */
export async function createPanelClient(serverId, options = {}) {
    const storedServer = serverStore.getById(serverId);
    if (!storedServer) {
        throw new Error('Server not found');
    }
    const server = {
        ...storedServer,
        username: options.username !== undefined ? String(options.username || '').trim() : storedServer.username,
        password: options.password !== undefined ? String(options.password || '') : storedServer.password,
    };

    const baseURL = `${server.url}${server.basePath === '/' ? '' : server.basePath}`;

    const client = axios.create({
        baseURL,
        timeout: 30000,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });

    // Attach session cookie if available
    const sessionCookie = serverStore.getSession(serverId);
    if (sessionCookie) {
        client.defaults.headers.Cookie = sessionCookie;
    }

    // Intercept responses to capture Set-Cookie headers
    client.interceptors.response.use(
        (response) => {
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                const sessionStr = setCookie
                    .map(c => c.split(';')[0])
                    .join('; ');
                serverStore.setSession(serverId, sessionStr);
                client.defaults.headers.Cookie = sessionStr;
            }
            return response;
        },
        (error) => {
            // If 401, clear session
            if (error.response && error.response.status === 401) {
                serverStore.clearSession(serverId);
            }
            return Promise.reject(error);
        }
    );

    return { client, server, baseURL };
}

/**
 * Ensure authenticated session with the panel.
 * Logs in if no session exists.
 */
export async function ensureAuthenticated(serverId, options = {}) {
    const forceLogin = options?.forceLogin === true;
    const { client, server } = await createPanelClient(serverId, options);

    // Check if current session is valid by trying to get status
    const existingSession = serverStore.getSession(serverId);
    if (existingSession && !forceLogin) {
        try {
            const res = await fetchPanelServerStatus(client);
            if (res.data && res.data.success !== false) {
                return client;
            }
        } catch (e) {
            // Session expired, proceed to login
        }
    }

    if (!String(server.username || '').trim()) {
        throw createPanelAuthError(
            'PANEL_CREDENTIAL_MISSING',
            'Panel username is missing, please update server credentials.'
        );
    }
    if (!String(server.password || '').trim()) {
        const reason = server.credentialUnreadable
            ? 'Stored panel credentials cannot be decrypted, please re-enter and save credentials.'
            : 'Panel password is missing, please update server credentials.';
        throw createPanelAuthError(
            server.credentialUnreadable ? 'PANEL_CREDENTIAL_UNREADABLE' : 'PANEL_CREDENTIAL_MISSING',
            reason
        );
    }

    // Login
    try {
        const loginRes = await client.post('/login', `username=${encodeURIComponent(server.username)}&password=${encodeURIComponent(server.password)}`);
        if (loginRes.data && loginRes.data.success) {
            return client;
        }
        throw createPanelAuthError('PANEL_LOGIN_FAILED', loginRes.data?.msg || 'Login failed');
    } catch (e) {
        serverStore.clearSession(serverId);
        if (e?.isPanelAuthError) {
            throw e;
        }
        const panelMessage = e?.response?.data?.msg || e?.message || 'Login failed';
        if ([401, 403].includes(Number(e?.response?.status || 0))) {
            throw createPanelAuthError('PANEL_LOGIN_FAILED', panelMessage, e);
        }
        const requestError = new Error(`Failed to authenticate with panel: ${panelMessage}`);
        requestError.code = e?.code;
        requestError.response = e?.response;
        requestError.request = e?.request;
        requestError.cause = e;
        throw requestError;
    }
}
