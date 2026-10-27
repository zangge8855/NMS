/**
 * s-ui (alireza0/s-ui, sing-box based) panel adapter.
 *
 * NMS talks to every node through a 3x-ui shaped HTTP API. Rather than teach
 * each route about a second panel, an s-ui node gets a facade axios instance
 * whose adapter translates the 3x-ui calls NMS makes into s-ui `/api` (session)
 * or `/apiv2` (token) calls, and converts the answers back into 3x-ui shapes.
 *
 * s-ui is client-centric: a client has one name (its subscription ID), a map of
 * per-protocol credentials, and a list of inbound IDs. That maps onto the 3x-ui
 * v3 client endpoints (`/panel/api/clients/*`), so those are implemented here
 * and the legacy per-inbound client endpoints answer "not supported", which
 * sends panelApiCompat down the v3 path.
 */
import crypto from 'crypto';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import { PANEL_TYPE_SUI } from './panelType.js';
import { SUI_CLIENT_PROTOCOLS } from './clientProtocols.js';

// ---------------------------------------------------------------------------
// Protocol knowledge
// ---------------------------------------------------------------------------

/** s-ui inbound types whose users come from client configs. */
export const SUI_USER_INBOUND_TYPES = SUI_CLIENT_PROTOCOLS;

/** Every inbound type s-ui can create. */
export const SUI_INBOUND_TYPES = [
    'direct', 'mixed', 'socks', 'http', 'shadowsocks', 'snell', 'vmess', 'trojan', 'naive',
    'hysteria', 'shadowtls', 'tuic', 'hysteria2', 'vless', 'anytls', 'tun', 'redirect',
    'tproxy', 'cloudflared',
];

const UUID_CONFIG_KEYS = ['vless', 'vmess', 'tuic'];
const PLAIN_PASSWORD_CONFIG_KEYS = ['trojan', 'hysteria2', 'anytls', 'tuic', 'naive', 'http', 'socks', 'mixed'];
const USERNAME_CONFIG_KEYS = new Set(['naive', 'http', 'socks', 'mixed']);
const DEFAULT_VLESS_FLOW = 'xtls-rprx-vision';
const SS16_METHOD = '2022-blake3-aes-128-gcm';
const DAY_MS = 86400000;
const ID_CHUNK_SIZE = 200;

function shadowsocksConfigKey(method: unknown): string {
    return String(method || '').trim() === SS16_METHOD ? 'shadowsocks16' : 'shadowsocks';
}

/** The client config key s-ui reads for an inbound (see InboundService.fetchUsers). */
export function suiConfigKeyForInbound(inbound: any): string {
    const type = normalizeText(inbound?.type || inbound?.protocol).toLowerCase();
    if (type === 'shadowsocks') return shadowsocksConfigKey(inbound?.method);
    return type;
}

/** Every config key an inbound depends on: mixed serves users from `mixed` but links from `socks` and `http`. */
export function suiConfigKeysForInbound(inbound: any): string[] {
    const key = suiConfigKeyForInbound(inbound);
    return key === 'mixed' ? ['mixed', 'socks', 'http'] : [key];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeName(value: unknown): string {
    return normalizeText(value).toLowerCase();
}

function toNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.floor(parsed);
}

function parseMaybeJson(value: any, fallback: any): any {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function cloneJson<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

const RANDOM_SEQ_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function randomSeq(length: number): string {
    const bytes = crypto.randomBytes(length);
    let output = '';
    for (let i = 0; i < length; i += 1) {
        output += RANDOM_SEQ_CHARS[bytes[i] % RANDOM_SEQ_CHARS.length];
    }
    return output;
}

function randomBase64Key(bytes: number): string {
    return crypto.randomBytes(bytes).toString('base64');
}

function base64KeyLength(value: string): number {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return 0;
    try {
        return Buffer.from(value, 'base64').length;
    } catch {
        return 0;
    }
}

function normalizeInboundIdList(value: any): number[] {
    const list = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
    const ids = list
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0);
    return Array.from(new Set(ids));
}

function chunk<T>(items: T[], size: number): T[][] {
    const output: T[][] = [];
    for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
    return output;
}

