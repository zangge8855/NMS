import {
    buildSubscriptionProfileBundle,
    findSubscriptionProfile,
} from './subscriptionProfiles.js';

describe('subscription profile bundle', () => {
    it('builds a unified Clash and Mihomo subscription URL from the merged URL', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://sub.example.com/base',
            subscriptionUrlRaw: 'https://sub.example.com/base?format=raw',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/base?format=clash');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/base?format=clash');
        expect(bundle.singboxUrl).toContain('sing-box://import-remote-profile');
        expect(bundle.importActions.find((item) => item.key === 'shadowrocket')?.href).toContain('shadowrocket://add/');
        expect(bundle.importActions.find((item) => item.key === 'stash')?.href).toContain('stash://install-config');
        expect(bundle.importActions.find((item) => item.key === 'surge')?.href).toContain('surge:///install-config');
        expect(findSubscriptionProfile(bundle, 'mihomo')?.label).toBe('Clash / Mihomo');
    });

    it('prefers the explicit unified YAML URL when it is present', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://sub.example.com/base',
            subscriptionUrlClash: 'https://sub.example.com/clash.yaml',
            subscriptionUrlMihomo: 'https://sub.example.com/mihomo.yaml',
            subscriptionUrlSingbox: 'sing-box://import-remote-profile?url=https://sub.example.com/raw',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/clash.yaml');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/clash.yaml');
        expect(bundle.singboxUrl).toBe('sing-box://import-remote-profile?url=https://sub.example.com/raw');
    });
});
