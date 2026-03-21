import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLIENT_STATIC_OPTIONS,
    DEFAULT_MISSING_CLIENT_BUILD_MESSAGE,
    createClientBuildFallbackHandler,
    createClientStaticHandler,
    injectClientBasePath,
    normalizeClientBasePath,
    rewriteClientAssetPaths,
    stripClientBasePath,
    shouldServeCamouflageRequest,
    shouldServeClientRequest,
} from '../lib/clientBuild.js';
import { createSiteCamouflageHtml } from '../lib/siteCamouflage.js';

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

    it('skips the SPA fallback for requests outside the configured access path', () => {
        let nextCalled = false;
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: true,
            getSiteConfig: () => ({
                accessPath: '/portal',
            }),
            readClientIndexFile() {
                throw new Error('should not read index file');
            },
        });

        handler({ path: '/', method: 'GET' }, {}, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
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

    it('strips the configured base path from client asset requests', () => {
        assert.equal(stripClientBasePath('/portal/assets/index.js', '/portal'), '/assets/index.js');
        assert.equal(stripClientBasePath('/portal', '/portal'), '/');
        assert.equal(stripClientBasePath('/other', '/portal'), null);
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

    it('rewrites client asset urls under a non-root access path', () => {
        const output = rewriteClientAssetPaths('<link href=\"/assets/index.css\"><script src=\"/assets/index.js\"></script>', '/portal');
        assert.match(output, /href=\"\/portal\/assets\/index\.css\"/);
        assert.match(output, /src=\"\/portal\/assets\/index\.js\"/);
    });

    it('disables static index auto-serving so root requests still honor the access-path gate', () => {
        assert.equal(CLIENT_STATIC_OPTIONS.index, false);
    });

    it('only serves static assets when they are requested under the configured access path', () => {
        const calls = [];
        const handler = createClientStaticHandler({
            clientBuild: '/tmp/client/dist',
            getSiteConfig: () => ({
                accessPath: '/portal',
            }),
        });

        handler({
            path: '/other/assets/index.js',
            url: '/other/assets/index.js',
        }, {}, () => {
            calls.push('next');
        });

        assert.deepEqual(calls, ['next']);
    });

    it('renders the camouflage site with browser-language switching support', () => {
        const html = createSiteCamouflageHtml({
            siteConfig: {
                camouflageTemplate: 'corporate',
                camouflageTitle: 'Edge Precision Systems',
            },
            requestPath: '/',
            statusCode: 200,
        });
        assert.match(html, /Edge Precision Systems/);
        assert.match(html, /中文/);
        assert.match(html, /English/);
        assert.match(html, /智能视觉设备/);
        assert.match(html, /产品矩阵/);
        assert.match(html, /在线检测单元/);
        assert.match(html, /data:image\/svg\+xml;base64,/);
        assert.match(html, /项目经验|Track record/);
        assert.match(html, /中国|China/);
        assert.match(html, /site_lang_pref/);
        assert.doesNotMatch(html, /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏/);
        assert.doesNotMatch(html, /公开站点壳层|当前页面仅保留最小公开信息/);
        assert.doesNotMatch(html, /目录状态 200/);
        assert.doesNotMatch(html, /nms_camouflage_lang/i);
        assert.doesNotMatch(html, /pexels\.com/i);
    });
});
