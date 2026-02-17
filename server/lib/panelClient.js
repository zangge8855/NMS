import axios from 'axios';
import serverStore from '../store/serverStore.js';

function createPanelAuthError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    error.isPanelAuthError = true;
    if (cause) error.cause = cause;
    return error;
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
            const res = await client.get('/panel/api/server/status');
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
        if (e?.response?.status === 401) {
            throw createPanelAuthError('PANEL_LOGIN_FAILED', panelMessage, e);
        }
        throw new Error(`Failed to authenticate with panel: ${panelMessage}`);
    }
}
