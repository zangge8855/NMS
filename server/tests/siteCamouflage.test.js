import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCamouflageAssetMiddleware,
    createSiteCamouflageHtml,
    getCamouflageAssetPublicPath,
    getCamouflageRuntime,
} from '../lib/siteCamouflage.js';
import { createCamouflageNotFoundMiddleware } from '../middleware/siteCamouflage.js';

const FORBIDDEN_PUBLIC_CONTENT = /\b(?:nms|subscription|node|server|panel|audit|proxy|xray|token|admin|inbound|telegram|3x-ui|x-ui|edge\s+precision\s+systems|precision\s+systems)\b|订阅|节点|面板|审计|代理|入站|后台|运维|服务器|真实入口|访问路径/i;

describe('site camouflage renderer', () => {
    it('renders configured templates with chinese-first bilingual content, inline assets and startup-randomized classes', () => {
        const runtime = getCamouflageRuntime();
        const html = createSiteCamouflageHtml({
            siteConfig: {
                camouflageTemplate: 'blog',
                camouflageTitle: 'Willow City Weekly',
            },
            requestPath: '/wp-admin',
            requestMethod: 'GET',
            statusCode: 404,
        });

        assert.match(html, /Willow City Weekly/);
        assert.match(html, /中文/);
        assert.match(html, /English/);
        assert.match(html, /街头影像/);
        assert.match(html, /Street Photo Notes/);
        assert.match(html, /白墙前的傍晚/);
        assert.match(html, /\/media\/city\/photo-walk\.svg/);
        assert.match(html, /city_lang_pref/);
        assert.doesNotMatch(html, /pexels\.com/i);
        assert.doesNotMatch(html, FORBIDDEN_PUBLIC_CONTENT);
        assert.doesNotMatch(html, /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏|状态码|目录状态/);
        assert.doesNotMatch(html, /公开站点壳层|当前页面仅保留最小公开信息|PUBLIC SITE|ACCESS NOTICE|STATUS UPDATE/i);
        assert.match(html, new RegExp(`page-${runtime.classSuffix}`));
        assert.doesNotMatch(html, /\/wp-admin/);
    });

    it('falls back to the corporate template for unknown template values', () => {
        const html = createSiteCamouflageHtml({
            siteConfig: {
                camouflageTemplate: 'unknown',
                camouflageTitle: 'Fallback City Journal',
            },
            requestPath: '/',
            statusCode: 200,
        });

        assert.match(html, /Fallback City Journal/);
        assert.match(html, /城市周刊/);
        assert.match(html, /城市漫游志/);
        assert.match(html, /雨后街区的慢早餐/);
        assert.match(html, /\/media\/city\/city-cover\.svg/);
        assert.match(html, /连续 12 期|12 issues/);
        assert.doesNotMatch(html, /上海|Zhangjiang|Pudong/i);
        assert.doesNotMatch(html, FORBIDDEN_PUBLIC_CONTENT);
        assert.doesNotMatch(html, /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏|目录状态 200/);
    });

    it('replaces legacy technical camouflage titles with the city-magazine default', () => {
        const html = createSiteCamouflageHtml({
            siteConfig: {
                camouflageTemplate: 'corporate',
                camouflageTitle: 'Edge Precision Systems',
            },
            requestPath: '/',
            statusCode: 200,
        });

        assert.match(html, /City Field Notes/);
        assert.match(html, /城市周刊/);
        assert.doesNotMatch(html, /Edge Precision Systems|Precision Systems/i);
        assert.doesNotMatch(html, FORBIDDEN_PUBLIC_CONTENT);
    });

    it('ships system-adaptive light and dark theme styles for every public template', () => {
        for (const template of ['corporate', 'blog', 'nginx']) {
            const html = createSiteCamouflageHtml({
                siteConfig: {
                    camouflageTemplate: template,
                    camouflageTitle: 'City Field Notes',
                },
                requestPath: '/',
                statusCode: 200,
            });

            assert.match(html, /color-scheme:\s*light dark/);
            assert.match(html, /@media\s*\(prefers-color-scheme:\s*dark\)/);
            assert.doesNotMatch(html, FORBIDDEN_PUBLIC_CONTENT);
        }
    });
});

describe('camouflage middleware', () => {
    it('serves registered camouflage media files when camouflage is enabled', () => {
        const middleware = createCamouflageAssetMiddleware({
            getSiteConfig: () => ({
                camouflageEnabled: true,
            }),
        });

        const headers = new Map();
        let sentFile = '';
        middleware({
            method: 'GET',
            path: getCamouflageAssetPublicPath('blog', 'blogHeroImage'),
        }, {
            setHeader(name, value) {
                headers.set(name, value);
            },
            removeHeader(name) {
                headers.delete(name);
            },
            sendFile(filePath, callback) {
                sentFile = filePath;
                if (typeof callback === 'function') callback();
                return this;
            },
        }, () => {
            throw new Error('next should not be called');
        });

        assert.equal(headers.get('Cache-Control'), 'public, max-age=86400');
        assert.match(sentFile, /server\/views\/camouflage\/assets\/city\/photo-walk\.svg$/);
    });

    it('renders a camouflage 404 page with static-site headers for document probes', () => {
        const middleware = createCamouflageNotFoundMiddleware({
            getSiteConfig: () => ({
                accessPath: '/portal',
                camouflageEnabled: true,
                camouflageTemplate: 'nginx',
                camouflageTitle: 'Sunday City Pages',
            }),
        });

        const headers = new Map();
        const calls = [];
        const res = {
            setHeader(name, value) {
                headers.set(name, value);
            },
            removeHeader(name) {
                headers.delete(name);
            },
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
            redirect(code, location) {
                calls.push(['redirect', code, location]);
                return this;
            },
        };

        middleware({
            method: 'GET',
            path: '/wp-admin',
            originalUrl: '/wp-admin',
            headers: { accept: 'text/html' },
        }, res, () => {
            throw new Error('next should not be called');
        });

        assert.equal(headers.get('Cache-Control'), 'public, max-age=86400');
        assert.deepEqual(calls[0], ['status', 404]);
        assert.deepEqual(calls[1], ['type', 'html']);
        assert.match(calls[2][1], /Sunday City Pages/);
        assert.match(calls[2][1], /中文/);
        assert.match(calls[2][1], /周末指南/);
        assert.match(calls[2][1], /周末城市指南/);
        assert.match(calls[2][1], /窗边热饮/);
        assert.doesNotMatch(calls[2][1], /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏|状态码/);
        assert.doesNotMatch(calls[2][1], /公开站点壳层|当前页面仅保留最小公开信息|PUBLIC SITE|ACCESS NOTICE|STATUS UPDATE/i);
        assert.doesNotMatch(calls[2][1], /\/wp-admin/);
        assert.doesNotMatch(calls[2][1], /completed with status/i);
        assert.doesNotMatch(calls[2][1], FORBIDDEN_PUBLIC_CONTENT);
    });

    it('redirects asset-like probes back to the camouflage home path', () => {
        const middleware = createCamouflageNotFoundMiddleware({
            getSiteConfig: () => ({
                accessPath: '/portal',
                camouflageEnabled: true,
            }),
        });

        const calls = [];
        middleware({
            method: 'GET',
            path: '/favicon.ico',
            originalUrl: '/favicon.ico',
            headers: { accept: '*/*' },
        }, {
            setHeader() {},
            removeHeader() {},
            redirect(code, location) {
                calls.push(['redirect', code, location]);
                return this;
            },
        }, () => {
            throw new Error('next should not be called');
        });

        assert.deepEqual(calls, [['redirect', 302, '/']]);
    });
});
