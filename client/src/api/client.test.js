import {
    clearStoredToken,
    getStoredToken,
    setStoredToken,
    shouldClearSessionOnUnauthorized,
} from './client.js';

describe('api client token storage', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    it('migrates the legacy session token into the current key', () => {
        sessionStorage.setItem('xui_token', 'legacy-session-token');

        expect(getStoredToken()).toBe('legacy-session-token');
        expect(sessionStorage.getItem('nms_token')).toBe('legacy-session-token');
        expect(sessionStorage.getItem('xui_token')).toBeNull();
    });

    it('moves the current local token into session storage', () => {
        localStorage.setItem('nms_token', 'legacy-local-token');

        expect(getStoredToken()).toBe('legacy-local-token');
        expect(sessionStorage.getItem('nms_token')).toBe('legacy-local-token');
        expect(localStorage.getItem('nms_token')).toBeNull();
    });

    it('writes and clears the current token consistently', () => {
        setStoredToken('current-token');
        expect(sessionStorage.getItem('nms_token')).toBe('current-token');

        clearStoredToken();
        expect(sessionStorage.getItem('nms_token')).toBeNull();
        expect(localStorage.getItem('nms_token')).toBeNull();
    });
});

describe('api client unauthorized handling', () => {
    it('does not clear the session for 3x-ui panel auth failures', () => {
        const error = {
            response: { status: 401, data: {} },
            config: { url: '/panel/server-a/panel/api/server/log' },
        };

        expect(shouldClearSessionOnUnauthorized(error)).toBe(false);
    });

    it('does not clear the session for explicit panel error codes', () => {
        const error = {
            response: {
                status: 401,
                data: { code: 'PANEL_SESSION_EXPIRED' },
            },
            config: { url: '/servers' },
        };

        expect(shouldClearSessionOnUnauthorized(error)).toBe(false);
    });

    it('clears the session for regular NMS 401 responses', () => {
        const error = {
            response: { status: 401, data: {} },
            config: { url: '/subscriptions/access' },
        };

        expect(shouldClearSessionOnUnauthorized(error)).toBe(true);
    });
});
