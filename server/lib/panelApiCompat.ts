import { normalizePanelErrorMessage } from './panelClient.js';
import { normalizePanelType, PANEL_TYPE_SUI } from './panelType.js';
import { normalizeInboundPayloadForXui } from './xuiInboundNormalizer.js';

const UUID_PROTOCOLS = new Set<string>(['vmess', 'vless', 'tuic']);
const PASSWORD_PROTOCOLS = new Set<string>(['trojan', 'shadowsocks']);
const AUTH_PROTOCOLS = new Set<string>(['hysteria', 'hysteria2', 'hy2']);

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeProtocol(value: unknown): string {
    return normalizeText(value).toLowerCase();
}

// A client's `email` is the panel's client name, not necessarily an address
// (e.g. `PH-菲律宾`), and 3x-ui looks it up case-sensitively. Fold case only to
// compare names; anything sent to the panel keeps the stored spelling.
function clientEmailKey(value: unknown): string {
    return normalizeText(value).toLowerCase();
}

function normalizeClientEmail(value: unknown): string {
    return normalizeText(value);
}

// Exact spelling first, so `PH-x` and `ph-x` on one panel stay distinct.
function findClientByEmail(clients: any[] = [], email: unknown): any {
    const exact = normalizeClientEmail(email);
    if (!exact) return null;
    const key = clientEmailKey(exact);
    return clients.find((item) => normalizeClientEmail(item?.email) === exact)
        || clients.find((item) => clientEmailKey(item?.email) === key)
        || null;
}

function encodePathSegment(value: unknown): string {
    return encodeURIComponent(normalizeText(value));
}

function normalizeInboundId(value: unknown): string | number {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    return value as string;
}

export function normalizeInboundIds(values: unknown = []): (string | number)[] {
    return (Array.isArray(values) ? values : [values])
        .map((item) => normalizeInboundId(item))
        .filter((item) => item !== '' && item !== null && item !== undefined);
}

function hasBusinessNotFoundMessage(message: string = ''): boolean {
    const lower = String(message || '').toLowerCase();
    return lower.includes('client not found')
        || lower.includes('inbound not found')
        || lower.includes('record not found')
        || lower.includes('user not found');
}

export function isUnsupportedPanelEndpointError(error: any): boolean {
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

export function buildFormBody(data: Record<string, any> = {}): string {
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

function parseMaybeJson(value: unknown, fallback: any = null): any {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(String(value));
    } catch {
        return fallback;
    }
}

export function sanitizeClientPayloadForPanel(client: any = {}): any {
    if (!client || typeof client !== 'object') return client;
    const sanitized = { ...client };
    if ('tgId' in sanitized) {
        sanitized.tgId = sanitized.tgId !== undefined && sanitized.tgId !== null && sanitized.tgId !== ''
            ? (Number(sanitized.tgId) || 0)
            : 0;
    }
    if ('limitIp' in sanitized) {
        sanitized.limitIp = Number(sanitized.limitIp) || 0;
    }
    if ('totalGB' in sanitized) {
        sanitized.totalGB = Number(sanitized.totalGB) || 0;
    }
    if ('expiryTime' in sanitized) {
        sanitized.expiryTime = Number(sanitized.expiryTime) || 0;
    }
    if ('reset' in sanitized) {
        sanitized.reset = Number(sanitized.reset) || 0;
    }
    if ('speedLimitUp' in sanitized) {
        sanitized.speedLimitUp = Number(sanitized.speedLimitUp) || 0;
    }
    if ('speedLimitDown' in sanitized) {
        sanitized.speedLimitDown = Number(sanitized.speedLimitDown) || 0;
    }
    if ('enable' in sanitized && typeof sanitized.enable !== 'boolean') {
        sanitized.enable = sanitized.enable !== 'false' && sanitized.enable !== false && sanitized.enable !== 0 && sanitized.enable !== '0';
    }
    return sanitized;
}

export function sanitizeSettingsForPanel(settings: any): any {
    if (!settings) return settings;
    let parsed = settings;
    let isString = false;
    if (typeof settings === 'string') {
        try {
            parsed = JSON.parse(settings);
            isString = true;
        } catch {
            return settings;
        }
    }
    if (parsed && typeof parsed === 'object') {
        let changed = false;
        let sanitized = { ...parsed };
        if (Array.isArray(parsed.clients)) {
            sanitized.clients = parsed.clients.map((c: any) => sanitizeClientPayloadForPanel(c));
            changed = true;
        }
        if (Array.isArray(parsed.users)) {
            sanitized.users = parsed.users.map((c: any) => sanitizeClientPayloadForPanel(c));
            changed = true;
        }
        if (changed) {
            return isString ? JSON.stringify(sanitized) : sanitized;
        }
    }
    return settings;
}

export function sanitizeInboundPayloadForPanel(inboundData: any = {}): any {
    if (!inboundData || typeof inboundData !== 'object') return inboundData;
    const payload = { ...inboundData };
    if ('settings' in payload && payload.settings !== undefined) {
        payload.settings = sanitizeSettingsForPanel(payload.settings);
    }
    return payload;
}

/**
 * 3x-ui has no `hysteria2` protocol: Hysteria2 is `protocol: "hysteria"` with
 * `version: 2`, clients keyed by `auth` and a `hysteria` stream network.
 * Xray only runs version 2, so v1-shaped payloads are converted too.
 * s-ui keeps its own `hysteria2` type, so this only runs for 3x-ui panels.
 */
export function normalizeHysteriaInboundForXui(inboundData: any = {}): any {
    if (!inboundData || typeof inboundData !== 'object') return inboundData;
    const protocol = normalizeProtocol(inboundData.protocol);
    if (protocol !== 'hysteria2' && protocol !== 'hy2' && protocol !== 'hysteria') return inboundData;
    return normalizeInboundPayloadForXui(inboundData);
}

function isSuiPanelClient(panelClient: any): boolean {
    return normalizePanelType(panelClient?.nmsPanelType) === PANEL_TYPE_SUI;
}

function prepareInboundPayload(panelClient: any, inboundData: any): any {
    const payload = sanitizeInboundPayloadForPanel(inboundData);
    return isSuiPanelClient(panelClient) ? payload : normalizeInboundPayloadForXui(payload);
}

export function parseInboundClients(inbound: any = {}): any[] {
    const settings = parseMaybeJson(inbound?.settings, {});
    if (Array.isArray(settings?.clients)) return settings.clients;
    if (Array.isArray(settings?.users)) return settings.users;
    if (Array.isArray(settings?.accounts)) return settings.accounts;
    return [];
}

export function resolveClientIdentifier(client: any = {}, protocol: string = ''): string {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.password || client.id || client.uuid || client.email);
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.uuid || client.id || client.password || client.email);
    }
    if (AUTH_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.auth || client.password || client.id || client.email);
    }
    return normalizeText(client.id || client.uuid || client.password || client.auth || client.email);
}

