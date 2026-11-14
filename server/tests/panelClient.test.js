import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DATA_DIR = path.join(os.tmpdir(), `nms-panel-client-test-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = TEST_DATA_DIR;

after(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
});

const { ensureAuthenticated, createPanelClient } = await import('../lib/panelClient.js');
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
    const apiToken = String(options.apiToken || '').trim();
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

    function hasValidApiToken(req) {
        if (!apiToken) return false;
        return String(req.headers.authorization || '') === `Bearer ${apiToken}`;
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
            if (options.preLoginCsrfRequiresAuth === true) {
                return sendJson(res, 401, { success: false, msg: 'login required' });
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
            if (options.statusGetUnsupported === true && req.method === 'GET') {
                return sendJson(res, 404, { success: false, msg: 'not found' });
            }
            if (hasValidApiToken(req)) {
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
            if (hasValidApiToken(req)) {
                await readBody(req);
                return sendJson(res, 200, { success: true, obj: null });
            }
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
            apiToken: serverConfig.apiToken || '',
            credentialStatus: 'configured',
            credentialUnreadable: false,
            apiTokenUnreadable: false,
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

test('ensureAuthenticated uses 3x-ui API token without login or CSRF bootstrap', async (t) => {
    const panel = await startFakePanel({ apiToken: 'panel-token-123' });
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-api-token',
        url: panel.url,
        username: '',
        password: '',
        apiToken: 'panel-token-123',
    });

    const client = await ensureAuthenticated('srv-api-token');
    const res = await client.post('/panel/api/inbounds/addClient', 'id=1');

    assert.equal(res.data.success, true);
    assert.deepEqual(panel.calls.slice(0, 2), [
        'GET /panel/api/server/status',
        'POST /panel/api/inbounds/addClient',
    ]);
    assert.equal(panel.calls.includes('GET /csrf-token'), false);
    assert.equal(panel.calls.includes('POST /login'), false);
});

test('ensureAuthenticated API token path uses the shared status compatibility fallback', async (t) => {
    const panel = await startFakePanel({
        apiToken: 'panel-token-456',
        statusGetUnsupported: true,
    });
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-api-token-post-status',
        url: panel.url,
        username: '',
        password: '',
        apiToken: 'panel-token-456',
    });

    const client = await ensureAuthenticated('srv-api-token-post-status');
    const res = await client.post('/panel/api/inbounds/addClient', 'id=1');

    assert.equal(res.data.success, true);
    assert.deepEqual(panel.calls.slice(0, 3), [
        'GET /panel/api/server/status',
        'POST /panel/api/server/status',
        'POST /panel/api/inbounds/addClient',
    ]);
    assert.equal(panel.calls.includes('POST /login'), false);
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

test('ensureAuthenticated keeps login compatibility when pre-login CSRF probing requires auth', async (t) => {
    const panel = await startFakePanel({
        preLoginCsrfRequiresAuth: true,
        requireCsrf: false,
    });
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-auth-gated-csrf-login',
        url: panel.url,
    });

    const client = await ensureAuthenticated('srv-auth-gated-csrf-login');
    const res = await client.post('/panel/api/inbounds/addClient', 'id=1');

    assert.equal(res.data.success, true);
    assert.deepEqual(panel.calls.slice(0, 3), [
        'GET /csrf-token',
        'POST /login',
        'GET /panel/csrf-token',
    ]);
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

test('ensureAuthenticated reports invalid panel API token as auth failure', async (t) => {
    const panel = await startFakePanel({ apiToken: 'valid-panel-token' });
    t.after(panel.close);

    mockPanelServerStore(t, {
        id: 'srv-bad-token',
        url: panel.url,
        username: '',
        password: '',
        apiToken: 'wrong-panel-token',
    });

    await assert.rejects(
        () => ensureAuthenticated('srv-bad-token'),
        (error) => {
            assert.equal(error.code, 'PANEL_LOGIN_FAILED');
            assert.match(error.message, /login required|API token/i);
            return true;
        }
    );
});

test('ensureAuthenticated preserves stored session when manual credential overrides fail', async (t) => {
    const panel = await startFakePanel();
    t.after(panel.close);

    const sessions = mockPanelServerStore(t, {
        id: 'srv-preserve-session',
        url: panel.url,
    }, '3x-ui=kept-sid');

    await assert.rejects(
        () => ensureAuthenticated('srv-preserve-session', {
            username: 'admin',
            password: 'wrong-override-password',
            forceLogin: true,
        }),
        (error) => error.code === 'PANEL_LOGIN_FAILED'
    );

    assert.equal(sessions.get('srv-preserve-session'), '3x-ui=kept-sid');
});

test('createPanelClient merges Set-Cookie headers by name and disables automatic redirects', async (t) => {
    const observedCookies = [];
    const server = http.createServer((req, res) => {
        observedCookies.push(req.headers.cookie || '');
        if (req.url === '/step1') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': ['3x-ui=sid-primary; Path=/; HttpOnly'],
            });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        if (req.url === '/step2') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': ['lang=en-US; Path=/'],
            });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        if (req.url === '/redirect') {
            res.writeHead(302, { Location: '/step1' });
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => closeServer(server));

    const address = server.address();
    const sessions = mockPanelServerStore(t, {
        id: 'srv-cookie-merge',
        url: `http://127.0.0.1:${address.port}`,
    });

    const { client } = await createPanelClient('srv-cookie-merge');
    assert.equal(client.defaults.maxRedirects, 0);

    await client.get('/step1');
    await client.get('/step2');
    await client.get('/step3');

    assert.equal(sessions.get('srv-cookie-merge'), '3x-ui=sid-primary; lang=en-US');
    assert.match(observedCookies[2], /3x-ui=sid-primary/);
    assert.match(observedCookies[2], /lang=en-US/);

    await assert.rejects(() => client.get('/redirect'));
});
