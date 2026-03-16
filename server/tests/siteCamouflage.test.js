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
        assert.match(html, /公开页维持简洁、克制/);
        assert.match(html, /当前路径未开放内容，请返回首页或稍后再试/);
        assert.match(html, /data:image\/svg\+xml;base64,/);
        assert.match(html, /\/media\/journal\/editorial-hero\.png/);
        assert.doesNotMatch(html, /pexels\.com/i);
        assert.doesNotMatch(html, /产品|方案|下载|联络|新闻中心/i);
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
        assert.match(html, /公开站点/);
        assert.match(html, /当前站点仅提供基础公开说明与更新时间/);
        assert.match(html, /保留中性的公开外壳/);
        assert.match(html, /\/media\/industrial\/facility-overview\.png/);
        assert.match(html, /维护节奏/);
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
        assert.match(calls[2][1], /公开页只保留基础访问提示、时间戳和状态标记/);
        assert.match(calls[2][1], /该路径未对外开放，请使用分配入口访问受限资源/);
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