function clientMatchesIdentifier(client: any = {}, identifier: string = '', protocol: string = ''): boolean {
    const needle = normalizeText(identifier);
    if (!needle) return false;
    const candidates = [
        resolveClientIdentifier(client, protocol),
        client.id,
        client.uuid,
        client.password,
        client.auth,
        client.email,
    ].map(normalizeText).filter(Boolean);
    return candidates.includes(needle);
}

function panelResponseIsFailure(response: any): boolean {
    return response?.data
        && typeof response.data === 'object'
        && response.data.success === false;
}

function createPanelResponseError(response: any, fallbackMessage: string = 'panel request failed'): Error & { response?: any } {
    const message = normalizeText(response?.data?.msg || response?.data?.message || fallbackMessage);
    const error: any = new Error(message || fallbackMessage);
    error.response = {
        status: Number(response?.status || 502),
        data: response?.data || { success: false, msg: message || fallbackMessage },
    };
    return error;
}

function assertPanelResponseSuccess(response: any, fallbackMessage: string): any {
    if (panelResponseIsFailure(response)) {
        throw createPanelResponseError(response, fallbackMessage);
    }
    return response;
}

function valuesEqual(field: string, left: any, right: any): boolean {
    // Exact: a case-only rename that the legacy route ignored must not pass as applied.
    if (field === 'email') return normalizeClientEmail(left) === normalizeClientEmail(right);
    if (['expiryTime', 'limitIp', 'totalGB'].includes(field)) {
        return Number(left || 0) === Number(right || 0);
    }
    if (field === 'enable') return (left !== false) === (right !== false);
    return normalizeText(left) === normalizeText(right);
}

function resolveActualFieldForMatch(actual: any, field: string): any {
    if (field === 'password') {
        return normalizeText(actual?.password) ? actual.password : actual?.auth;
    }
    if (field === 'auth') {
        return normalizeText(actual?.auth) ? actual.auth : actual?.password;
    }
    if (field === 'uuid') {
        return normalizeText(actual?.uuid) ? actual.uuid : actual?.id;
    }
    if (field === 'id') {
        return normalizeText(actual?.id) ? actual.id : actual?.uuid;
    }
    return actual?.[field];
}

export function clientUpdateMatches(actual: any = {}, expected: any = {}): boolean {
    const fields = ['email', 'id', 'uuid', 'password', 'auth', 'subId', 'flow', 'expiryTime', 'limitIp', 'totalGB', 'enable'];
    return fields.every((field) => {
        if (!Object.prototype.hasOwnProperty.call(expected || {}, field)) return true;
        return valuesEqual(field, resolveActualFieldForMatch(actual, field), expected?.[field]);
    });
}