function stripSuiMessage(value: unknown): string {
    // s-ui formats failures as "<action>: <error>"; an empty action leaves ": <error>".
    return normalizeText(value).replace(/^:\s*/, '');
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function createAuthError(code: string, message: string, cause?: any): any {
    const error: any = new Error(message);
    error.code = code;
    error.isPanelAuthError = true;
    if (cause) error.cause = cause;
    return error;
}

/** Business failure: s-ui answered HTTP 200 with success=false. */
export class SuiApiError extends Error {
    isSuiApiError = true;
    suiMessage: string;

    constructor(message: string) {
        super(message);
        this.suiMessage = message;
    }
}

function createHttpLikeError(status: number, message: string, code = ''): any {
    const error: any = new Error(message);
    error.code = code || (status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST');
    error.response = {
        status,
        data: { success: false, msg: message },
        headers: {},
    };
    return error;
}

class FacadeHttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

function unsupported(feature: string): never {
    throw new FacadeHttpError(404, `${feature} is not supported by s-ui panels`);
}

// ---------------------------------------------------------------------------
// Transport: raw s-ui HTTP API
// ---------------------------------------------------------------------------

export interface SuiRequestOptions {
    params?: Record<string, any>;
    form?: Record<string, any>;
    file?: { field: string; buffer: Buffer; filename?: string; contentType?: string };
    binary?: boolean;
    timeout?: number;
}

export interface SuiTransport {
    mode: 'token' | 'session';
    request(method: 'GET' | 'POST', action: string, options?: SuiRequestOptions): Promise<any>;
    login(): Promise<void>;
}

export interface SuiSessionStore {
    get(): string | null | undefined;
    set(cookie: string): void;
    clear(): void;
}

export interface SuiTransportOptions {
    httpAgent?: any;
    httpsAgent?: any;
    timeout?: number;
    sessionStore?: SuiSessionStore;
    httpClient?: { request(config: any): Promise<any> };
}

export function buildSuiBaseUrl(server: any): string {
    const url = normalizeText(server?.url).replace(/\/+$/, '');
    const basePath = normalizeText(server?.basePath);
    return `${url}${!basePath || basePath === '/' ? '' : basePath}`;
}

function stringifyFormValues(form: Record<string, any> = {}): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(form)) {
        if (value === undefined || value === null) continue;
        output[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    return output;
}

function readSetCookie(headers: any): string {
    const raw = headers?.['set-cookie'] ?? (typeof headers?.get === 'function' ? headers.get('set-cookie') : undefined);
    if (!raw) return '';
    const list = Array.isArray(raw) ? raw : [raw];
    return list
        .map((item) => String(item || '').split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}

export function createSuiTransport(server: any, options: SuiTransportOptions = {}): SuiTransport {
    const apiToken = normalizeText(server?.apiToken);
    const username = normalizeText(server?.username);
    const password = String(server?.password || '');
    const sessionStore = options.sessionStore;
    const http = options.httpClient || axios.create({
        baseURL: buildSuiBaseUrl(server),
        timeout: options.timeout ?? 30000,
        httpAgent: options.httpAgent,
        httpsAgent: options.httpsAgent,
        maxRedirects: 0,
        validateStatus: () => true,
    });
    let cookie = apiToken ? '' : normalizeText(sessionStore?.get?.());

    function captureCookie(response: any): void {
        const value = readSetCookie(response?.headers);
        if (!value) return;
        cookie = value;
        sessionStore?.set(value);
    }

    function clearCookie(): void {
        cookie = '';
        sessionStore?.clear();
    }

    async function login(): Promise<void> {
        const response = await http.request({
            method: 'POST',
            url: '/api/login',
            data: new URLSearchParams({ user: username, pass: password }).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                Accept: 'application/json',
            },
            maxRedirects: 0,
            validateStatus: () => true,
        });
        const status = Number(response?.status || 0);
        const body = typeof response?.data === 'string' ? parseMaybeJson(response.data, null) : response?.data;
        if (status === 200 && body && typeof body === 'object') {
            if (body.success === true) {
                captureCookie(response);
                return;
            }
            clearCookie();
            throw createAuthError('PANEL_LOGIN_FAILED', stripSuiMessage(body.msg) || 's-ui login failed');
        }
        clearCookie();
        if (status === 401 || status === 403) {
            throw createAuthError('PANEL_LOGIN_FAILED', stripSuiMessage(body?.msg) || `s-ui login rejected (HTTP ${status})`);
        }
        throw createHttpLikeError(
            status || 502,
            status === 200
                ? 's-ui login returned an unexpected response, check the panel URL and base path'
                : `s-ui login failed (HTTP ${status}), check the panel URL and base path`
        );
    }

    // Parallel requests that hit an expired session share one login.
    let pendingLogin: Promise<void> | null = null;
    function loginOnce(): Promise<void> {
        if (!pendingLogin) {
            pendingLogin = login().finally(() => {
                pendingLogin = null;
            });
        }
        return pendingLogin;
    }

    async function relogin(sentCookie: string): Promise<void> {
        if (cookie && cookie !== sentCookie) return;
        clearCookie();
        await loginOnce();
    }

    async function send(method: 'GET' | 'POST', action: string, opts: SuiRequestOptions, allowRelogin: boolean): Promise<any> {
        const sentCookie = cookie;
        const headers: Record<string, string> = {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: opts.binary ? '*/*' : 'application/json, text/plain, */*',
        };
        if (apiToken) {
            headers.Token = apiToken;
        } else if (cookie) {
            headers.Cookie = cookie;
        }

        let data: any;
        if (opts.file) {
            const form = new FormData();
            form.append(opts.file.field, opts.file.buffer, {
                filename: opts.file.filename || 'upload.db',
                contentType: opts.file.contentType || 'application/octet-stream',
            });
            Object.assign(headers, form.getHeaders());
            data = form;
        } else if (method === 'POST') {
            data = new URLSearchParams(stringifyFormValues(opts.form || {})).toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        const response = await http.request({
            method,
            url: `${apiToken ? '/apiv2' : '/api'}/${action}`,
            params: opts.params,
            data,
            headers,
            timeout: opts.timeout,
            responseType: opts.binary ? 'arraybuffer' : 'json',
            maxRedirects: 0,
            validateStatus: () => true,
        });
        captureCookie(response);
        const status = Number(response?.status || 0);

        if (status === 401 || (status >= 300 && status < 400)) {
            if (!apiToken && allowRelogin) {
                await relogin(sentCookie);
                return send(method, action, opts, false);
            }
            throw createAuthError(
                'PANEL_LOGIN_FAILED',
                apiToken ? 's-ui rejected the API token' : 's-ui session expired and re-login failed'
            );
        }

        let body = response?.data;
        if (opts.binary) {
            const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
            const contentType = String(response?.headers?.['content-type'] || '').toLowerCase();
            if (status < 400 && !contentType.includes('application/json')) {
                return { buffer, headers: response?.headers || {} };
            }
            body = parseMaybeJson(buffer.toString('utf8'), null);
        } else if (typeof body === 'string') {
            body = parseMaybeJson(body, body);
        }

        if (status >= 400) {
            throw createHttpLikeError(status, stripSuiMessage(body?.msg) || `s-ui request ${action} failed (HTTP ${status})`);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw createHttpLikeError(502, `s-ui request ${action} returned an unexpected response, check the panel URL and base path`, 'PANEL_STATUS_UNSUPPORTED');
        }
        if (body.success === false) {
            const message = stripSuiMessage(body.msg) || `s-ui request ${action} failed`;
            if (/invalid token/i.test(message)) {
                throw createAuthError('PANEL_LOGIN_FAILED', 's-ui API token is invalid or expired');
            }
            if (!apiToken && allowRelogin && /invalid login/i.test(message)) {
                await relogin(sentCookie);
                return send(method, action, opts, false);
            }
            throw new SuiApiError(message);
        }
        return body.obj;
    }

    return {
        mode: apiToken ? 'token' : 'session',
        login: loginOnce,
        async request(method, action, opts = {}) {
            if (!apiToken && !cookie) {
                await loginOnce();
            }
            return send(method, action, opts, !apiToken);
        },
    };
}

// ---------------------------------------------------------------------------
// s-ui data access
// ---------------------------------------------------------------------------

interface SuiSnapshot {
    inbounds: any[];
    clients: any[];
    tls: any[];
}

async function fetchFullObjects(transport: SuiTransport, kind: 'inbounds' | 'clients', ids: number[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const parts = await Promise.all(chunk(ids, ID_CHUNK_SIZE).map(async (group) => {
        const obj = await transport.request('GET', kind, { params: { id: group.join(',') } });
        return Array.isArray(obj?.[kind]) ? obj[kind] : [];
    }));
    return parts.flat();
}

async function fetchSummary(transport: SuiTransport, kind: 'inbounds' | 'clients' | 'tls'): Promise<any[]> {
    const obj = await transport.request('GET', kind);
    return Array.isArray(obj?.[kind]) ? obj[kind] : [];
}

async function loadSnapshot(transport: SuiTransport): Promise<SuiSnapshot> {
    const [inboundSummary, clientSummary, tls] = await Promise.all([
        fetchSummary(transport, 'inbounds'),
        fetchSummary(transport, 'clients'),
        fetchSummary(transport, 'tls').catch(() => []),
    ]);
    const [inbounds, clients] = await Promise.all([
        fetchFullObjects(transport, 'inbounds', normalizeInboundIdList(inboundSummary.map((item) => item?.id))),
        fetchFullObjects(transport, 'clients', normalizeInboundIdList(clientSummary.map((item) => item?.id))),
    ]);
    return { inbounds, clients: clients.map(normalizeSuiClient), tls };
}

function normalizeSuiClient(client: any): any {
    return {
        ...client,
        config: parseMaybeJson(client?.config, {}) || {},
        links: Array.isArray(parseMaybeJson(client?.links, [])) ? parseMaybeJson(client?.links, []) : [],
        inbounds: normalizeInboundIdList(parseMaybeJson(client?.inbounds, [])),
    };
}

async function findClientByName(transport: SuiTransport, name: string): Promise<any | null> {
    const target = normalizeName(name);
    if (!target) return null;
    const summary = await fetchSummary(transport, 'clients');
    const match = summary.find((item) => normalizeName(item?.name) === target);
    if (!match) return null;
    const [full] = await fetchFullObjects(transport, 'clients', [Number(match.id)]);
    return full ? normalizeSuiClient(full) : null;
}

async function requireClientByName(transport: SuiTransport, name: string): Promise<any> {
    const client = await findClientByName(transport, name);
    if (!client) throw new FacadeHttpError(404, 'client not found');
    return client;
}

async function findInboundById(transport: SuiTransport, id: unknown): Promise<any | null> {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) return null;
    const [inbound] = await fetchFullObjects(transport, 'inbounds', [numericId]);
    return inbound || null;
}

async function saveObject(transport: SuiTransport, object: string, action: string, data: any, extra: Record<string, any> = {}): Promise<any> {
    return transport.request('POST', 'save', {
        form: {
            object,
            action,
            data: JSON.stringify(data),
            ...extra,
        },
    });
}

/** The client record s-ui expects back on save: its own fields, JSON encoded where it stores JSON. */
function serializeSuiClient(client: any): any {
    return {
        id: client.id,
        enable: client.enable !== false,
        name: client.name,
        config: client.config || {},
        inbounds: normalizeInboundIdList(client.inbounds),
        links: Array.isArray(client.links) ? client.links : [],
        volume: toNonNegativeInt(client.volume),
        expiry: toNonNegativeInt(client.expiry),
        up: toNonNegativeInt(client.up),
        down: toNonNegativeInt(client.down),
        desc: normalizeText(client.desc),
        group: normalizeText(client.group),
        remark: normalizeText(client.remark),
        createdAt: toNonNegativeInt(client.createdAt),
        onlineAt: toNonNegativeInt(client.onlineAt),
        delayStart: client.delayStart === true,
        autoReset: client.autoReset === true,
        resetDays: toNonNegativeInt(client.resetDays),
        nextReset: toNonNegativeInt(client.nextReset),
        totalUp: toNonNegativeInt(client.totalUp),
        totalDown: toNonNegativeInt(client.totalDown),
    };
}

async function saveClient(transport: SuiTransport, client: any, action: 'new' | 'edit'): Promise<void> {
    const payload = serializeSuiClient(client);
    if (action === 'new') delete payload.id;
    await saveObject(transport, 'clients', action, payload);
}

// ---------------------------------------------------------------------------
// Client conversion
// ---------------------------------------------------------------------------

export function buildDefaultSuiClientConfig(name: string): Record<string, any> {
    const plainPassword = randomSeq(10);
    const ss16 = randomBase64Key(16);
    const ss32 = randomBase64Key(32);
    const uuid = crypto.randomUUID();
    return {
        mixed: { username: name, password: plainPassword },
        socks: { username: name, password: plainPassword },
        http: { username: name, password: plainPassword },
        shadowsocks: { name, password: ss32 },
        shadowsocks16: { name, password: ss16 },
        shadowtls: { name, password: ss32 },
        vmess: { name, uuid, alterId: 0 },
        vless: { name, uuid, flow: DEFAULT_VLESS_FLOW },
        anytls: { name, password: plainPassword },
        trojan: { name, password: plainPassword },
        naive: { username: name, password: plainPassword },
        hysteria: { name, auth_str: plainPassword },
        snell: { name, userkey: randomSeq(32) },
        tuic: { name, uuid, password: plainPassword },
        hysteria2: { name, password: plainPassword },
    };
}

function presentedExpiryTime(client: any): number {
    const expiry = toNonNegativeInt(client?.expiry);
    if (expiry > 0) return expiry * 1000;
    if (client?.delayStart === true && client?.autoReset !== true && toNonNegativeInt(client?.resetDays) > 0) {
        // 3x-ui encodes "start the clock on first use" as a negative duration.
        return -toNonNegativeInt(client.resetDays) * DAY_MS;
    }
    return 0;
}

function collectPasswordValues(config: any): Set<string> {
    const values = new Set<string>();
    const add = (value: unknown) => {
        const text = normalizeText(value);
        if (text) values.add(text);
    };
    for (const key of PLAIN_PASSWORD_CONFIG_KEYS) add(config?.[key]?.password);
    add(config?.hysteria?.auth_str);
    add(config?.snell?.userkey);
    add(config?.shadowsocks?.password);
    add(config?.shadowsocks16?.password);
    add(config?.shadowtls?.password);
    return values;
}

function collectUuidValues(config: any): Set<string> {
    const values = new Set<string>();
    for (const key of UUID_CONFIG_KEYS) {
        const value = normalizeText(config?.[key]?.uuid);
        if (value) values.add(value.toLowerCase());
    }
    return values;
}

/** Credentials of `client` for one inbound, in the field names 3x-ui uses. */
function presentCredentials(config: any, inbound: any): Record<string, any> {
    const type = normalizeText(inbound?.type).toLowerCase();
    const key = suiConfigKeyForInbound(inbound);
    const entry = config?.[key] || {};
    switch (type) {
        case 'vless':
            return { id: entry.uuid || '', flow: entry.flow || '' };
        case 'vmess':
            return { id: entry.uuid || '', alterId: toNonNegativeInt(entry.alterId), security: 'auto' };
        case 'tuic':
            return { id: entry.uuid || '', password: entry.password || '' };
        case 'hysteria':
            return { password: entry.auth_str || '', auth: entry.auth_str || '' };
        case 'snell':
            return { password: entry.userkey || '' };
        case 'shadowsocks':
            return { password: entry.password || '', method: inbound?.method || '' };
        case 'naive':
        case 'http':
        case 'socks':
        case 'mixed':
            return { user: entry.username || '', password: entry.password || '' };
        default:
            return { password: entry.password || '' };
    }
}

function localLinksForInbound(client: any, inbound: any): string[] {
    const tag = normalizeText(inbound?.tag);
    return (Array.isArray(client?.links) ? client.links : [])
        .filter((link: any) => link && link.type === 'local' && normalizeText(link.remark) === tag)
        .map((link: any) => normalizeText(link.uri))
        .filter(Boolean);
}

export function suiClientToXuiClient(client: any, inbound: any): any {
    const config = client?.config || {};
    return {
        email: normalizeText(client?.name),
        enable: client?.enable !== false,
        expiryTime: presentedExpiryTime(client),
        totalGB: toNonNegativeInt(client?.volume),
        limitIp: 0,
        tgId: 0,
        subId: normalizeText(client?.name),
        comment: normalizeText(client?.desc),
        group: normalizeText(client?.group),
        reset: client?.autoReset === true ? toNonNegativeInt(client?.resetDays) : 0,
        up: toNonNegativeInt(client?.up),
        down: toNonNegativeInt(client?.down),
        created_at: toNonNegativeInt(client?.createdAt) * 1000,
        ...presentCredentials(config, inbound),
        suiClientId: client?.id,
        shareLinks: localLinksForInbound(client, inbound),
    };
}

function suiClientStat(client: any, inboundId: number): any {
    return {
        id: client?.id,
        inboundId,
        enable: client?.enable !== false,
        email: normalizeText(client?.name),
        up: toNonNegativeInt(client?.up),
        down: toNonNegativeInt(client?.down),
        total: toNonNegativeInt(client?.volume),
        expiryTime: presentedExpiryTime(client),
        reset: client?.autoReset === true ? toNonNegativeInt(client?.resetDays) : 0,
        lastOnline: toNonNegativeInt(client?.onlineAt) * 1000,
    };
}

/** Client record for the 3x-ui v3 `clients/get` answer (protocol-neutral). */
function suiClientToV3Record(client: any): any {
    const config = client?.config || {};
    return {
        email: normalizeText(client?.name),
        enable: client?.enable !== false,
        expiryTime: presentedExpiryTime(client),
        totalGB: toNonNegativeInt(client?.volume),
        limitIp: 0,
        tgId: 0,
        subId: normalizeText(client?.name),
        comment: normalizeText(client?.desc),
        group: normalizeText(client?.group),
        reset: client?.autoReset === true ? toNonNegativeInt(client?.resetDays) : 0,
        id: config?.vless?.uuid || config?.vmess?.uuid || config?.tuic?.uuid || '',
        password: config?.trojan?.password || config?.hysteria2?.password || config?.anytls?.password || '',
        flow: config?.vless?.flow || '',
        up: toNonNegativeInt(client?.up),
        down: toNonNegativeInt(client?.down),
        suiClientId: client?.id,
        links: Array.isArray(client?.links) ? client.links : [],
    };
}

function applyExpiry(target: any, input: any): void {
    if (input.expiryTime === undefined && input.reset === undefined) return;
    const expiryTime = toNumber(input.expiryTime, presentedExpiryTime(target));
    const reset = input.reset !== undefined ? toNonNegativeInt(input.reset) : (target.autoReset ? toNonNegativeInt(target.resetDays) : 0);
    if (expiryTime < 0) {
        target.expiry = 0;
        target.delayStart = true;
        target.autoReset = false;
        target.resetDays = Math.max(1, Math.round(-expiryTime / DAY_MS));
        target.nextReset = 0;
        return;
    }
    target.expiry = expiryTime > 0 ? Math.floor(expiryTime / 1000) : 0;
    target.delayStart = false;
    if (reset > 0) {
        if (!target.autoReset || toNonNegativeInt(target.resetDays) !== reset || !toNonNegativeInt(target.nextReset)) {
            target.nextReset = Math.floor(Date.now() / 1000) + reset * 86400;
        }
        target.autoReset = true;
        target.resetDays = reset;
    } else {
        target.autoReset = false;
        target.resetDays = 0;
        target.nextReset = 0;
    }
}

function setPlainPassword(config: any, key: string, password: string): void {
    const entry = config[key] || (config[key] = {});
    if (key === 'hysteria') {
        entry.auth_str = password;
    } else if (key === 'snell') {
        entry.userkey = password;
    } else {
        entry.password = password;
    }
}

function applyKeyedPassword(config: any, key: string, password: string): boolean {
    const length = base64KeyLength(password);
    const expected = key === 'shadowsocks16' ? 16 : 32;
    if (length !== expected) return false;
    (config[key] || (config[key] = {})).password = password;
    return true;
}

function applyPasswordToKey(config: any, key: string, password: string): void {
    if (key === 'shadowsocks' || key === 'shadowsocks16' || key === 'shadowtls') {
        applyKeyedPassword(config, key, password);
        return;
    }
    setPlainPassword(config, key, password);
}

/**
 * Apply 3x-ui style credential fields to an s-ui config map.
 *
 * `targetKeys` limits the change to the config keys of specific inbounds (adding
 * a client to an inbound). Without it, a credential that differs from every
 * current value is treated as a rotation and applied to its whole family, which
 * is how s-ui itself shares one UUID and one password across protocols.
 */
export function applyXuiCredentials(config: any, input: any, targetKeys: string[] | null = null): void {
    const uuid = normalizeText(input?.id || input?.uuid);
    const password = normalizeText(input?.password ?? input?.auth ?? input?.pass);
    const flow = input?.flow !== undefined ? normalizeText(input.flow) : undefined;

    if (targetKeys) {
        for (const key of targetKeys) {
            if (uuid && UUID_CONFIG_KEYS.includes(key)) {
                (config[key] || (config[key] = {})).uuid = uuid;
            }
            if (password && key !== 'vless' && key !== 'vmess') {
                applyPasswordToKey(config, key, password);
            }
            if (key === 'vless' && flow) {
                (config.vless || (config.vless = {})).flow = flow;
            }
        }
        return;
    }

    if (uuid && !collectUuidValues(config).has(uuid.toLowerCase())) {
        for (const key of UUID_CONFIG_KEYS) {
            (config[key] || (config[key] = {})).uuid = uuid;
        }
    }
    if (password && !collectPasswordValues(config).has(password)) {
        for (const key of PLAIN_PASSWORD_CONFIG_KEYS) setPlainPassword(config, key, password);
        setPlainPassword(config, 'hysteria', password);
        applyKeyedPassword(config, 'shadowsocks', password);
        applyKeyedPassword(config, 'shadowsocks16', password);
        applyKeyedPassword(config, 'shadowtls', password);
    }
    // Vision is stripped by s-ui on inbounds that cannot use it, so an empty
    // flow from a non-TCP inbound must not erase it for the TLS/Reality ones.
    if (flow) {
        (config.vless || (config.vless = {})).flow = flow;
    }
}

function syncConfigIdentity(config: any, name: string): void {
    for (const [key, entry] of Object.entries(config || {})) {
        if (!entry || typeof entry !== 'object') continue;
        if (USERNAME_CONFIG_KEYS.has(key)) {
            (entry as any).username = name;
            delete (entry as any).name;
        } else {
            (entry as any).name = name;
        }
    }
}

/** Fold 3x-ui client fields (email, totalGB, expiryTime, ...) into an s-ui client. */
export function applyXuiClientFields(target: any, input: any = {}, targetKeys: string[] | null = null): any {
    const nextName = normalizeText(input.email);
    if (nextName) target.name = nextName;
    if (input.enable !== undefined) target.enable = input.enable !== false && input.enable !== 'false';
    if (input.totalGB !== undefined) target.volume = toNonNegativeInt(input.totalGB, target.volume || 0);
    if (input.comment !== undefined) target.desc = normalizeText(input.comment);
    if (input.group !== undefined) target.group = normalizeText(input.group);
    applyExpiry(target, input);
    target.config = target.config && typeof target.config === 'object' ? target.config : {};
    applyXuiCredentials(target.config, input, targetKeys);
    syncConfigIdentity(target.config, target.name);
    return target;
}

export function createSuiClientFromXui(input: any = {}, inboundIds: number[] = [], targetKeys: string[] = []): any {
    const name = normalizeText(input.email) || randomSeq(8);
    const client: any = {
        enable: true,
        name,
        config: buildDefaultSuiClientConfig(name),
        inbounds: normalizeInboundIdList(inboundIds),
        links: [],
        volume: 0,
        expiry: 0,
        up: 0,
        down: 0,
        desc: '',
        group: '',
        remark: '',
        delayStart: false,
        autoReset: false,
        resetDays: 0,
        nextReset: 0,
        totalUp: 0,
        totalDown: 0,
    };
    // A new client takes the caller's shared UUID/password for every protocol,
    // so later attaching it to more inbounds keeps one credential set.
    applyXuiClientFields(client, input, null);
    if (targetKeys.length > 0) applyXuiCredentials(client.config, input, targetKeys);
    syncConfigIdentity(client.config, client.name);
    return client;
}

// ---------------------------------------------------------------------------
// Inbound conversion
// ---------------------------------------------------------------------------

function resolveTlsSecurity(inbound: any, tlsById: Map<number, any>): { security: string; tlsName: string; serverName: string } {
    const tlsId = toNonNegativeInt(inbound?.tls_id);
    if (!tlsId) return { security: 'none', tlsName: '', serverName: '' };
    const tls = tlsById.get(tlsId);
    const serverConfig = parseMaybeJson(tls?.server, {}) || {};
    const security = serverConfig?.reality?.enabled ? 'reality' : 'tls';
    return {
        security,
        tlsName: normalizeText(tls?.name),
        serverName: normalizeText(serverConfig?.server_name),
    };
}

function resolveNetwork(inbound: any): string {
    const transport = inbound?.transport;
    const type = normalizeText(transport?.type).toLowerCase();
    if (type) return type === 'http' ? 'h2' : type;
    const protocol = normalizeText(inbound?.type).toLowerCase();
    if (['hysteria', 'hysteria2', 'tuic'].includes(protocol)) return 'udp';
    return 'tcp';
}

function buildXuiStreamSettings(inbound: any, tlsById: Map<number, any>): any {
    const network = resolveNetwork(inbound);
    const tls = resolveTlsSecurity(inbound, tlsById);
    const stream: any = { network, security: tls.security };
    const transport = inbound?.transport || {};
    if (network === 'ws') {
        stream.wsSettings = { path: transport.path || '/', headers: transport.headers || {} };
    } else if (network === 'grpc') {
        stream.grpcSettings = { serviceName: transport.service_name || '' };
    } else if (network === 'httpupgrade') {
        stream.httpupgradeSettings = { path: transport.path || '/', host: transport.host || '' };
    }
    if (tls.security === 'tls') {
        stream.tlsSettings = { serverName: tls.serverName };
    } else if (tls.security === 'reality') {
        stream.realitySettings = { serverNames: tls.serverName ? [tls.serverName] : [] };
    }
    return stream;
}

function inboundHasUsers(inbound: any): boolean {
    const type = normalizeText(inbound?.type).toLowerCase();
    if (!SUI_USER_INBOUND_TYPES.has(type)) return false;
    if (type === 'shadowtls' && toNumber(inbound?.version, 3) < 3) return false;
    if (type === 'shadowsocks' && inbound?.managed === true) return false;
    return true;
}

export function suiInboundToXuiInbound(inbound: any, clients: any[] = [], tls: any[] = []): any {
    const id = Number(inbound?.id);
    const tlsById = new Map<number, any>((tls || []).map((item) => [Number(item?.id), item]));
    const type = normalizeText(inbound?.type).toLowerCase();
    const hasUsers = inboundHasUsers(inbound);
    const attached = hasUsers
        ? (clients || []).filter((client) => normalizeInboundIdList(client?.inbounds).includes(id))
        : [];

    const settings: any = {};
    if (hasUsers) {
        settings.clients = attached.map((client) => suiClientToXuiClient(client, inbound));
    }
    if (type === 'shadowsocks') {
        settings.method = inbound?.method || '';
        settings.password = inbound?.password || '';
        settings.network = 'tcp,udp';
    }
    if (type === 'vless') {
        settings.decryption = 'none';
    }

    // A client attached to several inbounds has one traffic counter in s-ui;
    // spreading it keeps node totals right instead of counting it per inbound.
    let up = 0;
    let down = 0;
    for (const client of attached) {
        const share = Math.max(1, normalizeInboundIdList(client?.inbounds).length);
        up += toNonNegativeInt(client?.up) / share;
        down += toNonNegativeInt(client?.down) / share;
    }

    const tlsInfo = resolveTlsSecurity(inbound, tlsById);
    return {
        id,
        remark: normalizeText(inbound?.tag),
        tag: normalizeText(inbound?.tag),
        protocol: type,
        listen: normalizeText(inbound?.listen),
        port: toNonNegativeInt(inbound?.listen_port),
        enable: true,
        up: Math.round(up),
        down: Math.round(down),
        total: 0,
        expiryTime: 0,
        settings: JSON.stringify(settings),
        streamSettings: JSON.stringify(buildXuiStreamSettings(inbound, tlsById)),
        sniffing: JSON.stringify({ enabled: false }),
        clientStats: attached.map((client) => suiClientStat(client, id)),
        panelType: PANEL_TYPE_SUI,
        suiTlsId: toNonNegativeInt(inbound?.tls_id),
        suiTlsName: tlsInfo.tlsName,
        suiInbound: inbound,
    };
}

const TRANSPORT_FROM_XUI: Record<string, (stream: any) => any> = {
    ws: (stream) => ({
        type: 'ws',
        path: stream?.wsSettings?.path || '/',
        ...(stream?.wsSettings?.headers && Object.keys(stream.wsSettings.headers).length > 0 ? { headers: stream.wsSettings.headers } : {}),
    }),
    grpc: (stream) => ({ type: 'grpc', service_name: stream?.grpcSettings?.serviceName || '' }),
    httpupgrade: (stream) => ({
        type: 'httpupgrade',
        path: stream?.httpupgradeSettings?.path || '/',
        ...(stream?.httpupgradeSettings?.host ? { host: stream.httpupgradeSettings.host } : {}),
    }),
};

/**
 * Turn an inbound payload sent to `inbounds/add|update` into an s-ui inbound.
 * NMS's s-ui editor sends the native object as `suiInbound`; a 3x-ui shaped
 * payload is translated as far as sing-box has an equivalent.
 */
export function xuiInboundPayloadToSui(payload: any = {}, existing: any = null): any {
    const native = parseMaybeJson(payload?.suiInbound, null);
    if (native && typeof native === 'object') {
        const merged = { ...(existing || {}), ...native };
        if (existing?.id) merged.id = existing.id;
        delete merged.users;
        return merged;
    }

    const next: any = existing ? cloneJson(existing) : {};
    delete next.users;
    const protocol = normalizeText(payload?.protocol || payload?.type).toLowerCase();
    if (protocol) next.type = protocol;
    if (!next.type) throw new FacadeHttpError(400, 'Inbound protocol is required');
    if (!SUI_INBOUND_TYPES.includes(next.type)) {
        throw new FacadeHttpError(400, `s-ui does not support the ${next.type} inbound type`);
    }
    const tag = normalizeText(payload?.tag || payload?.remark);
    if (tag) next.tag = tag;
    if (!next.tag) next.tag = `${next.type}-${toNonNegativeInt(payload?.port) || randomSeq(4)}`;
    if (payload?.listen !== undefined || !next.listen) next.listen = normalizeText(payload?.listen) || '::';
    if (payload?.port !== undefined) next.listen_port = toNonNegativeInt(payload.port);
    if (payload?.suiTlsId !== undefined) next.tls_id = toNonNegativeInt(payload.suiTlsId);
    if (next.tls_id === undefined) next.tls_id = 0;
    if (!Array.isArray(next.addrs)) next.addrs = [];

    const settings = parseMaybeJson(payload?.settings, {}) || {};
    if (next.type === 'shadowsocks') {
        if (settings.method) next.method = settings.method;
        if (!next.method) next.method = '2022-blake3-aes-256-gcm';
        if (settings.password) next.password = settings.password;
        if (!next.password && String(next.method).startsWith('2022-')) {
            next.password = randomBase64Key(next.method === SS16_METHOD ? 16 : 32);
        }
    }

    const stream = parseMaybeJson(payload?.streamSettings, null);
    if (stream && typeof stream === 'object') {
        const network = normalizeText(stream.network).toLowerCase();
        const build = TRANSPORT_FROM_XUI[network];
        if (build) {
            next.transport = build(stream);
        } else if (network === 'tcp' || !network) {
            delete next.transport;
        }
    }
    return next;
}

// ---------------------------------------------------------------------------
// Status conversion
// ---------------------------------------------------------------------------

const netSamples = new Map<string, { sent: number; recv: number; at: number }>();

function stripCidr(value: unknown): string {
    return normalizeText(value).replace(/\/\d+$/, '');
}

export function suiStatusToXuiStatus(status: any = {}, sampleKey = '', now = Date.now()): any {
    const sys = status?.sys || {};
    const sbd = status?.sbd || {};
    const net = status?.net || {};
    const sent = toNonNegativeInt(net.sent);
    const recv = toNonNegativeInt(net.recv);
    let netIO = { up: 0, down: 0 };
    if (sampleKey) {
        const previous = netSamples.get(sampleKey);
        if (previous && now > previous.at && sent >= previous.sent && recv >= previous.recv) {
            const seconds = (now - previous.at) / 1000;
            netIO = {
                up: Math.round((sent - previous.sent) / seconds),
                down: Math.round((recv - previous.recv) / seconds),
            };
        }
        netSamples.set(sampleKey, { sent, recv, at: now });
    }
    const bootTime = toNonNegativeInt(sys.bootTime);
    const running = sbd.running === true;
    const maintenance = sbd.maintenance === true;
    const ipv4 = Array.isArray(sys.ipv4) ? sys.ipv4.map(stripCidr).filter(Boolean) : [];
    const ipv6 = Array.isArray(sys.ipv6) ? sys.ipv6.map(stripCidr).filter(Boolean) : [];
    const cpuCount = toNonNegativeInt(sys.cpuCount);
    return {
        cpu: toNumber(status?.cpu),
        cpuCores: cpuCount,
        logicalPro: cpuCount,
        cpuSpeedMhz: 0,
        cpuType: normalizeText(sys.cpuType),
        mem: { current: toNonNegativeInt(status?.mem?.current), total: toNonNegativeInt(status?.mem?.total) },
        swap: { current: toNonNegativeInt(status?.swp?.current), total: toNonNegativeInt(status?.swp?.total) },
        disk: { current: toNonNegativeInt(status?.dsk?.current), total: toNonNegativeInt(status?.dsk?.total) },
        uptime: bootTime > 0 ? Math.max(0, Math.floor(now / 1000) - bootTime) : 0,
        loads: [0, 0, 0],
        tcpCount: 0,
        udpCount: 0,
        netIO,
        netTraffic: { sent, recv },
        publicIP: { ipv4: ipv4[0] || '', ipv6: ipv6[0] || '' },
        appStats: {
            threads: toNonNegativeInt(sys.appThreads),
            mem: toNonNegativeInt(sys.appMem),
            uptime: toNonNegativeInt(sbd?.stats?.Uptime),
        },
        hostName: normalizeText(sys.hostName),
        appVersion: normalizeText(sys.appVersion),
        xray: {
            state: running ? 'running' : 'stop',
            errorMsg: running ? '' : (maintenance ? 'sing-box core is stopped for maintenance' : 'sing-box core is not running'),
            version: normalizeText(sys.appVersion) ? `s-ui ${normalizeText(sys.appVersion)}` : 'sing-box',
        },
        core: {
            name: 'sing-box',
            running,
            maintenance,
            uptime: toNonNegativeInt(sbd?.stats?.Uptime),
        },
        panelType: PANEL_TYPE_SUI,
    };
}

// ---------------------------------------------------------------------------
// Facade request parsing
// ---------------------------------------------------------------------------

interface FacadeRequest {
    method: string;
    path: string;
    params: Record<string, any>;
    body: any;
    file: { field: string; buffer: Buffer; filename: string; contentType: string } | null;
    config: InternalAxiosRequestConfig;
}

interface FacadeResult {
    status?: number;
    data: any;
    headers?: Record<string, string>;
}

function readHeader(headers: any, name: string): string {
    if (!headers) return '';
    if (typeof headers.get === 'function') {
        const value = headers.get(name);
        if (value !== undefined && value !== null) return String(value);
    }
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower && value !== undefined && value !== null) return String(value);
    }
    return '';
}

function parseTextBody(text: string, contentType: string): any {
    const trimmed = text.trim();
    if (!trimmed) return {};
    if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const parsed = parseMaybeJson(trimmed, undefined);
        if (parsed !== undefined) return parsed;
    }
    return Object.fromEntries(new URLSearchParams(trimmed));
}

