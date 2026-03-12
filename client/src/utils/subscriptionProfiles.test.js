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
            subscriptionUrlSurge: 'https://sub.example.com/base?format=surge',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/base?format=clash');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/base?format=clash');
        expect(bundle.singboxUrl).toBe('https://sub.example.com/base?format=singbox');
        expect(bundle.surgeUrl).toBe('https://sub.example.com/base?format=surge');
        expect(bundle.singboxImportUrl).toContain('sing-box://import-remote-profile');
        expect(bundle.importActions.find((item) => item.key === 'shadowrocket')?.href).toContain('shadowrocket://add/');
        expect(bundle.importActions.find((item) => item.key === 'clash-verge')?.href).toContain('clash://install-config');
        expect(bundle.importActions.find((item) => item.key === 'stash')?.href).toContain('stash://install-config');
        expect(bundle.importActions.find((item) => item.key === 'surge')?.href).toContain('surge:///install-config');
        expect(bundle.importActions.find((item) => item.key === 'singbox')?.href).toContain('sing-box://import-remote-profile');
        expect(findSubscriptionProfile(bundle, 'mihomo')?.label).toBe('Clash / Mihomo');
    });

    it('prefers the explicit unified YAML URL when it is present', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://sub.example.com/base',
            subscriptionUrlClash: 'https://sub.example.com/clash.yaml',
            subscriptionUrlMihomo: 'https://sub.example.com/mihomo.yaml',
            subscriptionUrlSingbox: 'https://sub.example.com/singbox.json',
            subscriptionUrlSurge: 'https://sub.example.com/surge.conf',
        });

        expect(bundle.clashUrl).toBe('https://sub.example.com/clash.yaml');
        expect(bundle.mihomoUrl).toBe('https://sub.example.com/clash.yaml');
        expect(bundle.singboxUrl).toBe('https://sub.example.com/singbox.json');
        expect(bundle.surgeUrl).toBe('https://sub.example.com/surge.conf');
        expect(bundle.singboxImportUrl).toContain(encodeURIComponent('https://sub.example.com/singbox.json'));
    });

    it('detects when client-specific links are wrapped by an external converter', () => {
        const bundle = buildSubscriptionProfileBundle({
            subscriptionUrl: 'https://nms.example.com/api/subscriptions/public/t/abc/def',
            subscriptionUrlRaw: 'https://nms.example.com/api/subscriptions/public/t/abc/def?format=raw',
            subscriptionUrlClash: 'https://converter.example.com/clash?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Fabc%2Fdef%3Fformat%3Draw',
            subscriptionUrlSingbox: 'https://converter.example.com/singbox?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Fabc%2Fdef%3Fformat%3Draw',
            subscriptionUrlSurge: 'https://converter.example.com/surge?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Fabc%2Fdef%3Fformat%3Draw',
        });

        expect(bundle.externalConverterConfigured).toBe(true);
        expect(bundle.externalConverterBaseUrl).toBe('https://converter.example.com');
        expect(bundle.externalConverterHost).toBe('converter.example.com');
    });
});
