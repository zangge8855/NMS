/**
 * In-memory stand-in for an s-ui (alireza0/s-ui) panel.
 *
 * It mirrors the parts of the s-ui API NMS relies on: `/api` with a session
 * cookie, `/apiv2` with a `Token` header, the {success,msg,obj} envelope with
 * HTTP 200 business errors, LoadPartialData answers, and the client save
 * semantics (unique names, link regeneration, usage reset on up=down=0).
 * Used by the adapter tests and by the review harness.
 */
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';

const USER_TYPES = new Set([
    'mixed', 'socks', 'http', 'shadowsocks', 'vmess', 'trojan', 'naive', 'hysteria',
    'shadowtls', 'tuic', 'hysteria2', 'vless', 'anytls', 'snell',
]);
const LINK_TYPES = new Set([
    'socks', 'http', 'mixed', 'shadowsocks', 'naive', 'hysteria', 'hysteria2', 'anytls', 'tuic',
    'vless', 'trojan', 'vmess',
]);

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseJson(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function configKey(inbound) {
    if (inbound.type === 'shadowsocks' && inbound.method === '2022-blake3-aes-128-gcm') return 'shadowsocks16';
    return inbound.type;
}

function hostForUri(host) {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function buildLinks(client, inbound, tls, hostname) {
    if (!LINK_TYPES.has(inbound.type)) return [];
    const config = client.config || {};
    const remark = client.remark ? `${client.remark}-${inbound.tag}` : inbound.tag;
    const host = hostForUri(hostname);
    const port = inbound.listen_port;
    const fragment = `#${encodeURIComponent(remark)}`;
    const server = tls ? (tls.server || {}) : null;
    const tlsParams = [];
    if (server && server.enabled) {
        if (server.reality && server.reality.enabled) {
            tlsParams.push('security=reality', `pbk=${encodeURIComponent((tls.client?.reality?.public_key) || '')}`);
        } else {
            tlsParams.push('security=tls');
        }
        if (server.server_name) tlsParams.push(`sni=${encodeURIComponent(server.server_name)}`);
    }
    const transportType = inbound.transport?.type || 'tcp';
    const transportParams = [`type=${transportType}`];
    if (inbound.transport?.path) transportParams.push(`path=${encodeURIComponent(inbound.transport.path)}`);
    const query = (parts) => (parts.length ? `?${parts.join('&')}` : '');
    const user = (name, pass) => `${encodeURIComponent(name)}:${encodeURIComponent(pass)}`;
    switch (inbound.type) {
        case 'vless': {
            const params = [...transportParams, ...tlsParams];
            if (tlsParams.length && transportType === 'tcp' && config.vless?.flow) params.push(`flow=${config.vless.flow}`);
            return [`vless://${config.vless?.uuid}@${host}:${port}${query(params)}${fragment}`];
        }
        case 'vmess': {
            const obj = { v: '2', ps: remark, add: hostname, port: String(port), id: config.vmess?.uuid, aid: 0, net: transportType, tls: tlsParams.length ? 'tls' : 'none' };
            return [`vmess://${Buffer.from(JSON.stringify(obj)).toString('base64')}`];
        }
        case 'trojan':
            return [`trojan://${encodeURIComponent(config.trojan?.password || '')}@${host}:${port}${query([...transportParams, ...tlsParams])}${fragment}`];
        case 'shadowsocks': {
            const passwords = inbound.method.startsWith('2022') ? [inbound.password, config[configKey(inbound)]?.password] : [config.shadowsocks?.password];
            const userInfo = Buffer.from(`${inbound.method}:${passwords.join(':')}`).toString('base64url');
            return [`ss://${userInfo}@${host}:${port}${fragment}`];
        }
        case 'hysteria2':
            return [`hysteria2://${encodeURIComponent(config.hysteria2?.password || '')}@${host}:${port}${query([...tlsParams, 'fastopen=0'])}${fragment}`];
        case 'hysteria':
            return [`hysteria://${host}:${port}${query([`auth=${encodeURIComponent(config.hysteria?.auth_str || '')}`, ...tlsParams, 'fastopen=0'])}${fragment}`];
        case 'tuic':
            return [`tuic://${user(config.tuic?.uuid || '', config.tuic?.password || '')}@${host}:${port}${query([...tlsParams, 'congestion_control=bbr'])}${fragment}`];
        case 'anytls':
            return [`anytls://${encodeURIComponent(config.anytls?.password || '')}@${host}:${port}${query(tlsParams)}${fragment}`];
        case 'socks':
            return [`socks5://${user(config.socks?.username || '', config.socks?.password || '')}@${host}:${port}${fragment}`];
        case 'http':
            return [`${tlsParams.length ? 'https' : 'http'}://${user(config.http?.username || '', config.http?.password || '')}@${host}:${port}${fragment}`];
        case 'mixed':
            return [
                `socks5://${user(config.socks?.username || '', config.socks?.password || '')}@${host}:${port}${fragment}`,
                `http://${user(config.http?.username || '', config.http?.password || '')}@${host}:${port}${fragment}`,
            ];
        case 'naive':
            return [`naive+https://${user(config.naive?.username || '', config.naive?.password || '')}@${host}:${port}${query(['padding=1', ...tlsParams])}${fragment}`];
        default:
            return [];
    }
}

export function createFakeSuiState(seed = {}) {
    const state = {
        username: seed.username || 'admin',
        password: seed.password || 'admin',
        tokens: (seed.tokens || []).map((token, index) => ({ id: index + 1, desc: `token-${index + 1}`, expiry: 0, token })),
        inbounds: clone(seed.inbounds || []),
        clients: clone(seed.clients || []),
        tls: clone(seed.tls || []),
        onlines: clone(seed.onlines || { inbound: [], user: [], outbound: [] }),
        sessions: clone(seed.sessions || []),
        logs: clone(seed.logs || ['INFO sing-box started', 'INFO [vless-in] inbound connection']),
        running: seed.running !== false,
        maintenance: false,
        version: seed.version || '1.6.6',
        hostName: seed.hostName || 'sui-node',
        sessionIds: new Set(),
        calls: [],
        nextIds: { inbounds: 1, clients: 1, tls: 1 },
        importedDb: null,
        closedSessions: [],
        restarts: 0,
    };
    for (const kind of ['inbounds', 'clients', 'tls']) {
        const maxId = state[kind].reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
        state.nextIds[kind] = maxId + 1;
    }
    for (const client of state.clients) {
        client.links = client.links || [];
        client.inbounds = client.inbounds || [];
    }
    // s-ui writes local links when a client is saved; `linkHost` lets a seed start with them.
    if (seed.linkHost) {
        for (const client of state.clients) {
            const local = [];
            for (const inboundId of client.inbounds) {
                const inbound = state.inbounds.find((item) => item.id === inboundId);
                if (!inbound) continue;
                const tls = inbound.tls_id ? state.tls.find((item) => item.id === inbound.tls_id) || null : null;
                for (const uri of buildLinks(client, inbound, tls, seed.linkHost)) {
                    local.push({ remark: inbound.tag, type: 'local', uri });
                }
            }
            client.links = [...local, ...client.links.filter((link) => link.type !== 'local')];
        }
    }
    return state;
}

export function createFakeSuiPanelApp(state, options = {}) {
    const basePath = options.basePath === undefined ? '/app' : options.basePath;
    const app = express();
    const upload = multer({ storage: multer.memoryStorage() });
    const router = express.Router();
    router.use(express.urlencoded({ extended: false }));

    const send = (res, obj, msg = '') => res.json({ success: true, msg, obj: obj === undefined ? null : obj });
    const fail = (res, msg, err) => res.json({ success: false, msg: `${msg}: ${err}`, obj: null });

    function tlsById(id) {
        return state.tls.find((item) => item.id === id) || null;
    }

    function rebuildLinks(client, hostname) {
        const local = [];
        for (const inboundId of client.inbounds) {
            const inbound = state.inbounds.find((item) => item.id === inboundId);
            if (!inbound) continue;
            for (const uri of buildLinks(client, inbound, inbound.tls_id ? tlsById(inbound.tls_id) : null, hostname)) {
                local.push({ remark: inbound.tag, type: 'local', uri });
            }
        }
        client.links = [...local, ...(client.links || []).filter((link) => link.type !== 'local')];
    }

    function inboundSummary(inbound) {
        const summary = {
            id: inbound.id,
            type: inbound.type,
            tag: inbound.tag,
            tls_id: inbound.tls_id || 0,
            listen: inbound.listen,
            listen_port: inbound.listen_port,
        };
        if (USER_TYPES.has(inbound.type)) {
            summary.users = state.clients.filter((client) => client.inbounds.includes(inbound.id)).map((client) => client.name);
        }
        return summary;
    }

    function clientSummary(client) {
        const { config, links, delayStart, autoReset, resetDays, nextReset, totalUp, totalDown, ...rest } = client;
        return clone(rest);
    }

    function loadPartial(kind, ids) {
        if (kind === 'inbounds') {
            if (!ids) return state.inbounds.map(inboundSummary);
            return state.inbounds.filter((item) => ids.includes(item.id)).map((item) => clone(item));
        }
        if (kind === 'clients') {
            if (!ids) return state.clients.map(clientSummary);
            return state.clients.filter((item) => ids.includes(item.id)).map((item) => clone(item));
        }
        if (kind === 'tls') return clone(state.tls);
        return [];
    }

    function hostnameOf(req) {
        return String(req.headers.host || 'localhost').replace(/:\d+$/, '');
    }

    function saveClients(action, data, hostname) {
        if (action === 'new' || action === 'edit') {
            const client = data;
            const name = String(client.name || '').trim();
            if (!name) throw new Error('client name must not be empty');
            if (state.clients.some((item) => item.name === name && item.id !== client.id)) {
                throw new Error(`client name "${name}" is already in use`);
            }
            if (!Array.isArray(client.links)) throw new Error('unexpected end of JSON input');
            if (!Array.isArray(client.inbounds)) throw new Error('json: cannot unmarshal inbounds');
            client.name = name;
            for (const [key, entry] of Object.entries(client.config || {})) {
                if (!entry || typeof entry !== 'object') continue;
                if (['mixed', 'socks', 'http', 'naive'].includes(key)) entry.username = name;
                else entry.name = name;
            }
            if (action === 'new') {
                client.id = state.nextIds.clients++;
                client.createdAt = nowSeconds();
                client.onlineAt = 0;
                rebuildLinks(client, hostname);
                state.clients.push(client);
                return [client.id];
            }
            const index = state.clients.findIndex((item) => item.id === client.id);
            if (index < 0) throw new Error('record not found');
            const previous = state.clients[index];
            client.createdAt = previous.createdAt;
            client.onlineAt = previous.onlineAt;
            if (client.up === 0 && client.down === 0) {
                client.totalUp = (previous.totalUp || 0) + (previous.up || 0);
                client.totalDown = (previous.totalDown || 0) + (previous.down || 0);
            } else {
                client.up = previous.up;
                client.down = previous.down;
                client.totalUp = previous.totalUp;
                client.totalDown = previous.totalDown;
            }
            rebuildLinks(client, hostname);
            state.clients[index] = client;
            return [client.id];
        }
        if (action === 'del') {
            const id = Number(data);
            const before = state.clients.length;
            state.clients = state.clients.filter((item) => item.id !== id);
            if (state.clients.length === before) throw new Error('record not found');
            return [];
        }
        throw new Error(`unknown action: ${action}`);
    }

    function saveInbounds(action, data, initUsers, hostname) {
        if (action === 'new' || action === 'edit') {
            const inbound = { ...data };
            delete inbound.users;
            delete inbound.tls;
            if (!inbound.type) throw new Error('inbound type is required');
            if (state.inbounds.some((item) => item.tag === inbound.tag && item.id !== inbound.id)) {
                throw new Error('UNIQUE constraint failed: inbounds.tag');
            }
            inbound.tls_id = Number(inbound.tls_id || 0);
            inbound.addrs = inbound.addrs || [];
            if (action === 'new') {
                inbound.id = state.nextIds.inbounds++;
                state.inbounds.push(inbound);
                for (const id of String(initUsers || '').split(',').map(Number).filter(Boolean)) {
                    const client = state.clients.find((item) => item.id === id);
                    if (client && !client.inbounds.includes(inbound.id)) client.inbounds.push(inbound.id);
                }
            } else {
                const index = state.inbounds.findIndex((item) => item.id === inbound.id);
                if (index < 0) throw new Error('record not found');
                state.inbounds[index] = inbound;
            }
            for (const client of state.clients) {
                if (client.inbounds.includes(inbound.id)) rebuildLinks(client, hostname);
            }
            return inbound;
        }
        if (action === 'del') {
            const tag = String(data);
            const inbound = state.inbounds.find((item) => item.tag === tag);
            if (!inbound) throw new Error('record not found');
            state.inbounds = state.inbounds.filter((item) => item !== inbound);
            for (const client of state.clients) {
                if (client.inbounds.includes(inbound.id)) {
                    client.inbounds = client.inbounds.filter((id) => id !== inbound.id);
                    rebuildLinks(client, hostname);
                }
            }
            return null;
        }
        throw new Error(`unknown action: ${action}`);
    }

    function statusObject() {
        return {
            cpu: 12.5,
            mem: { current: 512 * 1024 * 1024, total: 2048 * 1024 * 1024 },
            dsk: { current: 5 * 1024 ** 3, total: 20 * 1024 ** 3 },
            swp: { current: 0, total: 1024 ** 3 },
            net: { sent: 1000000, recv: 3000000, psent: 1000, precv: 3000 },
            sys: {
                appMem: 64 * 1024 * 1024,
                appThreads: 12,
                cpuType: 'Fake CPU',
                cpuCount: 2,
                hostName: state.hostName,
                appVersion: state.version,
                ipv4: ['203.0.113.10/24'],
                ipv6: [],
                bootTime: nowSeconds() - 3600,
            },
            sbd: {
                running: state.running && !state.maintenance,
                stats: { NumGoroutine: 20, Alloc: 1000, Uptime: 1800 },
                maintenance: state.maintenance,
            },
        };
    }

    async function handle(req, res, action) {
        const method = req.method;
        req.body = req.body || {};
        state.calls.push({ method, action, query: { ...req.query }, body: { ...(req.body || {}) } });
        try {
            if (method === 'GET') {
                switch (action) {
                    case 'inbounds':
                    case 'clients': {
                        const ids = req.query.id ? String(req.query.id).split(',').map(Number) : null;
                        return send(res, { [action]: loadPartial(action, ids) });
                    }
                    case 'tls':
                        return send(res, { tls: loadPartial('tls') });
                    case 'outbounds':
                        return send(res, { outbounds: [{ id: 1, type: 'direct', tag: 'direct' }] });
                    case 'endpoints':
                        return send(res, { endpoints: [] });
                    case 'status':
                        return send(res, statusObject());
                    case 'onlines':
                        return send(res, clone(state.onlines));
                    case 'sessions': {
                        const tag = String(req.query.tag || '');
                        const resource = String(req.query.resource || '');
                        return send(res, state.sessions.filter((session) => !tag || (resource === 'user' ? session.user === tag : session.inbound === tag)));
                    }
                    case 'logs':
                        return send(res, state.logs.slice(-Number(req.query.c || 10)));
                    case 'keypairs':
                        if (req.query.k !== 'reality') return fail(res, '', 'unknown key type');
                        return send(res, ['PrivateKey: fake-private-key', 'PublicKey: fake-public-key']);
                    case 'getdb':
                        res.set('Content-Type', 'application/octet-stream');
                        res.set('Content-Disposition', 'attachment; filename=s-ui_2026-10-27.db');
                        return res.send(Buffer.from('SQLite format 3\u0000fake'));
                    case 'settings':
                        return send(res, { webPort: '2095', subPort: '2096' });
                    default:
                        return fail(res, 'failed', `unknown action: ${action}`);
                }
            }
            switch (action) {
                case 'save': {
                    const object = String(req.body.object || '');
                    const act = String(req.body.action || '');
                    const data = parseJson(req.body.data, null);
                    if (data === undefined) return fail(res, 'save', 'invalid character in data');
                    const hostname = hostnameOf(req);
                    if (object === 'clients') {
                        const ids = saveClients(act, data, hostname);
                        return send(res, { clients: loadPartial('clients', ids.length ? ids : null) });
                    }
                    if (object === 'inbounds') {
                        saveInbounds(act, data, req.body.initUsers, hostname);
                        return send(res, { inbounds: state.inbounds.map(inboundSummary) });
                    }
                    if (object === 'tls') {
                        if (act === 'new') {
                            const tls = { ...data, id: state.nextIds.tls++ };
                            state.tls.push(tls);
                        }
                        return send(res, { tls: clone(state.tls) });
                    }
                    return fail(res, 'save', `unknown object: ${object}`);
                }
                case 'restartSb':
                    state.restarts += 1;
                    state.running = true;
                    return send(res, null);
                case 'maintenance':
                    state.maintenance = String(req.body.enable) === 'true';
                    return send(res, null);
                case 'resetTraffic':
                    for (const client of state.clients) {
                        client.totalUp = (client.totalUp || 0) + client.up;
                        client.totalDown = (client.totalDown || 0) + client.down;
                        client.up = 0;
                        client.down = 0;
                    }
                    return send(res, null);
                case 'closeSessions':
                    state.closedSessions.push(String(req.body.u || req.query.u || ''));
                    state.sessions = state.sessions.filter((session) => session.user !== String(req.body.u || req.query.u || ''));
                    return send(res, null);
                case 'importdb':
                    if (!req.file) return fail(res, 'importdb', 'no file');
                    state.importedDb = { field: req.file.fieldname, size: req.file.size, name: req.file.originalname };
                    return send(res, null);
                default:
                    return fail(res, 'failed', `unknown action: ${action}`);
            }
        } catch (error) {
            return fail(res, '', error.message);
        }
    }

    function requireSameOrigin(req, res, next) {
        if (req.method !== 'GET' && !req.headers.origin && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
            return res.status(403).json({ success: false, msg: 'cross-origin request rejected' });
        }
        return next();
    }

    function parseCookie(req) {
        const header = String(req.headers.cookie || '');
        const match = /(?:^|;\s*)s-ui=([^;]+)/.exec(header);
        return match ? match[1] : '';
    }

    router.post('/api/login', requireSameOrigin, (req, res) => {
        state.calls.push({ method: 'POST', action: 'login', body: { user: req.body.user } });
        if (req.body.user !== state.username || req.body.pass !== state.password) {
            return fail(res, '', 'wrong user or password');
        }
        const sid = crypto.randomBytes(8).toString('hex');
        state.sessionIds.add(sid);
        res.cookie('s-ui', sid, { httpOnly: true, path: '/' });
        return send(res, null);
    });

    router.all('/api/:action', requireSameOrigin, upload.single('db'), (req, res) => {
        const sid = parseCookie(req);
        if (!sid || !state.sessionIds.has(sid)) {
            if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
                return res.status(401).json({ success: false, msg: 'Invalid login', obj: null });
            }
            return res.redirect(307, `${basePath}/login`);
        }
        return handle(req, res, req.params.action);
    });

    router.all('/apiv2/:action', requireSameOrigin, upload.single('db'), (req, res) => {
        const token = String(req.headers.token || '');
        if (!token || !state.tokens.some((item) => item.token === token)) {
            return fail(res, '', 'invalid token');
        }
        return handle(req, res, req.params.action);
    });

    router.get('/login', (req, res) => res.type('html').send('<!doctype html><title>S-UI</title>'));

    app.use(basePath || '/', router);
    app.use((req, res) => res.status(404).type('text').send('404 page not found'));
    return app;
}

export async function startFakeSuiPanel(seed = {}, options = {}) {
    const state = createFakeSuiState(seed);
    const app = createFakeSuiPanelApp(state, options);
    const server = await new Promise((resolve) => {
        const instance = app.listen(options.port || 0, '127.0.0.1', () => resolve(instance));
    });
    const port = server.address().port;
    return {
        state,
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        basePath: options.basePath === undefined ? '/app' : options.basePath,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    };
}
