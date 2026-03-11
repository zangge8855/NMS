import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchServerLogPayload } from '../services/panelLogsService.js';

describe('panelLogsService', () => {
    it('falls back to legacy panel log endpoint when preferred endpoint is unsupported', async () => {
        const calls = [];
        const client = {
            async get(url) {
                calls.push(['get', url]);
                const error = new Error('not found');
                error.response = { status: 404, data: { msg: 'not found' } };
                throw error;
            },
            async post(url, body) {
                calls.push(['post', url, body]);
                return { data: { obj: 'line-a\nline-b' } };
            },
        };

        const result = await fetchServerLogPayload('srv-1', { source: 'panel', count: 20 }, {
            serverRepository: { getById: () => ({ id: 'srv-1', name: 'srv-1' }) },
            getAuthenticatedPanelClient: async () => client,
        });

        assert.equal(result.supported, true);
        assert.equal(result.warning, '当前节点使用旧版日志接口兼容返回');
        assert.equal(result.sourcePath, '/panel/api/server/log');
        assert.deepEqual(result.lines, ['line-a', 'line-b']);
        assert.deepEqual(calls[0], ['get', '/panel/api/server/logs/20']);
        assert.deepEqual(calls[1], ['post', '/panel/api/server/log', 'count=20']);
    });

    it('returns unsupported payload for xray logs when endpoint is unavailable', async () => {
        const client = {
            async get() {
                const error = new Error('unsupported');
                error.response = { status: 404, data: { msg: 'unsupported' } };
                throw error;
            },
        };

        const result = await fetchServerLogPayload('srv-1', { source: 'xray', count: 10 }, {
            serverRepository: { getById: () => ({ id: 'srv-1', name: 'srv-1' }) },
            getAuthenticatedPanelClient: async () => client,
        });

        assert.equal(result.supported, false);
        assert.equal(result.warning, '当前 3x-ui 版本不支持 Xray 日志接口');
        assert.deepEqual(result.lines, []);
    });

    it('falls back to the legacy panel log endpoint when the preferred endpoint returns no lines', async () => {
        const calls = [];
        const client = {
            async get(url) {
                calls.push(['get', url]);
                return { data: { obj: { lines: [] } } };
            },
            async post(url, body) {
                calls.push(['post', url, body]);
                return { data: { obj: 'legacy-line-a\nlegacy-line-b' } };
            },
        };

        const result = await fetchServerLogPayload('srv-1', { source: 'panel', count: 20 }, {
            serverRepository: { getById: () => ({ id: 'srv-1', name: 'srv-1' }) },
            getAuthenticatedPanelClient: async () => client,
        });

        assert.equal(result.supported, true);
        assert.equal(result.warning, '当前节点回退旧版日志接口返回');
        assert.equal(result.sourcePath, '/panel/api/server/log');
        assert.deepEqual(result.lines, ['legacy-line-a', 'legacy-line-b']);
        assert.deepEqual(calls[0], ['get', '/panel/api/server/logs/20']);
        assert.deepEqual(calls[1], ['post', '/panel/api/server/log', 'count=20']);
    });
});