/** Pull the uploaded file and plain fields out of a form-data instance without consuming it. */
function extractFormData(form: any): { fields: Record<string, string>; file: FacadeRequest['file'] } {
    const fields: Record<string, string> = {};
    let file: FacadeRequest['file'] = null;
    const streams = Array.isArray(form?._streams) ? form._streams : [];
    for (let i = 0; i < streams.length; i += 1) {
        const header = streams[i];
        if (typeof header !== 'string' || !header.includes('Content-Disposition')) continue;
        const name = /name="([^"]*)"/.exec(header)?.[1] || '';
        const filename = /filename="([^"]*)"/.exec(header)?.[1];
        const contentType = /Content-Type:\s*([^\r\n]+)/i.exec(header)?.[1] || 'application/octet-stream';
        const value = streams[i + 1];
        if (filename !== undefined && Buffer.isBuffer(value)) {
            if (!file) file = { field: name, buffer: value, filename, contentType };
        } else if (value !== undefined && typeof value !== 'function') {
            fields[name] = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
        }
    }
    return { fields, file };
}

function parseFacadeRequest(config: InternalAxiosRequestConfig): FacadeRequest {
    let url = String(config.url || '');
    if (/^https?:\/\//i.test(url)) {
        const parsed = new URL(url);
        url = `${parsed.pathname}${parsed.search}`;
    }
    const [pathname, search = ''] = url.split('?');
    const params: Record<string, any> = Object.fromEntries(new URLSearchParams(search));
    const configParams: any = config.params;
    if (configParams instanceof URLSearchParams) {
        configParams.forEach((value, key) => { params[key] = value; });
    } else if (configParams && typeof configParams === 'object') {
        Object.assign(params, configParams);
    }

    const contentType = readHeader(config.headers, 'Content-Type').toLowerCase();
    const raw: any = config.data;
    let body: any = {};
    let file: FacadeRequest['file'] = null;
    if (raw && typeof raw === 'object' && Array.isArray(raw._streams)) {
        const extracted = extractFormData(raw);
        body = extracted.fields;
        file = extracted.file;
    } else if (Buffer.isBuffer(raw)) {
        if (contentType.includes('octet-stream')) {
            file = { field: 'db', buffer: raw, filename: 'upload.db', contentType: 'application/octet-stream' };
        } else {
            body = parseTextBody(raw.toString('utf8'), contentType);
        }
    } else if (raw instanceof URLSearchParams) {
        body = Object.fromEntries(raw);
    } else if (typeof raw === 'string') {
        body = parseTextBody(raw, contentType);
    } else if (raw && typeof raw === 'object') {
        body = raw;
    }

    const path = `/${pathname.split('/').filter(Boolean).join('/')}`;
    return {
        method: String(config.method || 'get').toUpperCase(),
        path,
        params,
        body: body ?? {},
        file,
        config,
    };
}

