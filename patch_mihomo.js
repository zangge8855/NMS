const fs = require('fs');
const file = '/root/NMS/server/routes/subscriptions.ts';
let code = fs.readFileSync(file, 'utf8');

const oldMihomo = `function buildMihomoConfigObject(links: any[] = []) {
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
}`;

const newMihomo = `function buildMihomoConfigObject(links: any[] = [], routingPolicy: string = 'rules') {
    const usedNames = new Set();
    const proxies = [];
    (Array.isArray(links) ? links : []).forEach((link, index) => {
        const proxy = parseMihomoProxyFromLink(link, usedNames, index + 1);
        if (proxy) proxies.push(proxy);
    });
    if (proxies.length === 0) return null;

    const proxyNames = proxies.map((item) => item.name);
    
    let proxyGroups = [];
    let rules = [];
    
    if (routingPolicy === 'global') {
        proxyGroups = [
            { name: 'PROXY', type: 'select', proxies: proxyNames }
        ];
        rules = ['MATCH,PROXY'];
    } else if (routingPolicy === 'auto') {
        proxyGroups = [
            { name: 'AUTO', type: 'url-test', proxies: proxyNames, url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 50 }
        ];
        rules = ['MATCH,AUTO'];
    } else {
        proxyGroups = [
            { name: '🚀 节点选择', type: 'select', proxies: ['⚡ 自动优选', ...proxyNames, '🎯 全球直连'] },
            { name: '⚡ 自动优选', type: 'url-test', proxies: proxyNames, url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 50 },
            { name: '🤖 AI 服务', type: 'select', proxies: ['🚀 节点选择', ...proxyNames] },
            { name: '🎬 国际流媒体', type: 'select', proxies: ['🚀 节点选择', ...proxyNames] },
            { name: '🛑 广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT'] },
            { name: '🎯 全球直连', type: 'select', proxies: ['DIRECT', '🚀 节点选择'] }
        ];
        rules = [
            ...LOCAL_DIRECT_RULES,
            'GEOSITE,category-ads-all,🛑 广告拦截',
            'GEOSITE,openai,🤖 AI 服务',
            'GEOSITE,netflix,🎬 国际流媒体',
            'GEOSITE,youtube,🎬 国际流媒体',
            'GEOSITE,disney,🎬 国际流媒体',
            'DOMAIN-SUFFIX,cn,🎯 全球直连',
            'GEOIP,CN,🎯 全球直连',
            'MATCH,🚀 节点选择'
        ];
    }

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
        'proxy-groups': proxyGroups,
        rules
    };
}`;

if (code.includes('function buildMihomoConfigObject(links: any[] = []) {') && !code.includes('routingPolicy: string')) {
    code = code.replace(oldMihomo, newMihomo);
    fs.writeFileSync(file, code);
    console.log("Replaced Mihomo config generator.");
} else {
    console.log("Could not find old Mihomo config, or already patched.");
}
