import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const PROTOCOL_SCHEMAS = [
    {
        key: 'vmess',
        label: 'VMess',
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
        defaultSettings: { accounts: [{ user: '', pass: '' }], allowTransparent: false },
        supports: {
            transports: ['tcp'],
            securities: ['none'],
        },
    },
    {
        key: 'tunnel',
        label: 'Tunnel',
        defaultSettings: { address: '', port: '', portMap: [], network: 'tcp,udp', followRedirect: false },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'mixed',
        label: 'Mixed',
        defaultSettings: { auth: 'password', accounts: [{ user: '', pass: '' }], udp: false, ip: '127.0.0.1' },
        supports: {
            transports: [],
            securities: [],
        },
    },
    {
        key: 'wireguard',
        label: 'WireGuard',
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
        defaultSettings: { name: 'xray0', mtu: 1500, userLevel: 0 },
        supports: {
            transports: [],
            securities: [],
        },
    },
];

const CLIENT_FLOW_OPTIONS = ['', 'xtls-rprx-vision', 'xtls-rprx-vision-udp443'];
const CLIENT_FLOW_PROTOCOLS = ['vless'];

const LINK_REQUIREMENTS = {
    vmess: {
        required: ['uuid', 'host', 'port', 'network'],
    },
    vless: {
        required: ['uuid', 'host', 'port', 'type', 'encryption'],
        realityRequired: ['security=reality', 'sni', 'pbk', 'fp'],
        recommended: ['sid', 'spx', 'flow=xtls-rprx-vision'],
    },
    trojan: {
        required: ['password', 'host', 'port', 'type'],
        tlsRequired: ['security=tls', 'sni'],
        realityRequired: ['security=reality', 'sni', 'pbk', 'fp'],
    },
    shadowsocks: {
        required: ['method', 'password', 'host', 'port'],
    },
};

const STREAM_DEFAULTS = {
    network: 'tcp',
    security: 'none',
    externalProxy: [],
    tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
};

router.use(authMiddleware);

router.get('/', (req, res) => {
    return res.json({
        success: true,
        obj: {
            generatedAt: new Date().toISOString(),
            protocols: PROTOCOL_SCHEMAS,
            clientFlowOptions: CLIENT_FLOW_OPTIONS,
            clientFlowProtocols: CLIENT_FLOW_PROTOCOLS,
            linkRequirements: LINK_REQUIREMENTS,
            streamDefaults: STREAM_DEFAULTS,
        },
    });
});

export default router;