function findUpdatedClient(clients: any[] = [], clientIdentifier: string = '', protocol: string = '', clientData: any = {}, options: any = {}): any {
    const emailCandidates = [
        clientData?.email,
        options.currentEmail,
        options.email,
        options.sourceClient?.email,
    ].map(normalizeClientEmail).filter(Boolean);

    for (const email of emailCandidates) {
        const match = findClientByEmail(clients, email);
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

async function legacyUpdateAppearsApplied(panelClient: any, inboundId: any, clientIdentifier: string, clientData: any = {}, options: any = {}): Promise<boolean> {
    if (typeof panelClient?.get !== 'function') {
        return true;
    }
    try {
        const inbound = await fetchInboundById(panelClient, inboundId);
        const protocol = normalizeProtocol(options.protocol || inbound?.protocol || clientData?.protocol);
        const match = findUpdatedClient(parseInboundClients(inbound), clientIdentifier, protocol, clientData, options);
        return Boolean(match && clientUpdateMatches(match, clientData));
    } catch {
        return false;
    }
}

async function postJson(client: any, path: string, data: any = {}): Promise<any> {
    const response = await client.post(path, data, {
        headers: { 'Content-Type': 'application/json' },
    });
    return assertPanelResponseSuccess(response, `Post json to ${path} failed`);
}

async function postForm(client: any, path: string, data: any = {}): Promise<any> {
    const response = await client.post(path, buildFormBody(data), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return assertPanelResponseSuccess(response, `Post form to ${path} failed`);
}

async function fetchInboundById(panelClient: any, inboundId: any): Promise<any> {
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
    return items.find((item: any) => normalizeText(item?.id) === normalizedId) || null;
}

export async function fetchPanelInboundByIdCompat(panelClient: any, inboundId: any): Promise<any> {
    return fetchInboundById(panelClient, inboundId);
}

async function resolveClientEmailForInbound(panelClient: any, inboundId: any, clientIdentifier: string, options: any = {}): Promise<string> {
    const explicitEmail = normalizeClientEmail(options.currentEmail || options.email || options.sourceClient?.email);

    if (typeof panelClient?.get === 'function') {
        let inbound: any = null;
        try {
            inbound = await fetchInboundById(panelClient, inboundId);
        } catch (error) {
            if (!explicitEmail) throw error;
        }
        const protocol = normalizeProtocol(options.protocol || inbound?.protocol);
        const clients = parseInboundClients(inbound || {});
        // Callers may only hold a case-folded copy of the name (NMS stores
        // subscription emails lowercased), so resolve the panel's own spelling.
        const match = explicitEmail
            ? findClientByEmail(clients, explicitEmail)
            : clients.find((item) => clientMatchesIdentifier(item, clientIdentifier, protocol));
        const matchedEmail = normalizeClientEmail(match?.email);
        if (matchedEmail) return matchedEmail;
    }
    if (explicitEmail) return explicitEmail;

    const identifierAsEmail = normalizeClientEmail(clientIdentifier);
    if (identifierAsEmail.includes('@')) return identifierAsEmail;

    return normalizeClientEmail(options.clientData?.email);
}

function parseLegacyClientSettingsPayload(payload: any = {}): any {
    const settings = parseMaybeJson(payload?.settings, {});
    const clients = Array.isArray(settings?.clients)
        ? settings.clients
        : (Array.isArray(settings?.users) ? settings.users : []);
    return clients[0] || null;
}

export function normalizeLegacyClientPayload(payload: any = {}): any {
    return parseLegacyClientSettingsPayload(payload) || payload || {};
}

function isOnlineGroupMapPayload(payload: any): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    return Object.values(payload).every((value) => Array.isArray(value));
}

export async function fetchPanelOnlineClients(panelClient: any): Promise<any> {
    try {
        // 3x-ui v3.4.0 reports multi-node online attribution by stable panel GUID.
        const response = await panelClient.post('/panel/api/clients/onlinesByGuid');
        if (
            response?.data?.success !== false
            && isOnlineGroupMapPayload(response?.data?.obj)
        ) {
            return response;
        }
    } catch {
        // Fall back for older panels and mocks that only expose legacy shapes.
    }

    try {
        // Compatibility with older/pre-release NMS-managed 3x-ui builds.
        const response = await panelClient.post('/panel/api/clients/onlinesByNode');
        if (
            response?.data?.success !== false
            && isOnlineGroupMapPayload(response?.data?.obj)
        ) {
            return response;
        }
    } catch {
        // Fall back on any error for this endpoint, including mock assertion failures
    }

    try {
        return await panelClient.post('/panel/api/clients/onlines');
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return panelClient.post('/panel/api/inbounds/onlines');
    }
}

export async function fetchPanelLastOnlineClients(panelClient: any): Promise<any> {
    try {
        return await panelClient.post('/panel/api/clients/lastOnline');
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return {
            status: 200,
            data: {
                success: true,
                obj: {},
            },
        };
    }
}

export async function getClientIpsCompat(panelClient: any, email: string): Promise<any> {
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

export async function clearClientIpsCompat(panelClient: any, email: string): Promise<any> {
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

function enrichCompatClientCredentials(clientData: any = {}, protocol: string = ''): any {
    if (!clientData || typeof clientData !== 'object') return clientData;
    const next = { ...clientData };
    const normalizedProtocol = normalizeProtocol(protocol || next.protocol);
    if (next.uuid && !next.id) {
        next.id = next.uuid;
    }
    if (next.auth && !next.password) {
        next.password = next.auth;
    }
    if (normalizedProtocol === 'tuic') {
        const uuid = normalizeText(next.uuid || next.id);
        if (uuid) {
            next.uuid = uuid;
            if (!next.id) next.id = uuid;
        }
    } else if (AUTH_PROTOCOLS.has(normalizedProtocol)) {
        const secret = normalizeText(next.auth || next.password);
        if (secret) {
            next.auth = secret;
            if (!next.password) next.password = secret;
        }
    }
    return next;
}

export async function postAddClientCompat(panelClient: any, inboundId: any, clientData: any, options: any = {}): Promise<any> {
    const sanitizedClient = enrichCompatClientCredentials(
        sanitizeClientPayloadForPanel(clientData),
        options?.protocol
    );
    try {
        return assertPanelResponseSuccess(await postJson(panelClient, '/panel/api/clients/add', {
            client: sanitizedClient,
            inboundIds: normalizeInboundIds([inboundId]),
        }), 'add client failed');
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        return assertPanelResponseSuccess(await postForm(panelClient, '/panel/api/inbounds/addClient', {
            id: inboundId,
            settings: { clients: [sanitizedClient] },
        }), 'add client failed');
    }
}

export async function postUpdateClientCompat(panelClient: any, inboundId: any, clientIdentifier: string, clientData: any, options: any = {}): Promise<any> {
    const sanitizedClient = enrichCompatClientCredentials(
        sanitizeClientPayloadForPanel(clientData),
        options?.protocol
    );
    const encodedIdentifier = encodePathSegment(clientIdentifier);
    let legacyError: any = null;

    try {
        const response = assertPanelResponseSuccess(await postForm(panelClient, `/panel/api/inbounds/updateClient/${encodedIdentifier}`, {
            id: inboundId,
            settings: { clients: [sanitizedClient] },
        }), 'legacy updateClient failed');
        if (await legacyUpdateAppearsApplied(panelClient, inboundId, clientIdentifier, sanitizedClient, options)) {
            return response;
        }
    } catch (formError) {
        legacyError = formError;
    }

    try {
        const response = assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/inbounds/updateClient/${encodedIdentifier}`, sanitizedClient),
            'legacy updateClient JSON failed'
        );
        if (await legacyUpdateAppearsApplied(panelClient, inboundId, clientIdentifier, sanitizedClient, options)) {
            return response;
        }
    } catch (jsonError) {
        legacyError = jsonError;
    }

    const currentEmail = await resolveClientEmailForInbound(panelClient, inboundId, clientIdentifier, {
        ...options,
        clientData: sanitizedClient,
    });
    if (!currentEmail) {
        throw legacyError || new Error('Unable to resolve client email for latest 3x-ui update API');
    }
    return assertPanelResponseSuccess(
        await postJson(panelClient, `/panel/api/clients/update/${encodePathSegment(currentEmail)}`, sanitizedClient),
        'latest updateClient failed'
    );
}

async function postDetachClientFromInboundV3(panelClient: any, inboundId: any, email: string): Promise<any> {
    return postJson(panelClient, `/panel/api/clients/${encodePathSegment(email)}/detach`, {
        inboundIds: normalizeInboundIds([inboundId]),
    });
}

async function fetchClientRecordByEmailV3(panelClient: any, email: string): Promise<any> {
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

function normalizeClientRecordPayload(payload: any = {}): { client: any; inboundIds: (string | number)[] } {
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

export async function fetchClientRecordCompat(panelClient: any, email: string): Promise<{ client: any; inboundIds: (string | number)[] }> {
    const normalizedEmail = normalizeClientEmail(email);
    if (!normalizedEmail) return { client: null, inboundIds: [] };

    const latest = await fetchClientRecordByEmailV3(panelClient, normalizedEmail);
    if (latest) {
        return normalizeClientRecordPayload(latest);
    }

    const response = await panelClient.get('/panel/api/inbounds/list');
    const inbounds = Array.isArray(response?.data?.obj) ? response.data.obj : [];
    // Settle on one stored spelling first, then collect only that client's inbounds.
    const storedEmail = normalizeClientEmail(
        findClientByEmail(inbounds.flatMap((inbound: any) => parseInboundClients(inbound)), normalizedEmail)?.email
    );
    const inboundIds: (string | number)[] = [];
    let found: any = null;
    for (const inbound of storedEmail ? inbounds : []) {
        const match = parseInboundClients(inbound).find((item) => normalizeClientEmail(item?.email) === storedEmail);
        if (!match) continue;
        inboundIds.push(normalizeInboundId(inbound?.id));
        found = found || match;
    }

    return {
        client: found,
        inboundIds,
    };
}

async function removeClientFromInboundV3(panelClient: any, inboundId: any, email: string): Promise<any> {
    const clientRecord = await fetchClientRecordByEmailV3(panelClient, email);
    const inboundIds = normalizeInboundIds(clientRecord?.inboundIds);
    const onlyAttachedToCurrentInbound = inboundIds.length === 1
        && normalizeText(inboundIds[0]) === normalizeText(inboundId);

    if (onlyAttachedToCurrentInbound) {
        return assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/clients/del/${encodePathSegment(email)}`),
            'Delete client V3 failed'
        );
    }

    return postDetachClientFromInboundV3(panelClient, inboundId, email);
}

export async function postAttachClientToInboundsCompat(panelClient: any, email: string, inboundIds: any[] = [], options: any = {}): Promise<any> {
    const normalizedEmail = normalizeClientEmail(email || options.clientData?.email);
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
    let attachEmail = normalizedEmail;
    if (!sourceClient) {
        const record = await fetchClientRecordCompat(panelClient, normalizedEmail);
        sourceClient = record.client;
        // Copy the existing client under its stored spelling, not a case-folded duplicate.
        attachEmail = normalizeClientEmail(sourceClient?.email) || normalizedEmail;
    }
    if (!sourceClient) {
        throw new Error('Unable to resolve client data for legacy attach API');
    }

    for (const inboundId of targetInboundIds) {
        await postAddClientCompat(panelClient, inboundId, {
            ...sourceClient,
            email: attachEmail,
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

export async function postDetachClientFromInboundsCompat(panelClient: any, email: string, inboundIds: any[] = []): Promise<any> {
    const normalizedEmail = normalizeClientEmail(email);
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

export async function postBulkAdjustClientsCompat(panelClient: any, payload: any = {}): Promise<any> {
    const emails = Array.from(new Set(
        (Array.isArray(payload.emails) ? payload.emails : [])
            .map((item) => normalizeClientEmail(item))
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

export async function postDeleteClientFromInboundCompat(panelClient: any, inboundId: any, clientIdentifier: string, options: any = {}): Promise<any> {
    const encodedId = encodePathSegment(clientIdentifier);
    let oldPathError: any = null;

    try {
        return assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/inbounds/${encodePathSegment(inboundId)}/delClient/${encodedId}`),
            'delete client failed'
        );
    } catch (error) {
        oldPathError = error;
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    try {
        return assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/inbounds/delClient/${encodePathSegment(inboundId)}`, {
                id: clientIdentifier,
            }),
            'delete client failed'
        );
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

async function resetInboundClientTrafficsByEmail(panelClient: any, inboundId: any): Promise<void> {
    const inbound = await fetchInboundById(panelClient, inboundId);
    const clients = parseInboundClients(inbound);
    const emails = Array.from(new Set(
        clients.map((item) => normalizeClientEmail(item?.email)).filter(Boolean)
    ));
    for (const email of emails) {
        await assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/clients/resetTraffic/${encodePathSegment(email)}`),
            'Reset client traffic failed'
        );
    }
}

export async function resetInboundTrafficCompat(panelClient: any, inboundId: any): Promise<any> {
    let lastError: any = null;

    try {
        const response = assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/inbounds/${encodePathSegment(inboundId)}/resetTraffic`),
            'Reset inbound traffic failed'
        );
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
            return assertPanelResponseSuccess(
                await panelClient.post(path),
                'Reset traffic legacy failed'
            );
        } catch (error) {
            lastError = error;
            if (!isUnsupportedPanelEndpointError(error)) {
                throw error;
            }
        }
    }

    throw lastError || new Error(`Failed to reset inbound traffic for ${inboundId}`);
}

function resolveClientTraffic(client: any = {}, statsByEmail: Map<string, any> = new Map()): any {
    const email = normalizeClientEmail(client?.email);
    const stat = statsByEmail.get(clientEmailKey(email)) || {};
    return {
        email,
        up: Number(stat.up ?? client.up ?? 0) || 0,
        down: Number(stat.down ?? client.down ?? 0) || 0,
        total: Number(stat.total ?? client.total ?? client.totalGB ?? 0) || 0,
        expiryTime: Number(stat.expiryTime ?? client.expiryTime ?? 0) || 0,
        reset: Number(stat.reset ?? client.reset ?? 0) || 0,
    };
}

export async function cleanupDepletedClientsCompat(panelClient: any, inboundId: any): Promise<any> {
    try {
        return assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/inbounds/delDepletedClients/${encodePathSegment(inboundId)}`),
            'Delete depleted clients failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    const inbound = await fetchInboundById(panelClient, inboundId);
    if (!inbound) {
        const error: any = new Error('inbound not found');
        error.response = { status: 404, data: { success: false, msg: 'inbound not found' } };
        throw error;
    }

    const stats = Array.isArray(inbound.clientStats) ? inbound.clientStats : [];
    const statsByEmail = new Map<string, any>(stats.map((item: any) => [clientEmailKey(item?.email), item] as [string, any]).filter(([email]) => email));
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

export function parseLegacyAddClientBody(body: any = {}): { inboundId: any; client: any } {
    const client = parseLegacyClientSettingsPayload(body);
    return {
        inboundId: body?.id,
        client,
    };
}

export function parseLegacyUpdateClientBody(body: any = {}): any {
    return normalizeLegacyClientPayload(body);
}

export async function postRestartXrayCompat(panelClient: any): Promise<any> {
    try {
        const res = await panelClient.post('/panel/api/server/restartXrayService');
        return { status: res.status, data: res.data };
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        const res = await panelClient.post('/panel/api/server/restartXray');
        return { status: res.status, data: res.data };
    }
}

export async function postStopXrayCompat(panelClient: any): Promise<any> {
    try {
        const res = await panelClient.post('/panel/api/server/stopXrayService');
        return { status: res.status, data: res.data };
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        const res = await panelClient.post('/panel/api/server/stopXray');
        return { status: res.status, data: res.data };
    }
}

export async function postImportDBCompat(panelClient: any, files: any[] = []): Promise<any> {
    if (!files || files.length === 0) {
        throw new Error('No files provided for database import');
    }
    const FormData = (await import('form-data')).default;
    try {
        const form = new FormData();
        for (const file of files) {
            form.append('db', file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype,
            });
        }
        const res = await panelClient.post('/panel/api/server/importDB', form, {
            headers: form.getHeaders(),
        });
        return { status: res.status, data: res.data };
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }
    const form = new FormData();
    for (const file of files) {
        form.append(file.fieldname, file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });
    }
    const res = await panelClient.post('/panel/api/server/database/import', form, {
        headers: form.getHeaders(),
    });
    return { status: res.status, data: res.data };
}

export async function postUpdateGeofileCompat(panelClient: any): Promise<any> {
    try {
        const res = await panelClient.post('/panel/api/server/updateGeofile');
        return { status: res.status, data: res.data };
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        const res = await panelClient.post('/panel/api/server/geofile/update');
        return { status: res.status, data: res.data };
    }
}

export async function postTelegramBackupCompat(panelClient: any): Promise<any> {
    try {
        const res = await panelClient.post('/panel/api/backuptotgbot');
        return { status: res.status, data: res.data };
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        const res = await panelClient.post('/panel/api/server/telegram/backup');
        return { status: res.status, data: res.data };
    }
}

export async function getExportDBCompat(panelClient: any): Promise<any> {
    try {
        const res = await panelClient.get('/panel/api/server/getDb', { responseType: 'arraybuffer' });
        return {
            status: res.status,
            data: Buffer.from(res.data),
            isBinary: true,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': res.headers['content-disposition'] || 'attachment; filename=x-ui.db',
            },
        };
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        const res = await panelClient.get('/panel/api/server/database/export', { responseType: 'arraybuffer' });
        return {
            status: res.status,
            data: Buffer.from(res.data),
            isBinary: true,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': res.headers['content-disposition'] || 'attachment; filename=x-ui.db',
            },
        };
    }
}

export async function getTlsCertPathsCompat(panelClient: any): Promise<any> {
    try {
        const res = await panelClient.get('/panel/api/server/getWebCertFiles');
        return { status: res.status, data: res.data };
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
        const res = await panelClient.get('/panel/api/server/tlsCertPaths');
        return { status: res.status, data: res.data };
    }
}

function joinPem(value: unknown): string {
    return Array.isArray(value) ? value.join('\n').trim() : normalizeText(value);
}

function hasTlsServerCertificate(tlsSettings: any): boolean {
    const certificates = Array.isArray(tlsSettings?.certificates) ? tlsSettings.certificates : [];
    return certificates.some((cert: any) => {
        if (!cert || typeof cert !== 'object') return false;
        if (normalizeText(cert.usage).toLowerCase() === 'verify') return false;
        const certificate = normalizeText(cert.certificateFile) || joinPem(cert.certificate);
        const key = normalizeText(cert.keyFile) || joinPem(cert.key);
        return Boolean(certificate && key);
    });
}

/**
 * The certificate files the node panel serves HTTPS with. `null` means the panel
 * answered but has none; `undefined` means the panel could not tell us (older
 * version or request failed), so the inbound is sent unchanged.
 */
async function fetchPanelWebCertFiles(panelClient: any): Promise<{ certFile: string; keyFile: string } | null | undefined> {
    if (typeof panelClient?.get !== 'function') return undefined;
    try {
        const response = await panelClient.get('/panel/api/server/getWebCertFiles');
        if (panelResponseIsFailure(response) || !response?.data?.obj || typeof response.data.obj !== 'object') return undefined;
        const certFile = normalizeText(response.data.obj.webCertFile);
        const keyFile = normalizeText(response.data.obj.webKeyFile);
        return certFile && keyFile ? { certFile, keyFile } : null;
    } catch {
        return undefined;
    }
}

function writeJsonFieldLike(original: any, value: any): any {
    return typeof original === 'string' ? JSON.stringify(value) : value;
}

/**
 * A TLS inbound (or TUIC) saved without a certificate is rejected by the panel.
 * When none was entered, use the certificate the node panel itself serves HTTPS
 * with, so "TLS" works without having to know file paths on the node.
 */
export async function fillMissingXuiCertificates(panelClient: any, payload: any): Promise<any> {
    if (!payload || typeof payload !== 'object' || isSuiPanelClient(panelClient)) return payload;
    const protocol = normalizeProtocol(payload.protocol);
    const stream = parseMaybeJson(payload.streamSettings, null);
    const settings = parseMaybeJson(payload.settings, null);
    const streamNeedsCert = Boolean(stream && normalizeText(stream.security).toLowerCase() === 'tls' && !hasTlsServerCertificate(stream.tlsSettings));
    const tuicServer = protocol === 'tuic' && settings && typeof settings.server === 'object' ? settings.server : null;
    const tuicNeedsCert = Boolean(tuicServer && (!normalizeText(tuicServer.certificate) || !normalizeText(tuicServer.private_key)));
    if (!streamNeedsCert && !tuicNeedsCert) return payload;

    const files = await fetchPanelWebCertFiles(panelClient);
    if (files === undefined) return payload;
    if (files === null) {
        const msg = 'TLS needs a certificate: this node panel has no HTTPS certificate configured. '
            + 'Enter the certificate and key file paths under Security, or set a certificate in the node panel settings first.';
        throw createPanelResponseError({ status: 400, data: { success: false, msg } }, msg);
    }
    const next = { ...payload };
    if (streamNeedsCert) {
        const tlsSettings = { ...(stream.tlsSettings || {}) };
        const previous = Array.isArray(tlsSettings.certificates) ? tlsSettings.certificates : [];
        const kept = previous.filter((cert: any) => normalizeText(cert?.usage).toLowerCase() === 'verify');
        tlsSettings.certificates = [
            { certificateFile: files.certFile, keyFile: files.keyFile, oneTimeLoading: false, usage: 'encipherment', buildChain: false },
            ...kept,
        ];
        next.streamSettings = writeJsonFieldLike(payload.streamSettings, { ...stream, tlsSettings });
    }
    if (tuicNeedsCert) {
        const server = { ...tuicServer, certificate: files.certFile, private_key: files.keyFile };
        next.settings = writeJsonFieldLike(payload.settings, { ...settings, server });
    }
    return next;
}

const TUNNEL_CLIENT_PROTOCOLS = new Set<string>(['wireguard', 'amneziawg']);

function replaceSettingsClients(payload: any, clients: any[] | undefined): any {
    if (!payload || typeof payload !== 'object' || payload.settings === undefined) return payload;
    const isString = typeof payload.settings === 'string';
    const settings = parseMaybeJson(payload.settings, null);
    if (!settings || typeof settings !== 'object') return payload;
    const next = { ...settings };
    if (clients === undefined) delete next.clients;
    else next.clients = clients;
    return { ...payload, settings: isString ? JSON.stringify(next) : next };
}

/**
 * WireGuard/AmneziaWG clients get their keys and tunnel address from the panel's
 * client endpoint; an inbound create rejects them without an address. Create
 * the inbound with the complete clients and add the rest afterwards.
 */
export async function postAddInboundCompat(panelClient: any, inboundData: any): Promise<any> {
    let payload = await fillMissingXuiCertificates(panelClient, prepareInboundPayload(panelClient, { ...inboundData, id: undefined }));
    const protocol = normalizeProtocol(payload?.protocol);
    let deferred: any[] = [];
    if (!isSuiPanelClient(panelClient) && TUNNEL_CLIENT_PROTOCOLS.has(protocol)) {
        const clients = parseInboundClients(payload).filter((client: any) => client && typeof client === 'object');
        const ready = clients.filter((client: any) => Array.isArray(client.allowedIPs) && client.allowedIPs.length > 0 && normalizeText(client.publicKey));
        deferred = clients.filter((client: any) => !ready.includes(client));
        if (deferred.length > 0) payload = replaceSettingsClients(payload, ready);
    }
    const response = await postAddInboundRequest(panelClient, payload);
    if (deferred.length > 0) {
        const inboundId = response?.data?.obj?.id;
        const failures: string[] = [];
        for (const client of deferred) {
            try {
                await postAddClientCompat(panelClient, inboundId, client, { protocol });
            } catch (error: any) {
                failures.push(`${normalizeClientEmail(client.email) || 'client'}: ${normalizePanelErrorMessage(error, error?.message || 'failed')}`);
            }
        }
        if (failures.length > 0) {
            const msg = `Inbound created, but some clients were not added: ${failures.join('; ')}`;
            throw createPanelResponseError({ status: 502, data: { success: false, msg } }, msg);
        }
    }
    return response;
}

async function postAddInboundRequest(panelClient: any, payload: any): Promise<any> {
    try {
        return assertPanelResponseSuccess(
            await postForm(panelClient, '/panel/api/inbounds/add', payload),
            'add inbound failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    try {
        return assertPanelResponseSuccess(
            await postForm(panelClient, '/panel/inbound/add', payload),
            'legacy inbound/add failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    try {
        return assertPanelResponseSuccess(
            await postForm(panelClient, '/panel/api/inbound/add', payload),
            'api/inbound/add failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    return assertPanelResponseSuccess(
        await postJson(panelClient, '/panel/api/inbounds/add', payload),
        'json inbounds/add failed'
    );
}

const CLIENT_SYNC_FIELDS = [
    'id', 'uuid', 'password', 'auth', 'secret', 'flow', 'security', 'email', 'limitIp', 'totalGB',
    'expiryTime', 'enable', 'tgId', 'subId', 'comment', 'reset', 'publicKey', 'privateKey',
    'preSharedKey', 'allowedIPs', 'keepAlive', 'adTag',
];

function comparableClientValue(value: any): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function clientNeedsUpdate(stored: any = {}, desired: any = {}): boolean {
    const left = sanitizeClientPayloadForPanel(stored);
    const right = sanitizeClientPayloadForPanel(desired);
    return CLIENT_SYNC_FIELDS.some((field) => (
        Object.prototype.hasOwnProperty.call(right, field)
        && comparableClientValue(left[field]) !== comparableClientValue(right[field])
    ));
}

function toBooleanFlag(value: any): boolean {
    return !(value === false || value === 'false' || value === 0 || value === '0');
}

/**
 * 3x-ui 3.x ignores `clients` and `enable` on an inbound update (each has its
 * own endpoint), so a client added or removed in the inbound editor was dropped
 * without an error. After the update, apply whatever still differs through the
 * dedicated endpoints. On panels that did apply the update this finds nothing.
 */
async function syncXuiInboundClientsAndEnable(panelClient: any, inboundId: any, payload: any = {}): Promise<void> {
    const desiredSettings = parseMaybeJson(payload?.settings, null);
    const desiredClients = Array.isArray(desiredSettings?.clients)
        ? desiredSettings.clients.filter((client: any) => client && typeof client === 'object')
        : null;
    const hasEnable = payload && payload.enable !== undefined && payload.enable !== null && payload.enable !== '';
    if (!desiredClients && !hasEnable) return;

    const stored = await fetchInboundById(panelClient, inboundId);
    if (!stored) return;

    if (hasEnable) {
        const desiredEnable = toBooleanFlag(payload.enable);
        if (toBooleanFlag(stored.enable) !== desiredEnable) {
            await postForm(panelClient, `/panel/api/inbounds/setEnable/${encodePathSegment(inboundId)}`, { enable: desiredEnable });
        }
    }
    if (!desiredClients) return;

    const protocol = normalizeProtocol(stored.protocol || payload.protocol);
    const storedClients = parseInboundClients(stored).filter((client: any) => client && typeof client === 'object');
    const unmatched = new Set<any>(storedClients);
    const takeMatch = (desired: any): any => {
        const email = normalizeClientEmail(desired.email);
        const identifier = resolveClientIdentifier(desired, protocol);
        const byEmail = email ? storedClients.find((client) => unmatched.has(client) && normalizeClientEmail(client.email) === email) : null;
        const match = byEmail || (identifier
            ? storedClients.find((client) => unmatched.has(client) && resolveClientIdentifier(client, protocol) === identifier)
            : null);
        if (match) unmatched.delete(match);
        return match || null;
    };
    const pairs = desiredClients.map((desired: any) => ({ desired, stored: takeMatch(desired) }));

    const failures: string[] = [];
    const attempt = async (label: string, run: () => Promise<any>) => {
        try {
            await run();
        } catch (error: any) {
            failures.push(`${label}: ${normalizePanelErrorMessage(error, error?.message || 'failed')}`);
        }
    };
    for (const client of unmatched) {
        await attempt(`remove ${normalizeClientEmail(client.email) || 'client'}`, () => postDeleteClientFromInboundCompat(
            panelClient,
            inboundId,
            resolveClientIdentifier(client, protocol),
            { protocol, email: client.email }
        ));
    }
    for (const { desired, stored: current } of pairs) {
        if (!current) {
            await attempt(`add ${normalizeClientEmail(desired.email) || 'client'}`, () => postAddClientCompat(panelClient, inboundId, desired, { protocol }));
        } else if (clientNeedsUpdate(current, desired)) {
            await attempt(`update ${normalizeClientEmail(current.email) || 'client'}`, () => postUpdateClientCompat(
                panelClient,
                inboundId,
                resolveClientIdentifier(current, protocol),
                desired,
                { protocol, email: current.email }
            ));
        }
    }
    if (failures.length > 0) {
        const msg = `Inbound saved, but some clients were not applied: ${failures.join('; ')}`;
        throw createPanelResponseError({ status: 502, data: { success: false, msg } }, msg);
    }
}

export async function postUpdateInboundCompat(panelClient: any, inboundId: any, inboundData: any): Promise<any> {
    if (isSuiPanelClient(panelClient)) {
        return postUpdateInboundRequest(panelClient, inboundId, prepareInboundPayload(panelClient, inboundData));
    }
    const payload = await fillMissingXuiCertificates(panelClient, prepareInboundPayload(panelClient, inboundData));
    // The update carries the clients the panel already has (3x-ui 3.x keeps
    // those anyway, but validates whatever is sent); client changes go through
    // the client endpoints so new clients get panel-assigned keys/addresses.
    let request = payload;
    const desiredSettings = parseMaybeJson(payload?.settings, null);
    if (Array.isArray(desiredSettings?.clients)) {
        const stored = await fetchInboundById(panelClient, inboundId).catch(() => null);
        if (stored) {
            const storedSettings = parseMaybeJson(stored.settings, {});
            request = replaceSettingsClients(payload, Array.isArray(storedSettings?.clients) ? storedSettings.clients : undefined);
        }
    }
    const response = await postUpdateInboundRequest(panelClient, inboundId, request);
    await syncXuiInboundClientsAndEnable(panelClient, inboundId, payload);
    return response;
}

async function postUpdateInboundRequest(panelClient: any, inboundId: any, payload: any): Promise<any> {
    const encodedId = encodePathSegment(inboundId);
    try {
        return assertPanelResponseSuccess(
            await postForm(panelClient, `/panel/api/inbounds/update/${encodedId}`, payload),
            'update inbound failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    try {
        return assertPanelResponseSuccess(
            await postForm(panelClient, `/panel/inbound/update/${encodedId}`, payload),
            'legacy inbound/update failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    return assertPanelResponseSuccess(
        await postForm(panelClient, `/panel/api/inbound/update/${encodedId}`, payload),
        'api/inbound/update failed'
    );
}

export async function postDeleteInboundCompat(panelClient: any, inboundId: any): Promise<any> {
    const encodedId = encodePathSegment(inboundId);
    try {
        return assertPanelResponseSuccess(
            await panelClient.post(`/panel/api/inbounds/del/${encodedId}`),
            'delete inbound failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    try {
        return assertPanelResponseSuccess(
            await panelClient.post(`/panel/inbound/del/${encodedId}`),
            'legacy inbound/del failed'
        );
    } catch (error) {
        if (!isUnsupportedPanelEndpointError(error)) {
            throw error;
        }
    }

    return assertPanelResponseSuccess(
        await panelClient.post(`/panel/api/inbound/del/${encodedId}`),
        'api/inbound/del failed'
    );
}

export async function getNewX25519CertCompat(panelClient: any): Promise<any> {
    const endpoints = [
        '/panel/api/server/getNewX25519Cert',
        '/panel/api/inbounds/getNewX25519Cert',
        '/server/getNewX25519Cert',
        '/panel/server/getNewX25519Cert',
    ];
    let lastError: any = null;
    for (const ep of endpoints) {
        try {
            const res = await panelClient.get(ep);
            if (res.data?.success && res.data?.obj) {
                return res;
            }
        } catch (err) {
            lastError = err;
            if (!isUnsupportedPanelEndpointError(err)) {
                throw err;
            }
        }
    }
    for (const ep of endpoints) {
        try {
            const res = await panelClient.post(ep);
            if (res.data?.success && res.data?.obj) {
                return res;
            }
        } catch (err) {
            lastError = err;
            if (!isUnsupportedPanelEndpointError(err)) {
                throw err;
            }
        }
    }
    if (lastError) throw lastError;
    throw new Error('getNewX25519Cert failed');
}


