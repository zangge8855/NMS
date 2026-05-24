import { ensureAuthenticated, normalizePanelErrorMessage } from '../lib/panelClient.js';

const XRAY_SECTION_KEYS = new Set([
    'routing',
    'outbounds',
    'inbounds',
    'dns',
    'log',
    'api',
    'policy',
    'transport',
    'stats',
    'reverse',
    'fakedns',
    'metrics',
    'observatory',
    'burstObservatory',
]);

const SUPPORTED_WRITE_SECTIONS = new Set(['routing', 'outbounds', 'dns', 'balancers', 'reverse', 'template', 'log', 'policy']);

function parseJsonTemplate(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function buildXrayConfigSnapshot(template) {
    const config = template || {};
    return {
        routing: config.routing && typeof config.routing === 'object' ? config.routing : { rules: [], balancers: [] },
        outbounds: Array.isArray(config.outbounds) ? config.outbounds : [],
        dns: config.dns && typeof config.dns === 'object' ? config.dns : null,
        balancers: Array.isArray(config?.routing?.balancers) ? config.routing.balancers : [],
        reverse: config.reverse && typeof config.reverse === 'object' ? config.reverse : null,
    };
}

async function fetchPanelSettings(client) {
    const directAttempts = [
        { method: 'get', url: '/panel/xray/getXrayConfig' },
        { method: 'get', url: '/panel/setting/all' },
        { method: 'post', url: '/panel/setting/all', data: '' },
    ];

    let lastError = null;
    for (const attempt of directAttempts) {
        try {
            const res = await client({
                method: attempt.method,
                url: attempt.url,
                data: attempt.data,
                headers: attempt.method === 'post' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
                timeout: 15_000,
            });
            const payload = res?.data;
            if (payload && typeof payload === 'object') {
                return payload;
            }
        } catch (err) {
            lastError = err;
            const status = Number(err?.response?.status || 0);
            if (status >= 400 && status < 500 && status !== 404 && status !== 405) {
                throw err;
            }
        }
    }

    if (lastError) {
        throw lastError;
    }
    throw new Error('Panel settings endpoint did not return a valid payload');
}

function extractTemplateConfig(payload) {
    if (!payload) return null;
    const obj = payload?.obj && typeof payload.obj === 'object' ? payload.obj : payload;

    if (obj?.xrayTemplateConfig !== undefined) {
        return {
            template: parseJsonTemplate(obj.xrayTemplateConfig),
            rawSettings: obj,
            source: 'xrayTemplateConfig',
        };
    }

    if (obj?.xrayConfig !== undefined) {
        return {
            template: parseJsonTemplate(obj.xrayConfig),
            rawSettings: obj,
            source: 'xrayConfig',
        };
    }

    if (obj && (Array.isArray(obj.outbounds) || obj.routing)) {
        return {
            template: obj,
            rawSettings: null,
            source: 'inline',
        };
    }

    return { template: null, rawSettings: obj, source: 'unknown' };
}

export async function getXrayConfig(serverId) {
    const client = await ensureAuthenticated(serverId);
    const payload = await fetchPanelSettings(client);
    const extracted = extractTemplateConfig(payload);

    if (!extracted?.template) {
        const message = payload?.msg ? `面板返回但未识别 Xray 模板配置: ${payload.msg}` : '无法解析 Xray 模板配置';
        throw new Error(message);
    }

    const snapshot = buildXrayConfigSnapshot(extracted.template);
    return {
        serverId,
        source: extracted.source,
        snapshot,
        template: extracted.template,
        rawSettings: extracted.rawSettings,
    };
}

function ensureApiRuleFirst(rules = []) {
    const list = Array.isArray(rules) ? rules : [];
    const apiIndex = list.findIndex((rule) => {
        if (!rule || typeof rule !== 'object') return false;
        if (Array.isArray(rule.inboundTag) && rule.inboundTag.includes('api')) return true;
        if (rule.inboundTag === 'api') return true;
        if (rule.outboundTag === 'api') return true;
        return false;
    });
    if (apiIndex <= 0) return list;
    const reordered = list.slice();
    const [apiRule] = reordered.splice(apiIndex, 1);
    return [apiRule, ...reordered];
}

function mergeRoutingSection(template, payload) {
    const current = template.routing && typeof template.routing === 'object' ? template.routing : {};
    const incomingRules = Array.isArray(payload?.rules) ? payload.rules : current.rules || [];
    const incomingBalancers = Array.isArray(payload?.balancers) ? payload.balancers : current.balancers || [];

    const nextRules = ensureApiRuleFirst(incomingRules);
    return {
        ...current,
        domainStrategy: payload?.domainStrategy ?? current.domainStrategy,
        domainMatcher: payload?.domainMatcher ?? current.domainMatcher,
        rules: nextRules,
        balancers: incomingBalancers,
    };
}

function mergeOutboundsSection(_template, payload) {
    if (!Array.isArray(payload)) {
        throw new Error('outbounds payload must be an array');
    }
    return payload;
}

function mergeDnsSection(template, payload) {
    if (payload === null) return null;
    const current = template.dns && typeof template.dns === 'object' ? template.dns : {};
    return {
        ...current,
        ...(payload && typeof payload === 'object' ? payload : {}),
    };
}

function mergeBalancersSection(template, payload) {
    if (!Array.isArray(payload)) {
        throw new Error('balancers payload must be an array');
    }
    const current = template.routing && typeof template.routing === 'object' ? template.routing : {};
    return {
        ...current,
        balancers: payload,
    };
}

function mergeReverseSection(_template, payload) {
    if (payload === null) return null;
    if (!payload || typeof payload !== 'object') {
        throw new Error('reverse payload must be an object');
    }
    return payload;
}

function applySectionUpdate(template, section, payload) {
    if (section === 'template') {
        return payload;
    }
    const next = { ...template };
    if (section === 'routing') {
        next.routing = mergeRoutingSection(next, payload);
    } else if (section === 'outbounds') {
        next.outbounds = mergeOutboundsSection(next, payload);
    } else if (section === 'dns') {
        next.dns = mergeDnsSection(next, payload);
    } else if (section === 'balancers') {
        const routing = mergeBalancersSection(next, payload);
        next.routing = routing;
    } else if (section === 'reverse') {
        next.reverse = mergeReverseSection(next, payload);
    } else if (section === 'log') {
        next.log = payload;
    } else if (section === 'policy') {
        next.policy = payload;
    } else {
        throw new Error(`Unsupported section: ${section}`);
    }
    return next;
}

async function persistTemplate(client, source, rawSettings, nextTemplate) {
    const serialized = JSON.stringify(nextTemplate);

    if (source === 'inline') {
        const res = await client({
            method: 'post',
            url: '/panel/xray/updateXrayConfig',
            data: { xrayConfig: serialized },
            timeout: 15_000,
        });
        if (res?.data && res.data.success === false) {
            throw new Error(normalizePanelErrorMessage({ response: res }, '更新失败'));
        }
        return res?.data;
    }

    const formBody = new URLSearchParams();
    const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const passthroughKeys = new Set(Object.keys(settings).filter((key) => !XRAY_SECTION_KEYS.has(key)));
    for (const key of passthroughKeys) {
        const value = settings[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'object') {
            formBody.append(key, JSON.stringify(value));
        } else {
            formBody.append(key, String(value));
        }
    }
    formBody.set(source, serialized);

    const res = await client({
        method: 'post',
        url: '/panel/setting/update',
        data: formBody.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
    });

    if (res?.data && res.data.success === false) {
        throw new Error(normalizePanelErrorMessage({ response: res }, '更新失败'));
    }
    return res?.data;
}

export async function updateXrayConfigSection(serverId, section, payload) {
    if (!SUPPORTED_WRITE_SECTIONS.has(section)) {
        const supported = Array.from(SUPPORTED_WRITE_SECTIONS).join(', ');
        const error = new Error(`Unsupported xray section: ${section} (supported: ${supported})`);
        error.status = 400;
        throw error;
    }

    const client = await ensureAuthenticated(serverId);
    const payloadEnvelope = await fetchPanelSettings(client);
    const extracted = extractTemplateConfig(payloadEnvelope);

    if (!extracted?.template) {
        const message = payloadEnvelope?.msg
            ? `面板返回但未识别 Xray 模板配置: ${payloadEnvelope.msg}`
            : '无法解析 Xray 模板配置';
        throw new Error(message);
    }

    const nextTemplate = applySectionUpdate(extracted.template, section, payload);
    await persistTemplate(client, extracted.source, extracted.rawSettings, nextTemplate);

    return {
        serverId,
        section,
        snapshot: buildXrayConfigSnapshot(nextTemplate),
        template: nextTemplate,
        source: extracted.source,
    };
}

export {
    SUPPORTED_WRITE_SECTIONS,
    XRAY_SECTION_KEYS,
    applySectionUpdate,
    buildXrayConfigSnapshot,
    ensureApiRuleFirst,
    extractTemplateConfig,
};
