const fs = require('fs');
const file = '/root/NMS/server/routes/subscriptions.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /function buildSingboxConfigObject\(links: any\[\] = \[\], options: any = \{\}\) \{[\s\S]*?\n\}/g;
const match = code.match(regex);
if (!match) {
    console.log("Could not find buildSingboxConfigObject");
    process.exit(1);
}

// Just modify the function to use routingPolicy.

// For 1.11 and normal version, we generate the outbounds and route rules dynamically based on routingPolicy.

const replacement = match[0]
    // 1. Extract routingPolicy
    .replace('const configVersion = resolveSingboxConfigVersion(options.version, options.userAgent);', 
             'const configVersion = resolveSingboxConfigVersion(options.version, options.userAgent);\n    const routingPolicy = options.routingPolicy || "rules";')
    // 2. We need to construct outbounds manually
    .replace(/outbounds: \[\s*\{ type: 'block', tag: 'REJECT' \},\s*\{ type: 'direct', tag: 'DIRECT' \},\s*\.\.\.proxies,\s*\{\s*type: 'urltest',\s*tag: 'AUTO',\s*outbounds: proxyTags,\s*url: 'https:\/\/www.gstatic.com\/generate_204',\s*interval: '10m',\s*tolerance: 50,\s*\},\s*\{\s*type: 'selector',\s*tag: 'PROXY',\s*outbounds: \['AUTO', \.\.\.proxyTags, 'DIRECT'\],\s*\},\s*\],/g, 
            `...(() => {
                if (routingPolicy === 'global') {
                    return { outbounds: [{ type: 'block', tag: 'REJECT' }, { type: 'direct', tag: 'DIRECT' }, ...proxies, { type: 'selector', tag: 'PROXY', outbounds: proxyTags }] };
                }
                if (routingPolicy === 'auto') {
                    return { outbounds: [{ type: 'block', tag: 'REJECT' }, { type: 'direct', tag: 'DIRECT' }, ...proxies, { type: 'urltest', tag: 'AUTO', outbounds: proxyTags, url: 'https://www.gstatic.com/generate_204', interval: '10m', tolerance: 50 }] };
                }
                return {
                    outbounds: [
                        { type: 'block', tag: 'REJECT' },
                        { type: 'direct', tag: 'DIRECT' },
                        ...proxies,
                        { type: 'urltest', tag: '⚡ 自动优选', outbounds: proxyTags, url: 'https://www.gstatic.com/generate_204', interval: '10m', tolerance: 50 },
                        { type: 'selector', tag: '🚀 节点选择', outbounds: ['⚡ 自动优选', ...proxyTags, '🎯 全球直连'] },
                        { type: 'selector', tag: '🤖 AI 服务', outbounds: ['🚀 节点选择', ...proxyTags] },
                        { type: 'selector', tag: '🎬 国际流媒体', outbounds: ['🚀 节点选择', ...proxyTags] },
                        { type: 'selector', tag: '🛑 广告拦截', outbounds: ['REJECT', 'DIRECT'] },
                        { type: 'selector', tag: '🎯 全球直连', outbounds: ['DIRECT', '🚀 节点选择'] }
                    ]
                };
            })(),`)
    // 3. Update route rules
    // In Singbox < 1.11 rules:
    .replace(/rules: \[\s*\{\s*action: 'sniff',\s*timeout: '1s',\s*\},\s*\{\s*protocol: 'dns',\s*action: 'hijack-dns',\s*\},\s*\{\s*ip_is_private: true,\s*action: 'route',\s*outbound: 'DIRECT',\s*\},\s*\{\s*domain_suffix: \['\.cn'\],\s*action: 'route',\s*outbound: 'DIRECT',\s*\},\s*\{\s*rule_set: \['geoip-cn'\],\s*action: 'route',\s*outbound: 'DIRECT',\s*\},\s*\],\s*final: 'PROXY',/g, 
            `...(() => {
                if (routingPolicy === 'global') return { rules: [{action:'sniff',timeout:'1s'},{protocol:'dns',action:'hijack-dns'},{ip_is_private:true,action:'route',outbound:'DIRECT'}], final: 'PROXY' };
                if (routingPolicy === 'auto') return { rules: [{action:'sniff',timeout:'1s'},{protocol:'dns',action:'hijack-dns'},{ip_is_private:true,action:'route',outbound:'DIRECT'}], final: 'AUTO' };
                return {
                    rules: [
                        {action:'sniff',timeout:'1s'},
                        {protocol:'dns',action:'hijack-dns'},
                        {ip_is_private:true,action:'route',outbound:'🎯 全球直连'},
                        {rule_set:['geosite-category-ads-all'],action:'route',outbound:'🛑 广告拦截'},
                        {rule_set:['geosite-openai'],action:'route',outbound:'🤖 AI 服务'},
                        {rule_set:['geosite-netflix','geosite-youtube','geosite-disney'],action:'route',outbound:'🎬 国际流媒体'},
                        {domain_suffix:['.cn'],action:'route',outbound:'🎯 全球直连'},
                        {rule_set:['geoip-cn'],action:'route',outbound:'🎯 全球直连'}
                    ],
                    final: '🚀 节点选择'
                };
            })(),`)
    // 4. Update route rule_set to include new geosites
    .replace(/rule_set: \[\s*\{\s*type: 'remote',\s*tag: 'geoip-cn',\s*format: 'binary',\s*url: SINGBOX_GEOIP_CN_RULESET_URL,\s*update_interval: '7d',\s*\},\s*\],/g, 
            `rule_set: [
                { type: 'remote', tag: 'geoip-cn', format: 'binary', url: SINGBOX_GEOIP_CN_RULESET_URL, update_interval: '7d' },
                ...(routingPolicy === 'rules' ? [
                    { type: 'remote', tag: 'geosite-category-ads-all', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs', update_interval: '7d' },
                    { type: 'remote', tag: 'geosite-openai', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-openai.srs', update_interval: '7d' },
                    { type: 'remote', tag: 'geosite-netflix', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-netflix.srs', update_interval: '7d' },
                    { type: 'remote', tag: 'geosite-youtube', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-youtube.srs', update_interval: '7d' },
                    { type: 'remote', tag: 'geosite-disney', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-disney.srs', update_interval: '7d' }
                ] : [])
            ],`)
    // Update rules for Singbox >= 1.11 (without 'action: route')
    .replace(/rules: \[\s*\{\s*action: 'sniff',\s*timeout: '1s',\s*\},\s*\{\s*protocol: 'dns',\s*action: 'hijack-dns',\s*\},\s*\{\s*ip_is_private: true,\s*outbound: 'DIRECT',\s*\},\s*\{\s*domain_suffix: \['\.cn'\],\s*outbound: 'DIRECT',\s*\},\s*\{\s*rule_set: \['geoip-cn'\],\s*outbound: 'DIRECT',\s*\},\s*\],\s*final: 'PROXY',/g, 
            `...(() => {
                if (routingPolicy === 'global') return { rules: [{action:'sniff',timeout:'1s'},{protocol:'dns',action:'hijack-dns'},{ip_is_private:true,outbound:'DIRECT'}], final: 'PROXY' };
                if (routingPolicy === 'auto') return { rules: [{action:'sniff',timeout:'1s'},{protocol:'dns',action:'hijack-dns'},{ip_is_private:true,outbound:'DIRECT'}], final: 'AUTO' };
                return {
                    rules: [
                        {action:'sniff',timeout:'1s'},
                        {protocol:'dns',action:'hijack-dns'},
                        {ip_is_private:true,outbound:'🎯 全球直连'},
                        {rule_set:['geosite-category-ads-all'],outbound:'🛑 广告拦截'},
                        {rule_set:['geosite-openai'],outbound:'🤖 AI 服务'},
                        {rule_set:['geosite-netflix','geosite-youtube','geosite-disney'],outbound:'🎬 国际流媒体'},
                        {domain_suffix:['.cn'],outbound:'🎯 全球直连'},
                        {rule_set:['geoip-cn'],outbound:'🎯 全球直连'}
                    ],
                    final: '🚀 节点选择'
                };
            })(),`);

code = code.replace(match[0], replacement);
fs.writeFileSync(file, code);
console.log("Patched singbox config builder");
