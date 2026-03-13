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

function hasConfigQueryParam(url) {
    const text = normalizeUrl(url);
    if (!text) return false;
    try {
        const parsed = new URL(text);
        return parsed.searchParams.has('config');
    } catch {
        return false;
    }
}

function extractConverterBaseUrl(url) {
    const text = normalizeUrl(url);
    if (!text) return '';
    try {
        const parsed = new URL(text);
        parsed.search = '';
        parsed.hash = '';
        parsed.pathname = parsed.pathname.replace(/\/(?:clash|singbox|surge)\/?$/i, '') || '/';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return '';
    }
}

function extractUrlHost(url) {
    const text = normalizeUrl(url);
    if (!text) return '';
    try {
        return new URL(text).host || '';
    } catch {
        return '';
    }
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

function buildClashImportUrl(sourceUrl) {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `clash://install-config?url=${encodeURIComponent(url)}`;
}

function buildSurgeImportUrl(sourceUrl) {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `surge:///install-config?url=${encodeURIComponent(url)}`;
}

function buildSingboxImportUrl(sourceUrl, name = 'NMS') {
    const url = normalizeUrl(sourceUrl);
    if (!url) return '';
    return `sing-box://import-remote-profile?url=${encodeURIComponent(url)}#${encodeURIComponent(String(name || 'NMS'))}`;
}

function getSubscriptionProfileCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            shadowrocketHint: 'Import the standard subscription',
            clashFamilyHint: 'Use this YAML for Verge Rev / Mihomo Party / Stash',
            surgeHint: 'Import the Surge profile',
            singboxHint: 'Import the remote profile',
            profileStandard: 'Standard Link',
            profileStandardHint: 'For v2rayN / v2rayNG / Shadowrocket',
            profileClashHint: 'For Clash / Mihomo / Stash',
            profileSingboxHint: 'For sing-box',
            profileSurgeHint: 'For Surge',
            profileRawHint: 'Raw node list',
            supportedClientsLabel: 'Compatible Clients',
        };
    }
    return {
        shadowrocketHint: '导入通用订阅',
        clashFamilyHint: 'Verge Rev / Mihomo Party / Stash 共用这一组 YAML',
        surgeHint: '导入 Surge 配置',
        singboxHint: '导入 Remote Profile',
        profileStandard: '通用链接',
        profileStandardHint: '给 v2rayN / v2rayNG / Shadowrocket',
        profileClashHint: '给 Clash / Mihomo / Stash',
        profileSingboxHint: '给 sing-box',
        profileSurgeHint: '给 Surge',
        profileRawHint: '原始节点列表',
        supportedClientsLabel: '适用软件',
    };
}

const TOOL_SITES = [
    { key: 'flclash', label: 'FlClash', url: 'https://github.com/chen08209/FlClash' },
    { key: 'exclave', label: 'Exclave', url: 'https://github.com/dyhkwong/Exclave' },
    { key: 'v2rayn', label: 'v2rayN', url: 'https://github.com/2dust/v2rayN' },
    { key: 'v2rayng', label: 'v2rayNG', url: 'https://github.com/2dust/v2rayNG' },
    { key: 'cmfa', label: 'CMFA', url: 'https://github.com/MetaCubeX/ClashMetaForAndroid' },
    { key: 'sparkle', label: 'Sparkle', url: 'https://www.sparkle.pics/' },
    { key: 'shadowrocket', label: 'Shadowrocket', url: 'https://apps.apple.com/app/shadowrocket/id932747118' },
    {
        key: 'clash-family',
        label: 'Clash / Mihomo 系列',
        links: [
            { key: 'clash-verge', label: 'Verge Rev', url: 'https://www.clashverge.dev/' },
            { key: 'mihomo-party', label: 'Mihomo Party', url: 'https://mihomo.party/' },
            { key: 'stash', label: 'Stash', url: 'https://stash.wiki/installation/' },
        ],
    },
    { key: 'surge', label: 'Surge', url: 'https://nssurge.com/' },
    { key: 'singbox', label: 'sing-box', url: 'https://sing-box.sagernet.org/clients/' },
];

