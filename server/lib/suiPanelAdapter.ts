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
import { mergeCookieHeader } from './panelClient.js';
import {
    decodeX25519Key,
    encodeRealityKey,
    generateX25519KeyPair,
    x25519PublicKeyFromPrivate,
} from './xuiInboundNormalizer.js';

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

/** sing-box inbound types that take a TLS block. */
const SUI_TLS_TYPES = new Set(['http', 'vmess', 'trojan', 'naive', 'hysteria', 'tuic', 'hysteria2', 'vless', 'anytls']);
/** Types sing-box refuses to start without TLS. */
const SUI_TLS_REQUIRED_TYPES = new Set(['naive', 'hysteria', 'tuic', 'hysteria2', 'anytls']);
/** QUIC types: their TLS has to offer h3, and Reality does not apply. */
const SUI_QUIC_TYPES = new Set(['hysteria', 'tuic', 'hysteria2']);
/** Types sing-box refuses to start with an empty user list. */
const SUI_CLIENT_REQUIRED_TYPES = new Set(['naive', 'shadowtls']);
/** Types with a V2Ray transport block. */
const SUI_TRANSPORT_TYPES = new Set(['vmess', 'trojan', 'vless']);

/**
 * Inbound options NMS edits, per type, under their sing-box names. The editor
 * sends them in `settings` and reads them back from there; options not listed
 * here stay as they are on the stored inbound.
 */
const SUI_SETTINGS_FIELDS: Record<string, string[]> = {
    direct: ['network', 'override_address', 'override_port'],
    shadowsocks: ['method', 'password', 'network'],
    hysteria: ['up_mbps', 'down_mbps', 'obfs'],
    hysteria2: ['up_mbps', 'down_mbps', 'obfs', 'masquerade', 'ignore_client_bandwidth'],
    tuic: ['congestion_control', 'auth_timeout', 'zero_rtt_handshake', 'heartbeat'],
    naive: ['quic_congestion_control'],
    shadowtls: ['version', 'password', 'handshake', 'strict_mode'],
    snell: ['version', 'psk', 'obfs_mode', 'mode'],
    anytls: ['padding_scheme'],
    tun: ['interface_name', 'address', 'mtu', 'stack', 'auto_route', 'strict_route', 'udp_timeout'],
    tproxy: ['network'],
    cloudflared: ['token', 'protocol', 'ha_connections'],
};

/** What the s-ui UI fills in for a new AnyTLS inbound. */
export const SUI_ANYTLS_PADDING = [
    'stop=8',
    '0=30-30',
    '1=100-400',
    '2=400-500,c,500-1000,c,500-1000,c,500-1000,c,500-1000',
    '3=9-9,500-1000',
    '4=500-1000',
    '5=500-1000',
    '6=500-1000',
    '7=500-1000',
];

const SUI_NO_CERT_MESSAGE = 'TLS needs a certificate: this s-ui node has no TLS profile with a certificate and no panel HTTPS certificate. '
    + 'Enter the certificate and key file paths under Security, or add a TLS profile in s-ui first.';

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

