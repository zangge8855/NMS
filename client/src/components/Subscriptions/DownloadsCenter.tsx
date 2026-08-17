import React, { useMemo } from 'react';
import Header from '../Layout/Header';
import SectionHeader from '../UI/SectionHeader';
import SubscriptionClientLinks from './SubscriptionClientLinks';
import { useI18n } from '../../contexts/LanguageContext';
import { buildSubscriptionProfileBundle } from '../../utils/subscriptionProfiles';
import useMediaQuery from '../../hooks/useMediaQuery';

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

export default function DownloadsCenter() {
    const { locale } = useI18n();
    const isCompactViewport = useMediaQuery('(max-width: 768px)');
    const copy = useMemo(() => getDownloadsCopy(locale), [locale]);
    const bundle = useMemo(() => {
        const baseBundle = buildSubscriptionProfileBundle({}, locale);
        return {
            ...baseBundle,
            availableProfiles: baseBundle.profiles,
        };
    }, [locale]);

    return (
        <>
            <Header title={copy.title} />
            <div className="page-content page-content--wide page-enter subscriptions-page">
                <div className="card subscription-downloads-card subscription-downloads-page-card">
                    {!isCompactViewport ? (
                        <SectionHeader
                            compact divider
                            title={copy.panelTitle}
                            subtitle={copy.panelSubtitle}
                        />
                    ) : null}
                    <SubscriptionClientLinks
                        bundle={bundle}
                        showHeading={false}
                        showImportMethods={false}
                    />
                </div>
            </div>
        </>
    );
}
