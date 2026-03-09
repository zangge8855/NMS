import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { LEGACY_PROTOCOL_ALIASES, PROTOCOL_SCHEMAS } from '../lib/protocolCatalog.js';

const router = Router();

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
            canonicalization: {
                aliases: LEGACY_PROTOCOL_ALIASES,
            },
            protocols: PROTOCOL_SCHEMAS,
            clientFlowOptions: CLIENT_FLOW_OPTIONS,
            clientFlowProtocols: CLIENT_FLOW_PROTOCOLS,
            linkRequirements: LINK_REQUIREMENTS,
            streamDefaults: STREAM_DEFAULTS,
        },
    });
});

export default router;