function ok(obj: any = null, msg = ''): FacadeResult {
    return { data: { success: true, msg, obj } };
}

// ---------------------------------------------------------------------------
// Facade handlers
// ---------------------------------------------------------------------------

interface FacadeContext {
    server: any;
    transport: SuiTransport;
}

type Handler = (ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray) => Promise<FacadeResult>;

async function handleListInbounds(ctx: FacadeContext): Promise<FacadeResult> {
    const snapshot = await loadSnapshot(ctx.transport);
    return ok(snapshot.inbounds.map((inbound) => suiInboundToXuiInbound(inbound, snapshot.clients, snapshot.tls)));
}

async function handleGetInbound(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const snapshot = await loadSnapshot(ctx.transport);
    const inbound = snapshot.inbounds.find((item) => String(item?.id) === safeDecode(match[1]));
    if (!inbound) throw new FacadeHttpError(404, 'inbound not found');
    return ok(suiInboundToXuiInbound(inbound, snapshot.clients, snapshot.tls));
}

async function handleAddInbound(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    const inbound = xuiInboundPayloadToSui(req.body, null);
    delete inbound.id;
    const initUsers = normalizeInboundIdList(parseMaybeJson(req.body?.suiInitUsers, []));
    await saveObject(ctx.transport, 'inbounds', 'new', inbound, initUsers.length > 0 ? { initUsers: initUsers.join(',') } : {});
    const summary = await fetchSummary(ctx.transport, 'inbounds');
    const created = summary.find((item) => normalizeText(item?.tag) === normalizeText(inbound.tag));
    return ok(created ? { ...inbound, id: created.id } : inbound, 'Create successfully');
}

