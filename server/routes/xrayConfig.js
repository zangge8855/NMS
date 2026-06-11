import { Router } from 'express';
import { toHttpError } from '../lib/httpError.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import {
    getXrayConfig,
    updateXrayConfigSection,
    SUPPORTED_WRITE_SECTIONS,
} from '../services/xrayConfigService.js';

const router = Router();

function summarizePayloadForAudit(section, payload) {
    if (section === 'routing') {
        return {
            rulesCount: Array.isArray(payload?.rules) ? payload.rules.length : 0,
            balancersCount: Array.isArray(payload?.balancers) ? payload.balancers.length : 0,
            domainStrategy: payload?.domainStrategy || '',
        };
    }
    if (section === 'outbounds') {
        return {
            count: Array.isArray(payload) ? payload.length : 0,
            tags: Array.isArray(payload) ? payload.slice(0, 10).map((item) => String(item?.tag || '').slice(0, 32)) : [],
        };
    }
    if (section === 'dns') {
        return {
            serversCount: Array.isArray(payload?.servers) ? payload.servers.length : 0,
            queryStrategy: payload?.queryStrategy || '',
        };
    }
    if (section === 'balancers') {
        return {
            count: Array.isArray(payload) ? payload.length : 0,
            tags: Array.isArray(payload) ? payload.slice(0, 10).map((item) => String(item?.tag || '').slice(0, 32)) : [],
        };
    }
    if (section === 'reverse') {
        return {
            bridgesCount: Array.isArray(payload?.bridges) ? payload.bridges.length : 0,
            portalsCount: Array.isArray(payload?.portals) ? payload.portals.length : 0,
        };
    }
    return {};
}

router.get('/:serverId/config', async (req, res) => {
    try {
        const result = await getXrayConfig(req.params.serverId);
        return res.json({ success: true, obj: result });
    } catch (error) {
        const httpError = toHttpError(error, 502, '读取 Xray 配置失败');
        return res.status(httpError.status).json({
            success: false,
            msg: httpError.message,
        });
    }
});

router.put('/:serverId/:section', async (req, res) => {
    const { serverId, section } = req.params;
    if (!SUPPORTED_WRITE_SECTIONS.has(section)) {
        return res.status(400).json({
            success: false,
            msg: `不支持的 Xray 配置段: ${section}`,
        });
    }

    try {
        const result = await updateXrayConfigSection(serverId, section, req.body);
        appendSecurityAudit(`xray_${section}_updated`, req, {
            serverId,
            section,
            ...summarizePayloadForAudit(section, req.body),
        });
        return res.json({
            success: true,
            obj: {
                serverId,
                section: result.section,
                snapshot: result.snapshot,
                source: result.source,
                // Return the full template so the client can refresh its editors'
                // baseline; otherwise the Log/Policy/Advanced editors keep the pre-save
                // template and re-saving from Advanced silently reverts the change.
                template: result.template,
            },
        });
    } catch (error) {
        appendSecurityAudit(`xray_${section}_update_failed`, req, {
            serverId,
            section,
            error: String(error?.message || error || '').slice(0, 200),
        });
        const httpError = toHttpError(error, 502, '更新 Xray 配置失败');
        return res.status(httpError.status).json({
            success: false,
            msg: httpError.message,
        });
    }
});

export default router;
