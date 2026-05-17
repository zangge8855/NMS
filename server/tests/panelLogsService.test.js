import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __testing, fetchServerLogPayload } from '../services/panelLogsService.js';

describe('panelLogsService', () => {
    it('uses current POST panel log endpoints before legacy fallbacks', async () => {
        const calls = [];
        const client = {
            async post(url) {
                calls.push(['post', url]);
                return { data: { obj: { lines: ['line-a', 'line-b'] } } };
            },
        };

        const result = await fetchServerLogPayload('srv-1', { source: 'panel', count: 20 }, {
            serverRepository: { getById: () => ({ id: 'srv-1', name: 'srv-1' }) },
            getAuthenticatedPanelClient: async () => client,
        });

        assert.equal(result.supported, true);
        assert.equal(result.warning, '');
        assert.equal(result.sourcePath, '/panel/api/server/logs/20');
        assert.deepEqual(result.lines, ['line-a', 'line-b']);
        assert.deepEqual(calls, [['post', '/panel/api/server/logs/20']]);
    });

    it('falls back to legacy panel log endpoint when preferred endpoint is unsupported', async () => {
        const calls = [];
        const client = {
            async post(url, body) {
                calls.push(['post', url, body]);
                if (url === '/panel/api/server/log') {
                    return { data: { obj: 'line-a\nline-b' } };
                }
                const error = new Error('not found');
                error.response = { status: 404, data: { msg: 'not found' } };
                throw error;
            },
            async get(url) {
                calls.push(['get', url]);
                const error = new Error('not found');
                error.response = { status: 404, data: { msg: 'not found' } };
                throw error;
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
        assert.deepEqual(calls[0], ['post', '/panel/api/server/logs/20', undefined]);
        assert.deepEqual(calls[1], ['get', '/panel/api/server/logs/20']);
        assert.deepEqual(calls[2], ['post', '/panel/api/server/log', 'count=20']);
    });

    it('returns unsupported payload for xray logs when endpoint is unavailable', async () => {
        const client = {
            async post() {
                const error = new Error('unsupported');
                error.response = { status: 404, data: { msg: 'unsupported' } };
                throw error;
            },
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
            async post(url, body) {
                calls.push(['post', url, body]);
                if (url === '/panel/api/server/logs/20') {
                    return { data: { obj: { lines: [] } } };
                }
                return { data: { obj: 'legacy-line-a\nlegacy-line-b' } };
            },
            async get(url) {
                calls.push(['get', url]);
                return { data: { obj: { lines: [] } } };
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
        assert.deepEqual(calls[0], ['post', '/panel/api/server/logs/20', undefined]);
        assert.deepEqual(calls[1], ['post', '/panel/api/server/log', 'count=20']);
    });

    it('falls back to older GET log endpoints when current POST endpoints are unsupported', async () => {
        const calls = [];
        const client = {
            async post(url) {
                calls.push(['post', url]);
                const error = new Error('method not allowed');
                error.response = { status: 405, data: { msg: 'method not allowed' } };
                throw error;
            },
            async get(url) {
                calls.push(['get', url]);
                return { data: { obj: { lines: ['legacy-get-line'] } } };
            },
        };

        const result = await fetchServerLogPayload('srv-1', { source: 'panel', count: 20 }, {
            serverRepository: { getById: () => ({ id: 'srv-1', name: 'srv-1' }) },
            getAuthenticatedPanelClient: async () => client,
        });

        assert.equal(result.supported, true);
        assert.equal(result.warning, '当前节点使用旧版 GET 日志接口兼容返回');
        assert.equal(result.sourcePath, '/panel/api/server/logs/20');
        assert.deepEqual(result.lines, ['legacy-get-line']);
        assert.deepEqual(calls, [
            ['post', '/panel/api/server/logs/20'],
            ['get', '/panel/api/server/logs/20'],
        ]);
    });

    it('formats structured xray log entries into readable lines', () => {
        const lines = __testing.extractLogLines({
            data: {
                obj: [{
                    DateTime: '2026-05-17T10:00:00Z',
                    FromAddress: '1.1.1.1:1234',
                    ToAddress: 'example.com:443',
                    Inbound: 'inbound-443',
                    Outbound: 'proxy',
                    Email: 'alice@example.com',
                    Event: 2,
                }],
            },
        });

        assert.deepEqual(lines, [
            '2026-05-17T10:00:00Z FROM=1.1.1.1:1234 TO=example.com:443 INBOUND=inbound-443 OUTBOUND=proxy EMAIL=alice@example.com EVENT=2',
        ]);
    });
});
