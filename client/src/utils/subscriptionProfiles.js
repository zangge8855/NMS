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

function buildClashImportUrl(sourceUrl) {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `clash://install-config?url=${encodeURIComponent(url)}`;
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
    const singboxUrl = normalizeUrl(payload.subscriptionUrlSingbox);
    const importActions = [
        {
            key: 'shadowrocket',
            label: 'Shadowrocket',
            platform: 'iPhone / iPad',
            href: buildShadowrocketImportUrl(v2raynUrl || importSourceUrl),
            hint: '导入通用订阅链接',
            siteUrl: TOOL_SITES.find((item) => item.key === 'shadowrocket')?.url || '',
        },
        {
            key: 'clash-verge',
            label: 'Clash Verge Rev',
            platform: 'Desktop',
            href: buildClashImportUrl(clashUrl),
            hint: '导入 Clash / Mihomo YAML 订阅',
            siteUrl: TOOL_SITES.find((item) => item.key === 'clash-verge')?.url || '',
        },
        {
            key: 'stash',
            label: 'Stash',
            platform: 'iPhone / iPad',
            href: buildStashImportUrl(clashUrl),
            hint: '导入 Clash / Mihomo YAML 订阅',
            siteUrl: TOOL_SITES.find((item) => item.key === 'stash')?.url || '',
        },
        {
            key: 'surge',
            label: 'Surge',
            platform: 'iPhone / iPad / Mac',
            href: buildSurgeImportUrl(clashUrl),
            hint: '导入兼容配置',
            siteUrl: TOOL_SITES.find((item) => item.key === 'surge')?.url || '',
        },
        {
            key: 'singbox',
            label: 'sing-box',
            platform: 'Desktop / Mobile',
            href: singboxUrl,
            hint: '导入专用 Remote Profile',
            siteUrl: TOOL_SITES.find((item) => item.key === 'singbox')?.url || '',
        },
    ].filter((item) => item.href);

    const profiles = [
        {
            key: 'v2rayn',
            label: '通用链接',
            url: v2raynUrl,
            hint: '适用于 v2rayN / v2rayNG / Shadowrocket',
        },
        {
            key: 'clash',
            label: 'Clash / Mihomo',
            url: clashUrl,
            hint: 'YAML 订阅，适用于 Clash / Mihomo 类客户端',
        },
        {
            key: 'singbox',
            label: 'sing-box',
            url: singboxUrl,
            hint: '专用 Remote Profile',
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
