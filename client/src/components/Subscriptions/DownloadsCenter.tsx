import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineMagnifyingGlass, HiOutlineXMark } from 'react-icons/hi2';
import Header from '../Layout/Header';
import SectionHeader from '../UI/SectionHeader';
import EmptyState from '../UI/EmptyState';
import SubscriptionClientLinks from './SubscriptionClientLinks';
import { useI18n } from '../../contexts/LanguageContext';
import { getOpsUiCopy } from '../../i18n/opsUiCopy';
import { buildSubscriptionProfileBundle, type ToolSiteItem } from '../../utils/subscriptionProfiles';
import useMediaQuery from '../../hooks/useMediaQuery';

const TOOL_PLATFORM_KEYWORDS: Record<string, string[]> = {
    'clash-verge': ['windows', 'macos', 'mac', 'linux', 'desktop', '桌面', 'clash', 'mihomo'],
    'mihomo-party': ['windows', 'macos', 'mac', 'desktop', '桌面', 'clash', 'mihomo'],
    flclash: ['windows', 'macos', 'mac', 'android', 'linux', 'desktop', 'mobile', '桌面', '安卓', 'clash', 'mihomo'],
    v2rayn: ['windows', 'desktop', '桌面', 'xray', 'v2ray'],
    v2rayng: ['android', 'mobile', '安卓', 'xray', 'v2ray'],
    'nekobox-android': ['android', 'mobile', '安卓', 'sing-box', 'singbox'],
    'nekobox-windows': ['linux', 'windows', 'desktop', 'nekoray', 'nekorai', 'sing-box', 'singbox'],
    cmfa: ['android', 'mobile', '安卓', 'clash', 'mihomo'],
    shadowrocket: ['ios', 'iphone', 'ipad', 'apple', 'mobile', '小火箭'],
    stash: ['ios', 'iphone', 'ipad', 'macos', 'mac', 'apple', 'clash', 'mihomo'],
    surge: ['ios', 'iphone', 'ipad', 'macos', 'mac', 'apple'],
    loon: ['ios', 'iphone', 'ipad', 'apple'],
    egern: ['ios', 'iphone', 'ipad', 'apple'],
    singbox: ['windows', 'macos', 'mac', 'android', 'ios', 'iphone', 'ipad', 'linux', 'sing-box'],
    hiddify: ['windows', 'android', 'linux', 'sing-box'],
    karing: ['ios', 'iphone', 'ipad', 'apple', 'sing-box'],
    openclash: ['router', 'openwrt', 'gateway', '路由器', '软路由', 'clash', 'mihomo'],
    passwall: ['router', 'openwrt', 'gateway', '路由器', '软路由'],
    shellcrash: ['router', 'openwrt', 'gateway', '路由器', '软路由', 'clash', 'mihomo'],
    homeproxy: ['router', 'openwrt', 'gateway', '路由器', '软路由', 'sing-box'],
};

function getDownloadsCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Downloads',
            panelTitle: 'Client Downloads',
            panelSubtitle: 'Pick a client for your device. Import the subscription back in Subscriptions.',
        };
    }

    return {
        title: '软件下载',
        panelTitle: '客户端下载',
        panelSubtitle: '先按设备下载客户端，导入订阅请回订阅中心。',
    };
}

