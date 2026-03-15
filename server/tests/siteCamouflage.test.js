import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteCamouflageHtml, getCamouflageRuntime } from '../lib/siteCamouflage.js';
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
        assert.match(html, /新闻中心、技术文章与案例动态/);
        assert.match(html, /该内容暂未在新闻中心发布/);
        assert.match(html, /data:image\/svg\+xml;base64,/);
        assert.doesNotMatch(html, /pexels\.com/i);
        assert.doesNotMatch(html, /Directory status:/i);
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
        assert.match(html, /工业检测设备与自动化解决方案/);
        assert.match(html, /工业视觉检测设备、测量终端与自动化集成方案/);
        assert.match(html, /官方网站/);
        assert.match(html, /持续更新/);
        assert.doesNotMatch(html, /目录状态 200/);
    });
});

describe('camouflage middleware', () => {
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
        assert.match(calls[2][1], /服务与支持/);
        assert.match(calls[2][1], /您访问的页面暂未开放，请查看服务与支持栏目/);
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
