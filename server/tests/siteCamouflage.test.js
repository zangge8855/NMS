import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CAMOUFLAGE_TEMPLATE_IDS,
    createCamouflageAssetMiddleware,
    createSiteCamouflageHtml,
    getCamouflageRuntime,
    renderCamouflageResponse,
    resolveCamouflageAsset,
} from '../lib/siteCamouflage.js';
import { CAMOUFLAGE_CONTENT } from '../lib/camouflageContent.js';
import { createCamouflageNotFoundMiddleware } from '../middleware/siteCamouflage.js';

const FORBIDDEN_PUBLIC_CONTENT = /\b(?:nms|subscription|node|server|panel|audit|proxy|xray|token|admin|inbound|telegram|3x-ui|x-ui|edge\s+precision\s+systems|precision\s+systems)\b|订阅|节点|面板|审计|代理|入站|后台|运维|服务器|真实入口|访问路径/i;
const LEGACY_SHELL_COPY = /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏|状态码|目录状态|公开站点壳层|当前页面仅保留最小公开信息|PUBLIC SITE|ACCESS NOTICE|STATUS UPDATE/i;

function collectSitePaths(template) {
    const content = CAMOUFLAGE_CONTENT[template];
    return [
        '/',
        '/archive',
        '/about',
        ...content.sections.map((section) => `/section/${section.en.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`),
        ...content.articles.map((article) => `${content.articleBase}/${article.slug}`),
    ];
}

function createResponseRecorder() {
    const headers = new Map();
    const calls = [];
    return {
        headers,
        calls,
        res: {
            setHeader(name, value) { headers.set(name, value); },
            removeHeader(name) { headers.delete(name); },
            status(code) { calls.push(['status', code]); return this; },
            type(value) { calls.push(['type', value]); return this; },
            send(body) { calls.push(['send', body]); return this; },
            redirect(code, location) { calls.push(['redirect', code, location]); return this; },
        },
    };
}

