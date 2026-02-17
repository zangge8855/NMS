import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { ensureAuthenticated } from '../lib/panelClient.js';

const router = Router();

const TOOL_CAPABILITIES = [
    { key: 'uuid', path: '/panel/api/server/getNewUUID', method: 'get', probe: true },
    { key: 'x25519', path: '/panel/api/server/getNewX25519Cert', method: 'get', probe: true },
    { key: 'mldsa65', path: '/panel/api/server/getNewmldsa65', method: 'get', probe: true },
    { key: 'mlkem768', path: '/panel/api/server/getNewmlkem768', method: 'get', probe: true },
    { key: 'vlessEnc', path: '/panel/api/server/getNewVlessEnc', method: 'get', probe: true },
    { key: 'echCert', path: '/panel/api/server/getNewEchCert', method: 'post', probe: true },
];

async function detectToolCapabilities(client) {
    const checks = await Promise.all(TOOL_CAPABILITIES.map(async (tool) => {
        if (!tool.probe) {
            return { key: tool.key, available: null, source: 'unprobed' };
        }

        try {
            await client({
                method: tool.method,
                url: tool.path,
                timeout: 10000,
            });
            return { key: tool.key, available: true, source: 'probed' };
        } catch {
            return { key: tool.key, available: false, source: 'probed' };
        }
    }));

    return checks.reduce((acc, item) => {
        acc[item.key] = {
            available: item.available,
            source: item.source,
        };
        return acc;
    }, {});
}

router.use(authMiddleware);

router.get('/:serverId', async (req, res) => {
    try {
        const { serverId } = req.params;
        const client = await ensureAuthenticated(serverId);

        const [statusRes, inboundsRes, xrayVersionRes, tools] = await Promise.all([
            client.get('/panel/api/server/status').catch(() => null),
            client.get('/panel/api/inbounds/list').catch(() => null),
            client.get('/panel/api/server/getXrayVersion').catch(() => null),
            detectToolCapabilities(client),
        ]);

        const inbounds = inboundsRes?.data?.obj || [];
        const protocols = Array.from(new Set(
            inbounds
                .map((item) => String(item.protocol || '').toLowerCase())
                .filter(Boolean)
        )).sort();

        return res.json({
            success: true,
            obj: {
                serverId,
                generatedAt: new Date().toISOString(),
                status: statusRes?.data?.obj || null,
                protocols,
                versions: {
                    xray: xrayVersionRes?.data?.obj || [],
                },
                tools,
                systemModules: [
                    {
                        key: 'ssl',
                        label: 'SSL Certificate',
                        mode: 'guided',
                        docs: 'https://github.com/MHSanaei/3x-ui/wiki/SSL-Certificate',
                    },
                    {
                        key: 'fail2ban',
                        label: 'Fail2Ban',
                        mode: 'guided',
                        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Fail2ban',
                    },
                    {
                        key: 'warp',
                        label: 'Cloudflare WARP',
                        mode: 'guided',
                        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Cloudflare-WARP',
                    },
                    {
                        key: 'tor',
                        label: 'TOR Proxy',
                        mode: 'guided',
                        docs: 'https://github.com/MHSanaei/3x-ui/wiki/TOR-Proxy',
                    },
                    {
                        key: 'reverseProxy',
                        label: 'Reverse Proxy',
                        mode: 'guided',
                        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Reverse-Proxy',
                    },
                    {
                        key: 'environment',
                        label: 'Environment Variables',
                        mode: 'guided',
                        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Environment-Variables',
                    },
                ],
                batchActions: {
                    clients: ['add', 'update', 'enable', 'disable', 'delete'],
                    inbounds: ['add', 'update', 'enable', 'disable', 'delete', 'resetTraffic'],
                },
                nodeGovernance: {
                    fields: ['group', 'tags', 'environment', 'health'],
                    environments: ['production', 'staging', 'development', 'testing', 'dr', 'sandbox', 'unknown'],
                    healthStates: ['unknown', 'healthy', 'degraded', 'unreachable', 'maintenance'],
                },
                subscriptionModes: ['auto', 'native', 'reconstructed'],
            },
        });
    } catch (error) {
        if (String(error.message || '').toLowerCase().includes('server not found')) {
            return res.status(404).json({
                success: false,
                msg: 'Server not found',
            });
        }
        return res.status(500).json({
            success: false,
            msg: `Failed to detect capabilities: ${error.message}`,
        });
    }
});

export default router;
