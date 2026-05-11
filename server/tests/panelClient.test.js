import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DATA_DIR = '/tmp/nms-panel-client-test';

const { ensureAuthenticated } = await import('../lib/panelClient.js');
const { default: serverStore } = await import('../store/serverStore.js');

function parseCookies(header = '') {
    const cookies = {};
    String(header || '').split(';').forEach((part) => {
        const [rawName, ...rawValue] = part.trim().split('=');
        if (!rawName) return;
        cookies[rawName] = rawValue.join('=');
    });
    return cookies;
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, statusCode, payload, headers = {}) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        ...headers,
    });
    res.end(JSON.stringify(payload));
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function startFakePanel(options = {}) {
    const requireCsrf = options.requireCsrf !== false;
    const credentials = options.credentials || { username: 'admin', password: 'secret' };
    const state = {
        nextSession: 0,
        sessions: new Map(),
        calls: [],
    };

    function createSession(loggedIn = false) {
        state.nextSession += 1;
        const sid = `sid-${state.nextSession}`;
        state.sessions.set(sid, {
            csrf: `csrf-${state.nextSession}`,
            loggedIn,
        });
        return sid;
    }

    function resolveSession(req) {
        const sid = parseCookies(req.headers.cookie)['3x-ui'];
        if (!sid || !state.sessions.has(sid)) return null;
        return {
            sid,
            session: state.sessions.get(sid),
        };
    }

    function ensureRequestSession(req) {
        const existing = resolveSession(req);
        if (existing) return existing;
        const sid = createSession(false);
        return {
            sid,
            session: state.sessions.get(sid),
        };
    }

    function hasValidCsrf(req, session) {
        if (!requireCsrf) return true;
        return String(req.headers['x-csrf-token'] || '') === session?.csrf;
    }

    const initialSessionId = options.initialLoggedIn ? createSession(true) : '';

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const route = `${req.method} ${url.pathname}`;
        state.calls.push(route);

        if (url.pathname === '/csrf-token') {
            if (options.legacyCsrf === true) {
                return sendJson(res, 404, { success: false, msg: 'not found' });
            }
            const { sid, session } = ensureRequestSession(req);
            return sendJson(res, 200, { success: true, obj: session.csrf }, {
                'Set-Cookie': `3x-ui=${sid}; Path=/; HttpOnly`,
            });
        }

        if (url.pathname === '/panel/csrf-token') {
            if (options.legacyCsrf === true) {
                return sendJson(res, 404, { success: false, msg: 'not found' });
            }
            const resolved = resolveSession(req);
            if (!resolved?.session?.loggedIn) {
                return sendJson(res, 401, { success: false, msg: 'login required' });
            }
            return sendJson(res, 200, { success: true, obj: resolved.session.csrf });
        }

        if (url.pathname === '/login' && req.method === 'POST') {
            const resolved = ensureRequestSession(req);
            if (!hasValidCsrf(req, resolved.session)) {
                return sendJson(res, 403, { success: false, msg: 'csrf token invalid' });
            }

            const form = new URLSearchParams(await readBody(req));
            if (
                form.get('username') !== credentials.username
                || form.get('password') !== credentials.password
            ) {
                return sendJson(res, 200, {
                    success: false,
                    msg: 'wrong username or password',
                });
            }

            resolved.session.loggedIn = true;
            return sendJson(res, 200, { success: true, msg: 'logged in' }, {
                'Set-Cookie': `3x-ui=${resolved.sid}; Path=/; HttpOnly`,
            });
        }

        if (url.pathname === '/panel/api/server/status') {
            const resolved = resolveSession(req);
            if (!resolved?.session?.loggedIn) {
                return sendJson(res, 401, { success: false, msg: 'login required' });
            }
            if (req.method !== 'GET' && !hasValidCsrf(req, resolved.session)) {
                return sendJson(res, 403, { success: false, msg: 'csrf token invalid' });
            }
            return sendJson(res, 200, {
                success: true,
                obj: {
                    xray: {
                        state: 'running',
                        errorMsg: '',
                    },
                },
            });
        }

        if (url.pathname === '/panel/api/inbounds/addClient' && req.method === 'POST') {
            const resolved = resolveSession(req);
            if (!resolved?.session?.loggedIn) {
                return sendJson(res, 401, { success: false, msg: 'login required' });
            }
            if (!hasValidCsrf(req, resolved.session)) {
                return sendJson(res, 403, { success: false, msg: 'csrf token invalid' });
            }
            await readBody(req);
            return sendJson(res, 200, { success: true, obj: null });
        }

        return sendJson(res, 404, { success: false, msg: 'not found' });
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();

    return {
        url: `http://127.0.0.1:${address.port}`,
        calls: state.calls,
        initialSessionId,
        close: () => closeServer(server),
    };
}

