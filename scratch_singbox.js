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
                fakeip: {
                    enabled: true,
                    inet4_range: '198.18.0.0/15',
                    inet6_range: 'fc00::/18',
                },
            },
            ntp: {
                enabled: true,
                server: 'time.apple.com',
                server_port: 123,
                interval: '30m',
            },
            inbounds: [
                { type: 'mixed', tag: 'mixed-in', listen: '0.0.0.0', listen_port: 2080 },
                { type: 'tun', tag: 'tun-in', address: '172.19.0.1/30', auto_route: true, strict_route: true, stack: 'mixed', sniff: true },
            ],
            outbounds: [
                { type: 'block', tag: 'REJECT' },
                { type: 'direct', tag: 'DIRECT' },
                ...proxies,
                {
                    type: 'urltest',
                    tag: 'AUTO',
                    outbounds: proxyTags,
                    url: 'https://www.gstatic.com/generate_204',
                    interval: '10m',
                    tolerance: 50,
                },
                {
                    type: 'selector',
                    tag: 'PROXY',
                    outbounds: ['AUTO', ...proxyTags, 'DIRECT'],
                },
            ],
            route: {
                rule_set: [
                    {
                        type: 'remote',
                        tag: 'geoip-cn',
                        format: 'binary',
                        url: SINGBOX_GEOIP_CN_RULESET_URL,
                        update_interval: '7d',
                    },
                ],
                rules: [
                    {
                        action: 'sniff',
                        timeout: '1s',
                    },
                    {
                        protocol: 'dns',
                        action: 'hijack-dns',
                    },
                    {
                        ip_is_private: true,
                        outbound: 'DIRECT',
                    },
                    {
                        domain_suffix: ['.cn'],
                        outbound: 'DIRECT',
                    },
                    {
                        rule_set: ['geoip-cn'],
                        outbound: 'DIRECT',
                    },
                ],
                final: 'PROXY',
                auto_detect_interface: true,
            },
            experimental: {
                cache_file: {
                    enabled: true,
                    store_fakeip: true,
                },
            },
        };
    }

    return {
        dns: {
            servers: [
                {
                    type: 'tcp',
                    tag: 'dns_proxy',
                    server: '1.1.1.1',
                    detour: 'PROXY',
                    domain_resolver: 'dns_resolver',
                },
                {
                    type: 'https',
                    tag: 'dns_direct',
                    server: 'dns.alidns.com',
                    domain_resolver: 'dns_resolver',
                },
                {
                    type: 'udp',
                    tag: 'dns_resolver',
                    server: '223.5.5.5',
                },
                {
                    type: 'fakeip',
                    tag: 'dns_fakeip',
                    inet4_range: '198.18.0.0/15',
                    inet6_range: 'fc00::/18',
                },
            ],
            rules: [
                {
                    domain_suffix: ['.cn'],
                    query_type: ['A', 'AAAA'],
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
                    action: 'predefined',
                    rcode: 'REFUSED',
                },
            ],
            final: 'dns_direct',
            independent_cache: true,
        },
        ntp: {
            enabled: true,
            server: 'time.apple.com',
            server_port: 123,
            interval: '30m',
        },
        inbounds: [
            { type: 'mixed', tag: 'mixed-in', listen: '0.0.0.0', listen_port: 2080 },
            { type: 'tun', tag: 'tun-in', address: '172.19.0.1/30', auto_route: true, strict_route: true, stack: 'mixed', sniff: true },
        ],
        outbounds: [
            { type: 'block', tag: 'REJECT' },
            { type: 'direct', tag: 'DIRECT' },
            ...proxies,
            {
                type: 'urltest',
                tag: 'AUTO',
                outbounds: proxyTags,
                url: 'https://www.gstatic.com/generate_204',
                interval: '10m',
                tolerance: 50,
            },
            {
                type: 'selector',
                tag: 'PROXY',
                outbounds: ['AUTO', ...proxyTags, 'DIRECT'],
            },
        ],
        route: {
            default_domain_resolver: 'dns_resolver',
            rule_set: [
                {
                    type: 'remote',
                    tag: 'geoip-cn',
                    format: 'binary',
                    url: SINGBOX_GEOIP_CN_RULESET_URL,
                    update_interval: '7d',
                },
            ],
            rules: [
                {
                    action: 'sniff',
                    timeout: '1s',
                },
                {
                    protocol: 'dns',
                    action: 'hijack-dns',
                },
                {
                    ip_is_private: true,
                    action: 'route',
                    outbound: 'DIRECT',
                },
                {
                    domain_suffix: ['.cn'],
                    action: 'route',
                    outbound: 'DIRECT',
                },
                {
                    rule_set: ['geoip-cn'],
                    action: 'route',
                    outbound: 'DIRECT',
                },
            ],
            final: 'PROXY',
            auto_detect_interface: true,
        },
        experimental: {
            cache_file: {
                enabled: true,
                store_fakeip: true,
            },
        },
    };
}

