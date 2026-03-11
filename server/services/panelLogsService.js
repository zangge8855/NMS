import serverRepository from '../repositories/serverRepository.js';
import { createHttpError } from '../lib/httpError.js';
import { getAuthenticatedPanelClient } from './panelGateway.js';

const LOG_SOURCES = new Set(['panel', 'xray', 'system']);

function normalizeLogSource(value) {
    const text = String(value || '').trim().toLowerCase();
    return LOG_SOURCES.has(text) ? text : 'panel';
}

function normalizeLogCount(value, fallback = 100) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function isUnsupportedLogEndpoint(error) {
    const status = Number(error?.response?.status || 0);
    if ([400, 404, 405, 501].includes(status)) return true;
    const message = String(error?.response?.data?.msg || error?.message || '').toLowerCase();
    return message.includes('not found') || message.includes('not support') || message.includes('unsupported');
}

function extractLogLines(payload) {
    const raw = payload?.data?.obj ?? payload?.obj ?? payload;
    if (typeof raw === 'string') {
        return raw
            .split(/\r?\n/)
            .map((line) => String(line || '').trimEnd())
            .filter(Boolean);
    }
    if (Array.isArray(raw)) {
        return raw
            .map((line) => String(line || '').trimEnd())
            .filter(Boolean);
    }
    if (Array.isArray(raw?.lines)) {
        return raw.lines
            .map((line) => String(line || '').trimEnd())
            .filter(Boolean);
    }
    return [];
}

async function fetchLegacyLogLines(client, source, count) {
    const endpoint = source === 'system'
        ? '/server/api/server/log'
        : '/panel/api/server/log';
    const body = new URLSearchParams();
    body.append('count', String(count));
    const res = await client.post(endpoint, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return extractLogLines(res);
}

async function fetchServerLogPayload(serverId, options = {}, deps = {}) {
    const servers = deps.serverRepository || serverRepository;
    const getPanelClient = deps.getAuthenticatedPanelClient || getAuthenticatedPanelClient;
    const source = normalizeLogSource(options.source);
    const count = normalizeLogCount(options.count);
    const server = servers.getById(serverId);
    if (!server) {
        throw createHttpError(404, 'Server not found');
    }

    const client = await getPanelClient(serverId);

    if (source === 'panel') {
        try {
            const preferred = await client.get(`/panel/api/server/logs/${count}`);
            const preferredLines = extractLogLines(preferred);
            if (preferredLines.length === 0) {
                try {
                    const legacyLines = await fetchLegacyLogLines(client, 'panel', count);
                    if (legacyLines.length > 0) {
                        return {
                            serverId,
                            source,
                            supported: true,
                            lines: legacyLines,
                            warning: '当前节点回退旧版日志接口返回',
                            sourcePath: '/panel/api/server/log',
                        };
                    }
                } catch {
                    // Ignore legacy fallback errors when the preferred endpoint is reachable.
                }
            }
            return {
                serverId,
                source,
                supported: true,
                lines: preferredLines,
                warning: '',
                sourcePath: `/panel/api/server/logs/${count}`,
            };
        } catch (error) {
            if (!isUnsupportedLogEndpoint(error)) throw error;
            const lines = await fetchLegacyLogLines(client, 'panel', count);
            return {
                serverId,
                source,
                supported: true,
                lines,
                warning: '当前节点使用旧版日志接口兼容返回',
                sourcePath: '/panel/api/server/log',
            };
        }
    }

    if (source === 'xray') {
        try {
            const preferred = await client.get(`/panel/api/server/xraylogs/${count}`);
            return {
                serverId,
                source,
                supported: true,
                lines: extractLogLines(preferred),
                warning: '',
                sourcePath: `/panel/api/server/xraylogs/${count}`,
            };
        } catch (error) {
            if (!isUnsupportedLogEndpoint(error)) throw error;
            return {
                serverId,
                source,
                supported: false,
                lines: [],
                warning: '当前 3x-ui 版本不支持 Xray 日志接口',
                sourcePath: `/panel/api/server/xraylogs/${count}`,
            };
        }
    }

    const lines = await fetchLegacyLogLines(client, 'system', count);
    return {
        serverId,
        source,
        supported: true,
        lines,
        warning: '',
        sourcePath: '/server/api/server/log',
    };
}

export { fetchServerLogPayload, normalizeLogCount, normalizeLogSource };
