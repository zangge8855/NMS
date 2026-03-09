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
    { key: 'hiddify', label: 'Hiddify', url: 'https://hiddify.com/app/' },
];

export function buildSubscriptionProfileBundle(payload = {}) {
    const mergedUrl = normalizeUrl(payload.subscriptionUrl) || normalizeUrl(payload.legacySubscriptionUrl);
    const rawUrl = normalizeUrl(payload.subscriptionUrlRaw) || appendQuery(mergedUrl, { format: 'raw' });
    const nativeUrl = normalizeUrl(payload.subscriptionUrlNative) || appendQuery(mergedUrl, { mode: 'native' });
    const reconstructedUrl = normalizeUrl(payload.subscriptionUrlReconstructed) || appendQuery(mergedUrl, { mode: 'reconstructed' });
    const reconstructedRawUrl = normalizeUrl(payload.subscriptionUrlReconstructedRaw)
        || appendQuery(reconstructedUrl || mergedUrl, { format: 'raw' });
    const importSourceUrl = reconstructedRawUrl || rawUrl || mergedUrl;

    const v2raynUrl = normalizeUrl(payload.subscriptionUrlV2rayn) || mergedUrl;
    const clashUrl = normalizeUrl(payload.subscriptionUrlClash) || appendQuery(mergedUrl, { format: 'clash' });
    const mihomoUrl = normalizeUrl(payload.subscriptionUrlMihomo) || appendQuery(mergedUrl, { format: 'mihomo' });
    const singboxUrl = normalizeUrl(payload.subscriptionUrlSingbox) || buildSingboxImportUrl(importSourceUrl);

    const profiles = [
        {
            key: 'v2rayn',
            label: 'v2rayN / v2rayNG',
            url: v2raynUrl,
            hint: '通用订阅地址',
        },
        {
            key: 'clash',
            label: 'Clash / Verge',
            url: clashUrl,
            hint: 'Clash / Mihomo YAML 配置地址',
        },
        {
            key: 'mihomo',
            label: 'Mihomo Party',
            url: mihomoUrl,
            hint: 'Mihomo Party YAML 配置地址',
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
        {
            key: 'native',
            label: 'Native',
            url: nativeUrl,
            hint: '优先使用节点原生订阅',
        },
        {
            key: 'reconstructed',
            label: 'Reconstructed',
            url: reconstructedUrl,
            hint: '由 NMS 重建链接',
        },
    ];

    const availableProfiles = profiles.filter((item) => item.url);
    const defaultProfileKey = availableProfiles[0]?.key || '';

    return {
        mergedUrl,
        rawUrl,
        nativeUrl,
        reconstructedUrl,
        reconstructedRawUrl,
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
    const normalizedKey = String(key || '').trim();
    return profiles.find((item) => item.key === normalizedKey) || profiles.find((item) => item.url) || null;
}