describe('site camouflage renderer', () => {
    it('renders every route of every template as clean, bilingual editorial pages', () => {
        const runtime = getCamouflageRuntime();
        for (const template of CAMOUFLAGE_TEMPLATE_IDS) {
            for (const path of collectSitePaths(template)) {
                const result = renderCamouflageResponse({
                    siteConfig: { camouflageTemplate: template, camouflageTitle: 'Willow City Weekly' },
                    requestPath: path,
                });
                assert.equal(result.status, 200, `${template} ${path}`);
                assert.match(result.contentType, /^text\/html/);
                assert.match(result.body, /Willow City Weekly/);
                assert.match(result.body, /中文/);
                assert.match(result.body, /English/);
                assert.match(result.body, /city_lang_pref/);
                assert.match(result.body, new RegExp(`page-${runtime.classSuffix}`));
                assert.doesNotMatch(result.body, FORBIDDEN_PUBLIC_CONTENT, `${template} ${path}`);
                assert.doesNotMatch(result.body, LEGACY_SHELL_COPY, `${template} ${path}`);
                assert.doesNotMatch(result.body, /pexels\.com|\.example\b/i);
            }
        }
    });

    it('renders template specific home pages with dated articles', () => {
        const now = new Date(Date.UTC(2026, 10, 11, 12));
        const magazine = createSiteCamouflageHtml({ siteConfig: { camouflageTemplate: 'corporate' }, requestPath: '/', now });
        assert.match(magazine, /城市漫游志/);
        assert.match(magazine, /雨后街区的慢早餐/);
        assert.match(magazine, /\/stories\/slow-breakfast-after-rain/);
        assert.match(magazine, /\/media\/slow-breakfast-after-rain\.svg/);
        assert.match(magazine, /2026年11月/);

        const blog = createSiteCamouflageHtml({ siteConfig: { camouflageTemplate: 'blog' }, requestPath: '/', now });
        assert.match(blog, /街头影像/);
        assert.match(blog, /Street Photo Notes/);
        assert.match(blog, /白墙前的傍晚/);
        assert.match(blog, /\/posts\/evening-by-a-white-wall/);

        const guide = createSiteCamouflageHtml({ siteConfig: { camouflageTemplate: 'nginx' }, requestPath: '/', now });
        assert.match(guide, /周末城市指南|Weekend City Guide/);
        assert.match(guide, /11月14日 – 15日/);
        assert.match(guide, /窗边热饮/);
        assert.match(guide, /\/guides\/riverside-weekend-market/);
    });

    it('keeps article dates stable within a week and never in the future', () => {
        const monday = new Date(Date.UTC(2026, 10, 9, 0, 30));
        const sunday = new Date(Date.UTC(2026, 10, 15, 23, 0));
        const pick = (now) => /datetime="(\d{4}-\d{2}-\d{2})"/.exec(createSiteCamouflageHtml({ requestPath: '/archive', now }))[1];
        assert.ok(pick(monday) <= '2026-11-09');
        const midweek = new Date(Date.UTC(2026, 10, 13, 12));
        assert.equal(pick(midweek), pick(sunday));
    });

    it('returns a themed 404 page without echoing the requested path', () => {
        const result = renderCamouflageResponse({
            siteConfig: { camouflageTemplate: 'blog', camouflageTitle: 'Willow City Weekly' },
            requestPath: '/wp-admin/setup-config.php',
        });
        assert.equal(result.status, 404);
        assert.match(result.body, /页面不存在/);
        assert.match(result.body, /Page not found/);
        assert.match(result.body, /href="\/archive"/);
        assert.doesNotMatch(result.body, /wp-admin|setup-config/);
        assert.doesNotMatch(result.body, FORBIDDEN_PUBLIC_CONTENT);
    });

    it('publishes an RSS feed and sitemap with absolute urls', () => {
        const feed = renderCamouflageResponse({ siteConfig: { camouflageTemplate: 'corporate' }, requestPath: '/feed.xml', origin: 'https://example.org' });
        assert.equal(feed.status, 200);
        assert.match(feed.contentType, /application\/rss\+xml/);
        assert.match(feed.body, /<rss version="2.0">/);
        assert.match(feed.body, /<link>https:\/\/example\.org\/stories\/slow-breakfast-after-rain<\/link>/);

        const sitemap = renderCamouflageResponse({ siteConfig: { camouflageTemplate: 'nginx' }, requestPath: '/sitemap.xml', origin: 'https://example.org' });
        assert.equal(sitemap.status, 200);
        assert.match(sitemap.body, /<loc>https:\/\/example\.org\/guides\/the-hill-path-loop<\/loc>/);
        assert.doesNotMatch(feed.body + sitemap.body, FORBIDDEN_PUBLIC_CONTENT);
    });

    it('replaces legacy and technical camouflage titles with the default title', () => {
        for (const title of ['Edge Precision Systems', 'NMS Portal', 'Xray Proxy Server', '节点面板', '运维后台', '订阅管理系统']) {
            const html = createSiteCamouflageHtml({
                siteConfig: { camouflageTemplate: 'corporate', camouflageTitle: title },
                requestPath: '/',
            });
            assert.match(html, /City Field Notes/);
            assert.doesNotMatch(html, new RegExp(title, 'i'));
            assert.doesNotMatch(html, FORBIDDEN_PUBLIC_CONTENT);
        }
    });

    it('falls back to the magazine template for unknown template values', () => {
        const html = createSiteCamouflageHtml({ siteConfig: { camouflageTemplate: 'unknown' }, requestPath: '/' });
        assert.match(html, /城市漫游志/);
    });

    it('ships system-adaptive light and dark theme styles for every template', () => {
        for (const template of CAMOUFLAGE_TEMPLATE_IDS) {
            const html = createSiteCamouflageHtml({ siteConfig: { camouflageTemplate: template }, requestPath: '/' });
            assert.match(html, /color-scheme:\s*light dark/);
            assert.match(html, /@media\s*\(prefers-color-scheme:\s*dark\)/);
            assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme:\s*light\)"/);
            assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme:\s*dark\)"/);
            assert.match(html, /--image-scrim:/);
        }
    });

    it('renders artwork and favicons as svg media', () => {
        for (const template of CAMOUFLAGE_TEMPLATE_IDS) {
            for (const article of CAMOUFLAGE_CONTENT[template].articles) {
                const asset = resolveCamouflageAsset({ camouflageTemplate: template }, `/media/${article.slug}.svg`);
                assert.ok(asset, `${template} ${article.slug}`);
                assert.equal(asset.contentType, 'image/svg+xml');
                assert.match(asset.body, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
            }
        }
        assert.match(resolveCamouflageAsset({ camouflageTitle: 'Willow' }, '/favicon.ico').body, />W<\/text>/);
        assert.equal(resolveCamouflageAsset({ camouflageTemplate: 'blog' }, '/media/unknown.svg'), null);
    });
});

