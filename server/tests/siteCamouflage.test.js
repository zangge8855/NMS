import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCamouflageAssetMiddleware,
    createSiteCamouflageHtml,
    getCamouflageAssetPublicPath,
    getCamouflageRuntime,
} from '../lib/siteCamouflage.js';
import { createCamouflageNotFoundMiddleware } from '../middleware/siteCamouflage.js';

describe('site camouflage renderer', () => {
    it('renders configured templates with chinese-first bilingual content, inline assets and startup-randomized classes', () => {
        const runtime = getCamouflageRuntime();
        const html = createSiteCamouflageHtml({
            siteConfig: {
                camouflageTemplate: 'blog',
                camouflageTitle: 'Northline Field Journal',
            },
            requestPath: '/wp-admin',
            requestMethod: 'GET',
            statusCode: 404,
        });

        assert.match(html, /Northline Field Journal/);
        assert.match(html, /中文/);
        assert.match(html, /English/);
        assert.match(html, /应用摘要/);
        assert.match(html, /阅读案例/);
        assert.match(html, /电子装联/);
        assert.match(html, /最近更新/);
        assert.match(html, /data:image\/svg\+xml;base64,/);
        assert.match(html, /\/media\/journal\/editorial-hero\.png/);
        assert.doesNotMatch(html, /pexels\.com/i);
        assert.doesNotMatch(html, /下载|联络|新闻中心|telegram|订阅|节点|入站/i);
        assert.doesNotMatch(html, /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏/);
        assert.doesNotMatch(html, /公开站点壳层|当前页面仅保留最小公开信息/);
        assert.match(html, new RegExp(`page-${runtime.classSuffix}`));
        assert.doesNotMatch(html, /\/wp-admin/);
        assert.match(html, /site_lang_pref/);
        assert.doesNotMatch(html, /nms/i);
    });

    it('falls back to the corporate template for unknown template values', () => {
        const html = createSiteCamouflageHtml({
            siteConfig: {
                camouflageTemplate: 'unknown',
                camouflageTitle: 'Fallback Labs',
            },
            requestPath: '/',
            statusCode: 200,
        });

        assert.match(html, /Fallback Labs/);
        assert.match(html, /智能视觉设备/);
        assert.match(html, /产品矩阵/);
        assert.match(html, /在线检测单元/);
        assert.match(html, /25 年|25 years/);
        assert.match(html, /中国|China/);
        assert.match(html, /contact@edgeprecision\.cn/);
        assert.match(html, /\/media\/industrial\/facility-overview\.png/);
        assert.doesNotMatch(html, /上海|Zhangjiang|Pudong/i);
        assert.doesNotMatch(html, /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏/);
        assert.doesNotMatch(html, /公开站点壳层|当前页面仅保留最小公开信息/);
        assert.doesNotMatch(html, /目录状态 200/);
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
        assert.match(sentFile, /server\/views\/camouflage\/assets\/blog\/2026-03-15-18-41-blog-hero\.png$/);
    });

    it('renders a camouflage 404 page with static-site headers for document probes', () => {
        const middleware = createCamouflageNotFoundMiddleware({
            getSiteConfig: () => ({
                accessPath: '/portal',
                camouflageEnabled: true,
                camouflageTemplate: 'nginx',
                camouflageTitle: 'Aperture Relay',
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
        assert.match(calls[2][1], /Aperture Relay/);
        assert.match(calls[2][1], /中文/);
        assert.match(calls[2][1], /交付支持/);
        assert.match(calls[2][1], /实施路径/);
        assert.match(calls[2][1], /现场实施/);
        assert.doesNotMatch(calls[2][1], /访问说明|更新节奏|受限资源|公开范围|路径说明|维护节奏/);
        assert.doesNotMatch(calls[2][1], /公开站点壳层|当前页面仅保留最小公开信息/);
        assert.doesNotMatch(calls[2][1], /\/wp-admin/);
        assert.doesNotMatch(calls[2][1], /completed with status/i);
        assert.doesNotMatch(calls[2][1], /nms/i);
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
