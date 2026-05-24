import { normalizePanelErrorMessage } from './panelClient.js';

const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeProtocol(value) {
    return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function encodePathSegment(value) {
    return encodeURIComponent(normalizeText(value));
}

function normalizeInboundId(value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    return value;
}

function normalizeInboundIds(values = []) {
    return (Array.isArray(values) ? values : [values])
        .map((item) => normalizeInboundId(item))
        .filter((item) => item !== '' && item !== null && item !== undefined);
}

function hasBusinessNotFoundMessage(message = '') {
    const lower = String(message || '').toLowerCase();
    return lower.includes('client not found')
        || lower.includes('inbound not found')
        || lower.includes('record not found')
        || lower.includes('user not found');
}

export function isUnsupportedPanelEndpointError(error) {
    const status = Number(error?.response?.status || 0);
    if ([405, 410, 501].includes(status)) return true;
    const message = normalizePanelErrorMessage(error, '').toLowerCase();
    if (status === 404) {
        return !hasBusinessNotFoundMessage(message);
    }
    return message.includes('method not allowed')
        || message.includes('unsupported')
        || message.includes('not support')
        || message.includes('not implemented')
        || message.includes('no route');
}

export function buildFormBody(data = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(data || {})) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
        } else {
            params.append(key, String(value));
        }
    }
    return params.toString();
}

function parseMaybeJson(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(String(value));
    } catch {
        return fallback;
    }
}

export function parseInboundClients(inbound = {}) {
    const settings = parseMaybeJson(inbound?.settings, {});
    return Array.isArray(settings?.clients) ? settings.clients : [];
}

export function resolveClientIdentifier(client = {}, protocol = '') {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.password || client.id || client.email);
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.id || client.password || client.email);
    }
    return normalizeText(client.id || client.password || client.auth || client.email);
}

function clientMatchesIdentifier(client = {}, identifier = '', protocol = '') {
    const needle = normalizeText(identifier);
    if (!needle) return false;
    const candidates = [
        resolveClientIdentifier(client, protocol),
        client.id,
        client.password,
        client.auth,
        client.email,
    ].map(normalizeText).filter(Boolean);
    return candidates.includes(needle);
}

function panelResponseIsFailure(response) {
    return response?.data
        && typeof response.data === 'object'
        && response.data.success === false;
}

function createPanelResponseError(response, fallbackMessage = 'panel request failed') {
    const message = normalizeText(response?.data?.msg || response?.data?.message || fallbackMessage);
    const error = new Error(message || fallbackMessage);
    error.response = {
        status: Number(response?.status || 502),
        data: response?.data || { success: false, msg: message || fallbackMessage },
    };
    return error;
}

function assertPanelResponseSuccess(response, fallbackMessage) {
    if (panelResponseIsFailure(response)) {
        throw createPanelResponseError(response, fallbackMessage);
    }
    return response;
}

function valuesEqual(field, left, right) {
    if (field === 'email') return normalizeEmail(left) === normalizeEmail(right);
    if (['expiryTime', 'limitIp', 'totalGB'].includes(field)) {
        return Number(left || 0) === Number(right || 0);
    }
    if (field === 'enable') return (left !== false) === (right !== false);
    return normalizeText(left) === normalizeText(right);
}

function clientUpdateMatches(actual = {}, expected = {}) {
    const fields = ['email', 'id', 'password', 'subId', 'flow', 'expiryTime', 'limitIp', 'totalGB', 'enable'];
    return fields.every((field) => {
        if (!Object.prototype.hasOwnProperty.call(expected || {}, field)) return true;
        return valuesEqual(field, actual?.[field], expected?.[field]);
    });
}

function findUpdatedClient(clients = [], clientIdentifier = '', protocol = '', clientData = {}, options = {}) {
    const emailCandidates = [
        clientData?.email,
        options.currentEmail,
        options.email,
        options.sourceClient?.email,
    ].map(normalizeEmail).filter(Boolean);

    for (const email of emailCandidates) {
        const match = clients.find((item) => normalizeEmail(item?.email) === email);
        if (match) return match;
    }

    const identifierMatch = clients.find((item) => clientMatchesIdentifier(item, clientIdentifier, protocol));
    if (identifierMatch) return identifierMatch;

    const nextIdentifier = resolveClientIdentifier(clientData, protocol);
    if (nextIdentifier) {
        return clients.find((item) => clientMatchesIdentifier(item, nextIdentifier, protocol)) || null;
    }

    return null;
}

async function legacyUpdateAppearsApplied(panelClient, inboundId, clientIdentifier, clientData = {}, options = {}) {
    try {
        const inbound = await fetchInboundById(panelClient, inboundId);
        const protocol = normalizeProtocol(options.protocol || inbound?.protocol || clientData?.protocol);
        const match = findUpdatedClient(parseInboundClients(inbound), clientIdentifier, protocol, clientData, options);
        return Boolean(match && clientUpdateMatches(match, clientData));
    } catch {
        return true;
    }
}

