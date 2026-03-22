import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Select, Checkbox, Switch, InputNumber, Button, Row, Col, Space, Typography, Tooltip, Divider } from 'antd';
import { HiOutlineXMark, HiOutlineCheck } from 'react-icons/hi2';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import toast from 'react-hot-toast';

const { Text, Title } = Typography;
const { Option } = Select;

const PROTOCOL_SCHEMA_FALLBACK = [
    { key: 'vless', label: 'VLESS', legacyKeys: [], supports: { transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'], securities: ['none', 'tls', 'reality'], tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'], realityTransports: ['tcp', 'http', 'grpc', 'xhttp'] } },
    { key: 'vmess', label: 'VMess', legacyKeys: [], supports: { transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'], securities: ['none', 'tls'], tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'] } },
    { key: 'trojan', label: 'Trojan', legacyKeys: [], supports: { transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'], securities: ['none', 'tls', 'reality'], tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'], realityTransports: ['tcp', 'http', 'grpc', 'xhttp'] } },
    { key: 'shadowsocks', label: 'Shadowsocks', legacyKeys: [], supports: { transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'], securities: ['none', 'tls'], tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'] } },
    { key: 'http', label: 'HTTP', legacyKeys: [], supports: { transports: ['tcp'], securities: ['none'] } },
    { key: 'tunnel', label: 'Tunnel', legacyKeys: ['dokodemo-door'], supports: { transports: [], securities: [] } },
    { key: 'mixed', label: 'Mixed', legacyKeys: ['socks'], supports: { transports: [], securities: [] } },
    { key: 'wireguard', label: 'WireGuard', legacyKeys: [], supports: { transports: [], securities: [] } },
    { key: 'tun', label: 'TUN', legacyKeys: [], supports: { transports: [], securities: [] } },
];
const _PROTOCOL_FALLBACK = PROTOCOL_SCHEMA_FALLBACK.map((item) => item.key);

const NETWORK_LABELS = {
    tcp: 'TCP',
    ws: 'WebSocket (WS)',
    grpc: 'gRPC',
    kcp: 'KCP',
    quic: 'QUIC',
    httpupgrade: 'HTTP Upgrade',
    xhttp: 'XHTTP',
    udp: 'UDP',
};

const SECURITY_LABELS = {
    none: 'None',
    tls: 'TLS',
    reality: 'REALITY',
};

const FINGERPRINT_OPTIONS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'qq', '360', 'random', 'randomized', 'randomizednoalpn', 'unsafe'];
const _VMESS_SECURITY_OPTIONS = ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'];
const TLS_VERSION_OPTIONS = ['1.0', '1.1', '1.2', '1.3'];
const TLS_CIPHER_OPTIONS = [
    '',
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA',
    'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA',
    'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
    'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
    'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
    'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
];
const _SS_METHOD_OPTIONS = [
    'aes-256-gcm',
    'chacha20-poly1305',
    'chacha20-ietf-poly1305',
    'xchacha20-ietf-poly1305',
    '2022-blake3-aes-128-gcm',
    '2022-blake3-aes-256-gcm',
    '2022-blake3-chacha20-poly1305',
];
const VLESS_FLOW_OPTIONS = ['', 'xtls-rprx-vision', 'xtls-rprx-vision-udp443'];
const TRAFFIC_RESET_OPTIONS = ['never', 'daily', 'weekly', 'monthly'];
const SOCKOPT_DOMAIN_STRATEGY_OPTIONS = [
    'AsIs',
    'UseIP',
    'UseIPv6v4',
    'UseIPv6',
    'UseIPv4v6',
    'UseIPv4',
    'ForceIP',
    'ForceIPv6v4',
    'ForceIPv6',
    'ForceIPv4v6',
    'ForceIPv4',
];
const SOCKOPT_TCP_CONGESTION_OPTIONS = ['bbr', 'cubic', 'reno'];
const SOCKOPT_TPROXY_OPTIONS = ['off', 'redirect', 'tproxy'];
const XHTTP_PADDING_PLACEMENT_OPTIONS = ['', 'queryInHeader', 'header'];
const XHTTP_PADDING_METHOD_OPTIONS = ['', 'repeat-x', 'tokenish'];
const XHTTP_HTTP_METHOD_OPTIONS = ['', 'POST', 'PUT', 'GET'];
const XHTTP_SESSION_SEQ_PLACEMENT_OPTIONS = ['', 'path', 'header', 'cookie', 'query'];
const XHTTP_UPLINK_DATA_PLACEMENT_OPTIONS = ['', 'body', 'header', 'query'];

const STREAM_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const LOWER_NUM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ALPHA_NUM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const HEX_CHARS = '0123456789abcdef';
const DEFAULT_REALITY_TARGET = { target: 'www.apple.com:443', sni: 'www.apple.com,apple.com' };

function randomString(length, charset) {
    const size = Math.max(0, Number(length) || 0);
    if (size === 0) return '';
    const chars = charset || ALPHA_NUM_CHARS;
    let result = '';
    for (let i = 0; i < size; i += 1) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

function randomUuid() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    const raw = randomString(32, HEX_CHARS).split('');
    raw[12] = '4';
    raw[16] = HEX_CHARS[(parseInt(raw[16], 16) & 0x3) | 0x8];
    return `${raw.slice(0, 8).join('')}-${raw.slice(8, 12).join('')}-${raw.slice(12, 16).join('')}-${raw.slice(16, 20).join('')}-${raw.slice(20, 32).join('')}`;
}

function randomShadowsocksPassword() {
    return randomString(32, `${ALPHA_NUM_CHARS}_-`);
}

function deepClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function parseJsonObject(text, fallbackValue = {}) {
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch { }
    return deepClone(fallbackValue);
}

function normalizeHeadersObject(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return input;
}

function normalizeProtocolName(value, schemas = PROTOCOL_SCHEMA_FALLBACK) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const matched = (Array.isArray(schemas) ? schemas : []).find((item) => {
        const key = String(item?.key || '').trim().toLowerCase();
        if (!key) return false;
        if (key === raw) return true;
        return (Array.isArray(item?.legacyKeys) ? item.legacyKeys : [])
            .map((legacy) => String(legacy || '').trim().toLowerCase())
            .includes(raw);
    });
    return matched?.key || raw;
}

function _convertHeadersObjectToRows(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return [];
    return Object.entries(headers).map(([name, value]) => ({
        name: String(name || ''),
        value: Array.isArray(value) ? String(value[0] || '') : String(value || ''),
    }));
}

function _convertHeaderRowsToObject(rows) {
    const result = {};
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const name = String(row?.name || '').trim();
        if (!name) return;
        result[name] = String(row?.value || '');
    });
    return result;
}

function createBaseClient() {
    return {
        email: randomString(8, LOWER_NUM_CHARS),
        limitIp: 0,
        totalGB: 0,
        expiryTime: 0,
        enable: true,
        tgId: '',
        subId: randomString(16, LOWER_NUM_CHARS),
        comment: '',
        reset: 0,
    };
}

function createDefaultSettings(protocolKey = 'vmess') {
    const protocol = String(protocolKey || '').toLowerCase();
    if (protocol === 'vmess') {
        return {
            clients: [
                {
                    id: randomUuid(),
                    security: 'auto',
                    ...createBaseClient(),
                },
            ],
        };
    }

    if (protocol === 'vless') {
        return {
            clients: [
                {
                    id: randomUuid(),
                    flow: '',
                    ...createBaseClient(),
                },
            ],
            decryption: 'none',
            encryption: 'none',
            selectedAuth: undefined,
            testseed: [900, 500, 900, 256],
            fallbacks: [],
        };
    }

    if (protocol === 'trojan') {
        return {
            clients: [
                {
                    password: randomString(10, ALPHA_NUM_CHARS),
                    ...createBaseClient(),
                },
            ],
            fallbacks: [],
        };
    }

    if (protocol === 'shadowsocks') {
        return {
            method: '2022-blake3-aes-256-gcm',
            password: randomShadowsocksPassword(),
            network: 'tcp,udp',
            clients: [
                {
                    method: '',
                    password: randomShadowsocksPassword(),
                    ...createBaseClient(),
                },
            ],
            ivCheck: false,
        };
    }

    if (protocol === 'dokodemo-door') {
        return { network: 'tcp,udp', address: '', port: '' };
    }

    if (protocol === 'socks') {
        return {
            auth: 'password',
            accounts: [{ user: randomString(10, ALPHA_NUM_CHARS), pass: randomString(10, ALPHA_NUM_CHARS) }],
            udp: false,
        };
    }

    if (protocol === 'http') {
        return {
            accounts: [{ user: randomString(10, ALPHA_NUM_CHARS), pass: randomString(10, ALPHA_NUM_CHARS) }],
            allowTransparent: false,
        };
    }

    if (protocol === 'tunnel') {
        return { address: '', port: '', portMap: [], network: 'tcp,udp', followRedirect: false };
    }

    if (protocol === 'mixed') {
        return {
            auth: 'password',
            accounts: [{ user: randomString(10, ALPHA_NUM_CHARS), pass: randomString(10, ALPHA_NUM_CHARS) }],
            udp: false,
            ip: '127.0.0.1',
        };
    }

    if (protocol === 'wireguard') {
        return {
            mtu: 1420,
            secretKey: '',
            peers: [{
                privateKey: '',
                publicKey: '',
                allowedIPs: ['10.0.0.2/32'],
                keepAlive: 0,
            }],
            noKernelTun: false,
        };
    }

    if (protocol === 'tun') {
        return { name: 'xray0', mtu: 1500, userLevel: 0 };
    }

    return {};
}

function createDefaultTlsSettings() {
    return {
        serverName: '',
        minVersion: '1.2',
        maxVersion: '1.3',
        cipherSuites: '',
        rejectUnknownSni: false,
        disableSystemRoot: false,
        enableSessionResumption: false,
        certificates: [{ certificateFile: '', keyFile: '', oneTimeLoading: false, usage: 'encipherment', buildChain: false }],
        alpn: ['h2', 'http/1.1'],
        echServerKeys: '',
        echForceQuery: 'none',
        settings: { fingerprint: 'chrome', echConfigList: '' },
    };
}

function createDefaultRealitySettings() {
    return {
        show: false,
        xver: 0,
        target: DEFAULT_REALITY_TARGET.target,
        serverNames: DEFAULT_REALITY_TARGET.sni.split(',').map((item) => item.trim()).filter(Boolean),
        privateKey: '',
        minClientVer: '',
        maxClientVer: '',
        maxTimediff: 0,
        shortIds: [randomString(8, HEX_CHARS)],
        mldsa65Seed: '',
        settings: { publicKey: '', fingerprint: 'chrome', serverName: '', spiderX: '/', mldsa65Verify: '' },
    };
}

function createDefaultTransportSettings(network = 'tcp') {
    if (network === 'kcp') {
        return { kcpSettings: { mtu: 1350, tti: 20, uplinkCapacity: 5, downlinkCapacity: 20, congestion: false, readBufferSize: 1, writeBufferSize: 1 } };
    }
    if (network === 'ws') {
        return { wsSettings: { acceptProxyProtocol: false, path: '/', host: '', headers: {}, heartbeatPeriod: 0 } };
    }
    if (network === 'grpc') {
        return { grpcSettings: { serviceName: '', authority: '', multiMode: false } };
    }
    if (network === 'httpupgrade') {
        return { httpupgradeSettings: { acceptProxyProtocol: false, path: '/', host: '', headers: {} } };
    }
    if (network === 'xhttp') {
        return {
            xhttpSettings: {
                path: '/',
                host: '',
                headers: {},
                scMaxBufferedPosts: 30,
                scMaxEachPostBytes: '1000000',
                scStreamUpServerSecs: '20-80',
                noSSEHeader: false,
                xPaddingBytes: '100-1000',
                mode: 'auto',
                xPaddingObfsMode: false,
                xPaddingKey: '',
                xPaddingHeader: '',
                xPaddingPlacement: '',
                xPaddingMethod: '',
                uplinkHTTPMethod: '',
                sessionPlacement: '',
                sessionKey: '',
                seqPlacement: '',
                seqKey: '',
                uplinkDataPlacement: '',
                uplinkDataKey: '',
                uplinkChunkSize: 0,
            },
        };
    }
    return { tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } } };
}

function createDefaultStream(network = 'tcp', security = 'none') {
    const normalizedNetwork = String(network || 'tcp').toLowerCase();
    const normalizedSecurity = String(security || 'none').toLowerCase();
    const stream = {
        network: normalizedNetwork,
        security: normalizedSecurity,
        externalProxy: [],
        ...createDefaultTransportSettings(normalizedNetwork),
    };

    if (normalizedSecurity === 'tls') {
        stream.tlsSettings = createDefaultTlsSettings();
    }
    if (normalizedSecurity === 'reality') {
        stream.realitySettings = createDefaultRealitySettings();
    }
    return stream;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value) {
    return isObject(value) && Object.keys(value).length > 0;
}

function normalizeStreamForSubmission(rawStream, protocolKey) {
    const protocol = String(protocolKey || '').toLowerCase();
    const source = isObject(rawStream) ? rawStream : {};
    if (!STREAM_PROTOCOLS.has(protocol)) {
        if (hasKeys(source.sockopt)) {
            return { sockopt: source.sockopt };
        }
        return null;
    }

    const network = String(source.network || 'tcp').toLowerCase();
    const security = String(source.security || 'none').toLowerCase();
    const normalized = {
        network,
        security,
        externalProxy: Array.isArray(source.externalProxy) ? source.externalProxy : [],
    };

    Object.assign(normalized, createDefaultTransportSettings(network));
    if (network === 'tcp' && hasKeys(source.tcpSettings)) normalized.tcpSettings = source.tcpSettings;
    if (network === 'kcp' && hasKeys(source.kcpSettings)) normalized.kcpSettings = source.kcpSettings;
    if (network === 'ws' && hasKeys(source.wsSettings)) normalized.wsSettings = source.wsSettings;
    if (network === 'grpc' && hasKeys(source.grpcSettings)) normalized.grpcSettings = source.grpcSettings;
    if (network === 'httpupgrade' && hasKeys(source.httpupgradeSettings)) normalized.httpupgradeSettings = source.httpupgradeSettings;
    if (network === 'xhttp' && hasKeys(source.xhttpSettings)) normalized.xhttpSettings = source.xhttpSettings;

    if (security === 'tls') {
        normalized.tlsSettings = hasKeys(source.tlsSettings)
            ? source.tlsSettings
            : createDefaultTlsSettings();
    }
    if (security === 'reality') {
        normalized.realitySettings = hasKeys(source.realitySettings)
            ? source.realitySettings
            : createDefaultRealitySettings();
    }
    if (hasKeys(source.finalmask) && Array.isArray(source.finalmask.udp) && source.finalmask.udp.length > 0) {
        normalized.finalmask = source.finalmask;
    }
    if (hasKeys(source.sockopt)) {
        normalized.sockopt = source.sockopt;
    }
    return normalized;
}