async function handleUpdateInbound(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const existing = await findInboundById(ctx.transport, safeDecode(match[1]));
    if (!existing) throw new FacadeHttpError(404, 'inbound not found');
    const inbound = xuiInboundPayloadToSui(req.body, existing);
    inbound.id = existing.id;
    await saveObject(ctx.transport, 'inbounds', 'edit', inbound);
    return ok(inbound, 'Update successfully');
}

async function handleDeleteInbound(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const existing = await findInboundById(ctx.transport, safeDecode(match[1]));
    if (!existing) throw new FacadeHttpError(404, 'inbound not found');
    await saveObject(ctx.transport, 'inbounds', 'del', normalizeText(existing.tag));
    return ok(null, 'Delete successfully');
}

async function handleOnlines(ctx: FacadeContext): Promise<FacadeResult> {
    const obj = await ctx.transport.request('GET', 'onlines');
    return ok(Array.isArray(obj?.user) ? obj.user : []);
}

async function handleLastOnline(ctx: FacadeContext): Promise<FacadeResult> {
    const clients = await fetchSummary(ctx.transport, 'clients');
    const result: Record<string, number> = {};
    for (const client of clients) {
        const onlineAt = toNonNegativeInt(client?.onlineAt ?? client?.online_at);
        if (client?.name && onlineAt > 0) result[client.name] = onlineAt * 1000;
    }
    return ok(result);
}

