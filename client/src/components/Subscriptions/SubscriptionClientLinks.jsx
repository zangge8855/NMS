import React, { useMemo } from 'react';
import { useI18n } from '../../contexts/LanguageContext.jsx';

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

function buildProfileLookup(bundle, labelOverrides = {}) {
    const profiles = Array.isArray(bundle?.availableProfiles) ? bundle.availableProfiles : [];
    return new Map(profiles.map((item) => [
        item.key,
        {
            ...item,
            label: labelOverrides[item.key] || item.label,
        },
    ]));
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

function buildRule(toolLookup, profileLookup, toolKeys = [], profileKey, profileLabelOverride = '') {
    const tools = toolKeys
        .map((key) => toolLookup.get(key)?.label)
        .filter(Boolean);
    const profileLabel = String(profileLabelOverride || profileLookup.get(profileKey)?.label || '').trim();
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
    showImportMethods = true,
    profileLabelOverrides = {},
}) {
    const { locale } = useI18n();
    const copy = useMemo(() => (
        locale === 'en-US'
            ? {
                sectionTitle: 'Pick one client for your device',
                sectionCaption: 'Install it, then import the config you selected above.',
                chooseAny: 'Pick any mainstream client.',
                downloads: 'Client Downloads',
                recommended: 'Recommended Config',
                chooseLabel: 'Use',
                importMethod: 'Import Method',
                copyAddress: 'If one-tap import is not available, just copy the address above.',
            }
            : {
                sectionTitle: '按设备选一个客户端',
                sectionCaption: '下载一个常用客户端就行。',
                chooseAny: '选一个常用客户端。',
                downloads: '客户端下载',
                recommended: '推荐配置文件',
                chooseLabel: '选',
                importMethod: '导入方式',
                copyAddress: '复制上面的地址导入就行。',
            }
    ), [locale]);
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
    const profileLookup = useMemo(
        () => buildProfileLookup(bundle, profileLabelOverrides),
        [bundle, profileLabelOverrides]
    );

    const deviceGuides = useMemo(() => ([
        {
            key: 'windows',
            title: 'Windows',
            summary: copy.chooseAny,
            badge: 'PC / 桌面端',
            appLinks: buildLinks(toolLookup, ['clash-verge', 'mihomo-party', 'flclash', 'v2rayn', 'hiddify', 'singbox']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['clash-verge', 'mihomo-party', 'flclash'], 'clash'),
                buildRule(toolLookup, profileLookup, ['v2rayn'], 'v2rayn', 'v2rayN'),
                buildRule(toolLookup, profileLookup, ['hiddify', 'singbox'], 'singbox'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'macos',
            title: 'macOS',
            summary: copy.chooseAny,
            badge: 'Mac / 桌面端',
            appLinks: buildLinks(toolLookup, ['clash-verge', 'mihomo-party', 'flclash', 'surge', 'stash', 'singbox']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['clash-verge', 'mihomo-party', 'flclash', 'stash'], 'clash'),
                buildRule(toolLookup, profileLookup, ['surge'], 'surge'),
                buildRule(toolLookup, profileLookup, ['singbox'], 'singbox'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'android',
            title: 'Android',
            summary: copy.chooseAny,
            badge: '安卓 / 移动端',
            appLinks: buildLinks(toolLookup, ['flclash', 'v2rayng', 'nekobox-android', 'cmfa', 'hiddify', 'singbox']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['flclash', 'cmfa'], 'clash'),
                buildRule(toolLookup, profileLookup, ['v2rayng', 'nekobox-android'], 'v2rayn', 'v2rayNG / NekoBox'),
                buildRule(toolLookup, profileLookup, ['hiddify', 'singbox'], 'singbox'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'ios',
            title: 'iPhone / iPad',
            summary: copy.chooseAny,
            badge: 'iOS / 移动端',
            appLinks: buildLinks(toolLookup, ['shadowrocket', 'stash', 'surge', 'loon', 'egern', 'singbox', 'karing']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['stash'], 'clash'),
                buildRule(toolLookup, profileLookup, ['shadowrocket'], 'v2rayn', 'Shadowrocket'),
                buildRule(toolLookup, profileLookup, ['surge', 'loon', 'egern'], 'surge'),
                buildRule(toolLookup, profileLookup, ['singbox', 'karing'], 'singbox'),
            ].filter(Boolean),
            quickKeys: ['shadowrocket', 'clash-family', 'surge', 'singbox'],
        },
        {
            key: 'linux',
            title: 'Linux',
            summary: copy.chooseAny,
            badge: 'Linux / 服务器',
            appLinks: buildLinks(toolLookup, ['clash-verge', 'flclash', 'nekobox-windows', 'hiddify', 'singbox']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['clash-verge', 'flclash'], 'clash'),
                buildRule(toolLookup, profileLookup, ['nekobox-windows'], 'v2rayn', 'NekoRai'),
                buildRule(toolLookup, profileLookup, ['hiddify', 'singbox'], 'singbox'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'router',
            title: locale === 'en-US' ? 'Routers & OpenWrt' : '路由器 / 软路由',
            summary: locale === 'en-US' ? 'OpenWrt, Asus, Xiaomi, Merlin routers.' : '适合 OpenWrt、华硕、小米及软路由网关。',
            badge: '网关 / 路由器',
            appLinks: buildLinks(toolLookup, ['openclash', 'passwall', 'shellcrash', 'homeproxy']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['openclash', 'shellcrash'], 'clash'),
                buildRule(toolLookup, profileLookup, ['passwall'], 'v2rayn', 'PassWall'),
                buildRule(toolLookup, profileLookup, ['homeproxy'], 'singbox'),
            ].filter(Boolean),
            quickKeys: [],
        },
    ]), [copy.chooseAny, locale, profileLookup, toolLookup]);

    if (quickActions.length === 0 && toolSites.length === 0) return null;

    return (
        <div className={`subscription-client-links${compact ? ' subscription-client-links--compact' : ''}`}>
            {hasSection(sections, 'devices') && (
                <div className="subscription-client-links-section">
                    {showHeading && (
                            <div className="subscription-client-links-heading">
                            <div className="subscription-client-links-title">{copy.sectionTitle}</div>
                            <div className="subscription-client-links-caption">{copy.sectionCaption}</div>
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
                                <div key={item.key} className={`subscription-device-card${compact ? ' subscription-device-card--compact' : ''}`}>
                                    <div className="subscription-device-card-head">
                                        <div className="subscription-device-title-row">
                                            <div className="subscription-device-title">{item.title}</div>
                                            {item.badge && <span className="badge badge-neutral">{item.badge}</span>}
                                        </div>
                                        {!compact && <div className="subscription-device-text">{item.summary}</div>}
                                    </div>
                                    {compact ? (
                                        <div className="subscription-device-compact-layout">
                                            <div className="subscription-device-compact-row">
                                                <div className="subscription-device-compact-label">{copy.downloads}</div>
                                                <div className="subscription-device-actions subscription-device-actions--downloads">
                                                    {item.appLinks.map((link) => (
                                                        <a
                                                            key={link.key}
                                                            href={link.url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="btn btn-secondary btn-sm subscription-device-download-btn"
                                                        >
                                                            {link.label}
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="subscription-device-compact-row">
                                                <div className="subscription-device-compact-label">{copy.recommended}</div>
                                                <div className="subscription-device-rules subscription-device-rules--compact">
                                                    {item.profileRules.map((rule) => (
                                                        <div key={rule.key} className="subscription-device-rule">
                                                            <span className="subscription-device-rule-tools">{rule.tools.join(' / ')}</span>
                                                            <span className="subscription-device-rule-arrow">{copy.chooseLabel}</span>
                                                            <span className="subscription-device-rule-profile">{rule.profileLabel}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {showImportMethods && (
                                                <div className="subscription-device-compact-row subscription-device-compact-row--push">
                                                    <div className="subscription-device-compact-label">{copy.importMethod}</div>
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
                                                            {copy.copyAddress}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            <div className="subscription-device-block">
                                                <div className="subscription-device-block-label">{copy.downloads}</div>
                                                <div className="subscription-device-actions subscription-device-actions--downloads">
                                                    {item.appLinks.map((link) => (
                                                        <a
                                                            key={link.key}
                                                            href={link.url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="btn btn-secondary btn-sm subscription-device-download-btn"
                                                        >
                                                            {link.label}
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="subscription-device-block">
                                                <div className="subscription-device-block-label">{copy.recommended}</div>
                                                <div className="subscription-device-rules">
                                                    {item.profileRules.map((rule) => (
                                                        <div key={rule.key} className="subscription-device-rule">
                                                            <span className="subscription-device-rule-tools">{rule.tools.join(' / ')}</span>
                                                            <span className="subscription-device-rule-arrow">{copy.chooseLabel}</span>
                                                            <span className="subscription-device-rule-profile">{rule.profileLabel}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {showImportMethods && (
                                                <div className="subscription-device-block subscription-device-block--push">
                                                    <div className="subscription-device-block-label">{copy.importMethod}</div>
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
                                                            {copy.copyAddress}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
