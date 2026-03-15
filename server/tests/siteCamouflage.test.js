import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteCamouflageHtml, getCamouflageRuntime } from '../lib/siteCamouflage.js';
import { createCamouflageNotFoundMiddleware } from '../middleware/siteCamouflage.js';

describe('site camouflage renderer', () => {
    it('renders configured templates with inline assets and startup-randomized classes', () => {
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
        assert.match(html, /data:image\/svg\+xml;base64,/);
        assert.doesNotMatch(html, /pexels\.com/i);
        assert.match(html, new RegExp(`page-${runtime.classSuffix}`));
        assert.match(html, /\/wp-admin/);
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
        assert.match(html, /Industrial edge instrumentation/);
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
        assert.match(calls[2][1], /\/wp-admin/);
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
