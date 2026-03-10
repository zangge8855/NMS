import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'crypto';
import {
    REVIEW_PANEL_PORTS,
    buildReviewPanelDefinitions,
} from './reviewHarnessFixtures.js';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 2,
    },
});

function parseArgs(argv = []) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const raw = String(argv[index] || '');
        if (!raw.startsWith('--')) continue;
        const eqIndex = raw.indexOf('=');
        if (eqIndex >= 0) {
            options[raw.slice(2, eqIndex)] = raw.slice(eqIndex + 1);
            continue;
        }
        const key = raw.slice(2);
        const next = argv[index + 1];
        if (next && !String(next).startsWith('--')) {
            options[key] = String(next);
            index += 1;
        } else {
            options[key] = 'true';
        }
    }
    return options;
}

function toPort(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function parseMaybeJson(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'object') return deepClone(value);
    try {
        return JSON.parse(String(value));
    } catch {
        return fallback;
    }
}

function toText(value) {
    if (value === undefined || value === null) return '';
    return String(value);
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function getInboundSettings(inbound) {
    return parseMaybeJson(inbound?.settings, {});
}

function setInboundSettings(inbound, nextSettings) {
    if (typeof inbound.settings === 'string') {
        inbound.settings = JSON.stringify(nextSettings);
    } else {
        inbound.settings = nextSettings;
    }
}

function getInboundClients(inbound) {
    const settings = getInboundSettings(inbound);
    return Array.isArray(settings.clients) ? settings.clients : [];
}

function setInboundClients(inbound, clients) {
    const settings = getInboundSettings(inbound);
    settings.clients = Array.isArray(clients) ? clients : [];
    setInboundSettings(inbound, settings);
}

function buildClientStats(clients = []) {
    return clients
        .map((client) => ({
            email: toText(client.email),
            up: toNumber(client.up, 0),
            down: toNumber(client.down, 0),
        }))
        .filter((client) => client.email);
}

function matchClient(client, identifier) {
    const target = toText(identifier);
    if (!target) return false;
    return [
        toText(client?.id),
        toText(client?.password),
        toText(client?.email),
    ].includes(target);
}

function appendLog(state, source, line) {
    const key = ['panel', 'xray', 'system'].includes(source) ? source : 'panel';
    state.logs[key] = Array.isArray(state.logs[key]) ? state.logs[key] : [];
    state.logs[key].push(line);
    if (state.logs[key].length > 100) {
        state.logs[key] = state.logs[key].slice(-100);
    }
}

function listLogs(lines = [], count = 20) {
    const size = Math.max(1, Math.min(500, Number(count) || 20));
    return lines.slice(-size);
}

function makeSuccess(res, obj = null) {
    return res.json({
        success: true,
        obj,
    });
}

function createPanelApp(definition) {
    const state = deepClone(definition.state);
    const sessions = new Set();
    const app = express();

    app.use(cookieParser());
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: true, limit: '2mb' }));

    app.post('/login', (req, res) => {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');
        if (
            username !== definition.credentials.username
            || password !== definition.credentials.password
        ) {
            return res.status(401).json({
                success: false,
                msg: 'invalid username or password',
            });
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        sessions.add(sessionId);
        res.cookie('session', sessionId, { httpOnly: true });
        return makeSuccess(res, 'logged-in');
    });

    app.use((req, res, next) => {
        const sessionId = String(req.cookies?.session || '').trim();
        if (sessions.has(sessionId)) {
            return next();
        }
        return res.status(401).json({
            success: false,
            msg: 'session expired',
        });
    });

    app.get('/panel/api/server/status', (req, res) => {
        return makeSuccess(res, state.status);
    });

    app.get('/panel/api/server/cpuHistory/:count', (req, res) => {
        return makeSuccess(res, listLogs(state.cpuHistory, req.params.count).map((value) => ({
            cpu: toNumber(value, 0),
        })));
    });

    app.get('/panel/api/server/getXrayVersion', (req, res) => {
        return makeSuccess(res, state.xrayVersions);
    });

    app.post('/panel/api/server/installXray/:version', (req, res) => {
        const version = toText(req.params.version) || state.status?.xray?.version || '1.8.13';
        state.status.xray = state.status.xray || {};
        state.status.xray.version = version;
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] installed xray ${version}`);
        return makeSuccess(res, {
            version,
            installed: true,
        });
    });

    app.post('/panel/api/server/restartXrayService', (req, res) => {
        appendLog(state, 'system', `${new Date().toISOString()} systemd[1]: xray restarted`);
        return makeSuccess(res, {
            restarted: true,
        });
    });

    app.post('/panel/api/server/stopXrayService', (req, res) => {
        appendLog(state, 'system', `${new Date().toISOString()} systemd[1]: xray stopped`);
        return makeSuccess(res, {
            stopped: true,
        });
    });

    app.post('/panel/api/server/updateGeofile/:name?', (req, res) => {
        const name = toText(req.params.name) || 'all';
        appendLog(state, 'system', `${new Date().toISOString()} cron[1]: geofile ${name} updated`);
        return makeSuccess(res, {
            name,
            updated: true,
        });
    });

    app.get('/panel/api/server/getConfigJson', (req, res) => {
        return makeSuccess(res, definition.profile === 'legacy' ? JSON.stringify(state.config, null, 2) : state.config);
    });

    app.get('/panel/api/server/getDb', (req, res) => {
        const payload = Buffer.from(`fake-sqlite-${definition.profile}-db`, 'utf8');
        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename=x-ui.db',
        });
        return res.send(payload);
    });

    app.post('/panel/api/server/importDB', upload.any(), (req, res) => {
        appendLog(state, 'system', `${new Date().toISOString()} import db request accepted`);
        return makeSuccess(res, {
            imported: true,
            files: Array.isArray(req.files) ? req.files.length : 0,
        });
    });

    app.get('/panel/api/backuptotgbot', (req, res) => {
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] telegram backup triggered`);
        return makeSuccess(res, {
            queued: true,
        });
    });

    app.get('/panel/api/server/getNewUUID', (req, res) => {
        return makeSuccess(res, crypto.randomUUID());
    });

    app.get('/panel/api/server/getNewX25519Cert', (req, res) => {
        return makeSuccess(res, {
            privateKey: 'review-x25519-private-key',
            publicKey: 'review-x25519-public-key',
        });
    });

    app.get('/panel/api/server/getNewmldsa65', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'not supported',
            });
        }
        return makeSuccess(res, {
            seed: 'review-mldsa-seed',
            verify: 'review-mldsa-verify',
        });
    });

    app.get('/panel/api/server/getNewmlkem768', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'not supported',
            });
        }
        return makeSuccess(res, {
            privateKey: 'review-mlkem-private',
            publicKey: 'review-mlkem-public',
        });
    });

    app.get('/panel/api/server/getNewVlessEnc', (req, res) => {
        return makeSuccess(res, {
            auths: [
                {
                    label: 'aes-128-gcm',
                    decryption: 'none',
                    encryption: 'aes-128-gcm',
                },
                {
                    label: 'chacha20-poly1305',
                    decryption: 'none',
                    encryption: 'chacha20-poly1305',
                },
            ],
        });
    });

    app.post('/panel/api/server/getNewEchCert', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'not supported',
            });
        }
        const sni = toText(req.body?.sni) || 'review.example.com';
        return makeSuccess(res, {
            echServerKeys: `ech-server-keys-for-${sni}`,
            echConfigList: `ech-config-list-for-${sni}`,
        });
    });

    app.get('/panel/api/server/logs/:count', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'legacy node uses panel/api/server/log',
            });
        }
        return makeSuccess(res, {
            lines: listLogs(state.logs.panel, req.params.count),
        });
    });

    app.get('/panel/api/server/xraylogs/:count', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'xray logs unsupported',
            });
        }
        return makeSuccess(res, {
            lines: listLogs(state.logs.xray, req.params.count),
        });
    });

    app.post('/panel/api/server/log', (req, res) => {
        return makeSuccess(res, listLogs(state.logs.panel, req.body?.count).join('\n'));
    });

    app.post('/server/api/server/log', (req, res) => {
        return makeSuccess(res, listLogs(state.logs.system, req.body?.count).join('\n'));
    });

    app.get('/panel/api/inbounds/list', (req, res) => {
        return makeSuccess(res, state.inbounds);
    });

    app.post('/panel/api/inbounds/onlines', (req, res) => {
        return makeSuccess(res, state.onlineSessions);
    });

    app.post('/panel/api/inbounds/add', (req, res) => {
        const incoming = {
            id: toNumber(req.body?.id, 0),
            remark: toText(req.body?.remark),
            protocol: toText(req.body?.protocol),
            port: toNumber(req.body?.port, 0),
            listen: toText(req.body?.listen),
            total: toNumber(req.body?.total, 0),
            expiryTime: toNumber(req.body?.expiryTime, 0),
            settings: req.body?.settings ?? '{}',
            streamSettings: req.body?.streamSettings ?? '{}',
            sniffing: req.body?.sniffing ?? '{}',
            enable: normalizeBoolean(req.body?.enable, true),
        };
        const nextId = incoming.id > 0
            ? incoming.id
            : state.inbounds.reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0) + 1;
        const inbound = {
            ...incoming,
            id: nextId,
            up: 0,
            down: 0,
        };
        const clients = getInboundClients(inbound);
        inbound.clientStats = buildClientStats(clients);
        state.inbounds.push(inbound);
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] inbound ${nextId} added`);
        return makeSuccess(res, inbound);
    });

    app.post('/panel/api/inbounds/update/:id', (req, res) => {
        const inboundId = Number(req.params.id);
        const target = state.inbounds.find((item) => Number(item.id) === inboundId);
        if (!target) {
            return res.status(404).json({
                success: false,
                msg: 'inbound not found',
            });
        }

        const fields = ['remark', 'protocol', 'listen', 'settings', 'streamSettings', 'sniffing'];
        fields.forEach((field) => {
            if (req.body?.[field] !== undefined) {
                target[field] = req.body[field];
            }
        });
        ['port', 'total', 'expiryTime'].forEach((field) => {
            if (req.body?.[field] !== undefined) {
                target[field] = toNumber(req.body[field], target[field]);
            }
        });
        if (req.body?.enable !== undefined) {
            target.enable = normalizeBoolean(req.body.enable, target.enable !== false);
        }
        target.clientStats = buildClientStats(getInboundClients(target));
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] inbound ${inboundId} updated`);
        return makeSuccess(res, target);
    });

    app.post('/panel/api/inbounds/del/:id', (req, res) => {
        const inboundId = Number(req.params.id);
        const before = state.inbounds.length;
        state.inbounds = state.inbounds.filter((item) => Number(item.id) !== inboundId);
        if (state.inbounds.length === before) {
            return res.status(404).json({
                success: false,
                msg: 'inbound not found',
            });
        }
        appendLog(state, 'panel', `${new Date().toISOString()} [WARNING] inbound ${inboundId} deleted`);
        return makeSuccess(res, {
            deleted: true,
        });
    });

    app.post('/panel/api/inbounds/resetTraffic/:id', (req, res) => {
        const inboundId = Number(req.params.id);
        const target = state.inbounds.find((item) => Number(item.id) === inboundId);
        if (!target) {
            return res.status(404).json({
                success: false,
                msg: 'inbound not found',
            });
        }
        target.up = 0;
        target.down = 0;
        const clients = getInboundClients(target).map((client) => ({
            ...client,
            up: 0,
            down: 0,
        }));
        setInboundClients(target, clients);
        target.clientStats = buildClientStats(clients);
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] inbound ${inboundId} traffic reset`);
        return makeSuccess(res, target);
    });

    app.post('/panel/api/inbounds/addClient', (req, res) => {
        const inboundId = toNumber(req.body?.id, 0);
        const target = state.inbounds.find((item) => Number(item.id) === inboundId);
        if (!target) {
            return res.status(404).json({
                success: false,
                msg: 'inbound not found',
            });
        }
        const settings = parseMaybeJson(req.body?.settings, {});
        const incomingClients = Array.isArray(settings.clients) ? settings.clients : [];
        const existing = getInboundClients(target);
        const nextClients = existing.concat(incomingClients.map((client) => deepClone(client)));
        setInboundClients(target, nextClients);
        target.clientStats = buildClientStats(nextClients);
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] clients added to inbound ${inboundId}`);
        return makeSuccess(res, {
            added: incomingClients.length,
        });
    });

    app.post('/panel/api/inbounds/updateClient/:identifier', (req, res) => {
        const identifier = toText(req.params.identifier);
        let updated = null;
        for (const inbound of state.inbounds) {
            const clients = getInboundClients(inbound);
            const index = clients.findIndex((client) => matchClient(client, identifier));
            if (index < 0) continue;
            clients[index] = {
                ...clients[index],
                ...deepClone(req.body || {}),
            };
            setInboundClients(inbound, clients);
            inbound.clientStats = buildClientStats(clients);
            updated = clients[index];
            break;
        }
        if (!updated) {
            return res.status(404).json({
                success: false,
                msg: 'client not found',
            });
        }
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] client ${identifier} updated`);
        return makeSuccess(res, updated);
    });

    app.post('/panel/api/inbounds/:inboundId/delClient/:identifier', (req, res) => {
        const inboundId = Number(req.params.inboundId);
        const identifier = toText(req.params.identifier);
        const target = state.inbounds.find((item) => Number(item.id) === inboundId);
        if (!target) {
            return res.status(404).json({
                success: false,
                msg: 'inbound not found',
            });
        }
        const clients = getInboundClients(target);
        const nextClients = clients.filter((client) => !matchClient(client, identifier));
        setInboundClients(target, nextClients);
        target.clientStats = buildClientStats(nextClients);
        return makeSuccess(res, {
            deleted: clients.length - nextClients.length,
        });
    });

    app.post('/panel/api/inbounds/delClient/:inboundId', (req, res) => {
        const inboundId = Number(req.params.inboundId);
        const identifier = toText(req.body?.id || req.body?.clientId || req.body?.email || req.body?.password);
        const target = state.inbounds.find((item) => Number(item.id) === inboundId);
        if (!target) {
            return res.status(404).json({
                success: false,
                msg: 'inbound not found',
            });
        }
        const clients = getInboundClients(target);
        const nextClients = clients.filter((client) => !matchClient(client, identifier));
        setInboundClients(target, nextClients);
        target.clientStats = buildClientStats(nextClients);
        return makeSuccess(res, {
            deleted: clients.length - nextClients.length,
        });
    });

    app.post('/panel/api/inbounds/clientIps/:email', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'client ip api unsupported',
            });
        }
        const email = normalizeEmail(req.params.email);
        return makeSuccess(res, state.clientIps[email] || []);
    });

    app.post('/panel/api/inbounds/clearClientIps/:email', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'client ip api unsupported',
            });
        }
        const email = normalizeEmail(req.params.email);
        state.clientIps[email] = [];
        return makeSuccess(res, []);
    });

    return app;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const host = String(args.host || process.env.REVIEW_PANEL_HOST || '127.0.0.1').trim() || '127.0.0.1';
    const definitions = buildReviewPanelDefinitions({
        host,
        ports: {
            healthy: toPort(args['healthy-port'] || process.env.REVIEW_PANEL_PORT_HEALTHY, REVIEW_PANEL_PORTS.healthy),
            legacy: toPort(args['legacy-port'] || process.env.REVIEW_PANEL_PORT_LEGACY, REVIEW_PANEL_PORTS.legacy),
            down: toPort(args['down-port'] || process.env.REVIEW_PANEL_PORT_DOWN, REVIEW_PANEL_PORTS.down),
        },
    });

    const servers = [];
    for (const definition of definitions) {
        const app = createPanelApp(definition);
        const server = await new Promise((resolve, reject) => {
            const instance = app.listen(definition.port, host, () => resolve(instance));
            instance.on('error', reject);
        });
        servers.push(server);
    }

    process.stdout.write(`${JSON.stringify({
        success: true,
        host,
        panels: definitions.map((item) => ({
            key: item.key,
            url: item.url,
            username: item.credentials.username,
            password: item.credentials.password,
        })),
    }, null, 2)}\n`);

    const shutdown = () => {
        servers.forEach((server) => {
            try {
                server.close();
            } catch {
                // Best-effort shutdown.
            }
        });
        setTimeout(() => process.exit(0), 50);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
});
