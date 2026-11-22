import crypto from 'node:crypto';

/**
 * Brings an inbound payload into the shape 3x-ui 3.x (Xray 26) actually runs.
 *
 * 3x-ui stores what it is given and hands most of it straight to Xray, so a
 * payload with an empty REALITY private key, an empty WireGuard secret key or a
 * tunnel `port: ""` is accepted by the panel and then stops Xray for every
 * inbound on that node. This runs on every add/update sent to a 3x-ui panel and
 * only fills in or reshapes what would otherwise break; values the user set are
 * kept.
 */

type JsonField = { parsed: any; isString: boolean; present: boolean };

const PROTOCOL_ALIASES: Record<string, string> = {
    'dokodemo-door': 'tunnel',
    dokodemo: 'tunnel',
    socks: 'mixed',
    hysteria2: 'hysteria',
    hy2: 'hysteria',
};

const DEFAULT_MTPROTO_DOMAIN = 'www.cloudflare.com';
const DEFAULT_MASQUE_ADDRESS = ['10.14.0.1/24', 'fd14::1/64'];
const DEFAULT_MASQUE_PATH = '/.well-known/masque/ip/*/*/';
const DEFAULT_REALITY_TARGET = 'www.microsoft.com:443';
const AMNEZIA_ONLY_KEYS = ['jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4', 'h1', 'h2', 'h3', 'h4'];
const HYSTERIA_V1_KEYS = [
    'up_mbps', 'down_mbps', 'obfs', 'auth_str', 'ignore_client_bandwidth', 'recv_window_conn',
    'recv_window_client', 'max_conn_client', 'disable_mtu_discovery', 'masquerade',
];
const UDP_TRANSPORTS = new Set(['kcp', 'mkcp', 'quic', 'hysteria']);

export const TUIC_SERVER_DEFAULTS = Object.freeze({
    certificate: '',
    private_key: '',
    congestion_control: 'bbr',
    alpn: ['h3', 'spdy/3.1'],
    udp_relay_mode: 'native',
    zero_rtt_handshake: true,
    log_level: 'info',
    max_idle_time: 15,
    authentication_timeout: 3,
    max_udp_relay_packet_size: 1500,
    sni: '',
});