async function handleListClients(ctx: FacadeContext): Promise<FacadeResult> {
    const summary = await fetchSummary(ctx.transport, 'clients');
    const clients = await fetchFullObjects(ctx.transport, 'clients', normalizeInboundIdList(summary.map((item) => item?.id)));
    return ok(clients.map((client) => {
        const normalized = normalizeSuiClient(client);
        return { client: suiClientToV3Record(normalized), inboundIds: normalized.inbounds };
    }));
}

async function resolveTargetKeys(ctx: FacadeContext, inboundIds: number[]): Promise<string[]> {
    if (inboundIds.length === 0) return [];
    const inbounds = await fetchFullObjects(ctx.transport, 'inbounds', inboundIds);
    if (inbounds.length !== inboundIds.length) {
        throw new FacadeHttpError(404, 'inbound not found');
    }
    return Array.from(new Set(inbounds.filter(inboundHasUsers).flatMap(suiConfigKeysForInbound)));
}

async function handleAddClient(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    const body = req.body || {};
    const input = parseMaybeJson(body.client, null) || body;
    const inboundIds = normalizeInboundIdList(parseMaybeJson(body.inboundIds, []));
    const name = normalizeText(input?.email);
    if (!name) throw new FacadeHttpError(400, 'client email is required');
    const targetKeys = await resolveTargetKeys(ctx, inboundIds);

    const existing = await findClientByName(ctx.transport, name);
    if (existing) {
        existing.inbounds = Array.from(new Set([...existing.inbounds, ...inboundIds]));
        const { email: _ignored, ...fields } = input;
        applyXuiClientFields(existing, fields, targetKeys);
        await saveClient(ctx.transport, existing, 'edit');
        return ok({ email: existing.name, inboundIds: existing.inbounds }, 'Client updated');
    }

    const created = createSuiClientFromXui(input, inboundIds, targetKeys);
    await saveClient(ctx.transport, created, 'new');
    return ok({ email: created.name, inboundIds: created.inbounds }, 'Client added');
}

async function handleGetClient(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await requireClientByName(ctx.transport, safeDecode(match[1]));
    return ok({ client: suiClientToV3Record(client), inboundIds: client.inbounds });
}

async function handleUpdateClient(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await requireClientByName(ctx.transport, safeDecode(match[1]));
    const body = req.body || {};
    const input = parseMaybeJson(body.client, null) || body;
    const nextName = normalizeText(input?.email);
    if (nextName && normalizeName(nextName) !== normalizeName(client.name)) {
        const clash = await findClientByName(ctx.transport, nextName);
        if (clash && clash.id !== client.id) throw new FacadeHttpError(409, `client name ${nextName} is already in use`);
    } else if (nextName) {
        // Same client, differently cased: keep the stored name, it is the subscription ID.
        input.email = client.name;
    }
    applyXuiClientFields(client, input, null);
    if (body.inboundIds !== undefined) {
        client.inbounds = normalizeInboundIdList(parseMaybeJson(body.inboundIds, []));
    }
    await saveClient(ctx.transport, client, 'edit');
    return ok({ email: client.name, inboundIds: client.inbounds }, 'Client updated');
}

async function handleDeleteClient(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await requireClientByName(ctx.transport, safeDecode(match[1]));
    await saveObject(ctx.transport, 'clients', 'del', Number(client.id));
    return ok(null, 'Client deleted');
}

async function handleAttachClient(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await requireClientByName(ctx.transport, safeDecode(match[1]));
    const inboundIds = normalizeInboundIdList(parseMaybeJson(req.body?.inboundIds, []));
    const targetKeys = await resolveTargetKeys(ctx, inboundIds);
    client.inbounds = Array.from(new Set([...client.inbounds, ...inboundIds]));
    const input = parseMaybeJson(req.body?.client, null);
    if (input && typeof input === 'object') {
        // Fill only what the target inbounds read; the rest of the client stays as is.
        applyXuiCredentials(client.config, input, targetKeys);
        syncConfigIdentity(client.config, client.name);
    }
    await saveClient(ctx.transport, client, 'edit');
    return ok({ attached: inboundIds.length });
}

async function handleDetachClient(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await requireClientByName(ctx.transport, safeDecode(match[1]));
    const inboundIds = normalizeInboundIdList(parseMaybeJson(req.body?.inboundIds, []));
    const before = client.inbounds.length;
    client.inbounds = client.inbounds.filter((id: number) => !inboundIds.includes(id));
    if (client.inbounds.length !== before) {
        await saveClient(ctx.transport, client, 'edit');
    }
    return ok({ detached: before - client.inbounds.length });
}

async function resetClientUsage(ctx: FacadeContext, client: any): Promise<void> {
    // s-ui treats up=0 and down=0 on an edit as "reset usage" (folding it into the totals).
    client.up = 0;
    client.down = 0;
    await saveClient(ctx.transport, client, 'edit');
}

async function handleResetClientTraffic(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const email = safeDecode(match[match.length - 1]);
    const client = await requireClientByName(ctx.transport, email);
    await resetClientUsage(ctx, client);
    return ok(null, 'Traffic reset');
}

async function handleResetInboundTraffic(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    // The v3 inbound reset is followed by per-client resets from panelApiCompat;
    // only the legacy "reset every client of the inbound" paths do the work here.
    if (/\/resetTraffic$/.test(req.path) && /\/inbounds\/[^/]+\/resetTraffic$/.test(req.path)) {
        return ok(null, 'Inbound traffic reset');
    }
    const inboundId = Number(safeDecode(match[1]));
    const snapshot = await loadSnapshot(ctx.transport);
    const attached = snapshot.clients.filter((client) => client.inbounds.includes(inboundId));
    for (const client of attached) {
        await resetClientUsage(ctx, client);
    }
    return ok({ reset: attached.length }, 'Traffic reset');
}

async function handleResetAllTraffic(ctx: FacadeContext): Promise<FacadeResult> {
    await ctx.transport.request('POST', 'resetTraffic');
    return ok(null, 'Traffic reset');
}