describe('camouflage middleware', () => {
    it('serves generated media with static cache headers when camouflage is enabled', () => {
        const middleware = createCamouflageAssetMiddleware({ getSiteConfig: () => ({ camouflageEnabled: true, camouflageTemplate: 'blog' }) });
        const { headers, calls, res } = createResponseRecorder();
        headers.set('X-Request-Id', 'abc');
        middleware({ method: 'GET', path: '/media/evening-by-a-white-wall.svg' }, res, () => {
            throw new Error('next should not be called');
        });
        assert.equal(headers.get('Cache-Control'), 'public, max-age=86400');
        assert.equal(headers.has('X-Request-Id'), false);
        assert.deepEqual(calls.slice(0, 2), [['status', 200], ['type', 'image/svg+xml']]);
    });

    it('passes media requests through when camouflage is disabled', () => {
        const middleware = createCamouflageAssetMiddleware({ getSiteConfig: () => ({ camouflageEnabled: false }) });
        let nextCalled = false;
        middleware({ method: 'GET', path: '/favicon.ico' }, createResponseRecorder().res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('serves real pages and a 404 page for probes outside the access path', () => {
        const middleware = createCamouflageNotFoundMiddleware({
            getSiteConfig: () => ({
                accessPath: '/portal',
                camouflageEnabled: true,
                camouflageTemplate: 'nginx',
                camouflageTitle: 'Sunday City Pages',
            }),
        });

        const about = createResponseRecorder();
        middleware({ method: 'GET', path: '/about', headers: { host: 'weekend.example.org' } }, about.res, () => {
            throw new Error('next should not be called');
        });
        assert.deepEqual(about.calls[0], ['status', 200]);
        assert.match(about.calls[2][1], /hello@weekend\.example\.org/);
        assert.ok(about.headers.get('Last-Modified'));

        for (const path of ['/wp-admin', '/.env', '/favicon.png', '/api/v1/login']) {
            const probe = createResponseRecorder();
            probe.headers.set('Access-Control-Allow-Credentials', 'true');
            middleware({ method: 'GET', path, headers: { host: '203.0.113.7' } }, probe.res, () => {
                throw new Error('next should not be called');
            });
            assert.deepEqual(probe.calls[0], ['status', 404], path);
            assert.match(probe.calls[1][1], /^text\/html/);
            assert.match(probe.calls[2][1], /Sunday City Pages/);
            assert.match(probe.calls[2][1], /页面不存在/);
            assert.doesNotMatch(probe.calls[2][1], /wp-admin|\.env|hello@/);
            assert.doesNotMatch(probe.calls[2][1], FORBIDDEN_PUBLIC_CONTENT);
            assert.equal(probe.headers.has('Access-Control-Allow-Credentials'), false);
            assert.match(probe.headers.get('Content-Security-Policy'), /default-src 'none'/);
        }
    });

    it('answers non-GET requests with the 404 page', () => {
        const middleware = createCamouflageNotFoundMiddleware({
            getSiteConfig: () => ({ accessPath: '/portal', camouflageEnabled: true }),
        });
        const post = createResponseRecorder();
        middleware({ method: 'POST', path: '/about', headers: {} }, post.res, () => {
            throw new Error('next should not be called');
        });
        assert.deepEqual(post.calls[0], ['status', 404]);
    });

    it('leaves requests inside the access path to the application', () => {
        const middleware = createCamouflageNotFoundMiddleware({
            getSiteConfig: () => ({ accessPath: '/portal', camouflageEnabled: true }),
        });
        let nextCalled = false;
        middleware({ method: 'GET', path: '/portal/settings', headers: {} }, createResponseRecorder().res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });
});
