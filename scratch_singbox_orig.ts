function buildSingboxConfigObject(links: any[] = [], options: any = {}) {
    const configVersion = resolveSingboxConfigVersion(options.version, options.userAgent);
    const usedNames = new Set();
    const proxies = [];
    (Array.isArray(links) ? links : []).forEach((link, index) => {
        const outbound = parseSingboxOutboundFromLink(link, usedNames, index + 1);
        if (outbound) proxies.push(outbound);
    });
    if (proxies.length === 0) return null;
    const proxyTags = proxies.map((item) => item.tag);

    if (configVersion === '1.11') {
        return {
            dns: {
                servers: [
                    {
                        tag: 'dns_proxy',
                        address: 'tls://1.1.1.1',
                        detour: 'PROXY',
                    },
                    {
                        tag: 'dns_direct',
                        address: 'https://dns.alidns.com/dns-query',
                        detour: 'DIRECT',
                        address_resolver: 'dns_resolver',
                    },
                    {
                        tag: 'dns_resolver',
                        address: '223.5.5.5',
                        detour: 'DIRECT',
                    },
                    {
                        tag: 'dns_fakeip',
                        address: 'fakeip',
                    },
                ],
                rules: [
                    {
                        domain_suffix: ['.cn'],
                        query_type: ['A', 'AAAA', 'CNAME'],
                        server: 'dns_direct',
                    },
                    {
                        query_type: ['A', 'AAAA'],
                        server: 'dns_fakeip',
                    },
                    {
                        query_type: 'CNAME',
                        server: 'dns_proxy',
                    },
                    {
                        query_type: ['A', 'AAAA', 'CNAME'],
                        invert: true,
                        server: 'dns_direct',
                        disable_cache: true,
                    },
                ],
                final: 'dns_direct',
                strategy: 'prefer_ipv4',
                independent_cache: true,
