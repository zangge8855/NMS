const fs = require('fs');
const file = '/root/NMS/server/routes/subscriptions.ts';
let code = fs.readFileSync(file, 'utf8');

const regexDef = /function buildSurgeConfigFromLinks\(links: any\[\] = \[\], subscriptionUrl = ''\) \{/g;
code = code.replace(regexDef, `function buildSurgeConfigFromLinks(links: any[] = [], subscriptionUrl = '', routingPolicy = 'rules') {`);

const regexCall = /const config = buildSurgeConfigObject\(links\);/g;
code = code.replace(regexCall, `const config = buildSurgeConfigObject(links, routingPolicy);`);

// And in HTTP GET routes
code = code.replace(/buildSurgeConfigFromLinks\(links, scopedUrls.subscriptionUrlSurge\)/g, `buildSurgeConfigFromLinks(links, scopedUrls.subscriptionUrlSurge, routingPolicy)`);

const regexSurgeObj = /function buildSurgeConfigObject\(links: any\[\] = \[\]\) \{[\s\S]*?groups: \[\s*`PROXY = select, AUTO, \$\{proxyNames\.join\(\', \'\)\}, DIRECT`,\s*`AUTO = url-test, \$\{proxyNames\.join\(\', \'\)\}, url=http:\/\/cp\.cloudflare\.com\/generate_204, interval=300`,\s*\],\s*rules: \[\s*\.\.\.LOCAL_DIRECT_RULES,\s*'DOMAIN-SUFFIX,cn,DIRECT',\s*'GEOIP,CN,DIRECT',\s*'FINAL,PROXY',\s*\],\s*\};\s*\}/g;

const match = code.match(regexSurgeObj);
if(match) {
    const replacement = match[0]
        .replace(/function buildSurgeConfigObject\(links: any\[\] = \[\]\) \{/, 'function buildSurgeConfigObject(links: any[] = [], routingPolicy = "rules") {')
        .replace(/groups: \[\s*`PROXY = select, AUTO, \$\{proxyNames\.join\(\', \'\)\}, DIRECT`,\s*`AUTO = url-test, \$\{proxyNames\.join\(\', \'\)\}, url=http:\/\/cp\.cloudflare\.com\/generate_204, interval=300`,\s*\],\s*rules: \[\s*\.\.\.LOCAL_DIRECT_RULES,\s*'DOMAIN-SUFFIX,cn,DIRECT',\s*'GEOIP,CN,DIRECT',\s*'FINAL,PROXY',\s*\],/g, 
            `...(() => {
                if (routingPolicy === 'global') return { groups: [\`PROXY = select, \${proxyNames.join(', ')}\`], rules: ['FINAL,PROXY'] };
                if (routingPolicy === 'auto') return { groups: [\`AUTO = url-test, \${proxyNames.join(', ')}, url=http://cp.cloudflare.com/generate_204, interval=300\`], rules: ['FINAL,AUTO'] };
                return {
                    groups: [
                        \`🚀 节点选择 = select, ⚡ 自动优选, \${proxyNames.join(', ')}, 🎯 全球直连\`,
                        \`⚡ 自动优选 = url-test, \${proxyNames.join(', ')}, url=http://cp.cloudflare.com/generate_204, interval=300\`,
                        \`🤖 AI 服务 = select, 🚀 节点选择, \${proxyNames.join(', ')}\`,
                        \`🎬 国际流媒体 = select, 🚀 节点选择, \${proxyNames.join(', ')}\`,
                        \`🛑 广告拦截 = select, REJECT, DIRECT\`,
                        \`🎯 全球直连 = select, DIRECT, 🚀 节点选择\`
                    ],
                    rules: [
                        ...LOCAL_DIRECT_RULES,
                        'DOMAIN-SET,geosite:category-ads-all,🛑 广告拦截',
                        'DOMAIN-SET,geosite:openai,🤖 AI 服务',
                        'DOMAIN-SET,geosite:netflix,🎬 国际流媒体',
                        'DOMAIN-SET,geosite:youtube,🎬 国际流媒体',
                        'DOMAIN-SET,geosite:disney,🎬 国际流媒体',
                        'DOMAIN-SUFFIX,cn,🎯 全球直连',
                        'GEOIP,CN,🎯 全球直连',
                        'FINAL,🚀 节点选择'
                    ]
                };
            })(),`);
    code = code.replace(match[0], replacement);
    fs.writeFileSync(file, code);
    console.log("Patched Surge config builder");
} else {
    console.log("Could not find Surge config builder");
}