export function buildSubscriptionProfileBundle(payload = {}, locale = 'zh-CN') {
    const copy = getSubscriptionProfileCopy(locale);
    const mergedUrl = normalizeUrl(payload.subscriptionUrl) || normalizeUrl(payload.legacySubscriptionUrl);
    const rawUrl = normalizeUrl(payload.subscriptionUrlRaw) || appendQuery(mergedUrl, { format: 'raw' });
    const importSourceUrl = rawUrl || mergedUrl;

    const v2raynUrl = normalizeUrl(payload.subscriptionUrlV2rayn) || mergedUrl;
    const clashUrl = normalizeUrl(payload.subscriptionUrlClash)
        || normalizeUrl(payload.subscriptionUrlMihomo)
        || appendQuery(mergedUrl, { format: 'clash' });
    const mihomoUrl = clashUrl;
    const singboxUrl = normalizeUrl(payload.subscriptionUrlSingbox);
    const surgeUrl = normalizeUrl(payload.subscriptionUrlSurge);
    const wrappedProfileUrls = [clashUrl, singboxUrl, surgeUrl].filter(hasConfigQueryParam);
    const externalConverterBaseUrl = extractConverterBaseUrl(wrappedProfileUrls[0] || '');
    const externalConverterHost = extractUrlHost(externalConverterBaseUrl);
    const externalConverterConfigured = wrappedProfileUrls.length > 0 && !!externalConverterBaseUrl;
    const singboxImportUrl = buildSingboxImportUrl(singboxUrl);
    const clashFamilyLinks = TOOL_SITES.find((item) => item.key === 'clash-family')?.links || [];
    const importActions = [
        {
            key: 'shadowrocket',
            label: 'Shadowrocket',
            platform: 'iPhone / iPad',
            href: buildShadowrocketImportUrl(v2raynUrl || importSourceUrl),
            hint: copy.shadowrocketHint,
            siteUrl: TOOL_SITES.find((item) => item.key === 'shadowrocket')?.url || '',
        },
        {
            key: 'clash-family',
            label: 'Clash / Mihomo 系列',
            platform: 'Desktop / iPhone / iPad',
            hint: copy.clashFamilyHint,
            actions: [
                {
                    key: 'clash',
                    label: 'Clash / Mihomo',
                    href: buildClashImportUrl(clashUrl),
                },
                {
                    key: 'stash',
                    label: 'Stash',
                    href: buildStashImportUrl(clashUrl),
                },
            ].filter((item) => item.href),
            siteLinks: clashFamilyLinks,
        },
        {
            key: 'surge',
            label: 'Surge',
            platform: 'iPhone / iPad / Mac',
            href: buildSurgeImportUrl(surgeUrl),
            hint: copy.surgeHint,
            siteUrl: TOOL_SITES.find((item) => item.key === 'surge')?.url || '',
        },
        {
            key: 'singbox',
            label: 'sing-box',
            platform: 'Desktop / Mobile',
            href: singboxImportUrl,
            hint: copy.singboxHint,
            siteUrl: TOOL_SITES.find((item) => item.key === 'singbox')?.url || '',
        },
    ].filter((item) => item.href || (Array.isArray(item.actions) && item.actions.length > 0));

    const profiles = [
        {
            key: 'v2rayn',
            label: copy.profileStandard,
            url: v2raynUrl,
            hint: copy.profileStandardHint,
            supportedClientsLabel: copy.supportedClientsLabel,
            supportedClients: ['v2rayN', 'Exclave', 'Shadowrocket'],
        },
        {
            key: 'clash',
            label: 'Clash / Mihomo',
            url: clashUrl,
            hint: copy.profileClashHint,
            supportedClientsLabel: copy.supportedClientsLabel,
            supportedClients: ['FlClash', 'Sparkle', 'CMFA', 'Stash'],
        },
        {
            key: 'singbox',
            label: 'sing-box',
            url: singboxUrl,
            hint: copy.profileSingboxHint,
            supportedClientsLabel: copy.supportedClientsLabel,
            supportedClients: ['sing-box'],
        },
        {
            key: 'surge',
            label: 'Surge',
            url: surgeUrl,
            hint: copy.profileSurgeHint,
            supportedClientsLabel: copy.supportedClientsLabel,
            supportedClients: ['Surge'],
        },
        {
            key: 'raw',
            label: 'Raw',
            url: rawUrl,
            hint: copy.profileRawHint,
            supportedClientsLabel: copy.supportedClientsLabel,
            supportedClients: locale === 'en-US' ? ['Advanced Clients', 'Manual Import'] : ['高级客户端', '手动导入'],
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
        surgeUrl,
        singboxImportUrl,
        externalConverterConfigured,
        externalConverterBaseUrl,
        externalConverterHost,
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
