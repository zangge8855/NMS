import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'crypto';
import {
    REVIEW_PANEL_PORTS,
    buildReviewPanelDefinitions,
} from './reviewHarnessFixtures.js';
import { createFakeSuiPanelApp, createFakeSuiState } from './fakeSuiPanel.js';

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

function listUniqueClientRecords(inbounds = []) {
    const records = new Map();
    (Array.isArray(inbounds) ? inbounds : []).forEach((inbound) => {
        getInboundClients(inbound).forEach((client) => {
            const email = normalizeEmail(client.email);
            if (!email) return;
            const current = records.get(email) || {
                client: deepClone(client),
                inboundIds: [],
            };
            current.inboundIds.push(Number(inbound.id));
            records.set(email, current);
        });
    });
    return Array.from(records.entries()).map(([email, record]) => ({
        email,
        ...record,
    }));
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
    state.apiTokens = Array.isArray(state.apiTokens) ? state.apiTokens : [];
    state.clientGroups = Array.isArray(state.clientGroups) ? state.clientGroups : [];
    state.clientHwids = state.clientHwids && typeof state.clientHwids === 'object' ? state.clientHwids : {};
    state.hosts = Array.isArray(state.hosts) ? state.hosts : [];
    state.subBalancers = Array.isArray(state.subBalancers) ? state.subBalancers : [];
    state.outboundSubs = Array.isArray(state.outboundSubs) ? state.outboundSubs : [];
    state.nodes = Array.isArray(state.nodes) ? state.nodes : [];
    let nextBalancerId = state.subBalancers.reduce((m, item) => Math.max(m, Number(item?.id || 0)), 0) + 1;
    let nextOutboundSubId = state.outboundSubs.reduce((m, item) => Math.max(m, Number(item?.id || 0)), 0) + 1;
    let nextNodeId = state.nodes.reduce((m, item) => Math.max(m, Number(item?.id || 0)), 0) + 1;
    const isLegacy = definition.profile === 'legacy';
    const rejectLegacy = (res) => res.status(404).json({ success: false, msg: 'endpoint unavailable on legacy panel' });
    const sessions = new Set();
    const app = express();

    app.use(cookieParser());
    app.use(express.json({ limit: '2mb', strict: false }));
    app.use(express.urlencoded({ extended: true, limit: '2mb' }));

    app.get('/csrf-token', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'csrf endpoint unavailable',
            });
        }
        const csrfToken = crypto.randomBytes(16).toString('hex');
        res.cookie('csrf', csrfToken, { httpOnly: true });
        return makeSuccess(res, csrfToken);
    });

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
        const authHeader = req.headers.authorization || '';
        if (authHeader.startsWith('Bearer ')) {
            const tokenVal = authHeader.substring(7).trim();
            const tokenObj = state.apiTokens.find(t => t.token === tokenVal && t.enabled !== false);
            if (tokenObj) {
                return next();
            }
        }
        return res.status(401).json({
            success: false,
            msg: 'session expired',
        });
    });

    app.get('/panel/csrf-token', (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'csrf endpoint unavailable',
            });
        }
        return makeSuccess(res, toText(req.cookies?.csrf) || crypto.randomBytes(16).toString('hex'));
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

    app.get('/panel/api/server/getPanelUpdateInfo', (req, res) => {
        return makeSuccess(res, {
            currentVersion: '2.9.3',
            latestVersion: '2.9.4',
            updateAvailable: true,
        });
    });

    app.post('/panel/api/server/updatePanel', (req, res) => {
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] panel update started`);
        return makeSuccess(res, {
            updating: true,
        });
    });

    app.get('/panel/api/server/xrayMetricsState', (req, res) => {
        return makeSuccess(res, {
            enabled: true,
            listen: '127.0.0.1:11111',
            reason: '',
        });
    });

    app.get('/panel/api/server/xrayObservatory', (req, res) => {
        return makeSuccess(res, [
            { tag: 'proxy-a', alive: true, delay: 48 },
            { tag: 'proxy-b', alive: true, delay: 71 },
        ]);
    });

    app.get('/panel/api/custom-geo/list', (req, res) => {
        state.customGeoResources = Array.isArray(state.customGeoResources)
            ? state.customGeoResources
            : [{ id: 1, type: 'geoip', alias: 'review', url: 'https://example.com/geoip.dat' }];
        return makeSuccess(res, state.customGeoResources);
    });

    app.post('/panel/api/custom-geo/add', (req, res) => {
        state.customGeoResources = Array.isArray(state.customGeoResources) ? state.customGeoResources : [];
        const nextId = state.customGeoResources.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
        const item = {
            id: nextId,
            type: toText(req.body?.type) || 'geoip',
            alias: toText(req.body?.alias),
            url: toText(req.body?.url),
        };
        state.customGeoResources.push(item);
        return makeSuccess(res, item);
    });

    app.post('/panel/api/custom-geo/update/:id', (req, res) => {
        state.customGeoResources = Array.isArray(state.customGeoResources) ? state.customGeoResources : [];
        const item = state.customGeoResources.find((entry) => String(entry.id) === String(req.params.id));
        if (item) {
            item.type = toText(req.body?.type) || item.type;
            item.alias = toText(req.body?.alias) || item.alias;
            item.url = toText(req.body?.url) || item.url;
        }
        return makeSuccess(res, item || null);
    });

    app.post('/panel/api/custom-geo/delete/:id', (req, res) => {
        state.customGeoResources = Array.isArray(state.customGeoResources) ? state.customGeoResources : [];
        state.customGeoResources = state.customGeoResources.filter((entry) => String(entry.id) !== String(req.params.id));
        return makeSuccess(res, true);
    });

    app.post('/panel/api/custom-geo/download/:id', (req, res) => {
        return makeSuccess(res, { id: Number(req.params.id), downloaded: true });
    });

    app.post('/panel/api/custom-geo/update-all', (req, res) => {
        return makeSuccess(res, { updated: true });
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

    const handleTelegramBackup = (req, res) => {
        appendLog(state, 'panel', `${new Date().toISOString()} [INFO] telegram backup triggered`);
        return makeSuccess(res, {
            queued: true,
        });
    };

    app.post('/panel/api/backuptotgbot', handleTelegramBackup);
    app.get('/panel/api/backuptotgbot', handleTelegramBackup);

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

    const handlePanelLogs = (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'legacy node uses panel/api/server/log',
            });
        }
        return makeSuccess(res, {
            lines: listLogs(state.logs.panel, req.params.count),
        });
    };

    const handleXrayLogs = (req, res) => {
        if (definition.profile === 'legacy') {
            return res.status(404).json({
                success: false,
                msg: 'xray logs unsupported',
            });
        }
        return makeSuccess(res, {
            lines: listLogs(state.logs.xray, req.params.count),
        });
    };

    app.post('/panel/api/server/logs/:count', handlePanelLogs);
    app.get('/panel/api/server/logs/:count', handlePanelLogs);
    app.post('/panel/api/server/xraylogs/:count', handleXrayLogs);
    app.get('/panel/api/server/xraylogs/:count', handleXrayLogs);

    app.post('/panel/api/server/log', (req, res) => {
        return makeSuccess(res, listLogs(state.logs.panel, req.body?.count).join('\n'));
    });

    app.post('/server/api/server/log', (req, res) => {
        return makeSuccess(res, listLogs(state.logs.system, req.body?.count).join('\n'));
    });

    app.get('/panel/api/inbounds/list', (req, res) => {
        return makeSuccess(res, state.inbounds);
    });

    app.get('/panel/api/clients/list', (req, res) => {
        return makeSuccess(res, listUniqueClientRecords(state.inbounds));
    });

    app.get('/panel/api/clients/list/paged', (req, res) => {
        const page = Math.max(1, Number(req.query?.page) || 1);
        const pageSize = Math.max(1, Math.min(200, Number(req.query?.pageSize) || Number(req.query?.limit) || 20));
        const search = normalizeEmail(req.query?.search || req.query?.email || '');
        const inboundId = toText(req.query?.inboundId || '');
        const all = listUniqueClientRecords(state.inbounds)
            .filter((record) => !search || normalizeEmail(record.email).includes(search))
            .filter((record) => !inboundId || record.inboundIds.some((id) => String(id) === inboundId));
        const start = (page - 1) * pageSize;
        return makeSuccess(res, {
            total: all.length,
            page,
            pageSize,
            items: all.slice(start, start + pageSize),
        });
    });

    app.get('/panel/api/inbounds/get/:id', (req, res) => {
        const inboundId = Number(req.params.id);
        const target = state.inbounds.find((item) => Number(item.id) === inboundId);
        if (!target) {
            return res.status(404).json({
                success: false,
                msg: 'inbound not found',
            });
        }
        return makeSuccess(res, target);
    });

    app.post('/panel/api/inbounds/onlines', (req, res) => {
        return makeSuccess(res, state.onlineSessions);
    });

    app.post('/panel/api/clients/onlines', (req, res) => {
        return makeSuccess(res, state.onlineSessions);
    });

    app.post('/panel/api/clients/add', (req, res) => {
        const client = deepClone(req.body?.client || {});
        const inboundIds = Array.isArray(req.body?.inboundIds) ? req.body.inboundIds : [];
        let added = 0;
        inboundIds.forEach((id) => {
            const target = state.inbounds.find((item) => Number(item.id) === Number(id));
            if (!target) return;
            const clients = getInboundClients(target);
            if (!clients.some((item) => normalizeEmail(item.email) === normalizeEmail(client.email))) {
                clients.push(deepClone(client));
                setInboundClients(target, clients);
                target.clientStats = buildClientStats(clients);
                added += 1;
            }
        });
        return makeSuccess(res, { added });
    });

    app.post('/panel/api/clients/update/:email', (req, res) => {
        const email = normalizeEmail(req.params.email);
        let updated = 0;
        state.inbounds.forEach((inbound) => {
            const clients = getInboundClients(inbound);
            const nextClients = clients.map((client) => {
                if (normalizeEmail(client.email) !== email) return client;
                updated += 1;
                return {
                    ...client,
                    ...deepClone(req.body || {}),
                };
            });
            setInboundClients(inbound, nextClients);
            inbound.clientStats = buildClientStats(nextClients);
        });
        if (updated === 0) {
            return res.status(404).json({
                success: false,
                msg: 'client not found',
            });
        }
        return makeSuccess(res, { updated });
    });

    const lookupClientsByField = (matcher) => {
        const grouped = new Map();
        state.inbounds.forEach((inbound) => {
            getInboundClients(inbound).forEach((client) => {
                if (!matcher(client)) return;
                const emailKey = normalizeEmail(client.email) || toText(client.id) || crypto.randomUUID();
                const existing = grouped.get(emailKey) || { client: deepClone(client), inboundIds: [] };
                existing.inboundIds.push(Number(inbound.id));
                grouped.set(emailKey, existing);
            });
        });
        return Array.from(grouped.values());
    };

    app.get('/panel/api/clients/get/subId/:subId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const subId = toText(req.params.subId).trim();
        const matches = lookupClientsByField((client) => toText(client.subId || client.subID).trim() === subId);
        if (matches.length === 0) {
            return res.status(404).json({ success: false, msg: 'client not found' });
        }
        return makeSuccess(res, matches.length === 1 ? matches[0] : matches);
    });

    app.get('/panel/api/clients/get/tgId/:tgId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const tgId = toText(req.params.tgId).trim();
        const matches = lookupClientsByField((client) => toText(client.tgId ?? client.tgID).trim() === tgId);
        if (matches.length === 0) {
            return res.status(404).json({ success: false, msg: 'client not found' });
        }
        return makeSuccess(res, matches.length === 1 ? matches[0] : matches);
    });

    const getGroupEmailList = (groupName) => {
        const target = toText(groupName).trim();
        const emails = new Set();
        state.inbounds.forEach((inbound) => {
            getInboundClients(inbound).forEach((client) => {
                if (toText(client.group).trim() === target && client.email) {
                    emails.add(toText(client.email));
                }
            });
        });
        return Array.from(emails);
    };

    app.get('/panel/api/clients/groups', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const names = new Set(state.clientGroups.map((g) => toText(g.name).trim()).filter(Boolean));
        state.inbounds.forEach((inbound) => {
            getInboundClients(inbound).forEach((client) => {
                const groupName = toText(client.group).trim();
                if (groupName) names.add(groupName);
            });
        });
        const rows = Array.from(names).map((name) => {
            const existing = state.clientGroups.find((g) => toText(g.name).trim() === name) || {};
            const emails = getGroupEmailList(name);
            return {
                name,
                count: emails.length,
                createdAt: existing.createdAt || new Date().toISOString(),
            };
        });
        return makeSuccess(res, rows);
    });

    app.get('/panel/api/clients/groups/:name/emails', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, getGroupEmailList(req.params.name));
    });

    app.post('/panel/api/clients/groups/create', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const name = toText(req.body?.name).trim();
        if (!name) return res.status(400).json({ success: false, msg: 'name is required' });
        if (!state.clientGroups.some((g) => g.name === name)) {
            state.clientGroups.push({ name, createdAt: new Date().toISOString() });
        }
        return makeSuccess(res, { name, count: getGroupEmailList(name).length });
    });

    app.post('/panel/api/clients/groups/rename', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const oldName = toText(req.body?.oldName).trim();
        const newName = toText(req.body?.newName).trim();
        if (!oldName || !newName) return res.status(400).json({ success: false, msg: 'oldName and newName are required' });
        state.clientGroups = state.clientGroups.map((g) => (g.name === oldName ? { ...g, name: newName } : g));
        state.inbounds.forEach((inbound) => {
            const next = getInboundClients(inbound).map((client) => (
                toText(client.group).trim() === oldName ? { ...client, group: newName } : client
            ));
            setInboundClients(inbound, next);
        });
        return makeSuccess(res, { oldName, newName });
    });

    app.post('/panel/api/clients/groups/resetTraffic', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const name = toText(req.body?.name).trim();
        let resetCount = 0;
        state.inbounds.forEach((inbound) => {
            const next = getInboundClients(inbound).map((client) => {
                if (toText(client.group).trim() !== name) return client;
                resetCount += 1;
                return { ...client, up: 0, down: 0 };
            });
            setInboundClients(inbound, next);
            inbound.clientStats = buildClientStats(next);
        });
        return makeSuccess(res, { name, resetCount });
    });

    app.post('/panel/api/clients/groups/delete', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const name = toText(req.body?.name).trim();
        state.clientGroups = state.clientGroups.filter((g) => g.name !== name);
        state.inbounds.forEach((inbound) => {
            const next = getInboundClients(inbound).map((client) => (
                toText(client.group).trim() === name ? { ...client, group: '' } : client
            ));
            setInboundClients(inbound, next);
        });
        return makeSuccess(res, { deleted: true });
    });

    app.post('/panel/api/clients/groups/bulkAdd', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const group = toText(req.body?.group).trim();
        const rawEmails = Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.emails].filter(Boolean);
        const targetEmails = new Set(rawEmails.map(normalizeEmail).filter(Boolean));
        if (group && !state.clientGroups.some((g) => g.name === group)) {
            state.clientGroups.push({ name: group, createdAt: new Date().toISOString() });
        }
        let updated = 0;
        state.inbounds.forEach((inbound) => {
            const next = getInboundClients(inbound).map((client) => {
                if (!targetEmails.has(normalizeEmail(client.email))) return client;
                updated += 1;
                return { ...client, group };
            });
            setInboundClients(inbound, next);
        });
        return makeSuccess(res, { updated });
    });

    app.post('/panel/api/clients/groups/bulkRemove', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const rawEmails = Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.emails].filter(Boolean);
        const targetEmails = new Set(rawEmails.map(normalizeEmail).filter(Boolean));
        let updated = 0;
        state.inbounds.forEach((inbound) => {
            const next = getInboundClients(inbound).map((client) => {
                if (!targetEmails.has(normalizeEmail(client.email))) return client;
                updated += 1;
                return { ...client, group: '' };
            });
            setInboundClients(inbound, next);
        });
        return makeSuccess(res, { updated });
    });

    app.post('/panel/api/clients/hwids/:email', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const email = normalizeEmail(req.params.email);
        return makeSuccess(res, deepClone(state.clientHwids[email] || []));
    });

    app.delete('/panel/api/clients/hwids/:email/:hwidId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const email = normalizeEmail(req.params.email);
        const hwidId = toText(req.params.hwidId);
        const current = Array.isArray(state.clientHwids[email]) ? state.clientHwids[email] : [];
        state.clientHwids[email] = current.filter((item) => toText(item.id) !== hwidId);
        return makeSuccess(res, deepClone(state.clientHwids[email]));
    });

    app.delete('/panel/api/clients/hwids/:email', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const email = normalizeEmail(req.params.email);
        state.clientHwids[email] = [];
        return makeSuccess(res, []);
    });

    app.get('/panel/api/clients/get/:email', (req, res) => {
        const email = normalizeEmail(req.params.email);
        const inboundIds = [];
        let found = null;
        state.inbounds.forEach((inbound) => {
            const match = getInboundClients(inbound)
                .find((client) => normalizeEmail(client.email) === email);
            if (match) {
                inboundIds.push(Number(inbound.id));
                found = found || match;
            }
        });
        if (!found) {
            return res.status(404).json({
                success: false,
                msg: 'client not found',
            });
        }
        return makeSuccess(res, {
            client: found,
            inboundIds,
        });
    });

    app.post('/panel/api/clients/del/:email', (req, res) => {
        const email = normalizeEmail(req.params.email);
        let deleted = 0;
        state.inbounds.forEach((inbound) => {
            const clients = getInboundClients(inbound);
            const nextClients = clients.filter((client) => normalizeEmail(client.email) !== email);
            deleted += clients.length - nextClients.length;
            setInboundClients(inbound, nextClients);
            inbound.clientStats = buildClientStats(nextClients);
        });
        return makeSuccess(res, { deleted });
    });

    app.post('/panel/api/clients/:email/detach', (req, res) => {
        const email = normalizeEmail(req.params.email);
        const inboundIds = Array.isArray(req.body?.inboundIds) ? req.body.inboundIds : [];
        let detached = 0;
        inboundIds.forEach((id) => {
            const target = state.inbounds.find((item) => Number(item.id) === Number(id));
            if (!target) return;
            const clients = getInboundClients(target);
            const nextClients = clients.filter((client) => normalizeEmail(client.email) !== email);
            detached += clients.length - nextClients.length;
            setInboundClients(target, nextClients);
            target.clientStats = buildClientStats(nextClients);
        });
        return makeSuccess(res, { detached });
    });

    app.post('/panel/api/clients/:email/attach', (req, res) => {
        const email = normalizeEmail(req.params.email);
        const inboundIds = Array.isArray(req.body?.inboundIds) ? req.body.inboundIds : [];
        const source = req.body?.client && typeof req.body.client === 'object'
            ? deepClone(req.body.client)
            : listUniqueClientRecords(state.inbounds).find((record) => record.email === email)?.client;
        if (!source) {
            return res.status(404).json({
                success: false,
                msg: 'client not found',
            });
        }
        let attached = 0;
        inboundIds.forEach((id) => {
            const target = state.inbounds.find((item) => Number(item.id) === Number(id));
            if (!target) return;
            const clients = getInboundClients(target);
            if (clients.some((client) => normalizeEmail(client.email) === email)) return;
            clients.push({
                ...deepClone(source),
                email,
            });
            setInboundClients(target, clients);
            target.clientStats = buildClientStats(clients);
            attached += 1;
        });
        return makeSuccess(res, { attached });
    });

    app.post('/panel/api/clients/bulkAdjust', (req, res) => {
        const emails = new Set(
            (Array.isArray(req.body?.emails) ? req.body.emails : [])
                .map((item) => normalizeEmail(item))
                .filter(Boolean)
        );
        const addDays = Number(req.body?.addDays || 0) || 0;
        const addBytes = Number(req.body?.addBytes || 0) || 0;
        let updated = 0;
        const now = Date.now();
        state.inbounds.forEach((inbound) => {
            const clients = getInboundClients(inbound).map((client) => {
                if (!emails.has(normalizeEmail(client.email))) return client;
                const next = { ...client };
                if (addDays !== 0 && Number(next.expiryTime || 0) > 0) {
                    const base = addDays > 0 ? Math.max(Number(next.expiryTime || 0), now) : Number(next.expiryTime || 0);
                    next.expiryTime = Math.max(now + 1000, base + Math.trunc(addDays * 86400000));
                }
                if (addBytes !== 0 && Number(next.totalGB || 0) > 0) {
                    next.totalGB = Math.max(0, Number(next.totalGB || 0) + Math.trunc(addBytes));
                }
                if (req.body?.limitHwid !== undefined) {
                    next.limitHwid = toNumber(req.body.limitHwid, next.limitHwid || 0);
                }
                updated += 1;
                return next;
            });
            setInboundClients(inbound, clients);
            inbound.clientStats = buildClientStats(clients);
        });
        return makeSuccess(res, { updated });
    });

    app.post('/panel/api/clients/resetTraffic/:email', (req, res) => {
        const email = normalizeEmail(req.params.email);
        state.inbounds.forEach((inbound) => {
            const clients = getInboundClients(inbound).map((client) => (
                normalizeEmail(client.email) === email
                    ? { ...client, up: 0, down: 0 }
                    : client
            ));
            setInboundClients(inbound, clients);
            inbound.clientStats = buildClientStats(clients);
        });
        return makeSuccess(res, { reset: email });
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

    app.post('/panel/api/inbounds/setEnable/:id', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const inboundId = Number(req.params.id);
        const target = state.inbounds.find((item) => Number(item.id) === inboundId);
        if (!target) {
            return res.status(404).json({ success: false, msg: 'inbound not found' });
        }
        target.enable = normalizeBoolean(req.body?.enable, target.enable !== false);
        return makeSuccess(res, target);
    });

    // ── 3x-ui v3 hosts, sub-balancers, xray/outbound-subs, and multi-nodes ──

    const listHostTags = () => {
        const tags = new Set();
        state.hosts.forEach((group) => {
            (Array.isArray(group.hosts) ? group.hosts : []).forEach((h) => {
                if (h?.tag) tags.add(toText(h.tag));
            });
        });
        return Array.from(tags);
    };

    app.get('/panel/api/hosts/list', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, deepClone(state.hosts));
    });

    app.get('/panel/api/hosts/raw', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, deepClone(state.hosts));
    });

    app.get('/panel/api/hosts/tags', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, listHostTags());
    });

    app.get('/panel/api/hosts/get/:groupId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const found = state.hosts.find((item) => toText(item.groupId) === toText(req.params.groupId));
        if (!found) return res.status(404).json({ success: false, msg: 'host group not found' });
        return makeSuccess(res, deepClone(found));
    });

    app.get('/panel/api/hosts/byInbound/:inboundId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const inboundId = Number(req.params.inboundId);
        const matched = state.hosts.filter((item) =>
            Array.isArray(item.inboundIds) && item.inboundIds.map(Number).includes(inboundId)
        );
        return makeSuccess(res, deepClone(matched));
    });

    app.post('/panel/api/hosts/add', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const body = deepClone(req.body || {});
        const groupId = toText(body.groupId).trim() || crypto.randomUUID();
        const created = {
            ...body,
            groupId,
            inboundIds: Array.isArray(body.inboundIds) ? body.inboundIds.map(Number) : [],
            hosts: Array.isArray(body.hosts) ? body.hosts : [],
            isDisabled: body.isDisabled === true,
        };
        state.hosts.push(created);
        return makeSuccess(res, deepClone(created));
    });

    app.post('/panel/api/hosts/update/:groupId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const idx = state.hosts.findIndex((item) => toText(item.groupId) === toText(req.params.groupId));
        if (idx < 0) return res.status(404).json({ success: false, msg: 'host group not found' });
        state.hosts[idx] = { ...state.hosts[idx], ...deepClone(req.body || {}), groupId: state.hosts[idx].groupId };
        return makeSuccess(res, deepClone(state.hosts[idx]));
    });

    app.post('/panel/api/hosts/setEnable/:groupId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const target = state.hosts.find((item) => toText(item.groupId) === toText(req.params.groupId));
        if (!target) return res.status(404).json({ success: false, msg: 'host group not found' });
        const enable = normalizeBoolean(req.body?.enable, true);
        target.isDisabled = !enable;
        return makeSuccess(res, deepClone(target));
    });

    app.post('/panel/api/hosts/reorder', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(toText) : [];
        const byId = new Map(state.hosts.map((item) => [toText(item.groupId), item]));
        const reordered = [];
        ids.forEach((id) => {
            if (byId.has(id)) {
                reordered.push(byId.get(id));
                byId.delete(id);
            }
        });
        for (const rest of byId.values()) reordered.push(rest);
        state.hosts = reordered;
        return makeSuccess(res, deepClone(state.hosts));
    });

    app.post('/panel/api/hosts/del/:groupId', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const before = state.hosts.length;
        state.hosts = state.hosts.filter((item) => toText(item.groupId) !== toText(req.params.groupId));
        if (state.hosts.length === before) return res.status(404).json({ success: false, msg: 'host group not found' });
        return makeSuccess(res, { deleted: true });
    });

    const parseIdList = (raw) => {
        if (Array.isArray(raw)) return raw.map((v) => Number(v)).filter(Number.isFinite);
        if (raw === undefined || raw === null || raw === '') return [];
        const single = Number(raw);
        return Number.isFinite(single) ? [single] : [];
    };

    app.get('/panel/api/sub-balancers', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, deepClone(state.subBalancers));
    });

    app.post('/panel/api/sub-balancers', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const body = req.body || {};
        const created = {
            id: nextBalancerId++,
            remark: toText(body.remark).trim(),
            strategy: toText(body.strategy || 'random').trim(),
            inboundIds: parseIdList(body.inboundIds),
            memberWeights: parseMaybeJson(body.memberWeights, {}),
            sortOrder: toNumber(body.sortOrder, state.subBalancers.length + 1),
            enabled: normalizeBoolean(body.enabled, true),
        };
        state.subBalancers.push(created);
        return makeSuccess(res, deepClone(created));
    });

    app.post('/panel/api/sub-balancers/:id', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const targetId = Number(req.params.id);
        const idx = state.subBalancers.findIndex((item) => Number(item.id) === targetId);
        if (idx < 0) return res.status(404).json({ success: false, msg: 'sub-balancer not found' });
        const body = req.body || {};
        const prev = state.subBalancers[idx];
        state.subBalancers[idx] = {
            ...prev,
            remark: body.remark !== undefined ? toText(body.remark).trim() : prev.remark,
            strategy: body.strategy !== undefined ? toText(body.strategy).trim() : prev.strategy,
            inboundIds: body.inboundIds !== undefined ? parseIdList(body.inboundIds) : prev.inboundIds,
            memberWeights: body.memberWeights !== undefined ? parseMaybeJson(body.memberWeights, prev.memberWeights) : prev.memberWeights,
            sortOrder: body.sortOrder !== undefined ? toNumber(body.sortOrder, prev.sortOrder) : prev.sortOrder,
            enabled: body.enabled !== undefined ? normalizeBoolean(body.enabled, prev.enabled) : prev.enabled,
        };
        return makeSuccess(res, deepClone(state.subBalancers[idx]));
    });

    const handleDeleteSubBalancer = (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const targetId = Number(req.params.id);
        const before = state.subBalancers.length;
        state.subBalancers = state.subBalancers.filter((item) => Number(item.id) !== targetId);
        if (state.subBalancers.length === before) return res.status(404).json({ success: false, msg: 'sub-balancer not found' });
        return makeSuccess(res, { deleted: true });
    };
    app.post('/panel/api/sub-balancers/:id/del', handleDeleteSubBalancer);
    app.delete('/panel/api/sub-balancers/:id', handleDeleteSubBalancer);

    app.get('/panel/api/xray/outbound-subs', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, deepClone(state.outboundSubs));
    });

    app.post('/panel/api/xray/outbound-subs/parse', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, [{ tag: 'parsed-outbound-1', protocol: 'vless', address: 'example.com', port: 443 }]);
    });

    app.post('/panel/api/xray/outbound-subs', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const body = req.body || {};
        const created = {
            id: nextOutboundSubId++,
            remark: toText(body.remark).trim(),
            url: toText(body.url).trim(),
            tagPrefix: toText(body.tagPrefix).trim(),
            userAgent: toText(body.userAgent).trim(),
            allowPrivate: normalizeBoolean(body.allowPrivate, false),
            allowInsecure: normalizeBoolean(body.allowInsecure, false),
            enabled: normalizeBoolean(body.enabled, true),
            outboundCount: 1,
            lastUpdated: Math.floor(Date.now() / 1000),
            outbounds: [{ tag: `${toText(body.tagPrefix)}node-1`, protocol: 'vless' }],
        };
        state.outboundSubs.push(created);
        return makeSuccess(res, deepClone(created));
    });

    app.post('/panel/api/xray/outbound-subs/:id', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const targetId = Number(req.params.id);
        const idx = state.outboundSubs.findIndex((item) => Number(item.id) === targetId);
        if (idx < 0) return res.status(404).json({ success: false, msg: 'outbound sub not found' });
        const body = req.body || {};
        const prev = state.outboundSubs[idx];
        state.outboundSubs[idx] = {
            ...prev,
            remark: body.remark !== undefined ? toText(body.remark).trim() : prev.remark,
            url: body.url !== undefined ? toText(body.url).trim() : prev.url,
            tagPrefix: body.tagPrefix !== undefined ? toText(body.tagPrefix).trim() : prev.tagPrefix,
            enabled: body.enabled !== undefined ? normalizeBoolean(body.enabled, prev.enabled) : prev.enabled,
        };
        return makeSuccess(res, deepClone(state.outboundSubs[idx]));
    });

    app.post('/panel/api/xray/outbound-subs/:id/refresh', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const target = state.outboundSubs.find((item) => Number(item.id) === Number(req.params.id));
        if (!target) return res.status(404).json({ success: false, msg: 'outbound sub not found' });
        target.lastUpdated = Math.floor(Date.now() / 1000);
        target.outboundCount = Array.isArray(target.outbounds) ? target.outbounds.length : 1;
        return makeSuccess(res, deepClone(target.outbounds || []));
    });

    app.post('/panel/api/xray/outbound-subs/:id/move', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const idx = state.outboundSubs.findIndex((item) => Number(item.id) === Number(req.params.id));
        if (idx < 0) return res.status(404).json({ success: false, msg: 'outbound sub not found' });
        const dir = toText(req.body?.dir).trim().toLowerCase();
        const swapWith = dir === 'up' ? idx - 1 : (dir === 'down' ? idx + 1 : -1);
        if (swapWith >= 0 && swapWith < state.outboundSubs.length) {
            [state.outboundSubs[idx], state.outboundSubs[swapWith]] = [state.outboundSubs[swapWith], state.outboundSubs[idx]];
        }
        return makeSuccess(res, deepClone(state.outboundSubs));
    });

    const handleDeleteOutboundSub = (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const before = state.outboundSubs.length;
        state.outboundSubs = state.outboundSubs.filter((item) => Number(item.id) !== Number(req.params.id));
        if (state.outboundSubs.length === before) return res.status(404).json({ success: false, msg: 'outbound sub not found' });
        return makeSuccess(res, { deleted: true });
    };
    app.post('/panel/api/xray/outbound-subs/:id/del', handleDeleteOutboundSub);
    app.delete('/panel/api/xray/outbound-subs/:id', handleDeleteOutboundSub);

    app.get('/panel/api/nodes/list', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, deepClone(state.nodes));
    });

    app.post('/panel/api/nodes/test', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, { status: 'online', latencyMs: 12 });
    });

    app.post('/panel/api/nodes/certFingerprint', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    });

    app.post('/panel/api/nodes/inbounds', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, deepClone(state.inbounds.map((item) => ({
            id: item.id,
            remark: item.remark,
            tag: item.tag || `inbound-${item.port}`,
            protocol: item.protocol,
            port: item.port,
        }))));
    });

    app.post('/panel/api/nodes/add', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const body = deepClone(req.body || {});
        const created = {
            ...body,
            id: nextNodeId++,
            enable: body.enable !== false,
            status: 'online',
            latencyMs: 15,
            cpuPct: 12,
            memPct: 28,
            clientCount: 0,
            inboundCount: state.inbounds.length,
        };
        state.nodes.push(created);
        return makeSuccess(res, deepClone(created));
    });

    app.post('/panel/api/nodes/update/:id', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const idx = state.nodes.findIndex((item) => Number(item.id) === Number(req.params.id));
        if (idx < 0) return res.status(404).json({ success: false, msg: 'node not found' });
        state.nodes[idx] = { ...state.nodes[idx], ...deepClone(req.body || {}), id: state.nodes[idx].id };
        return makeSuccess(res, deepClone(state.nodes[idx]));
    });

    app.post('/panel/api/nodes/probe/:id', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const node = state.nodes.find((item) => Number(item.id) === Number(req.params.id));
        if (!node) return res.status(404).json({ success: false, msg: 'node not found' });
        node.status = 'online';
        node.latencyMs = 14;
        return makeSuccess(res, { status: node.status, latencyMs: node.latencyMs });
    });

    app.post('/panel/api/nodes/setEnable/:id', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const node = state.nodes.find((item) => Number(item.id) === Number(req.params.id));
        if (!node) return res.status(404).json({ success: false, msg: 'node not found' });
        node.enable = normalizeBoolean(req.body?.enable, true);
        return makeSuccess(res, deepClone(node));
    });

    app.post('/panel/api/nodes/updatePanel', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, { updated: true });
    });

    app.post('/panel/api/nodes/mtls/ca', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        return makeSuccess(res, { ca: 'mock-mtls-ca' });
    });

    app.post('/panel/api/nodes/del/:id', (req, res) => {
        if (isLegacy) return rejectLegacy(res);
        const before = state.nodes.length;
        state.nodes = state.nodes.filter((item) => Number(item.id) !== Number(req.params.id));
        if (state.nodes.length === before) return res.status(404).json({ success: false, msg: 'node not found' });
        return makeSuccess(res, { deleted: true });
    });

    const handleResetInboundTraffic = (req, res) => {
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
    };

    app.post('/panel/api/inbounds/:id/resetTraffic', handleResetInboundTraffic);
    app.post('/panel/api/inbounds/resetAllClientTraffics/:id', handleResetInboundTraffic);
    app.post('/panel/api/inbounds/resetTraffic/:id', handleResetInboundTraffic);

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

    app.post('/panel/api/clients/ips/:email', (req, res) => {
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

    app.post('/panel/api/clients/clearIps/:email', (req, res) => {
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

    const buildSettingsPayload = () => ({
        webPort: 2053,
        webDomain: definition.host,
        xrayTemplateConfig: JSON.stringify(state.xrayTemplate),
    });

    const buildXrayPayload = () => JSON.stringify({
        xraySetting: state.xrayTemplate,
        inboundTags: [],
        clientReverseTags: [],
        outboundTestUrl: 'https://www.google.com/generate_204',
    });

    const handleSettingsRead = (_req, res) => {
        return makeSuccess(res, buildSettingsPayload());
    };

    const handleSettingsUpdate = (req, res) => {
        if (typeof req.body?.xrayTemplateConfig === 'string') {
            try {
                state.xrayTemplate = JSON.parse(req.body.xrayTemplateConfig);
            } catch {
                return res.status(400).json({ success: false, msg: 'invalid xrayTemplateConfig' });
            }
        }
        return makeSuccess(res, { updated: true });
    };

    const handleXrayRead = (_req, res) => {
        return makeSuccess(res, buildXrayPayload());
    };

    const handleXrayUpdate = (req, res) => {
        const raw = typeof req.body?.xraySetting === 'string' ? req.body.xraySetting : req.body?.xrayConfig;
        if (typeof raw === 'string') {
            try {
                state.xrayTemplate = JSON.parse(raw);
            } catch {
                return res.status(400).json({ success: false, msg: 'invalid xraySetting' });
            }
        }
        return makeSuccess(res, { updated: true });
    };

    app.get('/panel/setting/all', handleSettingsRead);
    app.post('/panel/setting/all', handleSettingsRead);
    app.post('/panel/api/setting/all', handleSettingsRead);

    app.post('/panel/api/xray/', handleXrayRead);
    app.post('/panel/api/xray/update', handleXrayUpdate);
    app.post('/panel/xray/updateXrayConfig', handleXrayUpdate);

    app.post('/panel/setting/update', handleSettingsUpdate);
    app.post('/panel/api/setting/update', handleSettingsUpdate);

    const handleTokenList = (_req, res) => {
        return makeSuccess(res, state.apiTokens);
    };

    const handleTokenCreate = (req, res) => {
        const name = toText(req.body?.name).trim();
        if (!name) {
            return res.status(400).json({
                success: false,
                msg: 'token name is required',
            });
        }
        if (state.apiTokens.some((token) => token.name === name)) {
            return res.status(409).json({
                success: false,
                msg: 'a token with that name already exists',
            });
        }
        const row = {
            id: state.apiTokens.reduce((max, token) => Math.max(max, Number(token.id) || 0), 0) + 1,
            name,
            token: crypto.randomBytes(24).toString('hex'),
            enabled: true,
            createdAt: Math.floor(Date.now() / 1000),
        };
        state.apiTokens.push(row);
        return makeSuccess(res, row);
    };

    const handleTokenDelete = (req, res) => {
        const before = state.apiTokens.length;
        state.apiTokens = state.apiTokens.filter((token) => String(token.id) !== String(req.params.id));
        return makeSuccess(res, {
            deleted: before - state.apiTokens.length,
        });
    };

    const handleTokenSetEnabled = (req, res) => {
        const target = state.apiTokens.find((token) => String(token.id) === String(req.params.id));
        if (!target) {
            return res.status(404).json({
                success: false,
                msg: 'token not found',
            });
        }
        target.enabled = normalizeBoolean(req.body?.enabled, target.enabled !== false);
        return makeSuccess(res, target);
    };

    app.get('/panel/setting/apiTokens', handleTokenList);
    app.get('/panel/api/setting/apiTokens', handleTokenList);
    app.post('/panel/setting/apiTokens/create', handleTokenCreate);
    app.post('/panel/api/setting/apiTokens/create', handleTokenCreate);
    app.post('/panel/setting/apiTokens/delete/:id', handleTokenDelete);
    app.post('/panel/api/setting/apiTokens/delete/:id', handleTokenDelete);
    app.post('/panel/setting/apiTokens/setEnabled/:id', handleTokenSetEnabled);
    app.post('/panel/api/setting/apiTokens/setEnabled/:id', handleTokenSetEnabled);

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
            sui: toPort(args['sui-port'] || process.env.REVIEW_PANEL_PORT_SUI, REVIEW_PANEL_PORTS.sui),
        },
    });

    const servers = [];
    for (const definition of definitions) {
        const app = definition.panelType === 's-ui'
            ? createFakeSuiPanelApp(createFakeSuiState(definition.seed), { basePath: definition.basePath })
            : createPanelApp(definition);
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
            panelType: item.panelType || '3x-ui',
            url: item.url,
            basePath: item.basePath || '/',
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