function mockPanelServerStore(t, serverConfig, initialSession = '') {
    const sessions = new Map();
    if (initialSession) {
        sessions.set(serverConfig.id, initialSession);
    }

    t.mock.method(serverStore, 'getById', (id) => {
        if (id !== serverConfig.id) return null;
        return {
            id: serverConfig.id,
            name: 'Test panel',
            url: serverConfig.url,
            basePath: '/',
            username: serverConfig.username || 'admin',
            password: serverConfig.password || 'secret',
            credentialStatus: 'configured',
            credentialUnreadable: false,
        };
    });
    t.mock.method(serverStore, 'getSession', (id) => sessions.get(id) || null);
    t.mock.method(serverStore, 'setSession', (id, cookie) => {
        sessions.set(id, cookie);
    });
    t.mock.method(serverStore, 'clearSession', (id) => {
        sessions.delete(id);
    });

    return sessions;
}

test('ensureAuthenticated logs into 3x-ui v3 panels with CSRF protection', async (t) => {
    const panel = await startFakePanel();
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-csrf-login',
        url: panel.url,
    });

    const client = await ensureAuthenticated('srv-csrf-login');
    const res = await client.post('/panel/api/inbounds/addClient', 'id=1');

    assert.equal(res.data.success, true);
    assert.deepEqual(panel.calls.slice(0, 3), [
        'GET /csrf-token',
        'POST /login',
        'GET /panel/csrf-token',
    ]);
    assert.ok(panel.calls.includes('POST /panel/api/inbounds/addClient'));
});

test('ensureAuthenticated keeps legacy 3x-ui login compatibility when CSRF endpoints are absent', async (t) => {
    const panel = await startFakePanel({
        requireCsrf: false,
        legacyCsrf: true,
    });
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-legacy-login',
        url: panel.url,
    });

    const client = await ensureAuthenticated('srv-legacy-login');
    const status = await client.get('/panel/api/server/status');

    assert.equal(status.data.success, true);
    assert.ok(panel.calls.includes('GET /csrf-token'));
    assert.ok(panel.calls.includes('POST /login'));
});

test('ensureAuthenticated refreshes CSRF token for an existing logged-in session', async (t) => {
    const panel = await startFakePanel({ initialLoggedIn: true });
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-existing-session',
        url: panel.url,
    }, `3x-ui=${panel.initialSessionId}`);

    const client = await ensureAuthenticated('srv-existing-session');
    const res = await client.post('/panel/api/inbounds/addClient', 'id=1');

    assert.equal(res.data.success, true);
    assert.ok(panel.calls.includes('GET /panel/csrf-token'));
    assert.ok(panel.calls.includes('GET /panel/api/server/status'));
    assert.equal(panel.calls.includes('POST /login'), false);
});

test('ensureAuthenticated still reports invalid panel credentials as auth failures', async (t) => {
    const panel = await startFakePanel();
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-bad-password',
        url: panel.url,
        password: 'wrong-password',
    });

    await assert.rejects(
        () => ensureAuthenticated('srv-bad-password'),
        (error) => {
            assert.equal(error.code, 'PANEL_LOGIN_FAILED');
            assert.match(error.message, /wrong username or password/);
            return true;
        }
    );
});
