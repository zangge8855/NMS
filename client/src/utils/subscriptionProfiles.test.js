import {
    buildSubscriptionProfileBundle,
    findSubscriptionProfile,
} from './subscriptionProfiles.js';

describe('subscription profile bundle', () => {
    it('builds a unified Clash and Mihomo subscription URL from the merged URL', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://sub.example.com/base',
            subscriptionUrlRaw: 'https://sub.example.com/base?format=raw',
            subscriptionUrlSingbox: 'https://sub.example.com/base?format=singbox',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/base?format=clash');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/base?format=clash');
        expect(bundle.singboxUrl).toBe('https://sub.example.com/base?format=singbox');
        expect(bundle.singboxImportUrl).toContain('sing-box://import-remote-profile');
        expect(bundle.importActions.find((item) => item.key === 'shadowrocket')?.href).toContain('shadowrocket://add/');
        expect(bundle.importActions.find((item) => item.key === 'clash-verge')?.href).toContain('clash://install-config');
        expect(bundle.importActions.find((item) => item.key === 'stash')?.href).toContain('stash://install-config');
        expect(bundle.importActions.find((item) => item.key === 'singbox')?.href).toContain('sing-box://import-remote-profile');
        expect(findSubscriptionProfile(bundle, 'mihomo')?.label).toBe('Clash / Mihomo');
    });

    it('prefers the explicit unified YAML URL when it is present', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://sub.example.com/base',
            subscriptionUrlClash: 'https://sub.example.com/clash.yaml',
            subscriptionUrlMihomo: 'https://sub.example.com/mihomo.yaml',
            subscriptionUrlSingbox: 'https://sub.example.com/singbox.json',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/clash.yaml');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/clash.yaml');
        expect(bundle.singboxUrl).toBe('https://sub.example.com/singbox.json');
        expect(bundle.singboxImportUrl).toContain(encodeURIComponent('https://sub.example.com/singbox.json'));
    });
});
