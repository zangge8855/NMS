import React, { useMemo } from 'react';
import { Card, Typography } from 'antd';
import Header from '../Layout/Header.jsx';
import SubscriptionClientLinks from './SubscriptionClientLinks.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { buildSubscriptionProfileBundle } from '../../utils/subscriptionProfiles.js';

const { Title, Paragraph } = Typography;

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
            <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
                <Card 
                    title={<Title level={4} style={{ margin: 0 }}>{copy.panelTitle}</Title>}
                >
                    <Paragraph type="secondary">{copy.panelSubtitle}</Paragraph>
                    <SubscriptionClientLinks
                        bundle={bundle}
                        showHeading={false}
                        showImportMethods={false}
                    />
                </Card>
            </div>
        </>
    );
}
