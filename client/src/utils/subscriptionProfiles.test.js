import {
    buildSubscriptionProfileBundle,
    findSubscriptionProfile,
} from './subscriptionProfiles.js';

describe('subscription profile bundle', () => {
    it('builds built-in Clash and Mihomo subscription URLs from the merged URL', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://sub.example.com/base',
            subscriptionUrlRaw: 'https://sub.example.com/base?format=raw',
            subscriptionUrlReconstructedRaw: 'https://sub.example.com/base?mode=reconstructed&format=raw',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/base?format=clash');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/base?format=mihomo');
        expect(bundle.singboxUrl).toContain('sing-box://import-remote-profile');
        expect(findSubscriptionProfile(bundle, 'mihomo')?.label).toBe('Mihomo Party');
    });

    it('prefers explicit client-specific URLs when they are present', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://sub.example.com/base',
            subscriptionUrlClash: 'https://sub.example.com/clash.yaml',
            subscriptionUrlMihomo: 'https://sub.example.com/mihomo.yaml',
            subscriptionUrlSingbox: 'sing-box://import-remote-profile?url=https://sub.example.com/raw',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/clash.yaml');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/mihomo.yaml');
        expect(bundle.singboxUrl).toBe('sing-box://import-remote-profile?url=https://sub.example.com/raw');
    });
});
