import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    normalizeClientLocale,
    resolveActiveClientLocale,
    resolveLocalizedNotificationText,
} from './locale';

describe('locale utilities', () => {
    afterEach(() => {
        localStorage.clear();
        document.documentElement.lang = 'zh-CN';
        vi.restoreAllMocks();
    });

    it('normalizes supported locale codes cleanly', () => {
        expect(normalizeClientLocale('en')).toBe('en-US');
        expect(normalizeClientLocale('en-GB')).toBe('en-US');
        expect(normalizeClientLocale('zh')).toBe('zh-CN');
        expect(normalizeClientLocale('zh-TW')).toBe('zh-CN');
        expect(normalizeClientLocale('fr-FR')).toBeNull();
        expect(normalizeClientLocale('')).toBeNull();
    });

    it('prefers stored nms_locale and safely falls back to documentElement.lang', () => {
        document.documentElement.lang = 'en-US';
        localStorage.setItem('nms_locale', 'zh-CN');
        expect(resolveActiveClientLocale()).toBe('zh-CN');

        localStorage.removeItem('nms_locale');
        expect(resolveActiveClientLocale()).toBe('en-US');

        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        document.documentElement.lang = 'en';
        expect(resolveActiveClientLocale()).toBe('en-US');
    });

    it('resolves meta.localized entries with short-locale and raw fallbacks', () => {
        const notification = {
            title: 'Raw Title',
            body: 'Raw Body',
            meta: {
                localized: {
                    'zh-CN': { title: '节点离线', body: '节点 node-1 心跳超时' },
                    'en-US': { title: 'Node Offline', body: 'Node node-1 heartbeat timed out' },
                },
            },
        };

        expect(resolveLocalizedNotificationText(notification, 'en-US')).toEqual({
            title: 'Node Offline',
            body: 'Node node-1 heartbeat timed out',
        });
        expect(resolveLocalizedNotificationText(notification, 'zh-CN')).toEqual({
            title: '节点离线',
            body: '节点 node-1 心跳超时',
        });

        const shortOnly = {
            title: 'Fallback Title',
            body: 'Fallback Body',
            meta: {
                localized: {
                    en: { title: 'Short English Title', body: '' },
                },
            },
        };
        expect(resolveLocalizedNotificationText(shortOnly, 'en-US')).toEqual({
            title: 'Short English Title',
            body: '',
        });
        expect(resolveLocalizedNotificationText(shortOnly, 'zh-CN')).toEqual({
            title: 'Fallback Title',
            body: 'Fallback Body',
        });
    });
});
