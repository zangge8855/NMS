import React, { useMemo } from 'react';

function buildToolLookup(items = []) {
    const map = new Map();
    items.forEach((item) => {
        if (String(item?.url || '').trim()) {
            map.set(item.key, {
                key: item.key,
                label: item.label,
                url: item.url,
            });
        }
        if (Array.isArray(item?.links)) {
            item.links.forEach((link) => {
                if (!String(link?.url || '').trim()) return;
                map.set(link.key, {
                    key: link.key,
                    label: link.label,
                    url: link.url,
                    group: item.label,
                });
            });
        }
    });
    return map;
}

function buildProfileLookup(bundle) {
    const profiles = Array.isArray(bundle?.availableProfiles) ? bundle.availableProfiles : [];
    return new Map(profiles.map((item) => [item.key, item]));
}

function buildQuickActionLookup(items = []) {
    return new Map((Array.isArray(items) ? items : []).map((item) => [item.key, item]));
}

function hasSection(sections = [], key) {
    return Array.isArray(sections) ? sections.includes(key) : false;
}

export default function SubscriptionClientLinks({ bundle, sections = ['devices'], compact = false }) {
    const quickActions = Array.isArray(bundle?.importActions)
        ? bundle.importActions.filter((item) => (
            String(item?.href || '').trim()
            || (Array.isArray(item?.actions) && item.actions.some((action) => String(action?.href || '').trim()))
        ))
        : [];
    const toolSites = Array.isArray(bundle?.toolSites)
        ? bundle.toolSites.filter((item) => (
            String(item?.url || '').trim()
            || (Array.isArray(item?.links) && item.links.some((link) => String(link?.url || '').trim()))
        ))
        : [];
    const toolLookup = useMemo(() => buildToolLookup(toolSites), [toolSites]);
    const quickActionLookup = useMemo(() => buildQuickActionLookup(quickActions), [quickActions]);
    const profileLookup = useMemo(() => buildProfileLookup(bundle), [bundle]);

    const deviceGuides = useMemo(() => ([
        {
            key: 'windows',
            title: 'Windows',
            summary: '先用通用链接，常见客户端是 v2rayN；如果你平时用 Clash，再切到 Clash / Mihomo。',
            profileLabel: profileLookup.get('v2rayn')?.label || '通用链接',
            appLinks: ['v2rayn', 'clash-verge', 'mihomo-party']
                .map((key) => toolLookup.get(key))
                .filter(Boolean),
            quickKeys: ['clash-family', 'singbox'],
        },
        {
            key: 'macos',
            title: 'macOS',
            summary: '优先用 Clash / Mihomo、Stash 或 Surge；对应的订阅类型要和客户端一致。',
            profileLabel: profileLookup.get('clash')?.label || profileLookup.get('surge')?.label || '通用链接',
            appLinks: ['mihomo-party', 'stash', 'surge']
                .map((key) => toolLookup.get(key))
                .filter(Boolean),
            quickKeys: ['clash-family', 'surge'],
        },
        {
            key: 'android',
            title: 'Android',
            summary: '通常用 v2rayNG；如果你装的是 sing-box，也可以选 sing-box 专用格式。',
            profileLabel: profileLookup.get('v2rayn')?.label || '通用链接',
            appLinks: ['v2rayng', 'singbox']
                .map((key) => toolLookup.get(key))
                .filter(Boolean),
            quickKeys: ['singbox'],
        },
        {
            key: 'ios',
            title: 'iPhone / iPad',
            summary: '常见是 Shadowrocket、Stash 或 Surge；装好后可以直接用对应的快捷导入。',
            profileLabel: profileLookup.get('v2rayn')?.label || profileLookup.get('clash')?.label || '通用链接',
            appLinks: ['shadowrocket', 'stash', 'surge']
                .map((key) => toolLookup.get(key))
                .filter(Boolean),
            quickKeys: ['shadowrocket', 'clash-family', 'surge'],
        },
    ]), [profileLookup, toolLookup]);

    if (quickActions.length === 0 && toolSites.length === 0) return null;

    return (
        <div className="subscription-client-links">
            {hasSection(sections, 'devices') && (
                <div className="subscription-client-links-section">
                    <div className="subscription-client-links-heading">
                        <div className="subscription-client-links-title">还没装客户端？先按设备选</div>
                        <div className="subscription-client-links-caption">只看自己设备那一张卡：先装客户端，再点对应快捷导入；没有快捷导入时，就复制上面的订阅地址。</div>
                    </div>
                    <div className="subscription-device-grid">
                        {deviceGuides.map((item) => {
                            const deviceActions = item.quickKeys
                                .map((key) => quickActionLookup.get(key))
                                .filter(Boolean);

                            return (
                                <div key={item.key} className="subscription-device-card">
                                    <div className="subscription-device-title">{item.title}</div>
                                    <div className="subscription-device-profile">
                                        建议先选
                                        {' '}
                                        <span>{item.profileLabel}</span>
                                    </div>
                                    <div className="subscription-device-text">{item.summary}</div>
                                    <div className="subscription-device-block">
                                        <div className="subscription-device-block-label">客户端下载</div>
                                        <div className="subscription-device-actions">
                                            {item.appLinks.map((link) => (
                                                <a
                                                    key={link.key}
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="btn btn-ghost btn-sm"
                                                >
                                                    {link.label}
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="subscription-device-block subscription-device-block--push">
                                        <div className="subscription-device-block-label">快捷导入</div>
                                        {deviceActions.length > 0 ? (
                                            <div className={`subscription-quick-actions${compact ? ' subscription-quick-actions--compact' : ''}`}>
                                                {deviceActions.map((action) => (
                                                    <div key={`${item.key}-${action.key}`} className={`subscription-quick-card${compact ? ' subscription-quick-card--compact' : ''}`}>
                                                        <div className="subscription-quick-card-copy">
                                                            <div className="subscription-quick-card-title">{action.label}</div>
                                                            <div className="subscription-quick-card-hint">{action.hint}</div>
                                                        </div>
                                                        <div className="subscription-quick-card-actions">
                                                            {action.href ? (
                                                                <a href={action.href} className="btn btn-primary btn-sm">
                                                                    快捷导入
                                                                </a>
                                                            ) : null}
                                                            {Array.isArray(action.actions) && action.actions.map((subAction, index) => (
                                                                <a
                                                                    key={subAction.key || `${action.key}-${index}`}
                                                                    href={subAction.href}
                                                                    className={`btn btn-sm ${index === 0 ? 'btn-primary' : 'btn-secondary'}`}
                                                                >
                                                                    {subAction.label}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="subscription-device-empty">
                                                这个平台没有一键导入时，直接复制上面的订阅地址到客户端里就行。
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
