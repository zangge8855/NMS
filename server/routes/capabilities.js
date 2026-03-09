import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { buildProtocolSummary, canonicalizeProtocolList } from '../lib/protocolCatalog.js';

const router = Router();

const TOOL_CAPABILITIES = [
    {
        key: 'uuid',
        label: 'UUID',
        description: 'Generate VMess/VLESS UUID values from the node panel.',
        path: '/panel/api/server/getNewUUID',
        method: 'get',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        supportedByNms: true,
    },
    {
        key: 'x25519',
        label: 'X25519',
        description: 'Generate X25519 keys for REALITY transport settings.',
        path: '/panel/api/server/getNewX25519Cert',
        method: 'get',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        supportedByNms: true,
    },
    {
        key: 'mldsa65',
        label: 'ML-DSA-65',
        description: 'Generate ML-DSA-65 material for modern 3x-ui node crypto flows.',
        path: '/panel/api/server/getNewmldsa65',
        method: 'get',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        supportedByNms: true,
    },
    {
        key: 'mlkem768',
        label: 'ML-KEM-768',
        description: 'Generate ML-KEM-768 key material from the node panel.',
        path: '/panel/api/server/getNewmlkem768',
        method: 'get',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        supportedByNms: true,
    },
    {
        key: 'vlessEnc',
        label: 'VLESS Enc',
        description: 'Generate VLESS encryption material supported by the node panel.',
        path: '/panel/api/server/getNewVlessEnc',
        method: 'get',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        supportedByNms: true,
    },
    {
        key: 'echCert',
        label: 'ECH Cert',
        description: 'Generate ECH certificates when the node exposes the helper endpoint.',
        path: '/panel/api/server/getNewEchCert',
        method: 'post',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        supportedByNms: true,
    },
    {
        key: 'panelLogs',
        label: 'Panel Logs',
        description: 'Read panel logs from nodes that expose the 3x-ui log endpoint.',
        path: '/panel/api/server/logs/20',
        method: 'get',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Home',
        uiAction: 'logs',
        uiActionLabel: '日志中心',
        supportedByNms: true,
    },
    {
        key: 'xrayLogs',
        label: 'Xray Logs',
        description: 'Read xray logs from nodes that expose the xray log endpoint.',
        path: '/panel/api/server/xraylogs/20',
        method: 'get',
        probe: true,
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Home',
        uiAction: 'logs',
        uiActionLabel: '日志中心',
        supportedByNms: true,
    },
];

async function detectToolCapabilities(client) {
    const checks = await Promise.all(TOOL_CAPABILITIES.map(async (tool) => {
        if (!tool.probe) {
            return { ...tool, available: null, source: 'unprobed' };
        }

        try {
            await client({
                method: tool.method,
                url: tool.path,
                timeout: 10000,
            });
            return { ...tool, available: true, source: 'probed' };
        } catch {
            return { ...tool, available: false, source: 'probed' };
        }
    }));

    return checks.reduce((acc, item) => {
        acc[item.key] = {
            key: item.key,
            label: item.label,
            description: item.description,
            path: item.path,
            method: item.method,
            docs: item.docs,
            uiAction: item.uiAction,
            uiActionLabel: item.uiActionLabel,
            supportedBy3xui: true,
            supportedByNms: item.supportedByNms === true,
            status: item.supportedByNms === true ? 'integrated' : 'api_available_ui_missing',
            available: item.available,
            source: item.source,
        };
        return acc;
    }, {});
}

const SYSTEM_MODULES = [
    {
        key: 'xrayVersion',
        label: 'Xray Version Management',
        status: 'integrated',
        supportedBy3xui: true,
        supportedByNms: true,
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        note: 'Version list, install, and restart are exposed from the node control console.',
    },
    {
        key: 'xrayConfig',
        label: 'Xray Config Viewer',
        status: 'integrated',
        supportedBy3xui: true,
        supportedByNms: true,
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        note: 'NMS can open the current node config but does not edit private template internals.',
    },
    {
        key: 'databaseManagement',
        label: 'Database Management',
        status: 'integrated',
        supportedBy3xui: true,
        supportedByNms: true,
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        note: 'Export and import are supported on single-node scope only.',
    },
    {
        key: 'geofile',
        label: 'Geofile Update',
        status: 'integrated',
        supportedBy3xui: true,
        supportedByNms: true,
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        note: 'GeoIP and GeoSite update actions are integrated.',
    },
    {
        key: 'telegramBackup',
        label: 'Telegram Backup',
        status: 'integrated',
        supportedBy3xui: true,
        supportedByNms: true,
        uiAction: 'node_console',
        uiActionLabel: '节点控制台',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        note: 'NMS can trigger backup, but Telegram bot settings still stay in the panel.',
    },
    {
        key: 'telegramBot',
        label: 'Telegram Bot Settings',
        status: 'guided_only',
        supportedBy3xui: true,
        supportedByNms: false,
        uiAction: 'panel_only',
        uiActionLabel: '3x-ui 面板',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        note: 'Official panel workflow exists, but no stable documented write API is used by NMS.',
    },
    {
        key: 'panelWebBasePath',
        label: 'Panel Web Base Path',
        status: 'guided_only',
        supportedBy3xui: true,
        supportedByNms: false,
        uiAction: 'panel_only',
        uiActionLabel: '3x-ui 面板',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Configuration',
        note: 'Kept as guided-only until a reliable admin workflow is added to NMS.',
    },
    {
        key: 'panelCertificatePath',
        label: 'Panel Certificate Paths',
        status: 'guided_only',
        supportedBy3xui: true,
        supportedByNms: false,
        uiAction: 'panel_only',
        uiActionLabel: '3x-ui 面板',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/SSL-Certificate',
        note: 'Certificate path writes remain a panel-side workflow for now.',
    },
    {
        key: 'cloudflareWarp',
        label: 'Cloudflare WARP',
        status: 'guided_only',
        supportedBy3xui: true,
        supportedByNms: false,
        uiAction: 'docs_only',
        uiActionLabel: '官方文档',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Cloudflare-WARP',
        note: 'High-risk network changes stay documentation-guided in NMS.',
    },
    {
        key: 'fail2ban',
        label: 'Fail2Ban',
        status: 'guided_only',
        supportedBy3xui: true,
        supportedByNms: false,
        uiAction: 'docs_only',
        uiActionLabel: '官方文档',
        docs: 'https://github.com/MHSanaei/3x-ui/wiki/Fail2ban',
        note: 'System-level hardening is intentionally left to node operators.',
    },
];

function buildCapabilitiesPayload({
    serverId,
    status,
    inbounds = [],
    xrayVersions = [],
    tools = {},
}) {
    const protocols = canonicalizeProtocolList(
        (Array.isArray(inbounds) ? inbounds : []).map((item) => item?.protocol)
    ).sort();

    return {
        serverId,
        generatedAt: new Date().toISOString(),
        status: status || null,
        protocols,
        protocolDetails: protocols.map((item) => buildProtocolSummary(item)),
        versions: {
            xray: Array.isArray(xrayVersions) ? xrayVersions : [],
        },
        tools,
        systemModules: SYSTEM_MODULES,
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
    };
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

        return res.json({
            success: true,
            obj: buildCapabilitiesPayload({
                serverId,
                status: statusRes?.data?.obj || null,
                inbounds: inboundsRes?.data?.obj || [],
                xrayVersions: xrayVersionRes?.data?.obj || [],
                tools,
            }),
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
export {
    buildCapabilitiesPayload,
    detectToolCapabilities,
};