function extractRawSetCookie(headers: any): string[] | string | undefined {
    return headers?.['set-cookie'] ?? (typeof headers?.get === 'function' ? headers.get('set-cookie') : undefined);
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
        const raw = extractRawSetCookie(response?.headers);
        if (!raw || (Array.isArray(raw) && raw.length === 0)) return;
        const merged = mergeCookieHeader(cookie, raw);
        if (!merged) return;
        cookie = merged;
        sessionStore?.set(merged);
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
    const ss2022Key16 = normalizeText(input?.ss2022Key16);
    const ss2022Key32 = normalizeText(input?.ss2022Key32);
    const flow = input?.flow !== undefined ? normalizeText(input.flow) : undefined;

    if (targetKeys) {
        for (const key of targetKeys) {
            if (uuid && UUID_CONFIG_KEYS.includes(key)) {
                (config[key] || (config[key] = {})).uuid = uuid;
            }
            if (key === 'shadowsocks16') {
                const candidate = ss2022Key16 || password;
                if (candidate) applyKeyedPassword(config, 'shadowsocks16', candidate);
            } else if (key === 'shadowsocks' || key === 'shadowtls') {
                const candidate = ss2022Key32 || password;
                if (candidate) applyKeyedPassword(config, key, candidate);
            } else if (password && key !== 'vless' && key !== 'vmess') {
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
        setPlainPassword(config, 'snell', password);
        applyKeyedPassword(config, 'shadowsocks', ss2022Key32 || password);
        applyKeyedPassword(config, 'shadowsocks16', ss2022Key16 || password);
        applyKeyedPassword(config, 'shadowtls', ss2022Key32 || password);
    } else {
        if (ss2022Key32 && !collectPasswordValues(config).has(ss2022Key32)) {
            applyKeyedPassword(config, 'shadowsocks', ss2022Key32);
            applyKeyedPassword(config, 'shadowtls', ss2022Key32);
        }
        if (ss2022Key16 && !collectPasswordValues(config).has(ss2022Key16)) {
            applyKeyedPassword(config, 'shadowsocks16', ss2022Key16);
        }
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

interface ResolvedTls {
    security: string;
    tlsName: string;
    serverName: string;
    server: any;
    client: any;
}

function resolveTlsSecurity(inbound: any, tlsById: Map<number, any>): ResolvedTls {
    const tlsId = toNonNegativeInt(inbound?.tls_id);
    if (!tlsId) return { security: 'none', tlsName: '', serverName: '', server: {}, client: {} };
    const tls = tlsById.get(tlsId);
    const serverConfig = parseMaybeJson(tls?.server, {}) || {};
    const security = serverConfig?.reality?.enabled ? 'reality' : 'tls';
    return {
        security,
        tlsName: normalizeText(tls?.name),
        serverName: normalizeText(serverConfig?.server_name),
        server: serverConfig,
        client: parseMaybeJson(tls?.client, {}) || {},
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
    } else if (network === 'h2') {
        const hosts = Array.isArray(transport.host) ? transport.host : (transport.host ? [transport.host] : []);
        stream.httpSettings = { path: transport.path || '/', host: hosts.map((item: any) => normalizeText(item)).filter(Boolean) };
    }
    // Enough of the TLS profile for the editor to show it, and for an unchanged
    // save to recognise the profile and keep it (see resolveSuiInboundTls).
    if (tls.security === 'tls') {
        const tlsSettings: any = { serverName: tls.serverName };
        if (Array.isArray(tls.server.alpn) && tls.server.alpn.length > 0) tlsSettings.alpn = tls.server.alpn;
        const certificateFile = normalizeText(tls.server.certificate_path);
        const keyFile = normalizeText(tls.server.key_path);
        if (certificateFile || keyFile) tlsSettings.certificates = [{ certificateFile, keyFile }];
        const fingerprint = normalizeText(tls.client?.utls?.fingerprint);
        if (fingerprint) tlsSettings.settings = { fingerprint };
        stream.tlsSettings = tlsSettings;
    } else if (tls.security === 'reality') {
        const reality = tls.server.reality || {};
        const handshake = reality.handshake || {};
        const handshakeServer = normalizeText(handshake.server);
        stream.realitySettings = {
            serverNames: tls.serverName ? [tls.serverName] : [],
            target: handshakeServer ? `${handshakeServer}:${toNonNegativeInt(handshake.server_port, 443) || 443}` : '',
            privateKey: normalizeText(reality.private_key),
            shortIds: Array.isArray(reality.short_id) ? reality.short_id.map((item: any) => normalizeText(item)).filter(Boolean) : [],
            settings: {
                publicKey: normalizeText(tls.client?.reality?.public_key),
                fingerprint: normalizeText(tls.client?.utls?.fingerprint) || 'chrome',
            },
        };
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
    for (const field of SUI_SETTINGS_FIELDS[type] || []) {
        const value = inbound?.[field];
        if (value !== undefined && value !== null) settings[field] = cloneJson(value);
    }
    if (type === 'shadowsocks') {
        settings.method = inbound?.method || '';
        settings.password = inbound?.password || '';
        settings.network = inbound?.network || 'tcp,udp';
    }
    if (type === 'vless') {
        settings.decryption = 'none';
    }
    if (Array.isArray(inbound?.addrs) && inbound.addrs.length > 0) {
        settings.addrs = inbound.addrs;
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
        enable: inbound?.enable !== false,
        up: Math.round(up),
        down: Math.round(down),
        total: 0,
        expiryTime: 0,
        settings: JSON.stringify(settings),
        streamSettings: JSON.stringify(buildXuiStreamSettings(inbound, tlsById)),
        sniffing: JSON.stringify({ enabled: false }),
        clientStats: attached.map((client) => suiClientStat(client, id)),
        panelType: PANEL_TYPE_SUI,
        // Read-only details. The request keys (suiTlsId, suiInbound) are named differently
        // so that a caller echoing this object back with edits does not pin the old values.
        suiTls: { id: toNonNegativeInt(inbound?.tls_id), name: tlsInfo.tlsName },
        suiNative: inbound,
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
    // sing-box's V2Ray HTTP transport is HTTP/2 when TLS is on; Xray called it h2 / http.
    h2: (stream) => buildSuiHttpTransport(stream?.httpSettings),
    http: (stream) => buildSuiHttpTransport(stream?.httpSettings),
    quic: () => ({ type: 'quic' }),
};

function buildSuiHttpTransport(httpSettings: any): any {
    const rawHosts = httpSettings?.host;
    const hosts = (Array.isArray(rawHosts) ? rawHosts : String(rawHosts || '').split(','))
        .map((item: any) => normalizeText(item))
        .filter(Boolean);
    return {
        type: 'http',
        path: httpSettings?.path || '/',
        ...(hosts.length > 0 ? { host: hosts } : {}),
    };
}

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

    const settings = parseMaybeJson(payload?.settings, {}) || {};
    const stream = parseMaybeJson(payload?.streamSettings, null);
    let next: any = existing ? cloneJson(existing) : {};
    delete next.users;
    const protocol = resolveSuiInboundType(payload, settings);
    if (protocol && existing?.type && protocol !== existing.type) {
        // A new type shares nothing but the listener with the old one; sing-box
        // rejects options that belong to another type.
        next = Object.fromEntries(Object.entries(next).filter(([key]) => SUI_KEEP_ON_TYPE_CHANGE.has(key)));
    }
    if (protocol) next.type = protocol;
    if (!next.type) throw new FacadeHttpError(400, 'Inbound protocol is required');
    if (!SUI_INBOUND_TYPES.includes(next.type)) {
        throw new FacadeHttpError(400, `s-ui does not support the ${next.type} inbound type`);
    }
    // `remark` is the field the editors and the 3x-ui form API use; a read view echoed
    // back also carries the old `tag`, so an edited remark must win over it.
    const tag = normalizeText(payload?.remark || payload?.tag);
    if (tag) next.tag = tag;
    if (!next.tag) next.tag = `${next.type}-${toNonNegativeInt(payload?.port) || randomSeq(4)}`;
    if (payload?.listen !== undefined || !next.listen) next.listen = normalizeText(payload?.listen) || '::';
    if (payload?.port !== undefined) next.listen_port = toNonNegativeInt(payload.port);
    if (payload?.suiTlsId !== undefined) next.tls_id = toNonNegativeInt(payload.suiTlsId);
    if (next.tls_id === undefined) next.tls_id = 0;
    // Leave the flag alone when the payload doesn't mention it; `next` already carries the
    // stored value, and an update that omits it must not re-enable a disabled inbound.
    const rawEnable = payload?.enable;
    if (rawEnable !== undefined && rawEnable !== null && rawEnable !== '') {
        const enableValue = rawEnable !== false && rawEnable !== 'false';
        if (!enableValue || typeof existing?.enable === 'boolean') next.enable = enableValue;
    }
    if (Array.isArray(payload?.addrs)) next.addrs = payload.addrs;
    if (!Array.isArray(next.addrs)) next.addrs = [];
    if (Array.isArray(settings.addrs)) next.addrs = settings.addrs;

    applySuiInboundSettings(next, settings, stream);

    if (!SUI_TRANSPORT_TYPES.has(next.type)) {
        delete next.transport;
    } else if (stream && typeof stream === 'object') {
        const network = normalizeText(stream.network).toLowerCase();
        const build = TRANSPORT_FROM_XUI[network];
        if (build) {
            next.transport = build(stream);
        } else if (!network || network === 'tcp' || network === 'raw') {
            delete next.transport;
        } else {
            throw new FacadeHttpError(400, `s-ui (sing-box) has no ${network} transport. Choose TCP, WebSocket, gRPC, HTTPUpgrade, HTTP or QUIC.`);
        }
    }
    return next;
}

/** Listener fields that survive a change of inbound type. */
const SUI_KEEP_ON_TYPE_CHANGE = new Set([
    'id', 'tag', 'enable', 'listen', 'listen_port', 'tls_id', 'addrs', 'out_json',
    'tcp_fast_open', 'tcp_multi_path', 'udp_fragment', 'detour',
]);

/** The s-ui type for an editor payload; 3x-ui names are mapped to their sing-box equivalent. */
function resolveSuiInboundType(payload: any, settings: any): string {
    const type = normalizeText(payload?.protocol || payload?.type).toLowerCase();
    if (type === 'hy2') return 'hysteria2';
    if (type === 'tunnel' || type === 'dokodemo-door') return 'direct';
    // 3x-ui's Hysteria is protocol version 2, which sing-box calls hysteria2.
    if (type === 'hysteria' && Number(settings?.version) === 2) return 'hysteria2';
    return type;
}

function hasOwn(target: any, key: string): boolean {
    return Boolean(target) && Object.prototype.hasOwnProperty.call(target, key);
}

function normalizeSuiNetwork(target: any): void {
    const network = normalizeText(target.network).toLowerCase();
    if (network === 'tcp' || network === 'udp') target.network = network;
    else delete target.network;
}

/** Salamander password from 3x-ui's `finalmask`; null when the stream says nothing about it. */
function salamanderFromFinalmask(stream: any): string | null {
    const udp = stream?.finalmask?.udp;
    if (!Array.isArray(udp)) return null;
    const mask = udp.find((item: any) => normalizeText(item?.type).toLowerCase() === 'salamander');
    return mask ? normalizeText(mask?.settings?.password) : '';
}

/** 3x-ui's Hysteria masquerade in sing-box form, or null for none. */
function suiMasqueradeFromXui(value: any): any {
    if (!value) return null;
    if (typeof value === 'string') return value.trim() || null;
    const type = normalizeText(value.type).toLowerCase();
    if (type === 'proxy') {
        const url = normalizeText(value.url);
        if (!url) return null;
        return { type: 'proxy', url, ...((value.rewriteHost ?? value.rewrite_host) ? { rewrite_host: true } : {}) };
    }
    if (type === 'string') {
        const status = toNonNegativeInt(value.statusCode ?? value.status_code);
        return { type: 'string', content: String(value.content ?? ''), ...(status > 0 ? { status_code: status } : {}) };
    }
    if (type === 'file') {
        const directory = normalizeText(value.dir ?? value.directory);
        return directory ? { type: 'file', directory } : null;
    }
    return null;
}

function normalizeHandshake(value: any): any {
    if (typeof value === 'string') {
        const [server, port] = splitHostPort(value);
        return { server, server_port: port };
    }
    const server = normalizeText(value?.server);
    return { ...(value && typeof value === 'object' ? value : {}), server, server_port: toNonNegativeInt(value?.server_port, 443) || 443 };
}

/** `host:port` (IPv6 in brackets) into its parts; the port defaults to 443. */
function splitHostPort(value: unknown): [string, number] {
    const text = normalizeText(value);
    if (!text) return ['', 443];
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
    if (bracketed) return [bracketed[1], toNonNegativeInt(bracketed[2], 443) || 443];
    const index = text.lastIndexOf(':');
    if (index > 0 && text.indexOf(':') === index) {
        return [text.slice(0, index), toNonNegativeInt(text.slice(index + 1), 443) || 443];
    }
    return [text, 443];
}

/**
 * Copy the editor's settings onto an s-ui inbound and fill what sing-box needs
 * to start it. Native s-ui option names win; 3x-ui shapes (finalmask, the
 * TUIC server block, Tunnel rewrite fields) are read when those are absent.
 */
function applySuiInboundSettings(next: any, settings: any, stream: any): void {
    const type = next.type;
    for (const field of SUI_SETTINGS_FIELDS[type] || []) {
        if (!hasOwn(settings, field)) continue;
        const value = settings[field];
        if (value === null || value === undefined || value === '') delete next[field];
        else next[field] = cloneJson(value);
    }

    switch (type) {
        case 'shadowsocks':
            if (!next.method) next.method = '2022-blake3-aes-256-gcm';
            if (!next.password && String(next.method).startsWith('2022-')) {
                next.password = randomBase64Key(next.method === SS16_METHOD ? 16 : 32);
            }
            normalizeSuiNetwork(next);
            break;
        case 'hysteria':
            // sing-box needs both speeds for Hysteria v1; 100 is what s-ui fills in.
            for (const key of ['up_mbps', 'down_mbps']) {
                const value = toNonNegativeInt(next[key]);
                next[key] = value > 0 ? value : 100;
            }
            if (next.obfs && typeof next.obfs === 'object') next.obfs = normalizeText(next.obfs.password);
            if (typeof next.obfs !== 'string' || !next.obfs) delete next.obfs;
            break;
        case 'hysteria2': {
            for (const key of ['up_mbps', 'down_mbps']) {
                const value = toNonNegativeInt(next[key]);
                if (value > 0) next[key] = value;
                else delete next[key];
            }
            if (!hasOwn(settings, 'obfs')) {
                const mask = salamanderFromFinalmask(stream);
                if (mask) next.obfs = { type: 'salamander', password: mask };
                else if (mask === '') delete next.obfs;
            }
            if (typeof next.obfs === 'string') {
                next.obfs = next.obfs ? { type: 'salamander', password: next.obfs } : null;
            }
            if (next.obfs && typeof next.obfs === 'object' && normalizeText(next.obfs.password)) {
                next.obfs = { ...next.obfs, type: normalizeText(next.obfs.type) || 'salamander' };
            } else {
                delete next.obfs;
            }
            if (!hasOwn(settings, 'masquerade') && hasOwn(stream?.hysteriaSettings, 'masquerade')) {
                const masquerade = suiMasqueradeFromXui(stream.hysteriaSettings.masquerade);
                if (masquerade) next.masquerade = masquerade;
                else delete next.masquerade;
            }
            if (next.masquerade && typeof next.masquerade === 'object' && !normalizeText(next.masquerade.type)) delete next.masquerade;
            if (hasOwn(next, 'ignore_client_bandwidth')) next.ignore_client_bandwidth = next.ignore_client_bandwidth === true || next.ignore_client_bandwidth === 'true';
            break;
        }
        case 'tuic': {
            const server = settings?.server && typeof settings.server === 'object' ? settings.server : null;
            if (server) {
                if (!hasOwn(settings, 'congestion_control') && server.congestion_control) next.congestion_control = server.congestion_control;
                if (!hasOwn(settings, 'zero_rtt_handshake') && server.zero_rtt_handshake !== undefined) next.zero_rtt_handshake = server.zero_rtt_handshake;
                const authTimeout = toNonNegativeInt(server.authentication_timeout);
                if (!hasOwn(settings, 'auth_timeout') && authTimeout > 0) next.auth_timeout = `${authTimeout}s`;
            }
            if (!['cubic', 'new_reno', 'bbr'].includes(next.congestion_control)) next.congestion_control = 'cubic';
            if (hasOwn(next, 'zero_rtt_handshake')) next.zero_rtt_handshake = next.zero_rtt_handshake === true || next.zero_rtt_handshake === 'true';
            // A client-side option; older NMS builds put it on the inbound, which sing-box rejects.
            delete next.udp_relay_mode;
            break;
        }
        case 'snell':
            next.version = Number(next.version) === 5 ? 5 : 6;
            if (Buffer.byteLength(normalizeText(next.psk)) < 12) next.psk = randomSeq(32);
            if (next.version === 6) delete next.obfs_mode;
            else delete next.mode;
            break;
        case 'shadowtls': {
            const version = Number(next.version);
            next.version = [1, 2, 3].includes(version) ? version : 3;
            next.handshake = normalizeHandshake(next.handshake);
            if (!next.handshake.server) {
                throw new FacadeHttpError(400, 'ShadowTLS needs a handshake server, for example www.microsoft.com');
            }
            if (next.version === 2) {
                if (!normalizeText(next.password)) next.password = randomSeq(16);
            } else {
                delete next.password;
            }
            if (hasOwn(next, 'strict_mode')) next.strict_mode = next.strict_mode === true || next.strict_mode === 'true';
            break;
        }
        case 'anytls':
            if (!Array.isArray(next.padding_scheme) || next.padding_scheme.length === 0) next.padding_scheme = [...SUI_ANYTLS_PADDING];
            break;
        case 'direct': {
            // 3x-ui Tunnel fields, when the editor sent those.
            const address = settings?.rewriteAddress ?? settings?.address;
            if (!hasOwn(settings, 'override_address') && address !== undefined) {
                if (normalizeText(address)) next.override_address = normalizeText(address);
                else delete next.override_address;
            }
            const port = settings?.rewritePort ?? settings?.port;
            if (!hasOwn(settings, 'override_port') && port !== undefined) next.override_port = port;
            if (!hasOwn(settings, 'network') && settings?.allowedNetwork !== undefined) next.network = settings.allowedNetwork;
            const overridePort = toNonNegativeInt(next.override_port);
            if (overridePort > 0) next.override_port = overridePort;
            else delete next.override_port;
            normalizeSuiNetwork(next);
            break;
        }
        case 'tproxy':
            normalizeSuiNetwork(next);
            break;
        case 'tun':
            if (!hasOwn(settings, 'interface_name') && normalizeText(settings?.name)) next.interface_name = normalizeText(settings.name);
            if (!hasOwn(settings, 'mtu') && toNonNegativeInt(settings?.mtu) > 0) next.mtu = toNonNegativeInt(settings.mtu);
            if (!next.stack) next.stack = 'system';
            break;
        case 'cloudflared':
            if (!normalizeText(next.token)) {
                throw new FacadeHttpError(400, 'Cloudflare Tunnel needs the tunnel token from the Cloudflare Zero Trust dashboard');
            }
            if (!next.protocol) next.protocol = 'auto';
            break;
        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// TLS profiles for inbounds written from the NMS editor
// ---------------------------------------------------------------------------

/** What the editor asked for, read from a 3x-ui shaped stream. */
interface WantedSuiTls {
    reality: boolean;
    serverName: string;
    needsH3: boolean;
    alpn: string[] | null;
    fingerprint: string;
    certPath: string;
    keyPath: string;
    certInline: string[];
    keyInline: string[];
    privateKey: string;
    publicKey: string;
    shortIds: string[];
    handshakeServer: string;
    handshakePort: number;
}

function textList(value: unknown): string[] {
    const list = Array.isArray(value) ? value : String(value ?? '').split(',');
    return list.map((item) => normalizeText(item)).filter(Boolean);
}

function pemLines(value: unknown): string[] {
    const list = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
    return list.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export function readWantedSuiTls(type: string, security: string, stream: any = {}): WantedSuiTls {
    const needsH3 = SUI_QUIC_TYPES.has(type);
    const base: WantedSuiTls = {
        reality: false, serverName: '', needsH3, alpn: null, fingerprint: '',
        certPath: '', keyPath: '', certInline: [], keyInline: [],
        privateKey: '', publicKey: '', shortIds: [], handshakeServer: '', handshakePort: 0,
    };
    if (security === 'reality') {
        const reality = stream?.realitySettings || {};
        const target = normalizeText(reality.target || reality.dest);
        const [handshakeServer, handshakePort] = target ? splitHostPort(target) : ['', 0];
        return {
            ...base,
            reality: true,
            serverName: textList(reality.serverNames)[0] || '',
            fingerprint: normalizeText(reality.settings?.fingerprint || reality.fingerprint),
            privateKey: normalizeText(reality.privateKey),
            publicKey: normalizeText(reality.settings?.publicKey || reality.publicKey),
            shortIds: textList(reality.shortIds).filter((item) => /^[0-9a-f]{0,16}$/i.test(item)),
            handshakeServer,
            handshakePort,
        };
    }
    const tls = stream?.tlsSettings || {};
    const cert = Array.isArray(tls.certificates) ? (tls.certificates[0] || {}) : {};
    const alpn = textList(tls.alpn);
    return {
        ...base,
        serverName: normalizeText(tls.serverName),
        alpn: needsH3 ? ['h3'] : (alpn.length > 0 ? alpn : null),
        fingerprint: normalizeText(tls.settings?.fingerprint || tls.fingerprint),
        certPath: normalizeText(cert.certificateFile),
        keyPath: normalizeText(cert.keyFile),
        certInline: pemLines(cert.certificate),
        keyInline: pemLines(cert.key),
    };
}

/** Whether an existing s-ui TLS profile already gives an inbound what the editor asked for. */
export function suiTlsProfileMatches(profile: any, wanted: WantedSuiTls): boolean {
    const server = parseMaybeJson(profile?.server, {}) || {};
    if (server.enabled === false) return false;
    const isReality = server?.reality?.enabled === true;
    if (isReality !== wanted.reality) return false;
    if (wanted.serverName && normalizeText(server.server_name) !== wanted.serverName) return false;
    if (wanted.reality) {
        if (wanted.needsH3) return false;
        const reality = server.reality || {};
        if (wanted.privateKey && normalizeText(reality.private_key) !== wanted.privateKey) return false;
        if (wanted.handshakeServer && normalizeText(reality.handshake?.server) !== wanted.handshakeServer) return false;
        if (wanted.handshakeServer && (toNonNegativeInt(reality.handshake?.server_port, 443) || 443) !== wanted.handshakePort) return false;
        const ids = Array.isArray(reality.short_id) ? reality.short_id.map((item: any) => normalizeText(item)) : [];
        return wanted.shortIds.every((id) => ids.includes(id));
    }
    const hasCert = Boolean(
        normalizeText(server.certificate_path)
        || (Array.isArray(server.certificate) && server.certificate.length > 0)
        || normalizeText(server.certificate_provider)
        || server.acme
    );
    if (!hasCert) return false;
    if (wanted.certPath && normalizeText(server.certificate_path) !== wanted.certPath) return false;
    if (wanted.keyPath && normalizeText(server.key_path) !== wanted.keyPath) return false;
    if (wanted.certInline.length > 0 && JSON.stringify(pemLines(server.certificate)) !== JSON.stringify(wanted.certInline)) return false;
    const alpn = Array.isArray(server.alpn) ? server.alpn.map((item: any) => normalizeText(item)) : [];
    // sing-box offers h3 itself on QUIC inbounds whose profile sets no ALPN.
    if (wanted.needsH3) return alpn.length === 0 || alpn.includes('h3');
    // Go's TLS server fails the handshake when no ALPN protocol overlaps.
    return alpn.length === 0 || alpn.includes('h2') || alpn.includes('http/1.1');
}

function realityKeysFor(privateKey: string, publicKey: string): { privateKey: string; publicKey: string } {
    if (privateKey && publicKey) return { privateKey, publicKey };
    const decoded = privateKey ? decodeX25519Key(privateKey) : null;
    if (decoded) return { privateKey, publicKey: encodeRealityKey(x25519PublicKeyFromPrivate(decoded)) };
    if (privateKey) throw new FacadeHttpError(400, 'The Reality private key is not a valid X25519 key; clear it to have one generated');
    const pair = generateX25519KeyPair();
    return { privateKey: encodeRealityKey(pair.privateKey), publicKey: encodeRealityKey(pair.publicKey) };
}

async function createSuiTlsProfile(ctx: FacadeContext, wanted: WantedSuiTls, tag: string, profiles: any[]): Promise<number> {
    const server: any = { enabled: true };
    const client: any = {};
    if (wanted.serverName) server.server_name = wanted.serverName;
    if (wanted.reality) {
        const handshakeServer = wanted.handshakeServer || wanted.serverName;
        if (!handshakeServer) throw new FacadeHttpError(400, 'Reality needs a target site, for example www.microsoft.com:443');
        if (!server.server_name) server.server_name = handshakeServer;
        const keys = realityKeysFor(wanted.privateKey, wanted.publicKey);
        const shortIds = wanted.shortIds.length > 0 ? wanted.shortIds : [crypto.randomBytes(4).toString('hex')];
        server.reality = {
            enabled: true,
            handshake: { server: handshakeServer, server_port: wanted.handshakePort || 443 },
            private_key: keys.privateKey,
            short_id: shortIds,
        };
        client.utls = { enabled: true, fingerprint: wanted.fingerprint || 'chrome' };
        client.reality = { enabled: true, public_key: keys.publicKey, short_id: shortIds[0] };
    } else {
        server.alpn = wanted.needsH3 ? ['h3'] : (wanted.alpn || ['h2', 'http/1.1']);
        server.min_version = '1.2';
        server.max_version = '1.3';
        if (Boolean(wanted.certPath) !== Boolean(wanted.keyPath)) {
            throw new FacadeHttpError(400, 'Enter both the TLS certificate file and the key file, or leave both empty');
        }
        if (wanted.certPath) {
            server.certificate_path = wanted.certPath;
            server.key_path = wanted.keyPath;
        } else if (wanted.certInline.length > 0 && wanted.keyInline.length > 0) {
            server.certificate = wanted.certInline;
            server.key = wanted.keyInline;
        } else {
            const panelSettings = await ctx.transport.request('GET', 'settings').catch(() => null);
            const certFile = normalizeText(panelSettings?.webCertFile);
            const keyFile = normalizeText(panelSettings?.webKeyFile);
            if (!certFile || !keyFile) throw new FacadeHttpError(400, SUI_NO_CERT_MESSAGE);
            server.certificate_path = certFile;
            server.key_path = keyFile;
            const domain = normalizeText(panelSettings?.webDomain);
            if (!server.server_name && domain) server.server_name = domain;
        }
        if (wanted.fingerprint) client.utls = { enabled: true, fingerprint: wanted.fingerprint };
    }
    const taken = new Set(profiles.map((item) => normalizeText(item?.name)));
    const base = `nms-${wanted.reality ? 'reality' : 'tls'}-${server.server_name || tag || randomSeq(4)}`.slice(0, 64);
    let name = base;
    for (let index = 2; taken.has(name); index += 1) name = `${base}-${index}`;
    await saveObject(ctx.transport, 'tls', 'new', { name, server, client });
    const created = (await fetchSummary(ctx.transport, 'tls')).find((item) => normalizeText(item?.name) === name);
    if (!created) throw new FacadeHttpError(502, 'The TLS profile was not saved on the s-ui node');
    return Number(created.id);
}

/**
 * Pick the s-ui TLS profile for an inbound. s-ui keeps TLS in named profiles
 * where 3x-ui keeps it inline, so the editor's TLS/Reality settings are matched
 * against the node's profiles: the current one is kept when it still fits, a
 * fitting one is reused, and otherwise one is created (with the panel's own
 * HTTPS certificate when no certificate was entered).
 */
export async function resolveSuiInboundTls(ctx: FacadeContext, inbound: any, payload: any, existing: any): Promise<void> {
    const type = normalizeText(inbound?.type).toLowerCase();
    if (!SUI_TLS_TYPES.has(type)) {
        inbound.tls_id = 0;
        return;
    }
    const explicit = payload?.suiTlsId;
    if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '' && String(explicit) !== 'auto') {
        const id = toNonNegativeInt(explicit);
        if (id > 0 || !SUI_TLS_REQUIRED_TYPES.has(type)) {
            inbound.tls_id = id;
            return;
        }
    }
    const stream = parseMaybeJson(payload?.streamSettings, null);
    const hasStream = Boolean(stream && typeof stream === 'object');
    if (!hasStream && existing && (toNonNegativeInt(existing.tls_id) > 0 || !SUI_TLS_REQUIRED_TYPES.has(type))) {
        // Nothing about security in this request (a rename, a port change): keep what is stored.
        return;
    }
    let security = normalizeText(stream?.security).toLowerCase();
    if (SUI_QUIC_TYPES.has(type)) security = 'tls';
    else if (SUI_TLS_REQUIRED_TYPES.has(type) && security !== 'reality') security = 'tls';
    if (security !== 'tls' && security !== 'reality') {
        inbound.tls_id = 0;
        return;
    }
    const wanted = readWantedSuiTls(type, security, hasStream ? stream : {});
    const profiles = await fetchSummary(ctx.transport, 'tls').catch(() => []);
    const currentId = toNonNegativeInt(existing?.tls_id);
    const current = currentId ? profiles.find((item) => Number(item?.id) === currentId) : null;
    if (current && suiTlsProfileMatches(current, wanted)) {
        inbound.tls_id = currentId;
        return;
    }
    const reusable = profiles.find((item) => suiTlsProfileMatches(item, wanted));
    inbound.tls_id = reusable
        ? Number(reusable.id)
        : await createSuiTlsProfile(ctx, wanted, normalizeText(inbound.tag), profiles);
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

/** Clients listed in an editor payload, by name; entries without a name get a random one. */
function payloadClients(payload: any): any[] | null {
    const settings = parseMaybeJson(payload?.settings, {}) || {};
    const list = Array.isArray(settings.clients) ? settings.clients : (Array.isArray(settings.users) ? settings.users : null);
    if (!list) return null;
    const seen = new Set<string>();
    const result: any[] = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const input = { ...raw };
        input.email = normalizeText(input.email || input.name || input.username) || randomSeq(8);
        const key = normalizeName(input.email);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(input);
    }
    return result;
}

interface ClientMembershipChange {
    created: number[];
    attached: any[];
}

/**
 * Make sure every client named in the editor exists on the node. Existing
 * clients keep their credentials (s-ui shares them across the client's
 * inbounds); new ones take what the editor generated for this inbound.
 */
async function ensurePayloadClients(ctx: FacadeContext, inputs: any[], targetKeys: string[], change: ClientMembershipChange): Promise<any[]> {
    if (inputs.length === 0) return [];
    const summary = await fetchSummary(ctx.transport, 'clients');
    const byName = new Map(summary.map((item) => [normalizeName(item?.name), item]));
    const existingIds = inputs
        .map((input) => byName.get(normalizeName(input.email)))
        .filter(Boolean)
        .map((item: any) => Number(item.id));
    const existing = (await fetchFullObjects(ctx.transport, 'clients', existingIds)).map(normalizeSuiClient);
    const existingByName = new Map(existing.map((client) => [normalizeName(client.name), client]));
    const result: any[] = [];
    for (const input of inputs) {
        const found = existingByName.get(normalizeName(input.email));
        if (found) {
            result.push(found);
            continue;
        }
        const client = createSuiClientFromXui(input, [], targetKeys);
        await saveClient(ctx.transport, client, 'new');
        const saved = await findClientByName(ctx.transport, client.name);
        if (!saved) throw new FacadeHttpError(502, `client ${client.name} was not saved on the s-ui node`);
        change.created.push(Number(saved.id));
        result.push(saved);
    }
    return result;
}

async function rollbackClientChanges(ctx: FacadeContext, change: ClientMembershipChange, inboundId: number | null): Promise<void> {
    for (const client of change.attached) {
        if (!inboundId) break;
        client.inbounds = client.inbounds.filter((id: number) => id !== inboundId);
        await saveClient(ctx.transport, client, 'edit').catch(() => undefined);
    }
    for (const id of change.created) {
        await saveObject(ctx.transport, 'clients', 'del', id).catch(() => undefined);
    }
}

const CLIENT_FIELD_KEYS = ['enable', 'totalGB', 'expiryTime', 'reset', 'comment'];
const CLIENT_CREDENTIAL_KEYS = ['id', 'password', 'auth', 'flow'];

/** The fields of `input` that differ from what the node shows for this client on `inbound`. */
function changedClientFields(client: any, inbound: any, input: any): Record<string, any> | null {
    const shown = suiClientToXuiClient(client, inbound);
    const changes: Record<string, any> = {};
    for (const key of [...CLIENT_FIELD_KEYS, ...CLIENT_CREDENTIAL_KEYS]) {
        if (input[key] === undefined || input[key] === null) continue;
        if (CLIENT_CREDENTIAL_KEYS.includes(key) && normalizeText(input[key]) === '') continue;
        const before = shown[key];
        const after = input[key];
        const same = typeof before === 'number'
            ? Number(after) === before
            : typeof before === 'boolean'
                ? (after !== false && after !== 'false') === before
                : normalizeText(after) === normalizeText(before);
        if (!same) changes[key] = after;
    }
    return Object.keys(changes).length > 0 ? changes : null;
}

async function handleAddInbound(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    const body = req.body || {};
    const inbound = xuiInboundPayloadToSui(body, null);
    delete inbound.id;
    const native = parseMaybeJson(body.suiInbound, null);
    if (!native || typeof native !== 'object') await resolveSuiInboundTls(ctx, inbound, body, null);

    const summary = await fetchSummary(ctx.transport, 'inbounds');
    if (summary.some((item) => normalizeText(item?.tag) === normalizeText(inbound.tag))) {
        throw new FacadeHttpError(409, `An inbound named ${inbound.tag} already exists on this s-ui node; pick another remark`);
    }

    const change: ClientMembershipChange = { created: [], attached: [] };
    const initUsers = new Set(normalizeInboundIdList(parseMaybeJson(body.suiInitUsers, [])));
    const inputs = payloadClients(body);
    if (inputs && inboundHasUsers(inbound)) {
        const clients = await ensurePayloadClients(ctx, inputs, suiConfigKeysForInbound(inbound), change);
        for (const client of clients) initUsers.add(Number(client.id));
    }
    if (SUI_CLIENT_REQUIRED_TYPES.has(inbound.type) && inboundHasUsers(inbound) && initUsers.size === 0) {
        throw new FacadeHttpError(400, `${inbound.type} inbounds need at least one client`);
    }
    try {
        await saveObject(ctx.transport, 'inbounds', 'new', inbound, initUsers.size > 0 ? { initUsers: Array.from(initUsers).join(',') } : {});
    } catch (error) {
        await rollbackClientChanges(ctx, change, null);
        throw error;
    }
    const after = await fetchSummary(ctx.transport, 'inbounds');
    const created = after.find((item) => normalizeText(item?.tag) === normalizeText(inbound.tag));
    return ok(created ? { ...inbound, id: created.id } : inbound, 'Create successfully');
}

async function handleUpdateInbound(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const body = req.body || {};
    const existing = await findInboundById(ctx.transport, safeDecode(match[1]));
    if (!existing) throw new FacadeHttpError(404, 'inbound not found');
    const inbound = xuiInboundPayloadToSui(body, existing);
    inbound.id = existing.id;
    const native = parseMaybeJson(body.suiInbound, null);
    if (!native || typeof native !== 'object') await resolveSuiInboundTls(ctx, inbound, body, existing);

    const inboundId = Number(existing.id);
    const inputs = payloadClients(body);
    const change: ClientMembershipChange = { created: [], attached: [] };
    const toDetach: any[] = [];
    const toEdit: any[] = [];
    if (inputs && inboundHasUsers(inbound)) {
        const targetKeys = suiConfigKeysForInbound(inbound);
        const snapshotClients = (await fetchSummary(ctx.transport, 'clients'));
        const memberIds = normalizeInboundIdList(snapshotClients.map((item) => item?.id));
        const all = (await fetchFullObjects(ctx.transport, 'clients', memberIds)).map(normalizeSuiClient);
        const members = all.filter((client) => client.inbounds.includes(inboundId));
        const wanted = new Set(inputs.map((input) => normalizeName(input.email)));
        if (SUI_CLIENT_REQUIRED_TYPES.has(inbound.type) && wanted.size === 0) {
            throw new FacadeHttpError(400, `${inbound.type} inbounds need at least one client`);
        }
        const clients = await ensurePayloadClients(ctx, inputs, targetKeys, change);
        for (const [index, client] of clients.entries()) {
            const input = inputs[index];
            const isMember = client.inbounds.includes(inboundId);
            const isNew = change.created.includes(Number(client.id));
            const fields = isNew ? null : changedClientFields(client, inbound, input);
            if (fields) {
                const { id: _id, password: _pw, auth: _auth, flow: _flow, ...plain } = fields;
                applyXuiClientFields(client, plain, null);
                const credentials = { id: fields.id, password: fields.password ?? fields.auth, flow: fields.flow };
                if (credentials.id || credentials.password || credentials.flow) {
                    applyXuiCredentials(client.config, credentials, targetKeys);
                    syncConfigIdentity(client.config, client.name);
                }
            }
            if (!isMember) {
                client.inbounds = [...client.inbounds, inboundId];
                change.attached.push(client);
            } else if (fields) {
                toEdit.push(client);
            }
        }
        for (const client of members) {
            if (!wanted.has(normalizeName(client.name))) toDetach.push(client);
        }
    }

    try {
        // New members first, so a type that needs users (naive, ShadowTLS v3) starts with them.
        for (const client of change.attached) await saveClient(ctx.transport, client, 'edit');
        await saveObject(ctx.transport, 'inbounds', 'edit', inbound);
    } catch (error) {
        await rollbackClientChanges(ctx, change, inboundId);
        throw error;
    }
    for (const client of toEdit) await saveClient(ctx.transport, client, 'edit');
    for (const client of toDetach) {
        client.inbounds = client.inbounds.filter((id: number) => id !== inboundId);
        await saveClient(ctx.transport, client, 'edit');
    }
    return ok(inbound, 'Update successfully');
}

async function handleSetInboundEnable(ctx: FacadeContext, req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    const existing = await findInboundById(ctx.transport, safeDecode(match[1]));
    if (!existing) throw new FacadeHttpError(404, 'inbound not found');
    // Older s-ui builds have no enable column and would pass the key through to sing-box,
    // which rejects unknown inbound fields. Only builds that report the flag can take it.
    if (typeof existing.enable !== 'boolean') {
        unsupported('Enabling or disabling an inbound on this s-ui version');
    }
    const raw = req.body?.enable;
    const enable = raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
    const inbound = cloneJson(existing);
    delete inbound.users;
    inbound.enable = enable;
    await saveObject(ctx.transport, 'inbounds', 'edit', inbound);
    return ok(null, 'Update successfully');
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

// s-ui keeps API tokens per login user and only exposes them on the session API (`/api`);
// the token API (`/apiv2`) has no token actions at all.
function requireSessionTokenApi(ctx: FacadeContext): void {
    if (ctx.transport.mode !== 'session') {
        throw new FacadeHttpError(
            501,
            's-ui only manages API tokens for a logged-in user; connect this node with a username and password'
        );
    }
}

function suiTokenToXuiToken(row: any): any {
    const expirySeconds = toNonNegativeInt(row?.expiry);
    return {
        id: row?.id,
        name: normalizeText(row?.desc),
        // s-ui tokens have no enable switch and always carry full access.
        enabled: true,
        scope: 'admin',
        expiresAt: expirySeconds > 0 ? expirySeconds * 1000 : 0,
        createdAt: 0,
    };
}

async function handleListApiTokens(ctx: FacadeContext): Promise<FacadeResult> {
    requireSessionTokenApi(ctx);
    const rows = await ctx.transport.request('GET', 'tokens');
    return ok((Array.isArray(rows) ? rows : []).map(suiTokenToXuiToken));
}

async function handleCreateApiToken(ctx: FacadeContext, req: FacadeRequest): Promise<FacadeResult> {
    requireSessionTokenApi(ctx);
    const name = normalizeText(req.body?.name);
    if (!name) throw new FacadeHttpError(400, 'token name is required');
    const scope = normalizeText(req.body?.scope).toLowerCase();
    if (scope && scope !== 'admin') {
        throw new FacadeHttpError(400, 's-ui API tokens always have full access; choose the admin scope');
    }
    // s-ui takes a lifetime in whole days, counted from now (0 = never expires).
    const expiresAt = toNonNegativeInt(req.body?.expiresAt);
    const days = expiresAt > 0 ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 86400000)) : 0;
    const token = await ctx.transport.request('POST', 'addToken', { form: { desc: name, expiry: days } });
    return ok({
        name,
        token: typeof token === 'string' ? token : '',
        scope: 'admin',
        enabled: true,
        expiresAt: days > 0 ? Date.now() + days * 86400000 : 0,
    });
}

async function handleDeleteApiToken(ctx: FacadeContext, _req: FacadeRequest, match: RegExpMatchArray): Promise<FacadeResult> {
    requireSessionTokenApi(ctx);
    await ctx.transport.request('POST', 'deleteToken', { form: { id: safeDecode(match[1]) } });
    return ok(null, 'Token deleted');
}

const NATIVE_GET_ACTIONS = new Set([
    'load', 'inbounds', 'outbounds', 'endpoints', 'services', 'tls', 'clients', 'config', 'users',
    'settings', 'stats', 'status', 'onlines', 'sessions', 'logs', 'changes', 'keypairs', 'checkOutbound',
    'singbox-config', 'checkUpdate', 'tokens',
]);
const NATIVE_POST_ACTIONS = new Set([
    'save', 'restartApp', 'restartSb', 'maintenance', 'resetTraffic', 'linkConvert', 'subConvert',
    'closeSessions', 'getCertPing', 'update', 'addToken', 'deleteToken',
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
    [/^\/panel\/api\/inbounds\/setEnable\/([^/]+)$/, handleSetInboundEnable],
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
    [/^\/panel\/api\/setting\/apiTokens$/, handleListApiTokens],
    [/^\/panel\/api\/setting\/apiTokens\/create$/, handleCreateApiToken],
    [/^\/panel\/api\/setting\/apiTokens\/delete\/([^/]+)$/, handleDeleteApiToken],
    [/^\/panel\/api\/nodes\/list$/, async () => ok([])],
    [/^\/sub\/([^/]+)$/, handleSubscription],
    [/^\/sui\/([A-Za-z]+)$/, handleNative],
];

const UNSUPPORTED_FEATURES: Array<[RegExp, string]> = [
    [LEGACY_CLIENT_ENDPOINT, 'Per-inbound client editing'],
    [/^\/panel\/api\/clients\/onlinesBy(?:Guid|Node)$/, 'Multi-node online attribution'],
    [/^\/panel\/api\/setting\/apiTokens\/setEnabled\//, 'Pausing an API token (delete it instead)'],
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
