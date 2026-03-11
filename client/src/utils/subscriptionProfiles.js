function appendQuery(url, query = {}) {
    const base = String(url || '').trim();
    if (!base) return '';
    const entries = Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
    if (entries.length === 0) return base;
    const qs = entries
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

function normalizeUrl(value) {
    const text = String(value || '').trim();
    return text || '';
}

function buildSingboxImportUrl(sourceUrl, name = 'NMS') {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `sing-box://import-remote-profile?url=${encodeURIComponent(url)}#${encodeURIComponent(String(name || 'NMS'))}`;
}

const TOOL_SITES = [
    { key: 'v2rayn', label: 'v2rayN', url: 'https://github.com/2dust/v2rayN' },
    { key: 'clash-verge', label: 'Clash Verge Rev', url: 'https://www.clashverge.dev/' },
    { key: 'mihomo-party', label: 'Mihomo Party', url: 'https://mihomo.party/' },
    { key: 'singbox', label: 'sing-box', url: 'https://sing-box.sagernet.org/clients/' },
];

export function buildSubscriptionProfileBundle(payload = {}) {
    const mergedUrl = normalizeUrl(payload.subscriptionUrl) || normalizeUrl(payload.legacySubscriptionUrl);
    const rawUrl = normalizeUrl(payload.subscriptionUrlRaw) || appendQuery(mergedUrl, { format: 'raw' });
    const importSourceUrl = rawUrl || mergedUrl;

    const v2raynUrl = normalizeUrl(payload.subscriptionUrlV2rayn) || mergedUrl;
    const clashUrl = normalizeUrl(payload.subscriptionUrlClash)
        || normalizeUrl(payload.subscriptionUrlMihomo)
        || appendQuery(mergedUrl, { format: 'clash' });
    const mihomoUrl = clashUrl;
    const singboxUrl = normalizeUrl(payload.subscriptionUrlSingbox) || buildSingboxImportUrl(importSourceUrl);

    const profiles = [
        {
            key: 'v2rayn',
            label: '通用链接',
            url: v2raynUrl,
            hint: '适用于 v2rayN / v2rayNG / Shadowrocket 等常见 URI 订阅客户端',
        },
        {
            key: 'clash',
            label: 'Clash / Mihomo',
            url: clashUrl,
            hint: '通用 YAML 配置，适用于 Clash Verge Rev / Mihomo Party',
        },
        {
            key: 'singbox',
            label: 'sing-box',
            url: singboxUrl,
            hint: 'sing-box 一键导入链接',
        },
        {
            key: 'raw',
            label: 'Raw',
            url: rawUrl,
            hint: '原始 URI 列表',
        },
    ];

    const availableProfiles = profiles.filter((item) => item.url);
    const defaultProfileKey = availableProfiles[0]?.key || '';

    return {
        mergedUrl,
        rawUrl,
        v2raynUrl,
        clashUrl,
        mihomoUrl,
        singboxUrl,
        toolSites: TOOL_SITES,
        profiles,
        availableProfiles,
        defaultProfileKey,
    };
}

export function findSubscriptionProfile(bundle, key) {
    const profiles = Array.isArray(bundle?.profiles) ? bundle.profiles : [];
    const normalizedKey = String(key || '').trim() === 'mihomo' ? 'clash' : String(key || '').trim();
    return profiles.find((item) => item.key === normalizedKey) || profiles.find((item) => item.url) || null;
}