function validateInboundPayload(protocol, port, stream, protocolSchema = null) {
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
        return { ok: false, msg: '端口必须在 1-65535 之间' };
    }

    const network = String(stream?.network || 'tcp').toLowerCase();
    const allowedNetworks = Array.isArray(protocolSchema?.supports?.transports)
        ? protocolSchema.supports.transports.map((item) => String(item).toLowerCase())
        : [];
    if (allowedNetworks.length > 0 && !allowedNetworks.includes(network)) {
        return { ok: false, msg: `${String(protocol || '').toUpperCase()} 不支持传输协议 ${network}` };
    }

    if (network === 'ws' && !String(stream?.wsSettings?.path || '').trim()) {
        return { ok: false, msg: 'WS 传输必须填写 Path' };
    }
    if (network === 'grpc' && !String(stream?.grpcSettings?.serviceName || '').trim()) {
        return { ok: false, msg: 'gRPC 传输必须填写 serviceName' };
    }

    const security = String(stream?.security || 'none').toLowerCase();
    const allowedSecurities = Array.isArray(protocolSchema?.supports?.securities)
        ? protocolSchema.supports.securities.map((item) => String(item).toLowerCase())
        : [];
    if (allowedSecurities.length > 0 && !allowedSecurities.includes(security)) {
        return { ok: false, msg: `${String(protocol || '').toUpperCase()} 不支持安全类型 ${security}` };
    }

    if (security === 'tls') {
        const serverName = String(stream?.tlsSettings?.serverName || '').trim();
        if (!serverName) {
            return { ok: false, msg: 'TLS 模式必须填写 SNI (tlsSettings.serverName)' };
        }
    }

    if (security === 'reality') {
        const rs = stream?.realitySettings || {};
        const rsSettings = rs.settings || {};
        const dest = String(rs.target || rs.dest || '').trim();
        const serverNames = typeof rs.serverNames === 'string' ? rs.serverNames : (rs.serverNames?.[0] || '');
        const sni = String(rsSettings.serverName || serverNames || '').trim();
        if (!dest || !sni) {
            return { ok: false, msg: 'REALITY 必须填写 dest 与 SNI(serverNames[0])' };
        }
    }

    const normalizedProtocol = String(protocol || '').toLowerCase();
    if (security === 'reality' && (normalizedProtocol === 'vless' || normalizedProtocol === 'trojan')) {
        const rs = stream?.realitySettings || {};
        const rsSettings = rs.settings || {};
        const fp = String(rsSettings.fingerprint || '').trim();
        const spx = String(rsSettings.spiderX || '').trim();
        if (!fp || !spx) {
            return { ok: false, msg: 'REALITY 链接关键参数缺失: fingerprint / spiderX' };
        }
    }

    return { ok: true };
}

function toLocalDateTimeInput(timestampMs) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(input) {
    const text = String(input || '').trim();
    if (!text) return 0;
    const parsed = new Date(text);
    const ts = parsed.getTime();
    return Number.isFinite(ts) ? ts : 0;
}

