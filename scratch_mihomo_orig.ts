function buildMihomoConfigObject(links: any[] = []) {
    const usedNames = new Set();
    const proxies = [];
    (Array.isArray(links) ? links : []).forEach((link, index) => {
        const proxy = parseMihomoProxyFromLink(link, usedNames, index + 1);
        if (proxy) proxies.push(proxy);
    });
    if (proxies.length === 0) return null;

    const proxyNames = proxies.map((item) => item.name);
    return {
        port: 7890,
        'socks-port': 7891,
        'allow-lan': false,
        mode: 'rule',
        'log-level': 'info',
        'geodata-mode': true,
        'geo-auto-update': true,
        'geodata-loader': 'standard',
        'geo-update-interval': 24,
        'geox-url': METACUBEX_GEOX_URL,
        ipv6: true,
        'unified-delay': true,
        'rule-providers': {},
        profile: {
            'store-selected': true,
            'store-fake-ip': true,
        },
        dns: {
            enable: true,
            ipv6: true,
            'respect-rules': true,
            'enhanced-mode': 'fake-ip',
            nameserver: [
                'https://120.53.53.53/dns-query',
                'https://223.5.5.5/dns-query',
            ],
            'proxy-server-nameserver': [
                'https://120.53.53.53/dns-query',
                'https://223.5.5.5/dns-query',
            ],
            'nameserver-policy': {
                'geosite:cn,private': [
                    'https://120.53.53.53/dns-query',
                    'https://223.5.5.5/dns-query',
                ],
                'geosite:geolocation-!cn': [
                    'https://dns.cloudflare.com/dns-query',
                    'https://dns.google/dns-query',
                ],
            },
        },
        proxies,
        'proxy-groups': [
            {
                name: 'PROXY',
                type: 'select',
                proxies: ['AUTO', ...proxyNames, 'DIRECT'],
            },
            {
                name: 'AUTO',
                type: 'url-test',
                proxies: proxyNames,
                url: 'https://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50,
            },
        ],
        rules: [
            ...LOCAL_DIRECT_RULES,
            'DOMAIN-SUFFIX,cn,DIRECT',
            'GEOIP,CN,DIRECT',
            'MATCH,PROXY',
        ],
    };
}