function text(value: unknown): string {
    return value === undefined || value === null ? '' : String(value).trim();
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readField(value: unknown): JsonField {
    if (value === undefined || value === null) return { parsed: null, isString: false, present: false };
    if (typeof value === 'string') {
        if (!value.trim()) return { parsed: {}, isString: true, present: true };
        try {
            const parsed = JSON.parse(value);
            return isPlainObject(parsed)
                ? { parsed, isString: true, present: true }
                : { parsed: null, isString: true, present: false };
        } catch {
            return { parsed: null, isString: true, present: false };
        }
    }
    return isPlainObject(value)
        ? { parsed: value, isString: false, present: true }
        : { parsed: null, isString: false, present: false };
}

function writeField(field: JsonField, next: any): any {
    return field.isString ? JSON.stringify(next) : next;
}

function randomLowerAndNum(length: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

function randomPassword(length = 16): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

function validPort(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

// ---------------------------------------------------------------------------
// Curve25519 keys (REALITY and WireGuard use the same key type, different text)
// ---------------------------------------------------------------------------

const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

function clampX25519(raw: Buffer): Buffer {
    const key = Buffer.from(raw);
    key[0] &= 248;
    key[31] = (key[31] & 127) | 64;
    return key;
}

export function generateX25519KeyPair(): { privateKey: Buffer; publicKey: Buffer } {
    const { privateKey } = crypto.generateKeyPairSync('x25519');
    const jwk: any = privateKey.export({ format: 'jwk' });
    // X25519 clamps the scalar on use, so the public key already matches the
    // clamped private key; clamp the stored bytes to match `wg genkey` / `xray x25519`.
    return {
        privateKey: clampX25519(Buffer.from(jwk.d, 'base64url')),
        publicKey: Buffer.from(jwk.x, 'base64url'),
    };
}

export function decodeX25519Key(value: unknown): Buffer | null {
    const raw = text(value);
    if (!raw) return null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    try {
        const bytes = Buffer.from(normalized, 'base64');
        return bytes.length === 32 ? bytes : null;
    } catch {
        return null;
    }
}

export function x25519PublicKeyFromPrivate(privateKey: Buffer): Buffer {
    const keyObject = crypto.createPrivateKey({
        key: Buffer.concat([X25519_PKCS8_PREFIX, privateKey]),
        format: 'der',
        type: 'pkcs8',
    });
    const jwk: any = crypto.createPublicKey(keyObject).export({ format: 'jwk' });
    return Buffer.from(jwk.x, 'base64url');
}

/** REALITY keys: base64 RawURLEncoding, as `xray x25519` prints them. */
export function encodeRealityKey(key: Buffer): string {
    return key.toString('base64url');
}

/** WireGuard keys: standard padded base64, as `wg genkey` prints them. */
export function encodeWireguardKey(key: Buffer): string {
    return key.toString('base64');
}

export function generateMtprotoSecret(domain: string = DEFAULT_MTPROTO_DOMAIN): string {
    const host = text(domain) || DEFAULT_MTPROTO_DOMAIN;
    return `ee${crypto.randomBytes(16).toString('hex')}${Buffer.from(host, 'utf8').toString('hex')}`;
}

function mtprotoSecretIsValid(secret: string): boolean {
    let decoded: Buffer | null = null;
    if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
        decoded = Buffer.from(secret, 'hex');
    } else {
        try {
            decoded = Buffer.from(secret, 'base64url');
        } catch {
            decoded = null;
        }
    }
    return !!decoded && decoded.length > 17 && decoded[0] === 0xee;
}

function shadowsocksKeyBytes(method: string): number {
    const normalized = text(method).toLowerCase();
    if (normalized === '2022-blake3-aes-128-gcm') return 16;
    if (normalized.startsWith('2022-blake3-')) return 32;
    return 0;
}

function shadowsocksKeyIsValid(value: unknown, bytes: number): boolean {
    const raw = text(value);
    if (!raw) return false;
    try {
        return Buffer.from(raw, 'base64').length === bytes;
    } catch {
        return false;
    }
}

function randomShadowsocksKey(method: string): string {
    const bytes = shadowsocksKeyBytes(method);
    return bytes > 0 ? crypto.randomBytes(bytes).toString('base64') : randomPassword(16);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function withClientBase(client: Record<string, any>): Record<string, any> {
    const next = { ...client };
    if (!text(next.email)) next.email = randomLowerAndNum(10);
    // subId is left alone: inventing one would turn every inbound save into a client update.
    if (next.enable === undefined) next.enable = true;
    return next;
}

function normalizeClientForProtocol(client: any, protocol: string, settings: Record<string, any>): any {
    if (!isPlainObject(client)) return client;
    const next = withClientBase(client);
    switch (protocol) {
        case 'vless':
        case 'vmess':
            if (!text(next.id)) next.id = text(next.uuid) || crypto.randomUUID();
            break;
        case 'trojan':
        case 'masque':
            if (!text(next.password)) next.password = randomPassword(16);
            break;
        case 'shadowsocks': {
            const bytes = shadowsocksKeyBytes(settings.method);
            if (bytes > 0 ? !shadowsocksKeyIsValid(next.password, bytes) : !text(next.password)) {
                next.password = randomShadowsocksKey(settings.method);
            }
            break;
        }
        case 'hysteria': {
            // `password` is the field NMS user sync rotates, so it wins over a stale `auth`.
            const auth = text(next.password) || text(next.auth) || text(next.auth_str) || randomPassword(16);
            next.auth = auth;
            delete next.password;
            delete next.auth_str;
            break;
        }
        case 'tuic': {
            const id = text(next.id) || text(next.uuid) || crypto.randomUUID();
            next.id = id;
            next.uuid = id;
            if (!text(next.password)) next.password = randomPassword(16);
            break;
        }
        case 'mtproto': {
            const secret = text(next.secret);
            if (!secret || !mtprotoSecretIsValid(secret)) {
                next.secret = generateMtprotoSecret(settings.fakeTlsDomain);
            }
            break;
        }
        default:
            break;
    }
    return next;
}

// ---------------------------------------------------------------------------
// Settings, per protocol
// ---------------------------------------------------------------------------

function normalizePortMap(value: unknown): Record<string, string> {
    if (isPlainObject(value)) {
        const out: Record<string, string> = {};
        for (const [key, target] of Object.entries(value)) {
            if (text(key) && text(target)) out[text(key)] = text(target);
        }
        return out;
    }
    if (Array.isArray(value)) {
        const out: Record<string, string> = {};
        for (const entry of value) {
            if (isPlainObject(entry)) {
                const key = text(entry.key ?? entry.port ?? entry.name);
                const target = text(entry.value ?? entry.target ?? entry.address);
                if (key && target) out[key] = target;
            } else if (typeof entry === 'string' && entry.includes('=')) {
                const [key, target] = entry.split('=');
                if (text(key) && text(target)) out[text(key)] = text(target);
            }
        }
        return out;
    }
    return {};
}

function normalizeTunnelSettings(input: Record<string, any>): Record<string, any> {
    const settings = { ...input };
    if ('address' in settings) {
        const address = text(settings.address);
        if (address && !text(settings.rewriteAddress)) settings.rewriteAddress = address;
        delete settings.address;
    }
    if ('port' in settings) {
        const port = validPort(settings.port);
        if (port && !validPort(settings.rewritePort)) settings.rewritePort = port;
        delete settings.port;
    }
    if ('network' in settings) {
        if (!text(settings.allowedNetwork)) settings.allowedNetwork = text(settings.network);
        delete settings.network;
    }
    if ('rewriteAddress' in settings && !text(settings.rewriteAddress)) delete settings.rewriteAddress;
    if ('rewritePort' in settings) {
        const port = validPort(settings.rewritePort);
        if (port) settings.rewritePort = port;
        else delete settings.rewritePort;
    }
    settings.allowedNetwork = text(settings.allowedNetwork) || 'tcp,udp';
    settings.portMap = normalizePortMap(settings.portMap);
    settings.followRedirect = settings.followRedirect === true || settings.followRedirect === 'true';
    return settings;
}

function normalizeWireguardSettings(input: Record<string, any>): Record<string, any> {
    const settings = { ...input };
    const secret = decodeX25519Key(settings.secretKey);
    settings.secretKey = secret ? text(settings.secretKey) : encodeWireguardKey(generateX25519KeyPair().privateKey);
    // A peer without a public key fails Xray's config build; the panel's own
    // client list (keys + addresses filled by 3x-ui) replaces hand-made peers.
    if (Array.isArray(settings.peers)) {
        settings.peers = settings.peers.filter((peer: any) => isPlainObject(peer) && decodeX25519Key(peer.publicKey));
    } else {
        settings.peers = [];
    }
    if (!Array.isArray(settings.clients)) settings.clients = [];
    for (const key of AMNEZIA_ONLY_KEYS) delete settings[key];
    const mtu = Number(settings.mtu);
    settings.mtu = Number.isInteger(mtu) && mtu > 0 ? mtu : 1420;
    if (!text(settings.subnetIp)) settings.subnetIp = '10.0.0.0';
    const cidr = Number(settings.subnetCidr);
    settings.subnetCidr = Number.isInteger(cidr) && cidr > 0 && cidr <= 32 ? cidr : 24;
    if (typeof settings.noKernelTun !== 'boolean') settings.noKernelTun = false;
    return settings;
}

function normalizeMtprotoSettings(input: Record<string, any>): Record<string, any> {
    const settings = { ...input };
    settings.fakeTlsDomain = text(settings.fakeTlsDomain) || text(settings.domain) || DEFAULT_MTPROTO_DOMAIN;
    delete settings.domain;
    const legacySecret = text(settings.secret);
    delete settings.secret;
    if (!Array.isArray(settings.clients)) settings.clients = [];
    if (settings.clients.length === 0 && legacySecret) {
        settings.clients = [{ secret: legacySecret }];
    }
    return settings;
}

function normalizeTuicSettings(input: Record<string, any>, stream: Record<string, any> | null): Record<string, any> {
    const settings = { ...input };
    const legacyServer: Record<string, any> = {};
    if (text(settings.congestion_control)) legacyServer.congestion_control = text(settings.congestion_control);
    if (typeof settings.zero_rtt_handshake === 'boolean') legacyServer.zero_rtt_handshake = settings.zero_rtt_handshake;
    if (Array.isArray(settings.alpn) && settings.alpn.length > 0) legacyServer.alpn = settings.alpn;
    const server: Record<string, any> = {
        ...TUIC_SERVER_DEFAULTS,
        ...legacyServer,
        ...(isPlainObject(settings.server) ? settings.server : {}),
    };
    if (!text(server.certificate) || !text(server.private_key)) {
        const cert = Array.isArray(stream?.tlsSettings?.certificates) ? stream?.tlsSettings?.certificates[0] : null;
        if (cert && text(cert.certificateFile) && text(cert.keyFile)) {
            server.certificate = text(cert.certificateFile);
            server.private_key = text(cert.keyFile);
        }
        if (!text(server.sni) && text(stream?.tlsSettings?.serverName)) server.sni = text(stream?.tlsSettings?.serverName);
    }
    settings.server = server;
    if (!Array.isArray(settings.clients)) {
        settings.clients = Array.isArray(settings.users) ? settings.users : [];
    }
    for (const key of ['users', 'congestion_control', 'zero_rtt_handshake', 'alpn', 'auth_timeout', 'heartbeat']) {
        delete settings[key];
    }
    return settings;
}

function normalizeMasqueSettings(input: Record<string, any>): Record<string, any> {
    const settings = { ...input };
    const address = Array.isArray(settings.address)
        ? settings.address.map(text).filter(Boolean)
        : text(settings.address).split(/[\s,]+/).filter(Boolean);
    settings.address = address.length > 0 ? address : [...DEFAULT_MASQUE_ADDRESS];
    if (!Array.isArray(settings.clients)) settings.clients = [];
    return settings;
}

function normalizeHysteriaSettings(input: Record<string, any>): { settings: Record<string, any>; salamander: string } {
    const settings = { ...input };
    let salamander = '';
    if (isPlainObject(settings.obfs) && text(settings.obfs.type).toLowerCase() === 'salamander') {
        salamander = text(settings.obfs.password);
    } else if (typeof settings.obfs === 'string') {
        salamander = text(settings.obfs);
    }
    for (const key of HYSTERIA_V1_KEYS) delete settings[key];
    settings.version = 2;
    if (!Array.isArray(settings.clients)) settings.clients = [];
    return { settings, salamander };
}

function normalizeShadowsocksSettings(input: Record<string, any>, network: string): Record<string, any> {
    const settings = { ...input };
    settings.method = text(settings.method) || '2022-blake3-aes-256-gcm';
    const bytes = shadowsocksKeyBytes(settings.method);
    if (bytes > 0 && !shadowsocksKeyIsValid(settings.password, bytes)) {
        settings.password = randomShadowsocksKey(settings.method);
    }
    settings.network = text(settings.network) || 'tcp,udp';
    // A UDP transport already owns the UDP side of the port; Shadowsocks'
    // own UDP relay would then fail with "address already in use".
    if (UDP_TRANSPORTS.has(network) && settings.network.split(',').map(text).includes('udp')) {
        settings.network = 'tcp';
    }
    if (!Array.isArray(settings.clients)) settings.clients = [];
    return settings;
}

function normalizeMixedSettings(input: Record<string, any>): Record<string, any> {
    const settings = { ...input };
    const accounts = Array.isArray(settings.accounts)
        ? settings.accounts.filter((account: any) => isPlainObject(account) && text(account.user) && text(account.pass))
        : [];
    settings.accounts = accounts;
    if (!text(settings.auth)) settings.auth = accounts.length > 0 ? 'password' : 'noauth';
    return settings;
}

function normalizeHttpSettings(input: Record<string, any>): Record<string, any> {
    const settings = { ...input };
    settings.accounts = Array.isArray(settings.accounts)
        ? settings.accounts.filter((account: any) => isPlainObject(account) && text(account.user) && text(account.pass))
        : [];
    return settings;
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

function ensureH3Alpn(tlsSettings: Record<string, any>): Record<string, any> {
    const next = { ...tlsSettings };
    const alpn = Array.isArray(next.alpn) ? next.alpn.map(text).filter(Boolean) : [];
    next.alpn = alpn.includes('h3') ? alpn : ['h3'];
    return next;
}

function hostFromTarget(target: string): string {
    const raw = text(target);
    if (!raw) return '';
    if (raw.startsWith('[')) return raw.slice(1, raw.indexOf(']'));
    const lastColon = raw.lastIndexOf(':');
    return lastColon > 0 ? raw.slice(0, lastColon) : raw;
}

function normalizeRealitySettings(input: Record<string, any>): Record<string, any> {
    const reality = { ...input };
    const nested = isPlainObject(reality.settings) ? { ...reality.settings } : {};
    const privateKey = decodeX25519Key(reality.privateKey);
    if (!privateKey) {
        const pair = generateX25519KeyPair();
        reality.privateKey = encodeRealityKey(pair.privateKey);
        nested.publicKey = encodeRealityKey(pair.publicKey);
    } else {
        const derived = encodeRealityKey(x25519PublicKeyFromPrivate(privateKey));
        const current = decodeX25519Key(nested.publicKey);
        if (!current || encodeRealityKey(current) !== derived) nested.publicKey = derived;
    }
    reality.settings = nested;

    const target = text(reality.target) || text(reality.dest) || DEFAULT_REALITY_TARGET;
    reality.target = target.includes(':') ? target : `${target}:443`;
    if ('dest' in reality) delete reality.dest;
    const serverNames = Array.isArray(reality.serverNames)
        ? reality.serverNames.map(text).filter(Boolean)
        : text(reality.serverNames).split(/[\s,]+/).filter(Boolean);
    reality.serverNames = serverNames.length > 0 ? serverNames : [hostFromTarget(reality.target)].filter(Boolean);
    const shortIds = Array.isArray(reality.shortIds)
        ? reality.shortIds.map(text).filter((id: string) => /^[0-9a-fA-F]{0,16}$/.test(id) && id.length % 2 === 0)
        : text(reality.shortIds).split(/[\s,]+/).filter((id: string) => /^[0-9a-fA-F]{0,16}$/.test(id) && id.length % 2 === 0);
    reality.shortIds = shortIds.length > 0 ? shortIds : [crypto.randomBytes(4).toString('hex')];
    return reality;
}

function normalizeStream(input: Record<string, any>, protocol: string, salamander: string): Record<string, any> {
    const stream = { ...input };
    if (protocol === 'hysteria') {
        stream.network = 'hysteria';
        const hysteriaSettings = isPlainObject(stream.hysteriaSettings) ? stream.hysteriaSettings : {};
        stream.hysteriaSettings = { udpIdleTimeout: 60, ...hysteriaSettings, version: 2 };
        if (!stream.security || stream.security === 'none' || stream.security === 'reality') stream.security = 'tls';
        if (salamander) {
            const finalmask = isPlainObject(stream.finalmask) ? { ...stream.finalmask } : {};
            const udp = Array.isArray(finalmask.udp) ? finalmask.udp.filter((mask: any) => mask?.type !== 'salamander') : [];
            finalmask.udp = [...udp, { type: 'salamander', settings: { password: salamander } }];
            if (!Array.isArray(finalmask.tcp)) finalmask.tcp = [];
            stream.finalmask = finalmask;
        }
    } else if (protocol === 'masque') {
        stream.network = 'masque';
        const masqueSettings = isPlainObject(stream.masqueSettings) ? stream.masqueSettings : {};
        stream.masqueSettings = { ...masqueSettings, path: text(masqueSettings.path) || DEFAULT_MASQUE_PATH };
        if (!stream.security || stream.security === 'none' || stream.security === 'reality') stream.security = 'tls';
    }
    if ((protocol === 'hysteria' || protocol === 'masque') && stream.security === 'tls') {
        stream.tlsSettings = ensureH3Alpn(isPlainObject(stream.tlsSettings) ? stream.tlsSettings : {});
    }
    if (stream.security === 'reality') {
        stream.realitySettings = normalizeRealitySettings(isPlainObject(stream.realitySettings) ? stream.realitySettings : {});
    }
    return stream;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function canonicalXuiProtocol(protocol: unknown): string {
    const normalized = text(protocol).toLowerCase();
    return PROTOCOL_ALIASES[normalized] || normalized;
}

export function normalizeInboundPayloadForXui(inboundData: any = {}): any {
    if (!isPlainObject(inboundData)) return inboundData;
    const rawProtocol = text(inboundData.protocol).toLowerCase();
    if (!rawProtocol) return inboundData;
    const protocol = canonicalXuiProtocol(rawProtocol);
    const payload: Record<string, any> = { ...inboundData, protocol };

    const settingsField = readField(payload.settings);
    const streamField = readField(payload.streamSettings);
    const stream = streamField.present ? streamField.parsed : null;
    const network = text(stream?.network).toLowerCase();
    let salamander = '';

    if (settingsField.present) {
        let settings: Record<string, any> = { ...settingsField.parsed };
        switch (protocol) {
            case 'vless':
                if (!text(settings.decryption)) settings.decryption = 'none';
                if (!text(settings.encryption)) settings.encryption = 'none';
                break;
            case 'shadowsocks':
                settings = normalizeShadowsocksSettings(settings, network);
                break;
            case 'tunnel':
                settings = normalizeTunnelSettings(settings);
                break;
            case 'wireguard':
                settings = normalizeWireguardSettings(settings);
                break;
            case 'mtproto':
                settings = normalizeMtprotoSettings(settings);
                break;
            case 'tuic':
                settings = normalizeTuicSettings(settings, stream);
                break;
            case 'masque':
                settings = normalizeMasqueSettings(settings);
                break;
            case 'hysteria': {
                const result = normalizeHysteriaSettings(settings);
                settings = result.settings;
                salamander = result.salamander;
                break;
            }
            case 'mixed':
                settings = normalizeMixedSettings(settings);
                break;
            case 'http':
                settings = normalizeHttpSettings(settings);
                break;
            default:
                break;
        }
        if (Array.isArray(settings.clients) && protocol !== 'wireguard' && protocol !== 'amneziawg') {
            settings.clients = settings.clients.map((client: any) => normalizeClientForProtocol(client, protocol, settings));
        }
        payload.settings = writeField(settingsField, settings);
    }

    if (streamField.present) {
        payload.streamSettings = writeField(streamField, normalizeStream(streamField.parsed, protocol, salamander));
    } else if ((protocol === 'hysteria' || protocol === 'masque') && !('streamSettings' in inboundData)) {
        // Hysteria and MASQUE only exist as their own transport; a create without
        // stream settings would otherwise store an inbound Xray cannot build.
        if (settingsField.present) {
            payload.streamSettings = writeField(
                { parsed: {}, isString: settingsField.isString, present: true },
                normalizeStream({}, protocol, salamander)
            );
        }
    }
    return payload;
}