function isDepleted(client: any, nowSeconds: number): boolean {
    const volume = toNonNegativeInt(client?.volume);
    const used = toNonNegativeInt(client?.up) + toNonNegativeInt(client?.down);
    const expiry = toNonNegativeInt(client?.expiry);
    return (volume > 0 && used >= volume) || (expiry > 0 && expiry <= nowSeconds);
}

async function handleDeleteDepleted(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const inboundId = Number(safeDecode(match[1]));
    const snapshot = await loadSnapshot(ctx.transport);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const depleted = snapshot.clients.filter((client) => (
        (inboundId > 0 ? client.inbounds.includes(inboundId) : true) && isDepleted(client, nowSeconds)
    ));
    for (const client of depleted) {
        if (inboundId > 0 && client.inbounds.length > 1) {
            client.inbounds = client.inbounds.filter((id: number) => id !== inboundId);
            await saveClient(ctx.transport, client, 'edit');
        } else {
            await saveObject(ctx.transport, 'clients', 'del', Number(client.id));
        }
    }
    return ok({ deleted: depleted.length });
}

async function handleClientTraffics(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await requireClientByName(ctx.transport, safeDecode(match[1]));
    return ok(suiClientStat(client, client.inbounds[0] || 0));
}

async function handleBulkAdjust(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    const body = req.body || {};
    const emails = (Array.isArray(body.emails) ? body.emails : parseMaybeJson(body.emails, [])) || [];
    const addDays = toNumber(body.addDays);
    const addBytes = toNumber(body.addBytes);
    const targets = new Set((emails as any[]).map(normalizeName).filter(Boolean));
    const summary = await fetchSummary(ctx.transport, 'clients');
    const ids = summary.filter((item) => targets.has(normalizeName(item?.name))).map((item) => Number(item.id));
    const clients = (await fetchFullObjects(ctx.transport, 'clients', ids)).map(normalizeSuiClient);
    let adjusted = 0;
    for (const client of clients) {
        let changed = false;
        if (addDays !== 0 && toNonNegativeInt(client.expiry) > 0) {
            client.expiry = Math.max(1, toNonNegativeInt(client.expiry) + Math.round(addDays * 86400));
            changed = true;
        }
        if (addBytes !== 0 && toNonNegativeInt(client.volume) > 0) {
            client.volume = Math.max(1, toNonNegativeInt(client.volume) + Math.round(addBytes));
            changed = true;
        }
        if (changed) {
            await saveClient(ctx.transport, client, 'edit');
            adjusted += 1;
        }
    }
    return ok({ adjusted, skipped: clients.length - adjusted });
}

function extractSessionIp(source: unknown): string {
    const text = normalizeText(source);
    if (!text) return '';
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
    if (bracketed) return bracketed[1];
    const parts = text.split(':');
    return parts.length === 2 ? parts[0] : text;
}

async function handleClientIps(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await findClientByName(ctx.transport, safeDecode(match[1]));
    if (!client) return ok([]);
    const sessions = await ctx.transport.request('GET', 'sessions', { params: { resource: 'user', tag: client.name } });
    const ips = Array.from(new Set((Array.isArray(sessions) ? sessions : [])
        .map((session: any) => extractSessionIp(session?.source))
        .filter(Boolean)));
    return ok(ips);
}

async function handleClearClientIps(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await findClientByName(ctx.transport, safeDecode(match[1]));
    if (!client) return ok(null);
    await ctx.transport.request('POST', 'closeSessions', { form: { u: client.name } });
    return ok(null, 'Sessions closed');
}

async function handleStatus(ctx: FacadeContext): Promise<FacadeResult> {
    const status = await ctx.transport.request('GET', 'status', { params: { r: 'cpu,mem,dsk,swp,net,sys,sbd' } });
    return ok(suiStatusToXuiStatus(status, normalizeText(ctx.server?.id)));
}

async function handleRestartCore(ctx: FacadeContext): Promise<FacadeResult> {
    await ctx.transport.request('POST', 'maintenance', { form: { enable: 'false' } }).catch(() => null);
    await ctx.transport.request('POST', 'restartSb');
    return ok(null, 'sing-box restarted');
}

async function handleStopCore(ctx: FacadeContext): Promise<FacadeResult> {
    await ctx.transport.request('POST', 'maintenance', { form: { enable: 'true' } });
    return ok(null, 'sing-box stopped (maintenance mode)');
}

async function handleStartCore(ctx: FacadeContext): Promise<FacadeResult> {
    await ctx.transport.request('POST', 'maintenance', { form: { enable: 'false' } });
    return ok(null, 'sing-box started');
}

async function handleExportDb(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    const result = await ctx.transport.request('GET', 'getdb', {
        binary: true,
        params: req.params?.exclude ? { exclude: req.params.exclude } : undefined,
        timeout: 120000,
    });
    const disposition = normalizeText(result?.headers?.['content-disposition']) || 'attachment; filename=s-ui.db';
    return {
        data: result.buffer,
        headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': disposition,
        },
    };
}

async function handleImportDb(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    if (!req.file) throw new FacadeHttpError(400, 'Database file is required');
    await ctx.transport.request('POST', 'importdb', {
        file: { field: 'db', buffer: req.file.buffer, filename: req.file.filename, contentType: req.file.contentType },
        timeout: 120000,
    });
    return ok(null, 'Database imported');
}

function parseKeypairLines(lines: any): Record<string, string> {
    const output: Record<string, string> = {};
    for (const line of Array.isArray(lines) ? lines : []) {
        const text = String(line || '');
        const index = text.indexOf(':');
        if (index <= 0) continue;
        output[text.slice(0, index).trim().toLowerCase()] = text.slice(index + 1).trim();
    }
    return output;
}

async function handleX25519(ctx: FacadeContext): Promise<FacadeResult> {
    const lines = await ctx.transport.request('GET', 'keypairs', { params: { k: 'reality' } });
    const parsed = parseKeypairLines(lines);
    if (!parsed.privatekey || !parsed.publickey) {
        return { data: { success: false, msg: 'Unable to generate a Reality key pair', obj: null } };
    }
    return ok({ privateKey: parsed.privatekey, publicKey: parsed.publickey });
}

async function handleUuid(): Promise<FacadeResult> {
    return ok(crypto.randomUUID());
}

async function handleLogs(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const count = toNonNegativeInt(match?.[1] || req.body?.count || req.params?.count, 100) || 100;
    const level = normalizeText(req.body?.level || req.params?.level) || 'debug';
    const lines = await ctx.transport.request('GET', 'logs', { params: { c: count, l: level } });
    return ok(Array.isArray(lines) ? lines : []);
}

async function handleSubscription(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const client = await findClientByName(ctx.transport, safeDecode(match[1]));
    if (!client || client.enable === false) {
        return { status: 404, data: 'subscription not found', headers: { 'content-type': 'text/plain; charset=utf-8' } };
    }
    const links = (client.links || []).map((link: any) => normalizeText(link?.uri)).filter(Boolean);
    return { data: links.join('\n'), headers: { 'content-type': 'text/plain; charset=utf-8' } };
}

const NATIVE_GET_ACTIONS = new Set([
    'load', 'inbounds', 'outbounds', 'endpoints', 'services', 'tls', 'clients', 'config', 'users',
    'settings', 'stats', 'status', 'onlines', 'sessions', 'logs', 'changes', 'keypairs', 'checkOutbound',
]);
const NATIVE_POST_ACTIONS = new Set([
    'save', 'restartApp', 'restartSb', 'maintenance', 'resetTraffic', 'linkConvert', 'subConvert',
    'closeSessions', 'getCertPing',
]);

/** `/sui/<action>`: direct access to the s-ui API for the NMS s-ui editors. */
async function handleNative(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const action = match[1];
    if (req.method === 'GET') {
        if (action === 'getdb') return handleExportDb(ctx, req);
        if (!NATIVE_GET_ACTIONS.has(action)) throw new FacadeHttpError(404, `Unknown s-ui action: ${action}`);
        return ok(await ctx.transport.request('GET', action, { params: req.params }));
    }
    if (action === 'importdb') return handleImportDb(ctx, req);
    if (!NATIVE_POST_ACTIONS.has(action)) throw new FacadeHttpError(404, `Unknown s-ui action: ${action}`);
    const form: Record<string, any> = {};
    for (const [key, value] of Object.entries(req.body || {})) {
        form[key] = value;
    }
    return ok(await ctx.transport.request('POST', action, { form, params: req.params }));
}

const LEGACY_CLIENT_ENDPOINT = /^\/panel\/api\/inbounds\/(?:addClient|updateClient\/[^/]+|delClient\/[^/]+|[^/]+\/delClient\/[^/]+|[^/]+\/updateClient\/[^/]+)$/;