function matchesToolQuery(site: ToolSiteItem, normalizedQuery: string): boolean {
    if (!normalizedQuery) return true;
    const extraPlatforms = TOOL_PLATFORM_KEYWORDS[site.key] || [];
    const linkLabels = Array.isArray(site.links) ? site.links.map((link) => link.label) : [];
    const haystack = [
        site.key,
        site.label,
        site.category,
        site.core,
        ...linkLabels,
        ...extraPlatforms,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes(normalizedQuery);
}

export default function DownloadsCenter() {
    const { locale } = useI18n();
    const isCompactViewport = useMediaQuery('(max-width: 768px)');
    const copy = useMemo(() => getDownloadsCopy(locale), [locale]);
    const opsCopy = useMemo(() => getOpsUiCopy(locale), [locale]);
    const [filterQuery, setFilterQuery] = useState('');
    const filterInputRef = useRef<HTMLInputElement | null>(null);

    const bundle = useMemo(() => {
        const baseBundle = buildSubscriptionProfileBundle({}, locale);
        return {
            ...baseBundle,
            availableProfiles: baseBundle.profiles,
        };
    }, [locale]);

    const normalizedQuery = filterQuery.trim().toLowerCase();
    const hasActiveFilter = normalizedQuery.length > 0;

    const filteredBundle = useMemo(() => {
        const baseToolSites = Array.isArray(bundle?.toolSites)
            ? bundle.toolSites.filter((item) => (
                String(item?.url || '').trim()
                || (Array.isArray(item?.links) && item.links.some((link) => String(link?.url || '').trim()))
            ))
            : [];

        if (!hasActiveFilter) {
            return {
                ...bundle,
                toolSites: baseToolSites,
            };
        }

        const filteredToolSites = baseToolSites.filter((site) => matchesToolQuery(site, normalizedQuery));
        return {
            ...bundle,
            toolSites: filteredToolSites,
            importActions: [],
        };
    }, [bundle, hasActiveFilter, normalizedQuery]);

    const hasAnyToolSites = (Array.isArray(bundle?.toolSites) && bundle.toolSites.some((item) => (
        String(item?.url || '').trim()
        || (Array.isArray(item?.links) && item.links.some((link) => String(link?.url || '').trim()))
    ))) || (Array.isArray(bundle?.importActions) && bundle.importActions.length > 0);

    const hasFilteredResults = (
        (Array.isArray(filteredBundle?.toolSites) && filteredBundle.toolSites.length > 0)
        || (Array.isArray(filteredBundle?.importActions) && filteredBundle.importActions.length > 0)
    );

    const handleClearFilter = () => {
        setFilterQuery('');
        requestAnimationFrame(() => filterInputRef.current?.focus());
    };

    return (
        <>
            <Header title={copy.title} />
            <div className="page-content page-content--wide page-enter subscriptions-page">
                <section
                    className="card subscription-downloads-card subscription-downloads-page-card"
                    aria-label={opsCopy.downloads.regionLabel}
                >
                    {!isCompactViewport ? (
                        <SectionHeader
                            compact
                            divider
                            title={copy.panelTitle}
                            subtitle={copy.panelSubtitle}
                        />
                    ) : null}

                    {hasAnyToolSites ? (
                        <div className="downloads-filter-toolbar">
                            <div className="downloads-filter-input-wrap">
                                <HiOutlineMagnifyingGlass className="downloads-filter-icon" aria-hidden="true" />
                                <input
                                    ref={filterInputRef}
                                    type="search"
                                    name="downloadsFilterQuery"
                                    className="form-input downloads-filter-input"
                                    value={filterQuery}
                                    onChange={(event) => setFilterQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape' && filterQuery) {
                                            event.preventDefault();
                                            handleClearFilter();
                                        }
                                    }}
                                    placeholder={opsCopy.downloads.filterPlaceholder}
                                    aria-label={opsCopy.downloads.filterAriaLabel}
                                />
                            </div>
                            {hasActiveFilter && (
                                <div className="downloads-filter-meta">
                                    <span className="downloads-filter-count" aria-live="polite">
                                        {opsCopy.downloads.matchedCount.replace('{count}', String(filteredBundle.toolSites.length))}
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={handleClearFilter}
                                        aria-label={opsCopy.downloads.clearFilter}
                                    >
                                        <HiOutlineXMark aria-hidden="true" />
                                        <span>{opsCopy.downloads.clearFilter}</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : null}

                    {!hasAnyToolSites ? (
                        <div className="downloads-empty-wrap">
                            <EmptyState
                                size="compact"
                                title={opsCopy.downloads.emptyTitle}
                                subtitle={opsCopy.downloads.emptySubtitle}
                                action={(
                                    <Link to="/subscriptions" className="btn btn-secondary btn-sm">
                                        {opsCopy.downloads.backToSubscriptions}
                                    </Link>
                                )}
                            />
                        </div>
                    ) : !hasFilteredResults ? (
                        <div className="downloads-empty-wrap">
                            <EmptyState
                                size="compact"
                                hideIcon
                                title={opsCopy.downloads.filteredEmptyTitle}
                                subtitle={opsCopy.downloads.filteredEmptySubtitle}
                                action={(
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={handleClearFilter}
                                    >
                                        {opsCopy.downloads.clearFilter}
                                    </button>
                                )}
                            />
                        </div>
                    ) : (
                        <SubscriptionClientLinks
                            bundle={filteredBundle}
                            showHeading={false}
                            showImportMethods={false}
                        />
                    )}
                </section>
            </div>
        </>
    );
}
