import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLIENT_STATIC_OPTIONS,
    DEFAULT_MISSING_CLIENT_BUILD_MESSAGE,
    createClientBuildFallbackHandler,
    injectClientBasePath,
    normalizeClientBasePath,
    shouldServeCamouflageRequest,
    shouldServeClientRequest,
} from '../lib/clientBuild.js';

describe('createClientBuildFallbackHandler', () => {
    it('serves index.html with the injected site base path when the client build exists', () => {
        const calls = [];
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: true,
            getSiteAccessPath: () => '/portal',
            readClientIndexFile() {
                return '<html><head></head><body><div id="root"></div></body></html>';
            },
        });
        const res = {
            type(value) {
                calls.push(['type', value]);
                return this;
            },
            send(body) {
                calls.push(['send', body]);
                return this;
            },
        };

        handler({ path: '/portal' }, res, () => {
            throw new Error('next should not be called');
        });

        assert.equal(calls[0][0], 'type');
        assert.equal(calls[0][1], 'html');
        assert.match(calls[1][1], /window\.__NMS_SITE_BASE_PATH__="\/portal"/);
    });

    it('returns a 503 text response when the client build is missing', () => {
        const calls = [];
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: false,
        });
        const res = {
            status(code) {
                calls.push(['status', code]);
                return this;
            },
            type(value) {
                calls.push(['type', value]);
                return this;
            },
            send(body) {
                calls.push(['send', body]);
                return this;
            },
        };

        handler({}, res, () => {
            throw new Error('next should not be called');
        });

        assert.deepEqual(calls, [
            ['status', 503],
            ['type', 'text/plain'],
            ['send', DEFAULT_MISSING_CLIENT_BUILD_MESSAGE],
        ]);
    });

    it('re-checks the client build presence when supplied as a function', () => {
        const calls = [];
        let exists = false;
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: () => exists,
            readClientIndexFile() {
                return '<html><head></head><body></body></html>';
            },
        });
        const res = {
            status(code) {
                calls.push(['status', code]);
                return this;
            },
            type(value) {
                calls.push(['type', value]);
                return this;
            },
            send(body) {
                calls.push(['send', body]);
                return this;
            },
            type(value) {
                calls.push(['type', value]);
                return this;
            },
        };

        handler({ path: '/' }, res, () => {
            throw new Error('next should not be called');
        });

        exists = true;
        handler({ path: '/' }, res, () => {
            throw new Error('next should not be called');
        });

        assert.deepEqual(calls, [
            ['status', 503],
            ['type', 'text/plain'],
            ['send', DEFAULT_MISSING_CLIENT_BUILD_MESSAGE],
            ['type', 'html'],
            ['send', '<html><head><script>window.__NMS_SITE_BASE_PATH__="/";</script></head><body></body></html>'],
        ]);
    });

    it('skips client fallback for paths outside the configured access path', () => {
        let nextCalled = false;
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: true,
            getSiteAccessPath: () => '/secret',
            readClientIndexFile() {
                throw new Error('should not read index file');
            },
        });

        handler({
            path: '/',
        }, {
            type() {
                throw new Error('response should not be used');
            },
        }, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
    });

    it('serves the camouflage site for requests outside the configured access path when enabled', () => {
        const calls = [];
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: true,
            getSiteConfig: () => ({
                accessPath: '/portal',
                camouflageEnabled: true,
            }),
            readClientIndexFile() {
                throw new Error('should not read index file');
            },
        });
        const res = {
            type(value) {
                calls.push(['type', value]);
                return this;
            },
            send(body) {
                calls.push(['send', body]);
                return this;
            },
        };

        handler({ path: '/', method: 'GET' }, res, () => {
            throw new Error('next should not be called');
        });

        assert.equal(calls[0][1], 'html');
        assert.match(calls[1][1], /曜衡智能设备/);
        assert.doesNotMatch(calls[1][1], /window\.__NMS_SITE_BASE_PATH__/);
    });
});

describe('client build helpers', () => {
    it('normalizes client base paths', () => {
        assert.equal(normalizeClientBasePath('portal'), '/portal');
        assert.equal(normalizeClientBasePath('/portal/'), '/portal');
        assert.equal(normalizeClientBasePath(' /portal/team/ '), '/portal/team');
        assert.equal(normalizeClientBasePath('/'), '/');
        assert.equal(normalizeClientBasePath('/../bad', '/'), '/');
    });

    it('matches only requests inside a non-root base path', () => {
        assert.equal(shouldServeClientRequest('/secret', '/secret'), true);
        assert.equal(shouldServeClientRequest('/secret/clients', '/secret'), true);
        assert.equal(shouldServeClientRequest('/', '/secret'), false);
        assert.equal(shouldServeClientRequest('/assets/index.js', '/secret'), false);
    });

    it('only serves the camouflage page for document-like requests', () => {
        assert.equal(shouldServeCamouflageRequest({ method: 'GET', path: '/' }), true);
        assert.equal(shouldServeCamouflageRequest({ method: 'GET', path: '/landing' }), true);
        assert.equal(shouldServeCamouflageRequest({ method: 'GET', path: '/assets/main.js' }), false);
        assert.equal(shouldServeCamouflageRequest({ method: 'POST', path: '/' }), false);
    });

    it('injects the base-path bootstrap script into index html', () => {
        const output = injectClientBasePath('<html><head></head><body></body></html>', '/nms');
        assert.match(output, /window\.__NMS_SITE_BASE_PATH__="\/nms"/);
        assert.match(output, /<\/script><\/head>/);
    });

    it('disables static index auto-serving so root requests still honor the access-path gate', () => {
        assert.equal(CLIENT_STATIC_OPTIONS.index, false);
    });
});
