const LEGACY_PROTOCOL_ALIASES: Record<string, string> = {
    'dokodemo-door': 'tunnel',
    socks: 'mixed',
    hy2: 'hysteria2',
};

export interface ProtocolSchema {
    key: string;
    label: string;
    legacyKeys: string[];
    defaultSettings: Record<string, any>;
    supports: {
        transports: string[];
        securities: string[];
        tlsTransports?: string[];
        realityTransports?: string[];
    };
}

const BASE_CLIENT = {
    email: '',
    limitIp: 0,
    totalGB: 0,
    expiryTime: 0,
    enable: true,
    tgId: 0,
    subId: '',
    comment: '',
    reset: 0,
};

const PROTOCOL_SCHEMAS: ProtocolSchema[] = [
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
                tgId: 0,
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
                tgId: 0,
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
                tgId: 0,
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
                tgId: 0,
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
        key: 'hysteria2',
        label: 'Hysteria2',
        legacyKeys: ['hy2'],
        // 3x-ui 3.x: one protocol, version 2, client secret in `auth`;
        // obfuscation lives in streamSettings.finalmask, tuning in hysteriaSettings.
        defaultSettings: {
            version: 2,
            clients: [{ ...BASE_CLIENT, auth: '' }],
        },
        supports: {
            transports: ['hysteria'],
            securities: ['tls'],
        },
    },
    {
        key: 'hysteria',
        label: 'Hysteria',
        legacyKeys: [],
        defaultSettings: {
            version: 2,
            clients: [{ ...BASE_CLIENT, auth: '' }],
        },
        supports: {
            transports: ['hysteria'],
            securities: ['tls'],
        },
    },
    {
        key: 'tuic',
        label: 'TUIC',
        legacyKeys: [],
        defaultSettings: {
            server: {
                certificate: '',
                private_key: '',
                congestion_control: 'bbr',
                alpn: ['h3'],
                udp_relay_mode: 'native',
                zero_rtt_handshake: false,
                log_level: 'info',
                max_idle_time: 15,
                authentication_timeout: 3,
                max_udp_relay_packet_size: 1500,
                sni: '',
            },
            clients: [{ ...BASE_CLIENT, id: '', uuid: '', password: '' }],
        },
        supports: {
            transports: ['udp'],
            securities: ['tls'],
        },
    },
    {
        key: 'masque',
        label: 'MASQUE',
        legacyKeys: [],
        defaultSettings: {
            address: ['10.14.0.1/24', 'fd14::1/64'],
            clients: [{ ...BASE_CLIENT, password: '' }],
        },
        supports: {
            transports: ['masque'],
            securities: ['tls'],
        },
    },
    {
        key: 'wireguard',
        label: 'WireGuard',
        legacyKeys: [],
        // Clients get their keys and tunnel address from the panel's client endpoint.
        defaultSettings: {
            mtu: 1420,
            secretKey: '',
            peers: [],
            clients: [{ ...BASE_CLIENT }],
            noKernelTun: false,
            subnetIp: '10.0.0.0',
            subnetCidr: 24,
        },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'amneziawg',
        label: 'AmneziaWG',
        legacyKeys: [],
        defaultSettings: {
            server: {
                subnetIp: '10.8.1.0',
                subnetCidr: 24,
                primaryDns: '1.1.1.1',
                secondaryDns: '8.8.8.8',
                externalInterface: '',
                ipv6Enabled: false,
                ipv6Subnet: '',
                ipv6ExternalInterface: '',
                kernelMode: false,
                jc: 5,
                jmin: 10,
                jmax: 50,
                s1: 30,
                s2: 45,
                s3: 10,
                s4: 5,
            },
            clients: [{ ...BASE_CLIENT }],
        },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'mtproto',
        label: 'MTProto',
        legacyKeys: [],
        defaultSettings: {
            fakeTlsDomain: 'www.cloudflare.com',
            clients: [{ ...BASE_CLIENT, secret: '' }],
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
        key: 'http',
        label: 'HTTP',
        legacyKeys: [],
        defaultSettings: {
            accounts: [{ user: '', pass: '' }],
            allowTransparent: false,
        },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'tunnel',
        label: 'Tunnel',
        legacyKeys: ['dokodemo-door'],
        defaultSettings: {
            rewriteAddress: '',
            portMap: {},
            allowedNetwork: 'tcp,udp',
            followRedirect: false,
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

function normalizeProtocolKey(input: unknown): string {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return '';
    return LEGACY_PROTOCOL_ALIASES[raw] || raw;
}

function getProtocolSchema(input: unknown): ProtocolSchema | null {
    return PROTOCOL_SCHEMA_MAP.get(normalizeProtocolKey(input)) || null;
}

function canonicalizeProtocolList(values: unknown[] = []): string[] {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeProtocolKey(value))
            .filter(Boolean)
    ));
}

function buildProtocolSummary(input: unknown): { key: string; label: string; legacyKeys: string[] } {
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
