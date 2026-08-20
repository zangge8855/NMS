
    if (proxy.type === 'ss') {
        return `${proxy.name} = ss, ${proxy.server}, ${proxy.port}, encrypt-method=${proxy.cipher}, password=${proxy.password}`;
    }

    if (proxy.type === 'vmess') {
        let line = `${proxy.name} = vmess, ${proxy.server}, ${proxy.port}, username=${proxy.uuid}`;
        if (Number(proxy.alterId || 0) === 0) line += ', vmess-aead=true';
        if (proxy.tls) {
            line += ', tls=true';
            if (proxy.servername) line += `, sni=${proxy.servername}`;
            if (proxy['skip-cert-verify']) line += ', skip-cert-verify=true';
            if (Array.isArray(proxy.alpn) && proxy.alpn.length > 0) {
                line += `, alpn=${proxy.alpn.join(',')}`;
            }
        }
        if (proxy.network === 'ws') {
            line += `, ws=true, ws-path=${proxy['ws-opts']?.path || '/'}`;
            const host = proxy['ws-opts']?.headers?.Host;
            if (host) line += `, ws-headers=Host:${host}`;
        } else if (proxy.network === 'grpc' && proxy['grpc-opts']?.['grpc-service-name']) {
            line += `, grpc-service-name=${proxy['grpc-opts']['grpc-service-name']}`;
        }
        return line;
    }

    if (proxy.type === 'trojan') {
        let line = `${proxy.name} = trojan, ${proxy.server}, ${proxy.port}, password=${proxy.password}`;
        if (proxy.sni) line += `, sni=${proxy.sni}`;
        if (proxy['skip-cert-verify']) line += ', skip-cert-verify=true';
        if (Array.isArray(proxy.alpn) && proxy.alpn.length > 0) {
            line += `, alpn=${proxy.alpn.join(',')}`;
        }
        if (proxy.network === 'ws') {
            line += `, ws=true, ws-path=${proxy['ws-opts']?.path || '/'}`;
            const host = proxy['ws-opts']?.headers?.Host;
            if (host) line += `, ws-headers=Host:${host}`;
        } else if (proxy.network === 'grpc' && proxy['grpc-opts']?.['grpc-service-name']) {
            line += `, grpc-service-name=${proxy['grpc-opts']['grpc-service-name']}`;
        }
        return line;
    }

    if (proxy.type === 'hysteria2') {
        let line = `${proxy.name} = hysteria2, ${proxy.server}, ${proxy.port}, password=${proxy.password}`;
        if (proxy.sni) line += `, sni=${proxy.sni}`;
        if (proxy['skip-cert-verify']) line += ', skip-cert-verify=true';
        if (Array.isArray(proxy.alpn) && proxy.alpn.length > 0) {
            line += `, alpn=${proxy.alpn.join(',')}`;
        }
        if (proxy['hop-interval'] !== undefined) line += `, hop-interval=${proxy['hop-interval']}`;
        return line;
    }

    if (proxy.type === 'tuic') {
        let line = `${proxy.name} = tuic, ${proxy.server}, ${proxy.port}, password=${proxy.password}, uuid=${proxy.uuid}`;
        if (proxy.sni) line += `, sni=${proxy.sni}`;
        if (proxy['skip-cert-verify']) line += ', skip-cert-verify=true';
        if (Array.isArray(proxy.alpn) && proxy.alpn.length > 0) {
            line += `, alpn=${proxy.alpn.join(',')}`;
        }
        if (proxy['congestion-controller']) {
            line += `, congestion-controller=${proxy['congestion-controller']}`;
        }
        if (proxy['udp-relay-mode']) {
            line += `, udp-relay-mode=${proxy['udp-relay-mode']}`;
        }
        return line;
    }

    return '';
}

function buildSurgeConfigObject(links: any[] = []) {
    const usedNames = new Set();
    const proxies = [];
    (Array.isArray(links) ? links : []).forEach((link, index) => {
        const proxy = parseMihomoProxyFromLink(link, usedNames, index + 1);
        if (!proxy || proxy.type === 'vless') return;
        const line = buildSurgeProxyLine(proxy);
        if (line) {
            proxies.push({
                name: proxy.name,
                line,
            });
        }
    });
    if (proxies.length === 0) return null;

    const proxyNames = proxies.map((item) => item.name);
    return {
        general: SURGE_GENERAL_CONFIG,
        replica: SURGE_REPLICA_CONFIG,
        proxies,
        groups: [
            `PROXY = select, AUTO, ${proxyNames.join(', ')}, DIRECT`,
            `AUTO = url-test, ${proxyNames.join(', ')}, url=http://cp.cloudflare.com/generate_204, interval=300`,
        ],
        rules: [
            ...LOCAL_DIRECT_RULES,
            'DOMAIN-SUFFIX,cn,DIRECT',
            'GEOIP,CN,DIRECT',
            'FINAL,PROXY',
        ],
    };
}

function buildSurgeConfigFromLinks(links: any[] = [], subscriptionUrl = '') {
    const config = buildSurgeConfigObject(links);
    if (!config) return '';

