const LEGACY_PROTOCOL_ALIASES = {
    'dokodemo-door': 'tunnel',
    socks: 'mixed',
};

const PROTOCOL_SCHEMAS = [
    {
        key: 'vmess',
        label: 'VMess',
        legacyKeys: [],
        defaultSettings: {
            clients: [{
                id: '',
                security: 'auto',
                email: '',
                limitIp: 0,
                totalGB: 0,
                expiryTime: 0,
                enable: true,
                tgId: '',
                subId: '',
                comment: '',
                reset: 0,
            }],
        },
        supports: {
            transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'],
            securities: ['none', 'tls'],
            tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
        },
    },
    {
        key: 'vless',
        label: 'VLESS',
        legacyKeys: [],
        defaultSettings: {
            clients: [{
                id: '',
                flow: '',
                email: '',
                limitIp: 0,
                totalGB: 0,
                expiryTime: 0,
                enable: true,
                tgId: '',
                subId: '',
                comment: '',
                reset: 0,
            }],
            decryption: 'none',
            encryption: 'none',
            selectedAuth: undefined,
            testseed: [900, 500, 900, 256],
            fallbacks: [],
        },
        supports: {
            transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'],
            securities: ['none', 'tls', 'reality'],
            tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
            realityTransports: ['tcp', 'http', 'grpc', 'xhttp'],
        },
    },
    {
        key: 'trojan',
        label: 'Trojan',
        legacyKeys: [],
        defaultSettings: {
            clients: [{
                password: '',
                email: '',
                limitIp: 0,
                totalGB: 0,
                expiryTime: 0,
                enable: true,
                tgId: '',
                subId: '',
                comment: '',
                reset: 0,
            }],
            fallbacks: [],
        },
        supports: {
            transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'],
            securities: ['none', 'tls', 'reality'],
            tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
            realityTransports: ['tcp', 'http', 'grpc', 'xhttp'],
        },
    },
    {
        key: 'shadowsocks',
        label: 'Shadowsocks',
        legacyKeys: [],
        defaultSettings: {
            method: '2022-blake3-aes-256-gcm',
            password: '',
            network: 'tcp,udp',
            clients: [{
                method: '',
                password: '',
                email: '',
                limitIp: 0,
                totalGB: 0,
                expiryTime: 0,
                enable: true,
                tgId: '',
                subId: '',
                comment: '',
                reset: 0,
            }],
            ivCheck: false,
        },
        supports: {
            transports: ['tcp', 'ws', 'grpc', 'kcp', 'httpupgrade', 'xhttp'],
            securities: ['none', 'tls'],
            tlsTransports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
        },
    },
    {
        key: 'http',
        label: 'HTTP',
        legacyKeys: [],
        defaultSettings: {
            accounts: [{ user: '', pass: '' }],
            allowTransparent: false,
        },
        supports: {
            transports: ['tcp'],
            securities: ['none'],
        },
    },
    {
        key: 'tunnel',
        label: 'Tunnel',
        legacyKeys: ['dokodemo-door'],
        defaultSettings: {
            address: '',
            port: '',
            portMap: [],
            network: 'tcp,udp',
            followRedirect: false,
        },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'mixed',
        label: 'Mixed',
        legacyKeys: ['socks'],
        defaultSettings: {
            auth: 'password',
            accounts: [{ user: '', pass: '' }],
            udp: false,
            ip: '127.0.0.1',
        },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'wireguard',
        label: 'WireGuard',
        legacyKeys: [],
        defaultSettings: {
            mtu: 1420,
            secretKey: '',
            peers: [{ privateKey: '', publicKey: '', allowedIPs: ['10.0.0.2/32'], keepAlive: 0 }],
            noKernelTun: false,
        },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'tun',
        label: 'TUN',
        legacyKeys: [],
        defaultSettings: {
            name: 'xray0',
            mtu: 1500,
            userLevel: 0,
        },
        supports: {
            transports: [],
            securities: [],
        },
    },
];

const PROTOCOL_SCHEMA_MAP = new Map(PROTOCOL_SCHEMAS.map((item) => [item.key, item]));

function normalizeProtocolKey(input) {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return '';
    return LEGACY_PROTOCOL_ALIASES[raw] || raw;
}

function getProtocolSchema(input) {
    return PROTOCOL_SCHEMA_MAP.get(normalizeProtocolKey(input)) || null;
}

function canonicalizeProtocolList(values = []) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeProtocolKey(value))
            .filter(Boolean)
    ));
}

function buildProtocolSummary(input) {
    const schema = getProtocolSchema(input);
    if (!schema) {
        const key = normalizeProtocolKey(input);
        return {
            key,
            label: key ? key.toUpperCase() : '',
            legacyKeys: [],
        };
    }
    return {
        key: schema.key,
        label: schema.label,
        legacyKeys: schema.legacyKeys || [],
    };
}

export {
    LEGACY_PROTOCOL_ALIASES,
    PROTOCOL_SCHEMAS,
    buildProtocolSummary,
    canonicalizeProtocolList,
    getProtocolSchema,
    normalizeProtocolKey,
};