const ROUTES: Array<[RegExp, Handler]> = [
    [/^\/panel\/api\/inbounds\/list$/, handleListInbounds],
    [/^\/panel\/api\/inbounds\/get\/([^/]+)$/, handleGetInbound],
    [/^\/panel\/api\/inbounds\/add$/, handleAddInbound],
    [/^\/panel\/api\/inbounds\/update\/([^/]+)$/, handleUpdateInbound],
    [/^\/panel\/api\/inbounds\/del\/([^/]+)$/, handleDeleteInbound],
    [/^\/panel\/api\/(?:inbounds|clients)\/onlines$/, handleOnlines],
    [/^\/panel\/api\/clients\/lastOnline$/, handleLastOnline],
    [/^\/panel\/api\/clients\/list$/, handleListClients],
    [/^\/panel\/api\/clients\/add$/, handleAddClient],
    [/^\/panel\/api\/clients\/get\/([^/]+)$/, handleGetClient],
    [/^\/panel\/api\/clients\/update\/([^/]+)$/, handleUpdateClient],
    [/^\/panel\/api\/clients\/del\/([^/]+)$/, handleDeleteClient],
    [/^\/panel\/api\/clients\/resetTraffic\/([^/]+)$/, handleResetClientTraffic],
    [/^\/panel\/api\/clients\/bulkAdjust$/, handleBulkAdjust],
    [/^\/panel\/api\/(?:clients\/ips|inbounds\/clientIps)\/([^/]+)$/, handleClientIps],
    [/^\/panel\/api\/(?:clients\/clearIps|inbounds\/clearClientIps)\/([^/]+)$/, handleClearClientIps],
    [/^\/panel\/api\/clients\/([^/]+)\/attach$/, handleAttachClient],
    [/^\/panel\/api\/clients\/([^/]+)\/detach$/, handleDetachClient],
    [/^\/panel\/api\/inbounds\/resetClientTraffic\/([^/]+)\/([^/]+)$/, handleResetClientTraffic],
    [/^\/panel\/api\/inbounds\/resetAllTraffics$/, handleResetAllTraffic],
    [/^\/panel\/api\/inbounds\/(?:resetAllClientTraffics|resetTraffic)\/([^/]+)$/, handleResetInboundTraffic],
    [/^\/panel\/api\/inbounds\/([^/]+)\/resetTraffic$/, handleResetInboundTraffic],
    [/^\/panel\/api\/inbounds\/delDepletedClients\/([^/]+)$/, handleDeleteDepleted],
    [/^\/panel\/api\/inbounds\/getClientTraffics\/([^/]+)$/, handleClientTraffics],
    [/^\/panel\/api\/server\/status$/, handleStatus],
    [/^\/panel\/api\/server\/(?:restartXrayService|restartXray|restartCore)$/, handleRestartCore],
    [/^\/panel\/api\/server\/(?:stopXrayService|stopXray|stopCore)$/, handleStopCore],
    [/^\/panel\/api\/server\/(?:startXrayService|startXray|startCore)$/, handleStartCore],
    [/^\/panel\/api\/server\/(?:getDb|database\/export)$/, handleExportDb],
    [/^\/panel\/api\/server\/(?:importDB|database\/import)$/, handleImportDb],
    [/^\/panel\/api\/server\/getNewX25519Cert$/, handleX25519],
    [/^\/panel\/api\/server\/getNewUUID$/, handleUuid],
    [/^\/panel\/api\/server\/(?:logs|xraylogs)\/(\d+)$/, handleLogs],
    [/^\/(?:panel|server)\/api\/server\/log$/, handleLogs],
    [/^\/panel\/api\/nodes\/list$/, async () => ok([])],
    [/^\/sub\/([^/]+)$/, handleSubscription],
    [/^\/sui\/([A-Za-z]+)$/, handleNative],
];

const UNSUPPORTED_FEATURES: Array<[RegExp, string]> = [
    [LEGACY_CLIENT_ENDPOINT, 'Per-inbound client editing'],
    [/^\/panel\/api\/inbounds\/setEnable\//, 'Enabling or disabling an inbound'],
    [/^\/panel\/api\/clients\/onlinesBy(?:Guid|Node)$/, 'Multi-node online attribution'],
    [/^\/panel\/api\/server\/cpuHistory\//, 'CPU history'],
    [/^\/panel\/api\/(?:server\/getXrayVersion|server\/installXray|xray\/|server\/xray\/|server\/getConfigJson)/, 'Xray configuration'],
    [/^\/panel\/api\/setting\//, 'Panel settings over the 3x-ui API'],
];

async function routeFacadeRequest(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    for (const [pattern, handler] of ROUTES) {
        const match = req.path.match(pattern);
        if (match) return handler(ctx, req, match);
    }
    for (const [pattern, feature] of UNSUPPORTED_FEATURES) {
        if (pattern.test(req.path)) unsupported(feature);
    }
    throw new FacadeHttpError(404, `${req.path} is not supported by s-ui panels`);
}

function buildAxiosResponse(config: InternalAxiosRequestConfig, result: FacadeResult): AxiosResponse {
    const status = result.status ?? 200;
    let data = result.data;
    if (config.responseType === 'arraybuffer' && !Buffer.isBuffer(data)) {
        data = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data ?? null));
    }
    const headers = new AxiosHeaders({
        'content-type': Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json; charset=utf-8',
        ...(result.headers || {}),
    });
    return {
        data,
        status,
        statusText: status >= 400 ? 'Error' : 'OK',
        headers,
        config,
        request: { path: config.url, nmsPanelType: PANEL_TYPE_SUI },
    };
}

function settleFacadeResponse(config: InternalAxiosRequestConfig, response: AxiosResponse): AxiosResponse {
    const validate = config.validateStatus;
    if (!validate || validate(response.status)) return response;
    throw new AxiosError(
        `Request failed with status code ${response.status}`,
        response.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
        config,
        response.request,
        response
    );
}

export interface SuiPanelClient extends AxiosInstance {
    nmsPanelType?: string;
    suiTransport?: SuiTransport;
}

export function createSuiPanelFacade(server: any, transport: SuiTransport): SuiPanelClient {
    const ctx: FacadeContext = { server, transport };
    const facade = axios.create({
        timeout: 60000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        adapter: async (config: InternalAxiosRequestConfig) => {
            const req = parseFacadeRequest(config);
            let result: FacadeResult;
            try {
                result = await routeFacadeRequest(ctx, req);
            } catch (error: any) {
                if (error instanceof FacadeHttpError) {
                    result = { status: error.status, data: { success: false, msg: error.message, obj: null } };
                } else if (error?.isSuiApiError) {
                    // s-ui reports business failures as HTTP 200, like 3x-ui does.
                    result = { status: 200, data: { success: false, msg: error.message, obj: null } };
                } else if (error?.response && !error?.isAxiosError && !error?.isPanelAuthError) {
                    result = { status: Number(error.response.status) || 502, data: error.response.data };
                } else {
                    throw error;
                }
            }
            return settleFacadeResponse(config, buildAxiosResponse(config, result));
        },
    }) as SuiPanelClient;
    facade.nmsPanelType = PANEL_TYPE_SUI;
    facade.suiTransport = transport;
    return facade;
}

/**
 * Check credentials and return a ready facade, mirroring ensureAuthenticated for 3x-ui.
 */
export async function ensureSuiPanelClient(server: any, options: SuiTransportOptions & {
    forceLogin?: boolean;
    transport?: SuiTransport;
} = {}): Promise<SuiPanelClient> {
    const hasToken = Boolean(normalizeText(server?.apiToken));
    if (!hasToken) {
        if (!normalizeText(server?.username)) {
            throw createAuthError(
                server?.apiTokenUnreadable ? 'PANEL_CREDENTIAL_UNREADABLE' : 'PANEL_CREDENTIAL_MISSING',
                server?.apiTokenUnreadable
                    ? 'Stored panel API token cannot be decrypted, please re-enter and save credentials.'
                    : 'Panel username is missing, please update server credentials.'
            );
        }
        if (!String(server?.password || '').trim()) {
            const unreadable = server?.credentialUnreadable || server?.apiTokenUnreadable;
            throw createAuthError(
                unreadable ? 'PANEL_CREDENTIAL_UNREADABLE' : 'PANEL_CREDENTIAL_MISSING',
                unreadable
                    ? 'Stored panel credentials cannot be decrypted, please re-enter and save credentials.'
                    : 'Panel password is missing, please update server credentials.'
            );
        }
    }

    const transport = options.transport || createSuiTransport(server, options);
    if (options.forceLogin && transport.mode === 'session') {
        await transport.login();
    }
    try {
        await transport.request('GET', 'status', { params: { r: 'sbd' } });
    } catch (error: any) {
        if (error?.isSuiApiError) {
            throw createAuthError('PANEL_LOGIN_FAILED', error.message, error);
        }
        throw error;
    }
    return createSuiPanelFacade(server, transport);
}

export const __testing = {
    parseFacadeRequest,
    extractFormData,
    extractSessionIp,
    parseKeypairLines,
    netSamples,
};