async function postJson(client, path, data = {}) {
    return client.post(path, data, {
        headers: { 'Content-Type': 'application/json' },
    });
}

async function postForm(client, path, data = {}) {
    return client.post(path, buildFormBody(data), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
}

async function fetchInboundById(panelClient, inboundId) {
    const normalizedId = normalizeText(inboundId);
    try {
        const response = await panelClient.get(`/panel/api/inbounds/get/${encodePathSegment(normalizedId)}`);
        if (response?.data?.obj && typeof response.data.obj === 'object') {
            return response.data.obj;
        }
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    const response = await panelClient.get('/panel/api/inbounds/list');
    const items = Array.isArray(response?.data?.obj) ? response.data.obj : [];
    return items.find((item) => normalizeText(item?.id) === normalizedId) || null;
}

export async function fetchPanelInboundByIdCompat(panelClient, inboundId) {
    return fetchInboundById(panelClient, inboundId);
}

async function resolveClientEmailForInbound(panelClient, inboundId, clientIdentifier, options = {}) {
    const explicitEmail = normalizeEmail(options.currentEmail || options.email || options.sourceClient?.email);
    if (explicitEmail) return explicitEmail;

    const inbound = await fetchInboundById(panelClient, inboundId);
    const protocol = normalizeProtocol(options.protocol || inbound?.protocol);
    const clients = parseInboundClients(inbound);
    const match = clients.find((item) => clientMatchesIdentifier(item, clientIdentifier, protocol));
    const matchedEmail = normalizeEmail(match?.email);
    if (matchedEmail) return matchedEmail;

    const identifierAsEmail = normalizeEmail(clientIdentifier);
    if (identifierAsEmail.includes('@')) return identifierAsEmail;

    return normalizeEmail(options.clientData?.email);
}

function parseLegacyClientSettingsPayload(payload = {}) {
    const settings = parseMaybeJson(payload?.settings, {});
    const clients = Array.isArray(settings?.clients) ? settings.clients : [];
    return clients[0] || null;
}

export function normalizeLegacyClientPayload(payload = {}) {
    return parseLegacyClientSettingsPayload(payload) || payload || {};
}

export async function fetchPanelOnlineClients(panelClient) {
    try {
        return await panelClient.post('/panel/api/clients/onlines');
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return panelClient.post('/panel/api/inbounds/onlines');
    }
}

export async function getClientIpsCompat(panelClient, email) {
    const encoded = encodePathSegment(email);
    try {
        return await panelClient.post(`/panel/api/clients/ips/${encoded}`);
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return panelClient.post(`/panel/api/inbounds/clientIps/${encoded}`);
    }
}

export async function clearClientIpsCompat(panelClient, email) {
    const encoded = encodePathSegment(email);
    try {
        return await panelClient.post(`/panel/api/clients/clearIps/${encoded}`);
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return panelClient.post(`/panel/api/inbounds/clearClientIps/${encoded}`);
    }
}

export async function postAddClientCompat(panelClient, inboundId, clientData) {
    try {
        return await postJson(panelClient, '/panel/api/clients/add', {
            client: clientData,
            inboundIds: normalizeInboundIds([inboundId]),
        });
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return postForm(panelClient, '/panel/api/inbounds/addClient', {
            id: inboundId,
            settings: { clients: [clientData] },
        });
    }
}

export async function postUpdateClientCompat(panelClient, inboundId, clientIdentifier, clientData, options = {}) {
    const encodedIdentifier = encodePathSegment(clientIdentifier);
    let legacyError = null;

    try {
        const response = assertPanelResponseSuccess(await postForm(panelClient, `/panel/api/inbounds/updateClient/${encodedIdentifier}`, {
            id: inboundId,
            settings: { clients: [clientData] },
        }), 'legacy updateClient failed');
        if (await legacyUpdateAppearsApplied(panelClient, inboundId, clientIdentifier, clientData, options)) {
            return response;
        }
    } catch (formError) {
        legacyError = formError;
    }

    try {
        const response = assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/inbounds/updateClient/${encodedIdentifier}`, clientData),
            'legacy updateClient JSON failed'
        );
        if (await legacyUpdateAppearsApplied(panelClient, inboundId, clientIdentifier, clientData, options)) {
            return response;
        }
    } catch (jsonError) {
        legacyError = jsonError;
    }

    const currentEmail = await resolveClientEmailForInbound(panelClient, inboundId, clientIdentifier, {
        ...options,
        clientData,
    });
    if (!currentEmail) {
        throw legacyError || new Error('Unable to resolve client email for latest 3x-ui update API');
    }
    return assertPanelResponseSuccess(
        await postJson(panelClient, `/panel/api/clients/update/${encodePathSegment(currentEmail)}`, clientData),
        'latest updateClient failed'
    );
}

async function postDetachClientFromInboundV3(panelClient, inboundId, email) {
    return postJson(panelClient, `/panel/api/clients/${encodePathSegment(email)}/detach`, {
        inboundIds: normalizeInboundIds([inboundId]),
    });
}

async function fetchClientRecordByEmailV3(panelClient, email) {
    try {
        const response = await panelClient.get(`/panel/api/clients/get/${encodePathSegment(email)}`);
        return response?.data?.obj && typeof response.data.obj === 'object'
            ? response.data.obj
            : null;
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return null;
    }
}

function normalizeClientRecordPayload(payload = {}) {
    if (payload?.client && typeof payload.client === 'object') {
        return {
            client: payload.client,
            inboundIds: normalizeInboundIds(payload.inboundIds),
        };
    }
    if (payload && typeof payload === 'object') {
        return {
            client: payload,
            inboundIds: normalizeInboundIds(payload.inboundIds),
        };
    }
    return {
        client: null,
        inboundIds: [],
    };
}

export async function fetchClientRecordCompat(panelClient, email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return { client: null, inboundIds: [] };

    const latest = await fetchClientRecordByEmailV3(panelClient, normalizedEmail);
    if (latest) {
        return normalizeClientRecordPayload(latest);
    }

    const response = await panelClient.get('/panel/api/inbounds/list');
    const inbounds = Array.isArray(response?.data?.obj) ? response.data.obj : [];
    const inboundIds = [];
    let found = null;
    for (const inbound of inbounds) {
        const match = parseInboundClients(inbound)
            .find((item) => normalizeEmail(item?.email) === normalizedEmail);
        if (!match) continue;
        inboundIds.push(normalizeInboundId(inbound?.id));
        found = found || match;
    }

    return {
        client: found,
        inboundIds,
    };
}

async function removeClientFromInboundV3(panelClient, inboundId, email) {
    const clientRecord = await fetchClientRecordByEmailV3(panelClient, email);
    const inboundIds = normalizeInboundIds(clientRecord?.inboundIds);
    const onlyAttachedToCurrentInbound = inboundIds.length === 1
        && normalizeText(inboundIds[0]) === normalizeText(inboundId);

    if (onlyAttachedToCurrentInbound) {
        return panelClient.post(`/panel/api/clients/del/${encodePathSegment(email)}`);
    }

    return postDetachClientFromInboundV3(panelClient, inboundId, email);
}

export async function postAttachClientToInboundsCompat(panelClient, email, inboundIds = [], options = {}) {
    const normalizedEmail = normalizeEmail(email || options.clientData?.email);
    const targetInboundIds = normalizeInboundIds(inboundIds);
    if (!normalizedEmail || targetInboundIds.length === 0) {
        throw new Error('email and inboundIds are required');
    }

    try {
        return await postJson(panelClient, `/panel/api/clients/${encodePathSegment(normalizedEmail)}/attach`, {
            inboundIds: targetInboundIds,
        });
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    let sourceClient = options.clientData || null;
    if (!sourceClient) {
        const record = await fetchClientRecordCompat(panelClient, normalizedEmail);
        sourceClient = record.client;
    }
    if (!sourceClient) {
        throw new Error('Unable to resolve client data for legacy attach API');
    }

    for (const inboundId of targetInboundIds) {
        await postAddClientCompat(panelClient, inboundId, {
            ...sourceClient,
            email: normalizedEmail,
        });
    }
    return {
        status: 200,
        data: {
            success: true,
            obj: { attached: targetInboundIds.length },
        },
    };
}

export async function postDetachClientFromInboundsCompat(panelClient, email, inboundIds = []) {
    const normalizedEmail = normalizeEmail(email);
    const targetInboundIds = normalizeInboundIds(inboundIds);
    if (!normalizedEmail || targetInboundIds.length === 0) {
        throw new Error('email and inboundIds are required');
    }

    try {
        return await postJson(panelClient, `/panel/api/clients/${encodePathSegment(normalizedEmail)}/detach`, {
            inboundIds: targetInboundIds,
        });
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    for (const inboundId of targetInboundIds) {
        await postDeleteClientFromInboundCompat(panelClient, inboundId, normalizedEmail, {
            email: normalizedEmail,
        });
    }
    return {
        status: 200,
        data: {
            success: true,
            obj: { detached: targetInboundIds.length },
        },
    };
}

export async function postBulkAdjustClientsCompat(panelClient, payload = {}) {
    const emails = Array.from(new Set(
        (Array.isArray(payload.emails) ? payload.emails : [])
            .map((item) => normalizeEmail(item))
            .filter(Boolean)
    ));
    const addDays = Number(payload.addDays || 0) || 0;
    const addBytes = Number(payload.addBytes || 0) || 0;

    try {
        return await postJson(panelClient, '/panel/api/clients/bulkAdjust', {
            emails,
            addDays,
            addBytes,
        });
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    return {
        status: 501,
        data: {
            success: false,
            msg: 'Bulk adjust is not supported by this panel version',
        },
    };
}

export async function postDeleteClientFromInboundCompat(panelClient, inboundId, clientIdentifier, options = {}) {
    const encodedId = encodePathSegment(clientIdentifier);
    let oldPathError = null;

    try {
        return await panelClient.post(`/panel/api/inbounds/${encodePathSegment(inboundId)}/delClient/${encodedId}`);
    } catch (error) {
        oldPathError = error;
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    try {
        return await panelClient.post(`/panel/api/inbounds/delClient/${encodePathSegment(inboundId)}`, {
            id: clientIdentifier,
        });
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    const email = await resolveClientEmailForInbound(panelClient, inboundId, clientIdentifier, options);
    if (!email) {
        throw oldPathError || new Error('Unable to resolve client email for latest 3x-ui detach API');
    }
    return removeClientFromInboundV3(panelClient, inboundId, email);
}

async function resetInboundClientTrafficsByEmail(panelClient, inboundId) {
    const inbound = await fetchInboundById(panelClient, inboundId);
    const clients = parseInboundClients(inbound);
    const emails = Array.from(new Set(
        clients.map((item) => normalizeEmail(item?.email)).filter(Boolean)
    ));
    for (const email of emails) {
        await panelClient.post(`/panel/api/clients/resetTraffic/${encodePathSegment(email)}`);
    }
}

export async function resetInboundTrafficCompat(panelClient, inboundId) {
    let lastError = null;

    try {
        const response = await panelClient.post(`/panel/api/inbounds/${encodePathSegment(inboundId)}/resetTraffic`);
        await resetInboundClientTrafficsByEmail(panelClient, inboundId);
        return response;
    } catch (error) {
        lastError = error;
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    const legacyPaths = [
        `/panel/api/inbounds/resetAllClientTraffics/${encodePathSegment(inboundId)}`,
        `/panel/api/inbounds/resetTraffic/${encodePathSegment(inboundId)}`,
    ];
    for (const path of legacyPaths) {
        try {
            return await panelClient.post(path);
        } catch (error) {
            lastError = error;
            if (!isUnsupportedPanelEndpointError(error)) {
                throw error;
            }
        }
    }

    throw lastError || new Error(`Failed to reset inbound traffic for ${inboundId}`);
}

function resolveClientTraffic(client = {}, statsByEmail = new Map()) {
    const email = normalizeEmail(client?.email);
    const stat = statsByEmail.get(email) || {};
    return {
        email,
        up: Number(stat.up ?? client.up ?? 0) || 0,
        down: Number(stat.down ?? client.down ?? 0) || 0,
        total: Number(stat.total ?? client.total ?? client.totalGB ?? 0) || 0,
        expiryTime: Number(stat.expiryTime ?? client.expiryTime ?? 0) || 0,
        reset: Number(stat.reset ?? client.reset ?? 0) || 0,
    };
}

export async function cleanupDepletedClientsCompat(panelClient, inboundId) {
    try {
        return await panelClient.post(`/panel/api/inbounds/delDepletedClients/${encodePathSegment(inboundId)}`);
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    const inbound = await fetchInboundById(panelClient, inboundId);
    if (!inbound) {
        const error = new Error('inbound not found');
        error.response = { status: 404, data: { success: false, msg: 'inbound not found' } };
        throw error;
    }

    const stats = Array.isArray(inbound.clientStats) ? inbound.clientStats : [];
    const statsByEmail = new Map(stats.map((item) => [normalizeEmail(item?.email), item]).filter(([email]) => email));
    const now = Date.now();
    let deleted = 0;

    for (const client of parseInboundClients(inbound)) {
        const traffic = resolveClientTraffic(client, statsByEmail);
        const depleted = traffic.reset === 0 && (
            (traffic.total > 0 && traffic.up + traffic.down >= traffic.total)
            || (traffic.expiryTime > 0 && traffic.expiryTime <= now)
        );
        if (!depleted || !traffic.email) continue;

        const identifier = resolveClientIdentifier(client, inbound.protocol) || traffic.email;
        await removeClientFromInboundV3(panelClient, inboundId, traffic.email);
        deleted += identifier ? 1 : 0;
    }

    return {
        status: 200,
        data: {
            success: true,
            obj: { deleted },
        },
    };
}

export function parseLegacyAddClientBody(body = {}) {
    const client = parseLegacyClientSettingsPayload(body);
    return {
        inboundId: body?.id,
        client,
    };
}

export function parseLegacyUpdateClientBody(body = {}) {
    return normalizeLegacyClientPayload(body);
}