export default function InboundModal({ isOpen, onClose, editingInbound = null, onSuccess, servers = [], onBatchResult }) {
    const { panelApi } = useServer();
    const defaultProtocol = 'vless';
    const [loading, setLoading] = useState(false);
    const [isAdvanced, setIsAdvanced] = useState(false);
    const [schemaProtocols, setSchemaProtocols] = useState(PROTOCOL_SCHEMA_FALLBACK);

    // Form State
    const [remark, setRemark] = useState('');
    const [protocol, setProtocol] = useState(defaultProtocol);
    const [port, setPort] = useState('');
    const [listen, setListen] = useState('');
    const [inboundEnabled, setInboundEnabled] = useState(true);
    const [trafficReset, setTrafficReset] = useState('never');
    const [totalGB, setTotalGB] = useState(0);
    const [_expiryTime, setExpiryTime] = useState(0);
    const [expiryMode, setExpiryMode] = useState('never');
    const [expiryDateTime, setExpiryDateTime] = useState('');
    const [expiryAfterDays, setExpiryAfterDays] = useState('');
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const [syncExistingSubscriptions, setSyncExistingSubscriptions] = useState(false);

    // Raw JSON State (always the source of truth for submission)
    const [settings, setSettings] = useState(JSON.stringify(createDefaultSettings(defaultProtocol), null, 2));
    const [streamSettings, setStreamSettings] = useState(JSON.stringify(createDefaultStream('tcp', 'none'), null, 2));
    const [sniffing, setSniffing] = useState(JSON.stringify({ enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'], metadataOnly: false, routeOnly: false }, null, 2));

    // Simple Mode State
    const [simpleStream, setSimpleStream] = useState({
        network: 'tcp',
        security: 'none',
        tcpHeaderType: 'none',
        tcpAcceptProxyProtocol: false,
        kcpMtu: 1350,
        kcpTti: 20,
        kcpUplinkCapacity: 5,
        kcpDownlinkCapacity: 20,
        kcpCongestion: false,
        kcpReadBufferSize: 1,
        kcpWriteBufferSize: 1,
        wsPath: '/',
        wsHost: '',
        wsAcceptProxyProtocol: false,
        grpcServiceName: '',
        grpcAuthority: '',
        httpupgradePath: '/',
        httpupgradeHost: '',
        httpupgradeAcceptProxyProtocol: false,
        xhttpPath: '/',
        xhttpHost: '',
        xhttpMode: 'auto',
        tlsSni: '',
        tlsFingerprint: 'chrome',
        tlsAlpn: 'h2,http/1.1',
        realityShow: true,
        realityXver: 0,
        realityDest: DEFAULT_REALITY_TARGET.target,
        realitySNI: DEFAULT_REALITY_TARGET.sni.split(',')[0] || 'www.apple.com',
        realityShortId: '',
        realityPrivateKey: '',
        realityMinClientVer: '',
        realityMaxClientVer: '',
        realityMaxTimediff: 0,
        realityPublicKey: '',
        realityFingerprint: 'chrome',
        realitySpiderX: '/',
        realityMldsa65Seed: '',
        realityMldsa65Verify: '',
    });

    const protocolDefaultSettings = useMemo(
        () => createDefaultSettings(protocol),
        [protocol]
    );

    const settingsObj = useMemo(
        () => parseJsonObject(settings, protocolDefaultSettings),
        [settings, protocolDefaultSettings]
    );

    const streamObj = useMemo(
        () => parseJsonObject(streamSettings, createDefaultStream(simpleStream.network, simpleStream.security)),
        [streamSettings, simpleStream.network, simpleStream.security]
    );

    const updateSettingsJson = (updater) => {
        setSettings((prev) => {
            const draft = parseJsonObject(prev, protocolDefaultSettings);
            updater(draft);
            return JSON.stringify(draft, null, 2);
        });
    };

    const updateStreamJson = (updater) => {
        setStreamSettings((prev) => {
            const draft = parseJsonObject(prev, createDefaultStream(simpleStream.network, simpleStream.security));
            updater(draft);
            return JSON.stringify(draft, null, 2);
        });
    };

    const ensurePrimaryClient = (draft) => {
        if (!Array.isArray(draft.clients) || draft.clients.length === 0) {
            const seeded = protocolDefaultSettings?.clients?.[0] || createBaseClient();
            draft.clients = [deepClone(seeded)];
        }
        return draft.clients[0];
    };

    const protocolSchemas = useMemo(() => {
        if (!Array.isArray(schemaProtocols) || schemaProtocols.length === 0) return PROTOCOL_SCHEMA_FALLBACK;
        return schemaProtocols;
    }, [schemaProtocols]);

    const protocolOptions = useMemo(
        () => protocolSchemas.map((item) => ({
            key: String(item?.key || '').toLowerCase(),
            label: String(item?.label || item?.key || '').trim() || String(item?.key || '').toUpperCase(),
            legacyKeys: Array.isArray(item?.legacyKeys) ? item.legacyKeys : [],
        })).filter((item) => item.key),
        [protocolSchemas]
    );

    const protocolSchemaMap = useMemo(() => {
        const map = new Map();
        protocolSchemas.forEach((item) => {
            const key = String(item?.key || '').toLowerCase();
            if (!key) return;
            map.set(key, item);
        });
        return map;
    }, [protocolSchemas]);

    const currentProtocolSchema = useMemo(
        () => protocolSchemaMap.get(String(protocol || '').toLowerCase()) || PROTOCOL_SCHEMA_FALLBACK[0],
        [protocol, protocolSchemaMap]
    );

    const networkOptions = useMemo(() => {
        const supports = currentProtocolSchema?.supports?.transports;
        if (Array.isArray(supports) && supports.length > 0) {
            return supports.map((item) => String(item).toLowerCase());
        }
        return ['tcp'];
    }, [currentProtocolSchema]);

    const securityOptions = useMemo(() => {
        const supports = currentProtocolSchema?.supports?.securities;
        if (!Array.isArray(supports) || supports.length === 0) return ['none'];
        const network = simpleStream.network || 'tcp';
        const tlsTransports = currentProtocolSchema?.supports?.tlsTransports;
        const realityTransports = currentProtocolSchema?.supports?.realityTransports;
        return supports
            .map((item) => String(item).toLowerCase())
            .filter((sec) => {
                if (sec === 'tls' && Array.isArray(tlsTransports) && !tlsTransports.includes(network)) return false;
                if (sec === 'reality' && Array.isArray(realityTransports) && !realityTransports.includes(network)) return false;
                return true;
            });
    }, [currentProtocolSchema, simpleStream.network]);

    const normalizedProtocol = useMemo(
        () => String(protocol || '').toLowerCase(),
        [protocol]
    );

    const primaryClient = useMemo(() => {
        if (Array.isArray(settingsObj?.clients) && settingsObj.clients.length > 0) {
            return settingsObj.clients[0];
        }
        return null;
    }, [settingsObj]);

    const vlessFallbacks = useMemo(
        () => (Array.isArray(settingsObj?.fallbacks) ? settingsObj.fallbacks : []),
        [settingsObj]
    );

    const vlessTestseed = useMemo(() => {
        if (Array.isArray(settingsObj?.testseed) && settingsObj.testseed.length >= 4) {
            return settingsObj.testseed.slice(0, 4).map((item) => Number(item || 0));
        }
        return [900, 500, 900, 256];
    }, [settingsObj]);

    // Initialize form
    useEffect(() => {
        if (editingInbound) {
            setRemark(editingInbound.remark);
                setProtocol(normalizeProtocolName(editingInbound.protocol, protocolSchemas));
            setPort(editingInbound.port);
            setListen(editingInbound.listen);
            setInboundEnabled(editingInbound.enable !== false);
            setTrafficReset(String(editingInbound.trafficReset || 'never'));
            setTotalGB(editingInbound.total ? editingInbound.total / (1024 * 1024 * 1024) : 0);
            {
                const rawExpiry = Number(editingInbound.expiryTime || 0);
                setExpiryTime(rawExpiry);
                if (rawExpiry > 0) {
                    setExpiryMode('datetime');
                    setExpiryDateTime(toLocalDateTimeInput(rawExpiry));
                } else {
                    setExpiryMode('never');
                    setExpiryDateTime('');
                }
                setExpiryAfterDays('');
            }
            setSettings(editingInbound.settings);
            setStreamSettings(editingInbound.streamSettings || JSON.stringify(createDefaultStream('tcp', 'none'), null, 2));
            setSniffing(editingInbound.sniffing || JSON.stringify({ enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'], metadataOnly: false, routeOnly: false }, null, 2));
            setSyncExistingSubscriptions(false);

            // Try to parse simplified state
            try {
                const stream = JSON.parse(editingInbound.streamSettings);
                const realityServerNames = stream.realitySettings?.serverNames;
                const realitySNI = typeof realityServerNames === 'string'
                    ? realityServerNames.split(',')[0]
                    : (realityServerNames?.[0] || '');
                const realityShortIds = stream.realitySettings?.shortIds;
                const realityShortId = typeof realityShortIds === 'string'
                    ? realityShortIds.split(',')[0]
                    : (realityShortIds?.[0] || '');
                setSimpleStream({
                    network: stream.network || 'tcp',
                    security: stream.security || 'none',
                    tcpHeaderType: stream.tcpSettings?.header?.type || 'none',
                    tcpAcceptProxyProtocol: !!stream.tcpSettings?.acceptProxyProtocol,
                    kcpMtu: Number(stream.kcpSettings?.mtu || 1350),
                    kcpTti: Number(stream.kcpSettings?.tti || 20),
                    kcpUplinkCapacity: Number(stream.kcpSettings?.uplinkCapacity || 5),
                    kcpDownlinkCapacity: Number(stream.kcpSettings?.downlinkCapacity || 20),
                    kcpCongestion: !!stream.kcpSettings?.congestion,
                    kcpReadBufferSize: Number(stream.kcpSettings?.readBufferSize || 1),
                    kcpWriteBufferSize: Number(stream.kcpSettings?.writeBufferSize || 1),
                    wsPath: stream.wsSettings?.path || '/',
                    wsHost: stream.wsSettings?.host || stream.wsSettings?.headers?.Host || '',
                    wsAcceptProxyProtocol: !!stream.wsSettings?.acceptProxyProtocol,
                    grpcServiceName: stream.grpcSettings?.serviceName || '',
                    grpcAuthority: stream.grpcSettings?.authority || '',
                    httpupgradePath: stream.httpupgradeSettings?.path || '/',
                    httpupgradeHost: stream.httpupgradeSettings?.host || '',
                    httpupgradeAcceptProxyProtocol: !!stream.httpupgradeSettings?.acceptProxyProtocol,
                    xhttpPath: stream.xhttpSettings?.path || '/',
                    xhttpHost: stream.xhttpSettings?.host || '',
                    xhttpMode: stream.xhttpSettings?.mode || 'auto',
                    tlsSni: stream.tlsSettings?.serverName || '',
                    tlsFingerprint: stream.tlsSettings?.settings?.fingerprint || 'chrome',
                    tlsAlpn: Array.isArray(stream.tlsSettings?.alpn) ? stream.tlsSettings.alpn.join(',') : (stream.tlsSettings?.alpn || 'h2,http/1.1'),
                    realityShow: stream.realitySettings?.show !== false,
                    realityXver: Number(stream.realitySettings?.xver || 0),
                    realityDest: stream.realitySettings?.target || stream.realitySettings?.dest || '',
                    realitySNI: realitySNI,
                    realityShortId: realityShortId,
                    realityPrivateKey: stream.realitySettings?.privateKey || '',
                    realityMinClientVer: stream.realitySettings?.minClientVer || '',
                    realityMaxClientVer: stream.realitySettings?.maxClientVer || '',
                    realityMaxTimediff: Number(stream.realitySettings?.maxTimediff || 0),
                    realityPublicKey: stream.realitySettings?.settings?.publicKey || '',
                    realityFingerprint: stream.realitySettings?.settings?.fingerprint || 'chrome',
                    realitySpiderX: stream.realitySettings?.settings?.spiderX || '/',
                    realityMldsa65Seed: stream.realitySettings?.mldsa65Seed || '',
                    realityMldsa65Verify: stream.realitySettings?.settings?.mldsa65Verify || '',
                });
            } catch { }
        } else {
            // Reset
            setRemark('');
            setProtocol(defaultProtocol);
            setPort(Math.floor(Math.random() * 20000) + 10000);
            setListen('');
            setInboundEnabled(true);
            setTrafficReset('never');
            setTotalGB(0);
            setExpiryTime(0);
            setExpiryMode('never');
            setExpiryDateTime('');
            setExpiryAfterDays('');
            setSettings(JSON.stringify(createDefaultSettings(defaultProtocol), null, 2));
            setStreamSettings(JSON.stringify(createDefaultStream('tcp', 'none'), null, 2));
            setSniffing(JSON.stringify({ enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'], metadataOnly: false, routeOnly: false }, null, 2));
            setSyncExistingSubscriptions(false);
            setSimpleStream({
                network: 'tcp',
                security: 'none',
                tcpHeaderType: 'none',
                tcpAcceptProxyProtocol: false,
                kcpMtu: 1350,
                kcpTti: 20,
                kcpUplinkCapacity: 5,
                kcpDownlinkCapacity: 20,
                kcpCongestion: false,
                kcpReadBufferSize: 1,
                kcpWriteBufferSize: 1,
                wsPath: '/',
                wsHost: '',
                wsAcceptProxyProtocol: false,
                grpcServiceName: '',
                grpcAuthority: '',
                httpupgradePath: '/',
                httpupgradeHost: '',
                httpupgradeAcceptProxyProtocol: false,
                xhttpPath: '/',
                xhttpHost: '',
                xhttpMode: 'auto',
                tlsSni: '',
                tlsFingerprint: 'chrome',
                tlsAlpn: 'h2,http/1.1',
                realityShow: true,
                realityXver: 0,
                realityDest: DEFAULT_REALITY_TARGET.target,
                realitySNI: DEFAULT_REALITY_TARGET.sni.split(',')[0] || 'www.apple.com',
                realityShortId: '',
                realityPrivateKey: '',
                realityMinClientVer: '',
                realityMaxClientVer: '',
                realityMaxTimediff: 0,
                realityPublicKey: '',
                realityFingerprint: 'chrome',
                realitySpiderX: '/',
                realityMldsa65Seed: '',
                realityMldsa65Verify: '',
            });
            if (servers.length > 0) setSelectedServerIds(servers.map(s => s.id));
        }
    }, [defaultProtocol, editingInbound, isOpen, servers]);

    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        const loadProtocolSchemas = async () => {
            try {
                const res = await api.get('/protocol-schemas');
                const list = Array.isArray(res.data?.obj?.protocols) ? res.data.obj.protocols : [];
                const normalized = list
                    .map((item) => ({
                        key: String(item?.key || '').toLowerCase(),
                        label: String(item?.label || item?.key || '').trim() || String(item?.key || '').toUpperCase(),
                        legacyKeys: Array.isArray(item?.legacyKeys) ? item.legacyKeys : [],
                        supports: {
                            transports: Array.isArray(item?.supports?.transports) && item.supports.transports.length > 0
                                ? item.supports.transports
                                : ['tcp'],
                            securities: Array.isArray(item?.supports?.securities) && item.supports.securities.length > 0
                                ? item.supports.securities
                                : ['none'],
                            tlsTransports: Array.isArray(item?.supports?.tlsTransports) ? item.supports.tlsTransports : undefined,
                            realityTransports: Array.isArray(item?.supports?.realityTransports) ? item.supports.realityTransports : undefined,
                        },
                    }))
                    .filter((item) => item.key);
                if (!cancelled && normalized.length > 0) {
                    setSchemaProtocols(normalized);
                }
            } catch {
                if (!cancelled) {
                    setSchemaProtocols(PROTOCOL_SCHEMA_FALLBACK);
                }
            }
        };
        loadProtocolSchemas();
        return () => { cancelled = true; };
    }, [isOpen]);

    // Protocol Change -> Reset Settings
    useEffect(() => {
        if (!editingInbound && isOpen) {
            setSettings(JSON.stringify(createDefaultSettings(protocol), null, 2));
        }
    }, [protocol, editingInbound, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setSimpleStream((prev) => {
            const nextNetwork = networkOptions.includes(prev.network)
                ? prev.network
                : (networkOptions[0] || 'tcp');
            const nextSecurity = securityOptions.includes(prev.security)
                ? prev.security
                : (securityOptions[0] || 'none');

            if (nextNetwork === prev.network && nextSecurity === prev.security) {
                return prev;
            }
            return {
                ...prev,
                network: nextNetwork,
                security: nextSecurity,
            };
        });
    }, [isOpen, networkOptions, securityOptions]);

    // Simple Mode -> Update JSON
    useEffect(() => {
        if (!isAdvanced && isOpen) {
            let stream;
            try {
                stream = JSON.parse(streamSettings);
            } catch {
                stream = createDefaultStream(simpleStream.network, simpleStream.security);
            }

            stream.network = simpleStream.network;
            stream.security = simpleStream.security;

            if (simpleStream.network === 'tcp') {
                stream.tcpSettings = stream.tcpSettings || {};
                stream.tcpSettings.header = stream.tcpSettings.header || {};
                stream.tcpSettings.header.type = simpleStream.tcpHeaderType || 'none';
                stream.tcpSettings.acceptProxyProtocol = !!simpleStream.tcpAcceptProxyProtocol;
            } else if (simpleStream.network === 'kcp') {
                stream.kcpSettings = stream.kcpSettings || {};
                stream.kcpSettings.mtu = Number(simpleStream.kcpMtu || 1350);
                stream.kcpSettings.tti = Number(simpleStream.kcpTti || 20);
                stream.kcpSettings.uplinkCapacity = Number(simpleStream.kcpUplinkCapacity || 5);
                stream.kcpSettings.downlinkCapacity = Number(simpleStream.kcpDownlinkCapacity || 20);
                stream.kcpSettings.congestion = !!simpleStream.kcpCongestion;
                stream.kcpSettings.readBufferSize = Number(simpleStream.kcpReadBufferSize || 1);
                stream.kcpSettings.writeBufferSize = Number(simpleStream.kcpWriteBufferSize || 1);
            } else if (simpleStream.network === 'ws') {
                stream.wsSettings = stream.wsSettings || {};
                stream.wsSettings.path = simpleStream.wsPath;
                stream.wsSettings.host = simpleStream.wsHost || '';
                stream.wsSettings.acceptProxyProtocol = !!simpleStream.wsAcceptProxyProtocol;
                if (simpleStream.wsHost) {
                    stream.wsSettings.headers = { Host: simpleStream.wsHost };
                }
            } else if (simpleStream.network === 'grpc') {
                stream.grpcSettings = stream.grpcSettings || {};
                stream.grpcSettings.serviceName = simpleStream.grpcServiceName || '';
                stream.grpcSettings.authority = simpleStream.grpcAuthority || '';
            } else if (simpleStream.network === 'httpupgrade') {
                stream.httpupgradeSettings = stream.httpupgradeSettings || {};
                stream.httpupgradeSettings.path = simpleStream.httpupgradePath || '/';
                stream.httpupgradeSettings.host = simpleStream.httpupgradeHost || '';
                stream.httpupgradeSettings.acceptProxyProtocol = !!simpleStream.httpupgradeAcceptProxyProtocol;
            } else if (simpleStream.network === 'xhttp') {
                stream.xhttpSettings = stream.xhttpSettings || {};
                stream.xhttpSettings.path = simpleStream.xhttpPath || '/';
                stream.xhttpSettings.host = simpleStream.xhttpHost || '';
                stream.xhttpSettings.mode = simpleStream.xhttpMode || 'auto';
            }

            if (simpleStream.security === 'tls') {
                stream.tlsSettings = stream.tlsSettings || {};
                stream.tlsSettings.serverName = simpleStream.tlsSni || '';
                stream.tlsSettings.settings = stream.tlsSettings.settings || {};
                stream.tlsSettings.settings.fingerprint = simpleStream.tlsFingerprint || 'chrome';
                const alpnArr = (simpleStream.tlsAlpn || '').split(',').map(s => s.trim()).filter(Boolean);
                stream.tlsSettings.alpn = alpnArr.length > 0 ? alpnArr : ['h2', 'http/1.1'];
            }

            // Reality
            if (simpleStream.security === 'reality') {
                stream.realitySettings = stream.realitySettings || createDefaultRealitySettings();
                stream.realitySettings.settings = stream.realitySettings.settings || {};
                stream.realitySettings.show = !!simpleStream.realityShow;
                stream.realitySettings.xver = Number(simpleStream.realityXver || 0);
                stream.realitySettings.target = simpleStream.realityDest;
                delete stream.realitySettings.dest; // remove legacy field
                stream.realitySettings.serverNames = simpleStream.realitySNI
                    ? simpleStream.realitySNI.split(',').map(s => s.trim()).filter(Boolean)
                    : DEFAULT_REALITY_TARGET.sni.split(',').map(s => s.trim()).filter(Boolean);
                stream.realitySettings.shortIds = simpleStream.realityShortId
                    ? simpleStream.realityShortId.split(',').map(s => s.trim())
                    : [randomString(8, HEX_CHARS)];
                stream.realitySettings.privateKey = simpleStream.realityPrivateKey;
                stream.realitySettings.minClientVer = simpleStream.realityMinClientVer || '';
                stream.realitySettings.maxClientVer = simpleStream.realityMaxClientVer || '';
                stream.realitySettings.maxTimediff = Number(simpleStream.realityMaxTimediff || 0);
                stream.realitySettings.mldsa65Seed = simpleStream.realityMldsa65Seed || '';
                stream.realitySettings.settings.publicKey = simpleStream.realityPublicKey;
                stream.realitySettings.settings.fingerprint = simpleStream.realityFingerprint || 'chrome';
                stream.realitySettings.settings.spiderX = simpleStream.realitySpiderX || '/';
                stream.realitySettings.settings.mldsa65Verify = simpleStream.realityMldsa65Verify || '';
            }

            setStreamSettings(JSON.stringify(stream, null, 2));
        }
    }, [simpleStream, isAdvanced]);

    const resolveToolServerId = () => {
        if (editingInbound?.serverId) return editingInbound.serverId;
        if (Array.isArray(selectedServerIds) && selectedServerIds.length > 0) {
            return selectedServerIds[0];
        }
        if (servers.length > 0) {
            return servers[0].id;
        }
        return '';
    };

    const callPanelTool = async (serverId, method, path, payload = undefined) => {
        const lowerMethod = String(method || 'get').toLowerCase();
        if (serverId) {
            const base = `/panel/${serverId}${path}`;
            if (lowerMethod === 'post') return api.post(base, payload || {});
            return api.get(base);
        }
        if (lowerMethod === 'post') return panelApi('post', path, payload || {});
        return panelApi('get', path);
    };

    const generateRealityKeys = async () => {
        try {
            const preferredServerId = resolveToolServerId();
            if (!preferredServerId) {
                toast.error('请先选择目标服务器后再生成密钥');
                return;
            }
            const keys = await fetchRealityKeyPair(preferredServerId);
            if (!keys?.privateKey || !keys?.publicKey) return;

            setSimpleStream(prev => ({
                ...prev,
                realityPrivateKey: keys.privateKey,
                realityPublicKey: keys.publicKey
            }));

            let stream;
            try {
                stream = JSON.parse(streamSettings);
            } catch {
                stream = createDefaultStream('tcp', 'none');
            }

            stream.realitySettings = stream.realitySettings || {};
            stream.realitySettings.settings = stream.realitySettings.settings || {};
            stream.realitySettings.privateKey = keys.privateKey;
            stream.realitySettings.settings.publicKey = keys.publicKey;
            setStreamSettings(JSON.stringify(stream, null, 2));
        } catch (error) {
            toast.error(error?.response?.data?.msg || error?.message || '生成 Reality 密钥失败');
        }
    };

    const generateShortId = async () => {
        const sid = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        setSimpleStream(prev => ({ ...prev, realityShortId: sid }));
    };

    const createShortId = () =>
        Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    const fetchRealityKeyPair = async (serverId) => {
        const res = await callPanelTool(serverId, 'get', '/panel/api/server/getNewX25519Cert');
        if (res.data?.obj?.privateKey && res.data?.obj?.publicKey) {
            return res.data.obj;
        }
        throw new Error('Reality key pair generation failed');
    };

    const fetchVlessEncOptions = async (serverId) => {
        const res = await callPanelTool(serverId, 'get', '/panel/api/server/getNewVlessEnc');
        return Array.isArray(res.data?.obj?.auths) ? res.data.obj.auths : [];
    };

    const generateVlessEncKeys = async () => {
        try {
            const selectedAuth = String(settingsObj?.selectedAuth || '').trim();
            if (!selectedAuth) {
                toast.error('请先选择 Authentication');
                return;
            }
            const preferredServerId = resolveToolServerId();
            if (!preferredServerId) {
                toast.error('请先选择目标服务器后再生成密钥');
                return;
            }
            const auths = await fetchVlessEncOptions(preferredServerId);
            const block = auths.find((item) => item?.label === selectedAuth);
            if (!block) {
                toast.error('当前节点暂不支持所选 Authentication 生成');
                return;
            }
            updateSettingsJson((draft) => {
                draft.selectedAuth = selectedAuth;
                draft.decryption = String(block.decryption || 'none');
                draft.encryption = String(block.encryption || 'none');
            });
            toast.success('VLESS 密钥已更新');
        } catch (error) {
            toast.error(error?.response?.data?.msg || error?.message || '生成 VLESS 密钥失败');
        }
    };

    const clearVlessEncKeys = () => {
        updateSettingsJson((draft) => {
            draft.decryption = 'none';
            draft.encryption = 'none';
            draft.selectedAuth = undefined;
        });
    };

    const fetchMldsa65Seed = async (serverId) => {
        const res = await callPanelTool(serverId, 'get', '/panel/api/server/getNewmldsa65');
        if (res.data?.obj?.seed && res.data?.obj?.verify) {
            return { seed: String(res.data.obj.seed), verify: String(res.data.obj.verify) };
        }
        throw new Error('MLDSA65 generation failed');
    };

    const generateMldsa65Seed = async () => {
        try {
            const preferredServerId = resolveToolServerId();
            if (!preferredServerId) {
                toast.error('请先选择目标服务器后再生成 mldsa65');
                return;
            }
            const mldsa = await fetchMldsa65Seed(preferredServerId);
            setSimpleStream((prev) => ({
                ...prev,
                realityMldsa65Seed: mldsa.seed,
                realityMldsa65Verify: mldsa.verify,
            }));
            updateStreamJson((draft) => {
                draft.realitySettings = draft.realitySettings || {};
                draft.realitySettings.settings = draft.realitySettings.settings || {};
                draft.realitySettings.mldsa65Seed = mldsa.seed;
                draft.realitySettings.settings.mldsa65Verify = mldsa.verify;
            });
            toast.success('mldsa65 已生成');
        } catch (error) {
            toast.error(error?.response?.data?.msg || error?.message || '生成 mldsa65 失败');
        }
    };

    const clearMldsa65Seed = () => {
        setSimpleStream((prev) => ({
            ...prev,
            realityMldsa65Seed: '',
            realityMldsa65Verify: '',
        }));
        updateStreamJson((draft) => {
            draft.realitySettings = draft.realitySettings || {};
            draft.realitySettings.settings = draft.realitySettings.settings || {};
            draft.realitySettings.mldsa65Seed = '';
            draft.realitySettings.settings.mldsa65Verify = '';
        });
    };

    const fetchEchCert = async (serverId, sni) => {
        const res = await callPanelTool(serverId, 'post', '/panel/api/server/getNewEchCert', { sni: sni || '' });
        if (res.data?.obj?.echServerKeys !== undefined && res.data?.obj?.echConfigList !== undefined) {
            return {
                echServerKeys: String(res.data.obj.echServerKeys || ''),
                echConfigList: String(res.data.obj.echConfigList || ''),
            };
        }
        throw new Error('ECH certificate generation failed');
    };

    const generateEchCert = async () => {
        try {
            const preferredServerId = resolveToolServerId();
            if (!preferredServerId) {
                toast.error('请先选择目标服务器后再生成 ECH');
                return;
            }
            const sni = String(simpleStream.tlsSni || streamObj?.tlsSettings?.serverName || '').trim();
            if (!sni) {
                toast.error('请先填写 TLS SNI');
                return;
            }
            const ech = await fetchEchCert(preferredServerId, sni);
            updateStreamJson((draft) => {
                draft.tlsSettings = draft.tlsSettings || {};
                draft.tlsSettings.settings = draft.tlsSettings.settings || {};
                draft.tlsSettings.echServerKeys = ech.echServerKeys;
                draft.tlsSettings.settings.echConfigList = ech.echConfigList;
            });
            toast.success('ECH 证书已生成');
        } catch (error) {
            toast.error(error?.response?.data?.msg || error?.message || '生成 ECH 证书失败');
        }
    };

    const clearEchCert = () => {
        updateStreamJson((draft) => {
            draft.tlsSettings = draft.tlsSettings || {};
            draft.tlsSettings.settings = draft.tlsSettings.settings || {};
            draft.tlsSettings.echServerKeys = '';
            draft.tlsSettings.settings.echConfigList = '';
        });
    };

    const ensureRealityStreamForServer = async (baseStream, serverId) => {
        const stream = JSON.parse(JSON.stringify(baseStream || {}));
        if ((stream.security || 'none') !== 'reality') {
            return stream;
        }

        stream.realitySettings = stream.realitySettings || {};
        stream.realitySettings.settings = stream.realitySettings.settings || {};

        if (!stream.realitySettings.target && !stream.realitySettings.dest) {
            stream.realitySettings.target = simpleStream.realityDest || DEFAULT_REALITY_TARGET.target;
        } else if (stream.realitySettings.dest && !stream.realitySettings.target) {
            // Migrate legacy dest → target
            stream.realitySettings.target = stream.realitySettings.dest;
            delete stream.realitySettings.dest;
        }

        // Handle serverNames — always output as array for Xray-core
        const sn = stream.realitySettings.serverNames;
        if (!sn || (typeof sn === 'string' && !sn.trim()) || (Array.isArray(sn) && sn.length === 0)) {
            stream.realitySettings.serverNames = [simpleStream.realitySNI || (DEFAULT_REALITY_TARGET.sni.split(',')[0] || 'www.apple.com')];
        } else if (typeof sn === 'string') {
            stream.realitySettings.serverNames = sn.split(',').map(s => s.trim()).filter(Boolean);
            if (stream.realitySettings.serverNames.length === 0) {
                stream.realitySettings.serverNames = [simpleStream.realitySNI || (DEFAULT_REALITY_TARGET.sni.split(',')[0] || 'www.apple.com')];
            }
        }

        // Handle shortIds — always output as array for Xray-core
        const si = stream.realitySettings.shortIds;
        if (!si || (typeof si === 'string' && !si.trim()) || (Array.isArray(si) && si.length === 0)) {
            stream.realitySettings.shortIds = [simpleStream.realityShortId || createShortId()];
        } else if (typeof si === 'string') {
            stream.realitySettings.shortIds = si.split(',').map(s => s.trim());
            if (stream.realitySettings.shortIds.length === 0) {
                stream.realitySettings.shortIds = [simpleStream.realityShortId || createShortId()];
            }
        }

        if (!stream.realitySettings.settings.fingerprint) {
            stream.realitySettings.settings.fingerprint = simpleStream.realityFingerprint || 'chrome';
        }
        if (!stream.realitySettings.settings.spiderX) {
            stream.realitySettings.settings.spiderX = simpleStream.realitySpiderX || '/';
        }

        const missingPrivate = !stream.realitySettings.privateKey;
        const missingPublic = !stream.realitySettings.settings.publicKey;

        if (missingPrivate || missingPublic) {
            const keys = await fetchRealityKeyPair(serverId);
            stream.realitySettings.privateKey = keys.privateKey;
            stream.realitySettings.settings.publicKey = keys.publicKey;
        }

        return stream;
    };

    const createInboundParams = ({ settingsValue, streamSettingsValue, sniffingValue, expiryTimeValue }) => {
        const params = new URLSearchParams();
        params.append('remark', remark);
        params.append('protocol', protocol);
        params.append('port', port);
        params.append('listen', listen);
        params.append('total', Number(totalGB) * 1024 * 1024 * 1024);
        params.append('expiryTime', Number(expiryTimeValue || 0));
        params.append('trafficReset', trafficReset);
        params.append('settings', typeof settingsValue === 'string' ? settingsValue : JSON.stringify(settingsValue || {}));
        if (streamSettingsValue !== undefined && streamSettingsValue !== null) {
            params.append(
                'streamSettings',
                typeof streamSettingsValue === 'string'
                    ? streamSettingsValue
                    : JSON.stringify(streamSettingsValue)
            );
        }
        params.append('sniffing', typeof sniffingValue === 'string' ? sniffingValue : JSON.stringify(sniffingValue || {}));
        params.append('enable', String(inboundEnabled));
        return params;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Validate JSON
            let parsedStreamSettings;
            let parsedSettings;
            let parsedSniffing;
            try {
                parsedSettings = JSON.parse(settings);
                parsedStreamSettings = JSON.parse(streamSettings);
                parsedSniffing = JSON.parse(sniffing);
            } catch {
                toast.error('JSON 格式错误，请检查高级设置');
                setLoading(false);
                return;
            }

            const normalizedProtocol = String(protocol || '').toLowerCase();
            const isStreamProtocol = STREAM_PROTOCOLS.has(normalizedProtocol);
            const preStream = isStreamProtocol
                ? normalizeStreamForSubmission(parsedStreamSettings, normalizedProtocol) || {}
                : {};
            const preValidation = validateInboundPayload(protocol, port, preStream, currentProtocolSchema);
            if (!preValidation.ok) {
                toast.error(preValidation.msg);
                setLoading(false);
                return;
            }

            let resolvedExpiryTime = 0;
            if (expiryMode === 'datetime') {
                resolvedExpiryTime = fromLocalDateTimeInput(expiryDateTime);
                if (!resolvedExpiryTime) {
                    toast.error('请选择有效的到期日期时间');
                    setLoading(false);
                    return;
                }
            } else if (expiryMode === 'days') {
                const days = Number(expiryAfterDays || 0);
                if (!Number.isFinite(days) || days <= 0) {
                    toast.error('请填写大于 0 的天数');
                    setLoading(false);
                    return;
                }
                resolvedExpiryTime = Date.now() + (Math.floor(days) * 24 * 60 * 60 * 1000);
            } else {
                resolvedExpiryTime = 0;
            }

            if (editingInbound) {
                const serverId = editingInbound.serverId;
                let streamForTarget = parsedStreamSettings;
                if (isStreamProtocol) {
                    streamForTarget = await ensureRealityStreamForServer(parsedStreamSettings, serverId);
                }
                const streamPayload = normalizeStreamForSubmission(streamForTarget, normalizedProtocol);
                if (isStreamProtocol) {
                    const validation = validateInboundPayload(protocol, port, streamPayload || {}, currentProtocolSchema);
                    if (!validation.ok) {
                        toast.error(validation.msg);
                        setLoading(false);
                        return;
                    }
                }
                const params = createInboundParams({
                    settingsValue: parsedSettings,
                    streamSettingsValue: streamPayload,
                    sniffingValue: parsedSniffing,
                    expiryTimeValue: resolvedExpiryTime,
                });

                if (serverId) {
                    await api.post(`/panel/${serverId}/panel/api/inbounds/update/${editingInbound.id}`, params, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                } else {
                    await panelApi('post', `/panel/api/inbounds/update/${editingInbound.id}`, params, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                }
                toast.success('入站已更新');
            } else {
                if (selectedServerIds.length === 0) {
                    toast.error('请至少选择一个目标服务器');
                    setLoading(false);
                    return;
                }

                const targets = await Promise.all(selectedServerIds.map(async (sid) => {
                    let streamForTarget = parsedStreamSettings;
                    if (isStreamProtocol) {
                        streamForTarget = await ensureRealityStreamForServer(parsedStreamSettings, sid);
                    }
                    const streamPayload = normalizeStreamForSubmission(streamForTarget, normalizedProtocol);
                    if (isStreamProtocol) {
                        const validation = validateInboundPayload(protocol, port, streamPayload || {}, currentProtocolSchema);
                        if (!validation.ok) {
                            throw new Error(`[${sid}] ${validation.msg}`);
                        }
                    }
                    const payload = {
                        remark,
                        protocol,
                        port: Number(port),
                        listen,
                        total: Number(totalGB) * 1024 * 1024 * 1024,
                        expiryTime: Math.max(0, Number(resolvedExpiryTime || 0)),
                        trafficReset,
                        settings: parsedSettings,
                        sniffing: parsedSniffing,
                        enable: inboundEnabled,
                    };
                    if (streamPayload !== null && streamPayload !== undefined) {
                        payload.streamSettings = streamPayload;
                    }
                    return { serverId: sid, payload };
                }));

                const batchPayload = await attachBatchRiskToken({
                    action: 'add',
                    targets,
                    syncExistingSubscriptions,
                }, {
                    type: 'inbounds',
                    action: 'add',
                    targetCount: targets.length,
                });
                const res = await api.post('/batch/inbounds', batchPayload);
                const output = res.data?.obj;
                const summary = output?.summary || {
                    success: 0,
                    total: targets.length,
                    failed: targets.length,
                };
                const syncSummary = output?.subscriptionSync || null;
                onBatchResult?.('批量添加入站结果', output || null);
                if (summary.failed === 0) {
                    if (syncSummary && syncExistingSubscriptions) {
                        toast.success(`成功部署到 ${summary.success} 个服务器，并补齐 ${syncSummary.syncedUsers || 0} 个用户订阅`);
                    } else {
                        toast.success(`成功部署到 ${summary.success} 个服务器`);
                    }
                } else {
                    const baseMessage = `部署完成: ${summary.success} 成功, ${summary.failed} 失败`;
                    if (syncSummary && syncExistingSubscriptions) {
                        toast.error(`${baseMessage}；已补齐 ${syncSummary.syncedUsers || 0} 个用户订阅`);
                    } else {
                        toast.error(baseMessage);
                    }
                }
            }
            onSuccess();
            onClose();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.msg || err.message || '未知错误';
            toast.error(editingInbound ? `更新失败: ${msg}` : `添加失败: ${msg}`);
        }
        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <Modal
            open={isOpen}
            onCancel={onClose}
            footer={null}
            width={900}
            className="inbound-modal-antd"
            title={
                <div className="flex items-center justify-between pr-8">
                    <span>{editingInbound ? '编辑入站' : '批量添加入站'}</span>
                    <Checkbox
                        checked={isAdvanced}
                        onChange={e => setIsAdvanced(e.target.checked)}
                        className="text-sm font-normal"
                    >
                        专家模式 (JSON)
                    </Checkbox>
                </div>
            }
        >
            <Form layout="vertical" onFinish={handleSubmit}>
                <div className="modal-body-antd">
                        {/* Target Servers */}
                        {!editingInbound && servers.length > 0 && (
                            <div className="mb-6 p-4 rounded-xl bg-surface-soft border border-stroke-soft">
                                <Text strong className="mb-2 block">部署目标 ({selectedServerIds.length}/{servers.length})</Text>
                                <Space wrap gap={12}>
                                    <Checkbox
                                        checked={selectedServerIds.length === servers.length}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedServerIds(servers.map(s => s.id));
                                            else setSelectedServerIds([]);
                                        }}
                                    >
                                        全选
                                    </Checkbox>
                                    {servers.map(s => (
                                        <Checkbox
                                            key={s.id}
                                            checked={selectedServerIds.includes(s.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedServerIds(prev => Array.from(new Set([...prev, s.id])));
                                                else setSelectedServerIds(prev => prev.filter(id => id !== s.id));
                                            }}
                                        >
                                            {s.name}
                                        </Checkbox>
                                    ))}
                                </Space>
                                <div className="mt-3">
                                    <Checkbox
                                        checked={syncExistingSubscriptions}
                                        onChange={(e) => setSyncExistingSubscriptions(e.target.checked)}
                                        className="text-sm"
                                    >
                                        新增后补齐到已有用户订阅，仅同步策略允许的用户
                                    </Checkbox>
                                </div>
                            </div>
                        )}

                        {/* Basic Info */}
                        <Row gutter={16} className="mb-4">
                            <Col span={12}>
                                <Form.Item label="备注">
                                    <Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Name" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="协议">
                                    <Select value={protocol} onChange={val => setProtocol(val)} disabled={!!editingInbound} options={protocolOptions.map(o => ({ label: o.label, value: o.key }))} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="端口" required>
                                    <InputNumber style={{ width: '100%' }} value={port} onChange={val => setPort(val)} min={1} max={65535} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="监听地址 (Listen)">
                                    <Input
                                        value={listen}
                                        onChange={e => setListen(e.target.value)}
                                        placeholder="留空为默认监听"
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="流量限制 (GB)">
                                    <InputNumber style={{ width: '100%' }} value={totalGB} onChange={val => setTotalGB(val)} placeholder="0 = 无限制" min={0} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="周期流量重置">
                                    <Select value={trafficReset} onChange={val => setTrafficReset(val)} options={TRAFFIC_RESET_OPTIONS.map(o => ({ label: o, value: o }))} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="到期策略">
                                    <Select value={expiryMode} onChange={val => setExpiryMode(val)}>
                                        <Option value="never">永不过期</Option>
                                        <Option value="datetime">指定日期时间</Option>
                                        <Option value="days">N 天后过期</Option>
                                    </Select>
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="到期参数">
                                    {expiryMode === 'datetime' && (
                                        <Input
                                            type="datetime-local"
                                            value={expiryDateTime}
                                            onChange={(e) => setExpiryDateTime(e.target.value)}
                                        />
                                    )}
                                    {expiryMode === 'days' && (
                                        <InputNumber
                                            style={{ width: '100%' }}
                                            min={1}
                                            value={expiryAfterDays}
                                            onChange={val => setExpiryAfterDays(val)}
                                            placeholder="例如: 30"
                                        />
                                    )}
                                    {expiryMode === 'never' && (
                                        <Input value="永不过期" readOnly />
                                    )}
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label=" " colon={false}>
                                    <Space>
                                        <Switch checked={inboundEnabled} onChange={val => setInboundEnabled(val)} />
                                        <Text>启用入站</Text>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>

                        {/* Simple vs Advanced Toggle */}
                        {isAdvanced ? (
                            <>
                                <Form.Item label="协议设置 (Settings)">
                                    <Input.TextArea className="font-mono text-sm" rows={6} value={settings} onChange={e => setSettings(e.target.value)} />
                                </Form.Item>
                                <Form.Item label="传输设置 (Stream Settings)">
                                    <Input.TextArea className="font-mono text-sm" rows={8} value={streamSettings} onChange={e => setStreamSettings(e.target.value)} />
                                </Form.Item>
                                <Form.Item label="Sniffing">
                                    <Input.TextArea className="font-mono text-sm" rows={4} value={sniffing} onChange={e => setSniffing(e.target.value)} />
                                </Form.Item>
                            </>
                        ) : (
                            <div className="bg-surface-soft p-4 rounded-xl border border-stroke-soft">
                                {normalizedProtocol === 'vless' && (
                                    <div className="border border-stroke-soft rounded-lg p-4 mb-4">
                                        <Title level={5} className="text-secondary uppercase tracking-wider mb-4">VLESS 协议参数</Title>
                                        <Row gutter={16}>
                                            <Col span={12}>
                                                <Form.Item label="Authentication">
                                                    <Select
                                                        value={String(settingsObj?.selectedAuth || '')}
                                                        onChange={(val) => updateSettingsJson((draft) => {
                                                            draft.selectedAuth = val || undefined;
                                                        })}
                                                    >
                                                        <Option value="">默认(X25519)</Option>
                                                        <Option value="X25519, not Post-Quantum">X25519, not Post-Quantum</Option>
                                                        <Option value="ML-KEM-768, Post-Quantum">ML-KEM-768, Post-Quantum</Option>
                                                    </Select>
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="Flow">
                                                    <Select
                                                        value={String(primaryClient?.flow || '')}
                                                        onChange={(val) => updateSettingsJson((draft) => {
                                                            const client = ensurePrimaryClient(draft);
                                                            client.flow = val || '';
                                                        })}
                                                        options={[
                                                            { label: '不设置', value: '' },
                                                            ...VLESS_FLOW_OPTIONS.filter(Boolean).map(o => ({ label: o, value: o }))
                                                        ]}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>

                                        <Row gutter={16}>
                                            <Col span={12}>
                                                <Form.Item label="UUID">
                                                    <Space.Compact style={{ width: '100%' }}>
                                                        <Input
                                                            className="font-mono"
                                                            value={String(primaryClient?.id || '')}
                                                            onChange={(e) => updateSettingsJson((draft) => {
                                                                const client = ensurePrimaryClient(draft);
                                                                client.id = e.target.value;
                                                            })}
                                                        />
                                                        <Button
                                                            onClick={() => updateSettingsJson((draft) => {
                                                                const client = ensurePrimaryClient(draft);
                                                                client.id = randomUuid();
                                                            })}
                                                        >
                                                            生成
                                                        </Button>
                                                    </Space.Compact>
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="Email">
                                                    <Input
                                                        value={String(primaryClient?.email || '')}
                                                        onChange={(e) => updateSettingsJson((draft) => {
                                                            const client = ensurePrimaryClient(draft);
                                                            client.email = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>

                                        <Row gutter={16}>
                                            <Col span={12}>
                                                <Form.Item label="Decryption">
                                                    <Input
                                                        value={String(settingsObj?.decryption || '')}
                                                        onChange={(e) => updateSettingsJson((draft) => {
                                                            draft.decryption = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="Encryption">
                                                    <Input
                                                        value={String(settingsObj?.encryption || '')}
                                                        onChange={(e) => updateSettingsJson((draft) => {
                                                            draft.encryption = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                        <Form.Item label="Authentication 密钥">
                                            <Space>
                                                <Button
                                                    onClick={generateVlessEncKeys}
                                                >
                                                    生成
                                                </Button>
                                                <Button
                                                    onClick={clearVlessEncKeys}
                                                >
                                                    清空
                                                </Button>
                                            </Space>
                                        </Form.Item>

                                        {simpleStream.network === 'tcp' && !String(settingsObj?.selectedAuth || '').trim() && (
                                            <div className="mb-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Text strong>Fallbacks</Text>
                                                    <Button
                                                        size="small"
                                                        onClick={() => updateSettingsJson((draft) => {
                                                            if (!Array.isArray(draft.fallbacks)) draft.fallbacks = [];
                                                            draft.fallbacks.push({ name: '', alpn: '', path: '', dest: '', xver: 0 });
                                                        })}
                                                    >
                                                        新增
                                                    </Button>
                                                </div>
                                                {vlessFallbacks.length === 0 && (
                                                    <Text type="secondary" style={{ fontSize: '12px' }}>未配置 fallback</Text>
                                                )}
                                                {vlessFallbacks.map((fallback, index) => (
                                                    <div key={`vless-fallback-${index}`} className="border border-stroke-soft rounded-md p-3 mb-2">
                                                        <div className="flex justify-between items-center mb-2">
                                                            <Text type="secondary" style={{ fontSize: '12px' }}>Fallback #{index + 1}</Text>
                                                            <Button
                                                                danger
                                                                size="small"
                                                                onClick={() => updateSettingsJson((draft) => {
                                                                    if (!Array.isArray(draft.fallbacks)) draft.fallbacks = [];
                                                                    draft.fallbacks.splice(index, 1);
                                                                })}
                                                            >
                                                                删除
                                                            </Button>
                                                        </div>
                                                        <Row gutter={12}>
                                                            <Col span={12}>
                                                                <Form.Item label="SNI" className="mb-2">
                                                                    <Input
                                                                        value={String(fallback?.name || '')}
                                                                        onChange={(e) => updateSettingsJson((draft) => {
                                                                            if (!Array.isArray(draft.fallbacks)) draft.fallbacks = [];
                                                                            draft.fallbacks[index] = draft.fallbacks[index] || {};
                                                                            draft.fallbacks[index].name = e.target.value;
                                                                        })}
                                                                    />
                                                                </Form.Item>
                                                            </Col>
                                                            <Col span={12}>
                                                                <Form.Item label="ALPN" className="mb-2">
                                                                    <Input
                                                                        value={String(fallback?.alpn || '')}
                                                                        onChange={(e) => updateSettingsJson((draft) => {
                                                                            if (!Array.isArray(draft.fallbacks)) draft.fallbacks = [];
                                                                            draft.fallbacks[index] = draft.fallbacks[index] || {};
                                                                            draft.fallbacks[index].alpn = e.target.value;
                                                                        })}
                                                                    />
                                                                </Form.Item>
                                                            </Col>
                                                            <Col span={12}>
                                                                <Form.Item label="Path" className="mb-2">
                                                                    <Input
                                                                        value={String(fallback?.path || '')}
                                                                        onChange={(e) => updateSettingsJson((draft) => {
                                                                            if (!Array.isArray(draft.fallbacks)) draft.fallbacks = [];
                                                                            draft.fallbacks[index] = draft.fallbacks[index] || {};
                                                                            draft.fallbacks[index].path = e.target.value;
                                                                        })}
                                                                    />
                                                                </Form.Item>
                                                            </Col>
                                                            <Col span={12}>
                                                                <Form.Item label="Dest" className="mb-2">
                                                                    <Input
                                                                        value={String(fallback?.dest || '')}
                                                                        onChange={(e) => updateSettingsJson((draft) => {
                                                                            if (!Array.isArray(draft.fallbacks)) draft.fallbacks = [];
                                                                            draft.fallbacks[index] = draft.fallbacks[index] || {};
                                                                            draft.fallbacks[index].dest = e.target.value;
                                                                        })}
                                                                    />
                                                                </Form.Item>
                                                            </Col>
                                                            <Col span={12}>
                                                                <Form.Item label="xVer" className="mb-2">
                                                                    <InputNumber
                                                                        style={{ width: '100%' }}
                                                                        min={0}
                                                                        max={2}
                                                                        value={Number(fallback?.xver || 0)}
                                                                        onChange={(val) => updateSettingsJson((draft) => {
                                                                            if (!Array.isArray(draft.fallbacks)) draft.fallbacks = [];
                                                                            draft.fallbacks[index] = draft.fallbacks[index] || {};
                                                                            draft.fallbacks[index].xver = Number(val || 0);
                                                                        })}
                                                                    />
                                                                </Form.Item>
                                                            </Col>
                                                        </Row>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {(primaryClient?.flow === 'xtls-rprx-vision' || primaryClient?.flow === 'xtls-rprx-vision-udp443') && (
                                            <div className="mt-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Text strong>Vision Seed</Text>
                                                    <Space>
                                                        <Button
                                                            size="small"
                                                            onClick={() => updateSettingsJson((draft) => {
                                                                draft.testseed = [
                                                                    Math.floor(Math.random() * 1000),
                                                                    Math.floor(Math.random() * 1000),
                                                                    Math.floor(Math.random() * 1000),
                                                                    Math.floor(Math.random() * 1000),
                                                                ];
                                                            })}
                                                        >
                                                            Rand
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            onClick={() => updateSettingsJson((draft) => {
                                                                draft.testseed = [900, 500, 900, 256];
                                                            })}
                                                        >
                                                            Reset
                                                        </Button>
                                                    </Space>
                                                </div>
                                                <Row gutter={8}>
                                                    {vlessTestseed.map((seed, idx) => (
                                                        <Col span={6} key={`vless-seed-${idx}`}>
                                                            <InputNumber
                                                                style={{ width: '100%' }}
                                                                min={0}
                                                                max={9999}
                                                                value={seed}
                                                                onChange={(val) => updateSettingsJson((draft) => {
                                                                    const current = Array.isArray(draft.testseed) ? draft.testseed.slice(0, 4) : [900, 500, 900, 256];
                                                                    while (current.length < 4) current.push(0);
                                                                    current[idx] = Number(val || 0);
                                                                    draft.testseed = current;
                                                                })}
                                                            />
                                                        </Col>
                                                    ))}
                                                </Row>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <Title level={5} className="text-secondary uppercase tracking-wider mb-4">传输配置</Title>
                                <Row gutter={16}>
                                    <Col span={12}>
                                        <Form.Item label="传输协议 (Network)">
                                            <Select
                                                value={simpleStream.network}
                                                onChange={val => setSimpleStream({ ...simpleStream, network: val })}
                                                options={networkOptions.map((item) => ({
                                                    label: NETWORK_LABELS[item] || item.toUpperCase(),
                                                    value: item
                                                }))}
                                            />
                                        </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                        <Form.Item label="安全 (Security)">
                                            <Select
                                                value={simpleStream.security}
                                                onChange={val => setSimpleStream({ ...simpleStream, security: val })}
                                                options={securityOptions.map((item) => ({
                                                    label: SECURITY_LABELS[item] || item.toUpperCase(),
                                                    value: item
                                                }))}
                                            />
                                        </Form.Item>
                                    </Col>
                                </Row>

                                <div className="border-t border-stroke-soft pt-4 mt-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <Title level={5} className="text-secondary uppercase tracking-wider m-0">流量嗅探 (Sniffing)</Title>
                                        <Checkbox
                                            checked={(() => { try { return JSON.parse(sniffing).enabled; } catch { return true; } })()}
                                            onChange={(e) => {
                                                try {
                                                    const s = JSON.parse(sniffing);
                                                    s.enabled = e.target.checked;
                                                    setSniffing(JSON.stringify(s, null, 2));
                                                } catch { }
                                            }}
                                        >
                                            启用
                                        </Checkbox>
                                    </div>
                                    <Row gutter={[16, 16]}>
                                        <Col span={12}>
                                            <Form.Item label="目标覆盖 (Dest Override)">
                                                <Space wrap>
                                                    {['http', 'tls', 'quic', 'fakedns'].map(p => (
                                                        <Checkbox
                                                            key={p}
                                                            checked={(() => {
                                                                try {
                                                                    const s = JSON.parse(sniffing);
                                                                    return Array.isArray(s.destOverride) && s.destOverride.includes(p);
                                                                } catch { return false; }
                                                            })()}
                                                            onChange={(e) => {
                                                                try {
                                                                    const s = JSON.parse(sniffing);
                                                                    const current = Array.isArray(s.destOverride) ? s.destOverride : [];
                                                                    if (e.target.checked) {
                                                                        s.destOverride = [...new Set([...current, p])];
                                                                    } else {
                                                                        s.destOverride = current.filter(x => x !== p);
                                                                    }
                                                                    setSniffing(JSON.stringify(s, null, 2));
                                                                } catch { }
                                                            }}
                                                        >
                                                            {p}
                                                        </Checkbox>
                                                    ))}
                                                </Space>
                                            </Form.Item>
                                        </Col>
                                        <Col span={12}>
                                            <Form.Item label="高级选项">
                                                <Space direction="vertical">
                                                    <Checkbox
                                                        checked={(() => { try { return !!JSON.parse(sniffing).routeOnly; } catch { return false; } })()}
                                                        onChange={(e) => {
                                                            try {
                                                                const s = JSON.parse(sniffing);
                                                                s.routeOnly = e.target.checked;
                                                                setSniffing(JSON.stringify(s, null, 2));
                                                            } catch { }
                                                        }}
                                                    >
                                                        仅路由 (Route Only)
                                                    </Checkbox>
                                                    <Checkbox
                                                        checked={(() => { try { return !!JSON.parse(sniffing).metadataOnly; } catch { return false; } })()}
                                                        onChange={(e) => {
                                                            try {
                                                                const s = JSON.parse(sniffing);
                                                                s.metadataOnly = e.target.checked;
                                                                setSniffing(JSON.stringify(s, null, 2));
                                                            } catch { }
                                                        }}
                                                    >
                                                        仅元数据 (Metadata Only)
                                                    </Checkbox>
                                                </Space>
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </div>

                                {/* Dynamic Fields based on selection */}
                                {simpleStream.network === 'tcp' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <Row gutter={16}>
                                            <Col span={12}>
                                                <Form.Item label="TCP Header Type">
                                                    <Select
                                                        value={simpleStream.tcpHeaderType}
                                                        onChange={val => setSimpleStream({ ...simpleStream, tcpHeaderType: val })}
                                                        options={['none', 'http', 'srtp', 'utp', 'wechat-video', 'dtls', 'wireguard'].map((item) => ({ label: item, value: item }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="TCP 高级开关">
                                                    <Checkbox
                                                        checked={!!simpleStream.tcpAcceptProxyProtocol}
                                                        onChange={e => setSimpleStream({ ...simpleStream, tcpAcceptProxyProtocol: e.target.checked })}
                                                    >
                                                        Accept Proxy Protocol
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                        </Row>

                                        {simpleStream.tcpHeaderType === 'http' && (
                                            <div className="mt-3 border border-stroke-soft rounded-lg p-4 bg-surface-soft">
                                                <Row gutter={[16, 0]}>
                                                    <Col span={12}>
                                                        <Form.Item label="Request Version">
                                                            <Input
                                                                value={String(streamObj?.tcpSettings?.header?.request?.version || '1.1')}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tcpSettings = draft.tcpSettings || {};
                                                                    draft.tcpSettings.header = draft.tcpSettings.header || { type: 'http' };
                                                                    draft.tcpSettings.header.request = draft.tcpSettings.header.request || {};
                                                                    draft.tcpSettings.header.request.version = e.target.value;
                                                                })}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={12}>
                                                        <Form.Item label="Request Method">
                                                            <Input
                                                                value={String(streamObj?.tcpSettings?.header?.request?.method || 'GET')}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tcpSettings = draft.tcpSettings || {};
                                                                    draft.tcpSettings.header = draft.tcpSettings.header || { type: 'http' };
                                                                    draft.tcpSettings.header.request = draft.tcpSettings.header.request || {};
                                                                    draft.tcpSettings.header.request.method = e.target.value;
                                                                })}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={12}>
                                                        <Form.Item label="Request Path (逗号分隔)">
                                                            <Input
                                                                value={Array.isArray(streamObj?.tcpSettings?.header?.request?.path)
                                                                    ? streamObj.tcpSettings.header.request.path.join(',')
                                                                    : '/'}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tcpSettings = draft.tcpSettings || {};
                                                                    draft.tcpSettings.header = draft.tcpSettings.header || { type: 'http' };
                                                                    draft.tcpSettings.header.request = draft.tcpSettings.header.request || {};
                                                                    draft.tcpSettings.header.request.path = String(e.target.value || '/')
                                                                        .split(',')
                                                                        .map((item) => item.trim())
                                                                        .filter(Boolean);
                                                                    if (draft.tcpSettings.header.request.path.length === 0) {
                                                                        draft.tcpSettings.header.request.path = ['/'];
                                                                    }
                                                                })}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={12}>
                                                        <Form.Item label="Request Host">
                                                            <Input
                                                                value={String(streamObj?.tcpSettings?.header?.request?.headers?.Host?.[0] || '')}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tcpSettings = draft.tcpSettings || {};
                                                                    draft.tcpSettings.header = draft.tcpSettings.header || { type: 'http' };
                                                                    draft.tcpSettings.header.request = draft.tcpSettings.header.request || {};
                                                                    draft.tcpSettings.header.request.headers = normalizeHeadersObject(draft.tcpSettings.header.request.headers);
                                                                    draft.tcpSettings.header.request.headers.Host = [e.target.value];
                                                                })}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={12}>
                                                        <Form.Item label="Response Version">
                                                            <Input
                                                                value={String(streamObj?.tcpSettings?.header?.response?.version || '1.1')}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tcpSettings = draft.tcpSettings || {};
                                                                    draft.tcpSettings.header = draft.tcpSettings.header || { type: 'http' };
                                                                    draft.tcpSettings.header.response = draft.tcpSettings.header.response || {};
                                                                    draft.tcpSettings.header.response.version = e.target.value;
                                                                })}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={12}>
                                                        <Form.Item label="Response Status">
                                                            <Input
                                                                value={String(streamObj?.tcpSettings?.header?.response?.status || '200')}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tcpSettings = draft.tcpSettings || {};
                                                                    draft.tcpSettings.header = draft.tcpSettings.header || { type: 'http' };
                                                                    draft.tcpSettings.header.response = draft.tcpSettings.header.response || {};
                                                                    draft.tcpSettings.header.response.status = e.target.value;
                                                                })}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={24}>
                                                        <Form.Item label="Response Reason">
                                                            <Input
                                                                value={String(streamObj?.tcpSettings?.header?.response?.reason || 'OK')}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tcpSettings = draft.tcpSettings || {};
                                                                    draft.tcpSettings.header = draft.tcpSettings.header || { type: 'http' };
                                                                    draft.tcpSettings.header.response = draft.tcpSettings.header.response || {};
                                                                    draft.tcpSettings.header.response.reason = e.target.value;
                                                                })}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {simpleStream.network === 'kcp' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <Row gutter={[16, 0]}>
                                            <Col span={8}>
                                                <Form.Item label="MTU">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={576}
                                                        max={1460}
                                                        value={simpleStream.kcpMtu}
                                                        onChange={val => setSimpleStream({ ...simpleStream, kcpMtu: Number(val || 1350) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="TTI (ms)">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={10}
                                                        max={100}
                                                        value={simpleStream.kcpTti}
                                                        onChange={val => setSimpleStream({ ...simpleStream, kcpTti: Number(val || 20) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Uplink (MB/s)">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={simpleStream.kcpUplinkCapacity}
                                                        onChange={val => setSimpleStream({ ...simpleStream, kcpUplinkCapacity: Number(val || 0) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Downlink (MB/s)">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={simpleStream.kcpDownlinkCapacity}
                                                        onChange={val => setSimpleStream({ ...simpleStream, kcpDownlinkCapacity: Number(val || 0) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Read Buffer (MB)">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={simpleStream.kcpReadBufferSize}
                                                        onChange={val => setSimpleStream({ ...simpleStream, kcpReadBufferSize: Number(val || 0) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Write Buffer (MB)">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={simpleStream.kcpWriteBufferSize}
                                                        onChange={val => setSimpleStream({ ...simpleStream, kcpWriteBufferSize: Number(val || 0) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="Congestion">
                                                    <Checkbox
                                                        checked={!!simpleStream.kcpCongestion}
                                                        onChange={e => setSimpleStream({ ...simpleStream, kcpCongestion: e.target.checked })}
                                                    >
                                                        开启
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>
                                )}

                                {simpleStream.network === 'ws' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <Row gutter={16}>
                                            <Col span={8}>
                                                <Form.Item label="WS Path">
                                                    <Input value={simpleStream.wsPath} onChange={e => setSimpleStream({ ...simpleStream, wsPath: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="WS Host">
                                                    <Input value={simpleStream.wsHost} onChange={e => setSimpleStream({ ...simpleStream, wsHost: e.target.value })} placeholder="Optional" />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="WS 高级开关">
                                                    <Checkbox
                                                        checked={!!simpleStream.wsAcceptProxyProtocol}
                                                        onChange={e => setSimpleStream({ ...simpleStream, wsAcceptProxyProtocol: e.target.checked })}
                                                    >
                                                        Accept Proxy Protocol
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="Heartbeat Period">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={Number(streamObj?.wsSettings?.heartbeatPeriod || 0)}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.wsSettings = draft.wsSettings || {};
                                                            draft.wsSettings.heartbeatPeriod = Number(val || 0);
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="WS Headers (JSON)">
                                                    <Input
                                                        className="font-mono text-xs"
                                                        value={JSON.stringify(streamObj?.wsSettings?.headers || {})}
                                                        onChange={(e) => {
                                                            try {
                                                                const parsed = parseJsonObject(e.target.value, {});
                                                                updateStreamJson((draft) => {
                                                                    draft.wsSettings = draft.wsSettings || {};
                                                                    draft.wsSettings.headers = parsed;
                                                                });
                                                            } catch { }
                                                        }}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>
                                )}

                                {simpleStream.network === 'grpc' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <Row gutter={16}>
                                            <Col span={8}>
                                                <Form.Item label="gRPC Service Name">
                                                    <Input
                                                        value={simpleStream.grpcServiceName}
                                                        onChange={e => setSimpleStream({ ...simpleStream, grpcServiceName: e.target.value })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="gRPC Authority">
                                                    <Input
                                                        value={simpleStream.grpcAuthority}
                                                        onChange={e => setSimpleStream({ ...simpleStream, grpcAuthority: e.target.value })}
                                                        placeholder="Optional"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Multi Mode">
                                                    <Checkbox
                                                        checked={!!streamObj?.grpcSettings?.multiMode}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.grpcSettings = draft.grpcSettings || {};
                                                            draft.grpcSettings.multiMode = e.target.checked;
                                                        })}
                                                    >
                                                        开启
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>
                                )}

                                {simpleStream.network === 'httpupgrade' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <Row gutter={16}>
                                            <Col span={8}>
                                                <Form.Item label="HTTPUpgrade Path">
                                                    <Input value={simpleStream.httpupgradePath} onChange={e => setSimpleStream({ ...simpleStream, httpupgradePath: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="HTTPUpgrade Host">
                                                    <Input value={simpleStream.httpupgradeHost} onChange={e => setSimpleStream({ ...simpleStream, httpupgradeHost: e.target.value })} placeholder="Optional" />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="HTTPUpgrade 高级开关">
                                                    <Checkbox
                                                        checked={!!simpleStream.httpupgradeAcceptProxyProtocol}
                                                        onChange={e => setSimpleStream({ ...simpleStream, httpupgradeAcceptProxyProtocol: e.target.checked })}
                                                    >
                                                        Accept Proxy Protocol
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="HTTPUpgrade Headers (JSON)">
                                                    <Input
                                                        className="font-mono text-xs"
                                                        value={JSON.stringify(streamObj?.httpupgradeSettings?.headers || {})}
                                                        onChange={(e) => {
                                                            const parsed = parseJsonObject(e.target.value, {});
                                                            updateStreamJson((draft) => {
                                                                draft.httpupgradeSettings = draft.httpupgradeSettings || {};
                                                                draft.httpupgradeSettings.headers = parsed;
                                                            });
                                                        }}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>
                                )}

                                {simpleStream.network === 'xhttp' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <Row gutter={16}>
                                            <Col span={8}>
                                                <Form.Item label="XHTTP Path">
                                                    <Input value={simpleStream.xhttpPath} onChange={e => setSimpleStream({ ...simpleStream, xhttpPath: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="XHTTP Host">
                                                    <Input value={simpleStream.xhttpHost} onChange={e => setSimpleStream({ ...simpleStream, xhttpHost: e.target.value })} placeholder="Optional" />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="XHTTP Mode">
                                                    <Select
                                                        value={simpleStream.xhttpMode}
                                                        onChange={val => setSimpleStream({ ...simpleStream, xhttpMode: val })}
                                                        options={['auto', 'packet-up', 'stream-up', 'stream-one'].map(o => ({ label: o, value: o }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Max Buffered Upload">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={Number(streamObj?.xhttpSettings?.scMaxBufferedPosts || 30)}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.scMaxBufferedPosts = Number(val || 0);
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Max Upload Size(Byte)">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.scMaxEachPostBytes || '1000000')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.scMaxEachPostBytes = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Stream-Up Server">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.scStreamUpServerSecs || '20-80')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.scStreamUpServerSecs = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Padding Bytes">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.xPaddingBytes || '100-1000')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.xPaddingBytes = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="No SSE Header">
                                                    <Checkbox
                                                        checked={!!streamObj?.xhttpSettings?.noSSEHeader}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.noSSEHeader = e.target.checked;
                                                        })}
                                                    >
                                                        开启
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Padding Obfs Mode">
                                                    <Checkbox
                                                        checked={!!streamObj?.xhttpSettings?.xPaddingObfsMode}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.xPaddingObfsMode = e.target.checked;
                                                        })}
                                                    >
                                                        开启
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Padding Key">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.xPaddingKey || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.xPaddingKey = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Padding Header">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.xPaddingHeader || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.xPaddingHeader = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Padding Placement">
                                                    <Select
                                                        value={String(streamObj?.xhttpSettings?.xPaddingPlacement || '')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.xPaddingPlacement = val;
                                                        })}
                                                        options={XHTTP_PADDING_PLACEMENT_OPTIONS.map(item => ({
                                                            label: item || 'Default (queryInHeader)',
                                                            value: item
                                                        }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Padding Method">
                                                    <Select
                                                        value={String(streamObj?.xhttpSettings?.xPaddingMethod || '')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.xPaddingMethod = val;
                                                        })}
                                                        options={XHTTP_PADDING_METHOD_OPTIONS.map(item => ({
                                                            label: item || 'Default (repeat-x)',
                                                            value: item
                                                        }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Uplink HTTP Method">
                                                    <Select
                                                        value={String(streamObj?.xhttpSettings?.uplinkHTTPMethod || '')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.uplinkHTTPMethod = val;
                                                        })}
                                                        options={XHTTP_HTTP_METHOD_OPTIONS.map(item => ({
                                                            label: item || 'Default (POST)',
                                                            value: item
                                                        }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Session Placement">
                                                    <Select
                                                        value={String(streamObj?.xhttpSettings?.sessionPlacement || '')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.sessionPlacement = val;
                                                        })}
                                                        options={XHTTP_SESSION_SEQ_PLACEMENT_OPTIONS.map(item => ({
                                                            label: item || 'Default (path)',
                                                            value: item
                                                        }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Session Key">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.sessionKey || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.sessionKey = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Sequence Placement">
                                                    <Select
                                                        value={String(streamObj?.xhttpSettings?.seqPlacement || '')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.seqPlacement = val;
                                                        })}
                                                        options={XHTTP_SESSION_SEQ_PLACEMENT_OPTIONS.map(item => ({
                                                            label: item || 'Default (path)',
                                                            value: item
                                                        }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Sequence Key">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.seqKey || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.seqKey = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Uplink Data Placement">
                                                    <Select
                                                        value={String(streamObj?.xhttpSettings?.uplinkDataPlacement || '')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.uplinkDataPlacement = val;
                                                        })}
                                                        options={XHTTP_UPLINK_DATA_PLACEMENT_OPTIONS.map(item => ({
                                                            label: item || 'Default (body)',
                                                            value: item
                                                        }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Uplink Data Key">
                                                    <Input
                                                        value={String(streamObj?.xhttpSettings?.uplinkDataKey || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.uplinkDataKey = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Uplink Chunk Size">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={Number(streamObj?.xhttpSettings?.uplinkChunkSize || 0)}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.xhttpSettings = draft.xhttpSettings || {};
                                                            draft.xhttpSettings.uplinkChunkSize = Number(val || 0);
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="XHTTP Headers (JSON)">
                                                    <Input
                                                        className="font-mono text-xs"
                                                        value={JSON.stringify(streamObj?.xhttpSettings?.headers || {})}
                                                        onChange={(e) => {
                                                            const parsed = parseJsonObject(e.target.value, {});
                                                            updateStreamJson((draft) => {
                                                                draft.xhttpSettings = draft.xhttpSettings || {};
                                                                draft.xhttpSettings.headers = parsed;
                                                            });
                                                        }}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>
                                )}

                                {simpleStream.security === 'tls' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <Row gutter={16}>
                                            <Col span={8}>
                                                <Form.Item label="TLS SNI (serverName)">
                                                    <Input
                                                        value={simpleStream.tlsSni}
                                                        onChange={e => setSimpleStream({ ...simpleStream, tlsSni: e.target.value })}
                                                        placeholder="例如: apple.com"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Fingerprint">
                                                    <Select
                                                        value={simpleStream.tlsFingerprint}
                                                        onChange={val => setSimpleStream({ ...simpleStream, tlsFingerprint: val })}
                                                        options={[
                                                            ...(!FINGERPRINT_OPTIONS.includes(simpleStream.tlsFingerprint) && simpleStream.tlsFingerprint ? [{ label: simpleStream.tlsFingerprint, value: simpleStream.tlsFingerprint }] : []),
                                                            ...FINGERPRINT_OPTIONS.map(fp => ({ label: fp, value: fp }))
                                                        ]}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="ALPN">
                                                    <Input
                                                        value={simpleStream.tlsAlpn}
                                                        onChange={e => setSimpleStream({ ...simpleStream, tlsAlpn: e.target.value })}
                                                        placeholder="h2,http/1.1"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Min Version">
                                                    <Select
                                                        value={String(streamObj?.tlsSettings?.minVersion || '1.2')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.minVersion = val;
                                                        })}
                                                        options={TLS_VERSION_OPTIONS.map(v => ({ label: v, value: v }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Max Version">
                                                    <Select
                                                        value={String(streamObj?.tlsSettings?.maxVersion || '1.3')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.maxVersion = val;
                                                        })}
                                                        options={TLS_VERSION_OPTIONS.map(v => ({ label: v, value: v }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Cipher Suites">
                                                    <Select
                                                        value={String(streamObj?.tlsSettings?.cipherSuites || '')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.cipherSuites = val;
                                                        })}
                                                        options={TLS_CIPHER_OPTIONS.map(c => ({ label: c || 'Auto', value: c }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Reject Unknown SNI">
                                                    <Checkbox
                                                        checked={!!streamObj?.tlsSettings?.rejectUnknownSni}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.rejectUnknownSni = e.target.checked;
                                                        })}
                                                    >
                                                        开启
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Disable System Root">
                                                    <Checkbox
                                                        checked={!!streamObj?.tlsSettings?.disableSystemRoot}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.disableSystemRoot = e.target.checked;
                                                        })}
                                                    >
                                                        开启
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Session Resumption">
                                                    <Checkbox
                                                        checked={!!streamObj?.tlsSettings?.enableSessionResumption}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.enableSessionResumption = e.target.checked;
                                                        })}
                                                    >
                                                        开启
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="ECH Server Keys">
                                                    <Input
                                                        value={String(streamObj?.tlsSettings?.echServerKeys || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.echServerKeys = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="ECH Config List">
                                                    <Input
                                                        value={String(streamObj?.tlsSettings?.settings?.echConfigList || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.settings = draft.tlsSettings.settings || {};
                                                            draft.tlsSettings.settings.echConfigList = e.target.value;
                                                        })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="ECH Force Query">
                                                    <Select
                                                        value={String(streamObj?.tlsSettings?.echForceQuery || 'none')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.tlsSettings = draft.tlsSettings || {};
                                                            draft.tlsSettings.echForceQuery = val;
                                                        })}
                                                        options={['none', 'half', 'full'].map(o => ({ label: o, value: o }))}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="ECH 证书操作">
                                                    <Space>
                                                        <Button size="small" onClick={generateEchCert}>生成</Button>
                                                        <Button size="small" onClick={clearEchCert}>清空</Button>
                                                    </Space>
                                                </Form.Item>
                                            </Col>
                                        </Row>

                                        <div className="border border-stroke-soft rounded-lg p-4 mt-2 bg-surface-soft">
                                            <Title level={5} className="mb-4">证书 (第1条)</Title>
                                            <Row gutter={16}>
                                                <Col span={12}>
                                                    <Form.Item label="证书文件路径">
                                                        <Input
                                                            value={String(streamObj?.tlsSettings?.certificates?.[0]?.certificateFile || '')}
                                                            onChange={(e) => updateStreamJson((draft) => {
                                                                draft.tlsSettings = draft.tlsSettings || {};
                                                                if (!Array.isArray(draft.tlsSettings.certificates) || draft.tlsSettings.certificates.length === 0) {
                                                                    draft.tlsSettings.certificates = [{ certificateFile: '', keyFile: '', oneTimeLoading: false, usage: 'encipherment', buildChain: false }];
                                                                }
                                                                draft.tlsSettings.certificates[0].certificateFile = e.target.value;
                                                            })}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="私钥文件路径">
                                                        <Input
                                                            value={String(streamObj?.tlsSettings?.certificates?.[0]?.keyFile || '')}
                                                            onChange={(e) => updateStreamJson((draft) => {
                                                                draft.tlsSettings = draft.tlsSettings || {};
                                                                if (!Array.isArray(draft.tlsSettings.certificates) || draft.tlsSettings.certificates.length === 0) {
                                                                    draft.tlsSettings.certificates = [{ certificateFile: '', keyFile: '', oneTimeLoading: false, usage: 'encipherment', buildChain: false }];
                                                                }
                                                                draft.tlsSettings.certificates[0].keyFile = e.target.value;
                                                            })}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="证书用途">
                                                        <Select
                                                            value={String(streamObj?.tlsSettings?.certificates?.[0]?.usage || 'encipherment')}
                                                            onChange={(val) => updateStreamJson((draft) => {
                                                                draft.tlsSettings = draft.tlsSettings || {};
                                                                if (!Array.isArray(draft.tlsSettings.certificates) || draft.tlsSettings.certificates.length === 0) {
                                                                    draft.tlsSettings.certificates = [{ certificateFile: '', keyFile: '', oneTimeLoading: false, usage: 'encipherment', buildChain: false }];
                                                                }
                                                                draft.tlsSettings.certificates[0].usage = val;
                                                            })}
                                                            options={[
                                                                { label: 'encipherment (加密)', value: 'encipherment' },
                                                                { label: 'verify (验证客户端)', value: 'verify' },
                                                                { label: 'issue (签发子证书)', value: 'issue' },
                                                            ]}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="高级选项" colon={false}>
                                                        <Space>
                                                            <Checkbox
                                                                checked={!!streamObj?.tlsSettings?.certificates?.[0]?.oneTimeLoading}
                                                                onChange={(e) => updateStreamJson((draft) => {
                                                                    draft.tlsSettings = draft.tlsSettings || {};
                                                                    if (!Array.isArray(draft.tlsSettings.certificates) || draft.tlsSettings.certificates.length === 0) {
                                                                        draft.tlsSettings.certificates = [{ certificateFile: '', keyFile: '', oneTimeLoading: false, usage: 'encipherment', buildChain: false }];
                                                                    }
                                                                    draft.tlsSettings.certificates[0].oneTimeLoading = e.target.checked;
                                                                })}
                                                            >
                                                                一次性加载
                                                            </Checkbox>
                                                            {String(streamObj?.tlsSettings?.certificates?.[0]?.usage || 'encipherment') === 'issue' && (
                                                                <Checkbox
                                                                    checked={!!streamObj?.tlsSettings?.certificates?.[0]?.buildChain}
                                                                    onChange={(e) => updateStreamJson((draft) => {
                                                                        draft.tlsSettings = draft.tlsSettings || {};
                                                                        if (!Array.isArray(draft.tlsSettings.certificates) || draft.tlsSettings.certificates.length === 0) {
                                                                            draft.tlsSettings.certificates = [{ certificateFile: '', keyFile: '', oneTimeLoading: false, usage: 'encipherment', buildChain: false }];
                                                                        }
                                                                        draft.tlsSettings.certificates[0].buildChain = e.target.checked;
                                                                    })}
                                                                >
                                                                    构建证书链
                                                                </Checkbox>
                                                            )}
                                                        </Space>
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        </div>
                                    </div>
                                )}

                                {simpleStream.security === 'reality' && (
                                    <div className="mt-4 border-t border-stroke-soft pt-4">
                                        <div className="flex justify-between items-center mb-4">
                                            <Title level={5} className="m-0 uppercase tracking-wider">Reality Settings</Title>
                                            <Button type="primary" size="small" onClick={generateRealityKeys}>生成密钥</Button>
                                        </div>

                                        <Row gutter={16}>
                                            <Col span={12}>
                                                <Form.Item label="Show">
                                                    <Checkbox
                                                        checked={!!simpleStream.realityShow}
                                                        onChange={e => setSimpleStream({ ...simpleStream, realityShow: e.target.checked })}
                                                    >
                                                        启用
                                                    </Checkbox>
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="Xver">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        max={2}
                                                        value={simpleStream.realityXver}
                                                        onChange={val => setSimpleStream({ ...simpleStream, realityXver: Number(val || 0) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="目标网站 (Target)">
                                                    <Input value={simpleStream.realityDest} onChange={e => setSimpleStream({ ...simpleStream, realityDest: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="SNI (ServerName)">
                                                    <Input value={simpleStream.realitySNI} onChange={e => setSimpleStream({ ...simpleStream, realitySNI: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="Reality Settings ServerName">
                                                    <Input
                                                        value={String(streamObj?.realitySettings?.settings?.serverName || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.realitySettings = draft.realitySettings || {};
                                                            draft.realitySettings.settings = draft.realitySettings.settings || {};
                                                            draft.realitySettings.settings.serverName = e.target.value;
                                                        })}
                                                        placeholder="可选，通常留空"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="ShortId">
                                                    <Space.Compact style={{ width: '100%' }}>
                                                        <Input value={simpleStream.realityShortId} onChange={e => setSimpleStream({ ...simpleStream, realityShortId: e.target.value })} />
                                                        <Button onClick={generateShortId}>生成</Button>
                                                    </Space.Compact>
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="PrivateKey" extra="REALITY 服务端私钥；留空时保存会自动为每个目标节点生成密钥对">
                                                    <Input className="font-mono text-xs" value={simpleStream.realityPrivateKey} onChange={e => setSimpleStream({ ...simpleStream, realityPrivateKey: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="PublicKey" extra="订阅链接所需 pbk 参数（可手动填入，或点击“生成密钥”自动填充）">
                                                    <Input className="font-mono text-xs" value={simpleStream.realityPublicKey} onChange={e => setSimpleStream({ ...simpleStream, realityPublicKey: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Min Client Ver">
                                                    <Input
                                                        value={simpleStream.realityMinClientVer}
                                                        onChange={e => setSimpleStream({ ...simpleStream, realityMinClientVer: e.target.value })}
                                                        placeholder="Optional"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Max Client Ver">
                                                    <Input
                                                        value={simpleStream.realityMaxClientVer}
                                                        onChange={e => setSimpleStream({ ...simpleStream, realityMaxClientVer: e.target.value })}
                                                        placeholder="Optional"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={8}>
                                                <Form.Item label="Max TimeDiff">
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        value={simpleStream.realityMaxTimediff}
                                                        onChange={val => setSimpleStream({ ...simpleStream, realityMaxTimediff: Number(val || 0) })}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="Fingerprint (fp)">
                                                    <Select
                                                        value={simpleStream.realityFingerprint}
                                                        onChange={val => setSimpleStream({ ...simpleStream, realityFingerprint: val })}
                                                        options={[
                                                            ...(!FINGERPRINT_OPTIONS.includes(simpleStream.realityFingerprint) && simpleStream.realityFingerprint ? [{ label: simpleStream.realityFingerprint, value: simpleStream.realityFingerprint }] : []),
                                                            ...FINGERPRINT_OPTIONS.map(fp => ({ label: fp, value: fp }))
                                                        ]}
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="SpiderX (spx)">
                                                    <Input value={simpleStream.realitySpiderX} onChange={e => setSimpleStream({ ...simpleStream, realitySpiderX: e.target.value })} />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="mldsa65 Seed">
                                                    <Input
                                                        value={simpleStream.realityMldsa65Seed}
                                                        onChange={e => setSimpleStream({ ...simpleStream, realityMldsa65Seed: e.target.value })}
                                                        placeholder="Optional"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={12}>
                                                <Form.Item label="mldsa65 Verify">
                                                    <Input
                                                        value={simpleStream.realityMldsa65Verify}
                                                        onChange={e => setSimpleStream({ ...simpleStream, realityMldsa65Verify: e.target.value })}
                                                        placeholder="Optional"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item label="mldsa65 操作">
                                                    <Space>
                                                        <Button size="small" onClick={generateMldsa65Seed}>生成</Button>
                                                        <Button size="small" onClick={clearMldsa65Seed}>清空</Button>
                                                    </Space>
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>
                                )}

                                {STREAM_PROTOCOLS.has(normalizedProtocol) && (
                                    <div className="border-t border-stroke-soft pt-4 mt-4">
                                        <div className="flex items-center justify-between mb-4">
                                            <Title level={5} className="m-0 uppercase tracking-wider">External Proxy</Title>
                                            <Space>
                                                <Button
                                                    size="small"
                                                    onClick={() => updateStreamJson((draft) => {
                                                        draft.externalProxy = Array.isArray(draft.externalProxy) ? draft.externalProxy : [];
                                                        draft.externalProxy.push({ forceTls: 'same', dest: '', port: 443, remark: '' });
                                                    })}
                                                >
                                                    新增
                                                </Button>
                                                <Button
                                                    size="small"
                                                    onClick={() => updateStreamJson((draft) => {
                                                        draft.externalProxy = [];
                                                    })}
                                                >
                                                    清空
                                                </Button>
                                            </Space>
                                        </div>
                                        {(Array.isArray(streamObj?.externalProxy) ? streamObj.externalProxy : []).length === 0 && (
                                            <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '12px' }}>未配置 external proxy</Text>
                                        )}
                                        {(Array.isArray(streamObj?.externalProxy) ? streamObj.externalProxy : []).map((row, index) => (
                                            <Row key={`external-proxy-${index}`} gutter={8} align="middle" style={{ marginBottom: '8px' }}>
                                                <Col span={4}>
                                                    <Select
                                                        style={{ width: '100%' }}
                                                        value={String(row?.forceTls || 'same')}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.externalProxy = Array.isArray(draft.externalProxy) ? draft.externalProxy : [];
                                                            draft.externalProxy[index] = draft.externalProxy[index] || {};
                                                            draft.externalProxy[index].forceTls = val;
                                                        })}
                                                        options={[
                                                            { label: 'same', value: 'same' },
                                                            { label: 'none', value: 'none' },
                                                            { label: 'tls', value: 'tls' },
                                                        ]}
                                                    />
                                                </Col>
                                                <Col span={7}>
                                                    <Input
                                                        value={String(row?.dest || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.externalProxy = Array.isArray(draft.externalProxy) ? draft.externalProxy : [];
                                                            draft.externalProxy[index] = draft.externalProxy[index] || {};
                                                            draft.externalProxy[index].dest = e.target.value;
                                                        })}
                                                        placeholder="dest"
                                                    />
                                                </Col>
                                                <Col span={4}>
                                                    <InputNumber
                                                        style={{ width: '100%' }}
                                                        min={1}
                                                        max={65535}
                                                        value={Number(row?.port || 443)}
                                                        onChange={(val) => updateStreamJson((draft) => {
                                                            draft.externalProxy = Array.isArray(draft.externalProxy) ? draft.externalProxy : [];
                                                            draft.externalProxy[index] = draft.externalProxy[index] || {};
                                                            draft.externalProxy[index].port = Number(val || 443);
                                                        })}
                                                        placeholder="port"
                                                    />
                                                </Col>
                                                <Col span={7}>
                                                    <Input
                                                        value={String(row?.remark || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.externalProxy = Array.isArray(draft.externalProxy) ? draft.externalProxy : [];
                                                            draft.externalProxy[index] = draft.externalProxy[index] || {};
                                                            draft.externalProxy[index].remark = e.target.value;
                                                        })}
                                                        placeholder="remark"
                                                    />
                                                </Col>
                                                <Col span={2}>
                                                    <Button
                                                        danger
                                                        size="small"
                                                        onClick={() => updateStreamJson((draft) => {
                                                            draft.externalProxy = Array.isArray(draft.externalProxy) ? draft.externalProxy : [];
                                                            draft.externalProxy.splice(index, 1);
                                                        })}
                                                    >
                                                        删除
                                                    </Button>
                                                </Col>
                                            </Row>
                                        ))}
                                    </div>
                                )}

                                {STREAM_PROTOCOLS.has(normalizedProtocol) && (
                                    <div className="border-t border-stroke-soft pt-4 mt-4">
                                        <Title level={5} className="uppercase tracking-wider mb-2">Sockopt</Title>
                                        <Form.Item label="启用状态">
                                            <Checkbox
                                                checked={!!streamObj?.sockopt}
                                                onChange={(e) => updateStreamJson((draft) => {
                                                    if (e.target.checked) {
                                                        draft.sockopt = draft.sockopt || {
                                                            acceptProxyProtocol: false,
                                                            tcpFastOpen: false,
                                                            mark: 0,
                                                            tproxy: 'off',
                                                            tcpMptcp: false,
                                                            penetrate: false,
                                                            domainStrategy: 'AsIs',
                                                            tcpMaxSeg: 1440,
                                                            dialerProxy: '',
                                                            tcpKeepAliveInterval: 0,
                                                            tcpKeepAliveIdle: 300,
                                                            tcpUserTimeout: 10000,
                                                            tcpcongestion: 'bbr',
                                                            V6Only: false,
                                                            tcpWindowClamp: 600,
                                                            interface: '',
                                                            trustedXForwardedFor: [],
                                                        };
                                                    } else {
                                                        delete draft.sockopt;
                                                    }
                                                })}
                                            >
                                                启用 Sockopt
                                            </Checkbox>
                                        </Form.Item>
                                        {!!streamObj?.sockopt && (
                                            <Row gutter={[16, 0]}>
                                                <Col span={8}>
                                                    <Form.Item label="Route Mark">
                                                        <InputNumber style={{ width: '100%' }} min={0} value={Number(streamObj?.sockopt?.mark || 0)} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.mark = Number(val || 0); })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="TCP KeepAlive Interval">
                                                        <InputNumber style={{ width: '100%' }} min={0} value={Number(streamObj?.sockopt?.tcpKeepAliveInterval || 0)} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.tcpKeepAliveInterval = Number(val || 0); })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="TCP KeepAlive Idle">
                                                        <InputNumber style={{ width: '100%' }} min={0} value={Number(streamObj?.sockopt?.tcpKeepAliveIdle || 0)} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.tcpKeepAliveIdle = Number(val || 0); })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="TCP Max Seg">
                                                        <InputNumber style={{ width: '100%' }} min={0} value={Number(streamObj?.sockopt?.tcpMaxSeg || 0)} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.tcpMaxSeg = Number(val || 0); })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="TCP User Timeout">
                                                        <InputNumber style={{ width: '100%' }} min={0} value={Number(streamObj?.sockopt?.tcpUserTimeout || 0)} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.tcpUserTimeout = Number(val || 0); })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="TCP Window Clamp">
                                                        <InputNumber style={{ width: '100%' }} min={0} value={Number(streamObj?.sockopt?.tcpWindowClamp || 0)} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.tcpWindowClamp = Number(val || 0); })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="Domain Strategy">
                                                        <Select style={{ width: '100%' }} value={String(streamObj?.sockopt?.domainStrategy || 'AsIs')} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.domainStrategy = val; })} options={SOCKOPT_DOMAIN_STRATEGY_OPTIONS.map(o => ({ label: o, value: o }))} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="TCP Congestion">
                                                        <Select style={{ width: '100%' }} value={String(streamObj?.sockopt?.tcpcongestion || 'bbr')} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.tcpcongestion = val; })} options={SOCKOPT_TCP_CONGESTION_OPTIONS.map(o => ({ label: o, value: o }))} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="TProxy">
                                                        <Select style={{ width: '100%' }} value={String(streamObj?.sockopt?.tproxy || 'off')} onChange={(val) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.tproxy = val; })} options={SOCKOPT_TPROXY_OPTIONS.map(o => ({ label: o, value: o }))} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Dialer Proxy">
                                                        <Input value={String(streamObj?.sockopt?.dialerProxy || '')} onChange={(e) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.dialerProxy = e.target.value; })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Interface Name">
                                                        <Input value={String(streamObj?.sockopt?.interface || '')} onChange={(e) => updateStreamJson((draft) => { draft.sockopt = draft.sockopt || {}; draft.sockopt.interface = e.target.value; })} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={24}>
                                                    <Form.Item label="Trusted XFF (逗号分隔)">
                                                        <Input
                                                            value={Array.isArray(streamObj?.sockopt?.trustedXForwardedFor) ? streamObj.sockopt.trustedXForwardedFor.join(',') : ''}
                                                            onChange={(e) => updateStreamJson((draft) => {
                                                                draft.sockopt = draft.sockopt || {};
                                                                draft.sockopt.trustedXForwardedFor = String(e.target.value || '')
                                                                    .split(',')
                                                                    .map((item) => item.trim())
                                                                    .filter(Boolean);
                                                            })}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={24}>
                                                    <Form.Item label="Sockopt Flags">
                                                        <Space wrap>
                                                            {[
                                                                ['acceptProxyProtocol', 'Accept Proxy'],
                                                                ['tcpFastOpen', 'TFO'],
                                                                ['tcpMptcp', 'MPTCP'],
                                                                ['penetrate', 'Penetrate'],
                                                                ['V6Only', 'V6Only'],
                                                            ].map(([key, label]) => (
                                                                <Checkbox
                                                                    key={key}
                                                                    checked={!!streamObj?.sockopt?.[key]}
                                                                    onChange={(e) => updateStreamJson((draft) => {
                                                                        draft.sockopt = draft.sockopt || {};
                                                                        draft.sockopt[key] = e.target.checked;
                                                                    })}
                                                                >
                                                                    {label}
                                                                </Checkbox>
                                                            ))}
                                                        </Space>
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        )}
                                    </div>
                                )}

                                {STREAM_PROTOCOLS.has(normalizedProtocol) && ['tcp', 'ws', 'httpupgrade', 'xhttp', 'kcp'].includes(simpleStream.network) && (
                                    <div className="border-t border-stroke-soft pt-4 mt-4">
                                        <div className="flex items-center justify-between mb-4">
                                            <Title level={5} className="m-0 uppercase tracking-wider">UDP Masks (FinalMask)</Title>
                                            <Button
                                                size="small"
                                                onClick={() => updateStreamJson((draft) => {
                                                    draft.finalmask = draft.finalmask || {};
                                                    draft.finalmask.udp = Array.isArray(draft.finalmask.udp) ? draft.finalmask.udp : [];
                                                    draft.finalmask.udp.push({
                                                        type: simpleStream.network === 'kcp' ? 'mkcp-aes128gcm' : 'xdns',
                                                        settings: {},
                                                    });
                                                })}
                                            >
                                                新增 Mask
                                            </Button>
                                        </div>
                                        {(Array.isArray(streamObj?.finalmask?.udp) ? streamObj.finalmask.udp : []).length === 0 && (
                                            <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '12px' }}>未配置 UDP mask</Text>
                                        )}
                                        {(Array.isArray(streamObj?.finalmask?.udp) ? streamObj.finalmask.udp : []).map((mask, index) => (
                                            <Row key={`udp-mask-${index}`} gutter={8} align="middle" style={{ marginBottom: '8px' }}>
                                                <Col span={7}>
                                                    <Input
                                                        value={String(mask?.type || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.finalmask = draft.finalmask || {};
                                                            draft.finalmask.udp = Array.isArray(draft.finalmask.udp) ? draft.finalmask.udp : [];
                                                            draft.finalmask.udp[index] = draft.finalmask.udp[index] || {};
                                                            draft.finalmask.udp[index].type = e.target.value;
                                                        })}
                                                        placeholder="type"
                                                    />
                                                </Col>
                                                <Col span={8}>
                                                    <Input
                                                        value={String(mask?.settings?.password || mask?.settings?.domain || mask?.settings?.ip || '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.finalmask = draft.finalmask || {};
                                                            draft.finalmask.udp = Array.isArray(draft.finalmask.udp) ? draft.finalmask.udp : [];
                                                            const current = draft.finalmask.udp[index] || { type: 'xdns', settings: {} };
                                                            current.settings = current.settings || {};
                                                            if (current.type === 'mkcp-aes128gcm' || current.type === 'salamander') current.settings.password = e.target.value;
                                                            else if (current.type === 'xicmp') current.settings.ip = e.target.value;
                                                            else current.settings.domain = e.target.value;
                                                            draft.finalmask.udp[index] = current;
                                                        })}
                                                        placeholder="settings"
                                                    />
                                                </Col>
                                                <Col span={7}>
                                                    <Input
                                                        value={String(mask?.settings?.id ?? '')}
                                                        onChange={(e) => updateStreamJson((draft) => {
                                                            draft.finalmask = draft.finalmask || {};
                                                            draft.finalmask.udp = Array.isArray(draft.finalmask.udp) ? draft.finalmask.udp : [];
                                                            const current = draft.finalmask.udp[index] || { type: 'xicmp', settings: {} };
                                                            current.settings = current.settings || {};
                                                            current.settings.id = Number(e.target.value || 0);
                                                            draft.finalmask.udp[index] = current;
                                                        })}
                                                        placeholder="id(仅xicmp)"
                                                    />
                                                </Col>
                                                <Col span={2}>
                                                    <Button
                                                        danger
                                                        size="small"
                                                        onClick={() => updateStreamJson((draft) => {
                                                            draft.finalmask = draft.finalmask || {};
                                                            draft.finalmask.udp = Array.isArray(draft.finalmask.udp) ? draft.finalmask.udp : [];
                                                            draft.finalmask.udp.splice(index, 1);
                                                        })}
                                                    >
                                                        删除
                                                    </Button>
                                                </Col>
                                            </Row>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mt-8 flex justify-end">
                        <Space>
                            <Button onClick={onClose}>取消</Button>
                            <Button type="primary" htmlType="submit" loading={loading} icon={<HiOutlineCheck />}>
                                保存配置
                            </Button>
                        </Space>
                    </div>
                </Form>
            </Modal>
        );
}
