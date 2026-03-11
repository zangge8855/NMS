import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIpIspResolver } from '../lib/ipIspResolver.js';

describe('ip isp resolver', () => {
    it('matches ipv4 and ipv6 CIDRs from provider lists', async () => {
        const resolver = createIpIspResolver({
            enabled: true,
            sources: [
                { label: '中国电信', urls: ['https://example.com/ct.txt'] },
                { label: '中国联通', urls: ['https://example.com/cu.txt'] },
            ],
            fetcher: async ({ url }) => {
                if (url.endsWith('/ct.txt')) {
                    return '1.1.1.0/24\n240e::/20\n';
                }
                if (url.endsWith('/cu.txt')) {
                    return '8.8.8.0/24\n';
                }
                throw new Error(`unexpected url ${url}`);
            },
        });

        const map = await resolver.lookupMany(['1.1.1.1', '8.8.8.8', '240e::1']);
        assert.equal(resolver.pickFromMap(map, '1.1.1.1'), '中国电信');
        assert.equal(resolver.pickFromMap(map, '8.8.8.8'), '中国联通');
        assert.equal(resolver.pickFromMap(map, '240e::1'), '中国电信');
    });

    it('returns empty string for private addresses and misses', async () => {
        const resolver = createIpIspResolver({
            enabled: true,
            sources: [{ label: '中国电信', urls: ['https://example.com/ct.txt'] }],
            fetcher: async () => '1.1.1.0/24\n',
        });

        assert.equal(await resolver.lookup('192.168.1.10'), '');
        assert.equal(await resolver.lookup('9.9.9.9'), '');
    });
});
