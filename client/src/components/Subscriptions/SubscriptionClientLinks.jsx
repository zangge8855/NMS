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

function buildLinks(toolLookup, keys = []) {
    return keys
        .map((key) => toolLookup.get(key))
        .filter(Boolean);
}

function buildRule(toolLookup, profileLookup, toolKeys = [], profileKey) {
    const tools = toolKeys
        .map((key) => toolLookup.get(key)?.label)
        .filter(Boolean);
    const profileLabel = profileLookup.get(profileKey)?.label;
    if (!tools.length || !profileLabel) return null;
    return {
        key: `${toolKeys.join('-')}::${profileKey}`,
        tools,
        profileLabel,
    };
}

export default function SubscriptionClientLinks({
    bundle,
    sections = ['devices'],
    compact = false,
    showHeading = true,
}) {
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
            summary: '任选一个客户端。',
            appLinks: buildLinks(toolLookup, ['flclash', 'v2rayn', 'sparkle']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['flclash', 'sparkle'], 'clash'),
                buildRule(toolLookup, profileLookup, ['v2rayn'], 'v2rayn'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'macos',
            title: 'macOS',
            summary: '任选一个客户端。',
            appLinks: buildLinks(toolLookup, ['flclash', 'sparkle', 'v2rayn']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['flclash', 'sparkle'], 'clash'),
                buildRule(toolLookup, profileLookup, ['v2rayn'], 'v2rayn'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'android',
            title: 'Android',
            summary: '任选一个客户端。',
            appLinks: buildLinks(toolLookup, ['flclash', 'cmfa', 'exclave']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['flclash', 'cmfa'], 'clash'),
                buildRule(toolLookup, profileLookup, ['exclave'], 'v2rayn'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'ios',
            title: 'iPhone / iPad',
            summary: '装好后可直接导入。',
            appLinks: buildLinks(toolLookup, ['shadowrocket', 'surge', 'singbox']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['shadowrocket'], 'v2rayn'),
                buildRule(toolLookup, profileLookup, ['surge'], 'surge'),
                buildRule(toolLookup, profileLookup, ['singbox'], 'singbox'),
            ].filter(Boolean),
            quickKeys: ['shadowrocket', 'surge', 'singbox'],
        },
    ]), [profileLookup, toolLookup]);

    if (quickActions.length === 0 && toolSites.length === 0) return null;

    return (
        <div className={`subscription-client-links${compact ? ' subscription-client-links--compact' : ''}`}>
            {hasSection(sections, 'devices') && (
                <div className="subscription-client-links-section">
                    {showHeading && (
                        <div className="subscription-client-links-heading">
                            <div className="subscription-client-links-title">还没装客户端？先按设备选</div>
                            <div className="subscription-client-links-caption">先下客户端，再按下面的订阅类型导入。</div>
                        </div>
                    )}
                    <div className="subscription-device-grid">
                        {deviceGuides.map((item) => {
                            const quickItems = item.quickKeys
                                .map((key) => quickActionLookup.get(key))
                                .filter(Boolean)
                                .map((action) => {
                                    if (Array.isArray(action?.actions)) {
                                        return action.actions.find((subAction) => subAction.key === 'clash') || action.actions[0] || null;
                                    }
                                    return action;
                                })
                                .filter((action) => String(action?.href || '').trim());

                            return (
                                <div key={item.key} className="subscription-device-card">
                                    <div className="subscription-device-title">{item.title}</div>
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
                                    <div className="subscription-device-block">
                                        <div className="subscription-device-block-label">对应订阅</div>
                                        <div className="subscription-device-rules">
                                            {item.profileRules.map((rule) => (
                                                <div key={rule.key} className="subscription-device-rule">
                                                    <span className="subscription-device-rule-tools">{rule.tools.join(' / ')}</span>
                                                    <span className="subscription-device-rule-arrow">选</span>
                                                    <span className="subscription-device-rule-profile">{rule.profileLabel}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="subscription-device-block subscription-device-block--push">
                                        <div className="subscription-device-block-label">导入方式</div>
                                        {quickItems.length > 0 ? (
                                            <div className="subscription-device-actions">
                                                {quickItems.map((action) => (
                                                    <a key={`${item.key}-${action.key}`} href={action.href} className="btn btn-primary btn-sm">
                                                        {action.label}
                                                    </a>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="subscription-device-empty">
                                                复制上面的订阅地址，到客户端里粘贴导入就行。
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
