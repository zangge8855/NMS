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

function buildShadowrocketImportUrl(sourceUrl) {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `shadowrocket://add/${encodeURIComponent(url)}`;
}

function buildStashImportUrl(sourceUrl, name = 'NMS') {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `stash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(String(name || 'NMS'))}`;
}

function buildSurgeImportUrl(sourceUrl, name = 'NMS') {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `surge:///install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(String(name || 'NMS'))}`;
}

function buildSingboxImportUrl(sourceUrl, name = 'NMS') {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `sing-box://import-remote-profile?url=${encodeURIComponent(url)}#${encodeURIComponent(String(name || 'NMS'))}`;
}

const TOOL_SITES = [
    { key: 'v2rayn', label: 'v2rayN', url: 'https://github.com/2dust/v2rayN' },
    { key: 'v2rayng', label: 'v2rayNG', url: 'https://github.com/2dust/v2rayNG' },
    { key: 'clash-verge', label: 'Clash Verge Rev', url: 'https://www.clashverge.dev/' },
    { key: 'mihomo-party', label: 'Mihomo Party', url: 'https://mihomo.party/' },
    { key: 'shadowrocket', label: 'Shadowrocket', url: 'https://apps.apple.com/app/shadowrocket/id932747118' },
    { key: 'stash', label: 'Stash', url: 'https://stash.wiki/installation/' },
    { key: 'surge', label: 'Surge', url: 'https://nssurge.com/' },
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
    const importActions = [
        {
            key: 'shadowrocket',
            label: 'Shadowrocket',
            platform: 'iPhone / iPad',
            href: buildShadowrocketImportUrl(v2raynUrl || importSourceUrl),
            hint: '使用通用 URI 订阅直接导入小火箭',
            siteUrl: TOOL_SITES.find((item) => item.key === 'shadowrocket')?.url || '',
        },
        {
            key: 'stash',
            label: 'Stash',
            platform: 'iPhone / iPad',
            href: buildStashImportUrl(clashUrl),
            hint: '使用 Clash / Mihomo YAML 一键导入',
            siteUrl: TOOL_SITES.find((item) => item.key === 'stash')?.url || '',
        },
        {
            key: 'surge',
            label: 'Surge',
            platform: 'iPhone / iPad / Mac',
            href: buildSurgeImportUrl(clashUrl),
            hint: '使用兼容配置直接导入 Surge',
            siteUrl: TOOL_SITES.find((item) => item.key === 'surge')?.url || '',
        },
        {
            key: 'singbox',
            label: 'sing-box',
            platform: 'Desktop / Mobile',
            href: singboxUrl,
            hint: '使用 sing-box 远程配置一键导入',
            siteUrl: TOOL_SITES.find((item) => item.key === 'singbox')?.url || '',
        },
    ].filter((item) => item.href);

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
        importActions,
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
