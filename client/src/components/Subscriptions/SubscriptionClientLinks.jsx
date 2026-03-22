import React, { useMemo } from 'react';
import { Card, Typography, Row, Col, Button, Tag, Space, Divider } from 'antd';
import { useI18n } from '../../contexts/LanguageContext.jsx';

const { Title, Text, Paragraph } = Typography;

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
            appLinks: buildLinks(toolLookup, ['flclash', 'v2rayn', 'sparkle']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['flclash', 'sparkle'], 'clash'),
                buildRule(toolLookup, profileLookup, ['v2rayn'], 'v2rayn', 'v2rayN'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'macos',
            title: 'macOS',
            summary: copy.chooseAny,
            appLinks: buildLinks(toolLookup, ['flclash', 'sparkle', 'v2rayn']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['flclash', 'sparkle'], 'clash'),
                buildRule(toolLookup, profileLookup, ['v2rayn'], 'v2rayn', 'v2rayN'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'android',
            title: 'Android',
            summary: copy.chooseAny,
            appLinks: buildLinks(toolLookup, ['flclash', 'cmfa', 'exclave']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['flclash', 'cmfa'], 'clash'),
                buildRule(toolLookup, profileLookup, ['exclave'], 'v2rayn', 'Exclave'),
            ].filter(Boolean),
            quickKeys: [],
        },
        {
            key: 'ios',
            title: 'iPhone / iPad',
            summary: copy.chooseAny,
            appLinks: buildLinks(toolLookup, ['shadowrocket', 'stash', 'surge', 'singbox']),
            profileRules: [
                buildRule(toolLookup, profileLookup, ['stash'], 'clash'),
                buildRule(toolLookup, profileLookup, ['shadowrocket'], 'v2rayn', 'Shadowrocket'),
                buildRule(toolLookup, profileLookup, ['surge'], 'surge'),
                buildRule(toolLookup, profileLookup, ['singbox'], 'singbox'),
            ].filter(Boolean),
            quickKeys: ['shadowrocket', 'clash-family', 'surge', 'singbox'],
        },
    ]), [copy.chooseAny, profileLookup, toolLookup]);

    if (quickActions.length === 0 && toolSites.length === 0) return null;

    return (
        <div style={{ marginTop: compact ? 0 : 24 }}>
            {hasSection(sections, 'devices') && (
                <div>
                    {showHeading && (
                        <div style={{ marginBottom: 24 }}>
                            <Title level={4}>{copy.sectionTitle}</Title>
                            <Paragraph type="secondary">{copy.sectionCaption}</Paragraph>
                        </div>
                    )}
                    <Row gutter={[16, 16]}>
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
                                <Col xs={24} md={compact ? 24 : 12} key={item.key}>
                                    <Card 
                                        size="small"
                                        title={<Text strong>{item.title}</Text>}
                                        extra={!compact && <Text type="secondary" style={{ fontSize: '12px' }}>{item.summary}</Text>}
                                    >
                                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                                            <div>
                                                <Text type="secondary" block style={{ marginBottom: 8 }}>{copy.downloads}</Text>
                                                <Space wrap>
                                                    {item.appLinks.map((link) => (
                                                        <Button
                                                            key={link.key}
                                                            href={link.url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            size="small"
                                                        >
                                                            {link.label}
                                                        </Button>
                                                    ))}
                                                </Space>
                                            </div>

                                            <div>
                                                <Text type="secondary" block style={{ marginBottom: 8 }}>{copy.recommended}</Text>
                                                {item.profileRules.map((rule) => (
                                                    <div key={rule.key} style={{ marginBottom: 4 }}>
                                                        <Text style={{ fontSize: '13px' }}>{rule.tools.join(' / ')}</Text>
                                                        <Text type="secondary" style={{ margin: '0 8px', fontSize: '12px' }}>{copy.chooseLabel}</Text>
                                                        <Tag color="blue" style={{ margin: 0 }}>{rule.profileLabel}</Tag>
                                                    </div>
                                                ))}
                                            </div>

                                            {showImportMethods && (
                                                <div>
                                                    <Text type="secondary" block style={{ marginBottom: 8 }}>{copy.importMethod}</Text>
                                                    {quickItems.length > 0 ? (
                                                        <Space wrap>
                                                            {quickItems.map((action) => (
                                                                <Button 
                                                                    key={`${item.key}-${action.key}`} 
                                                                    href={action.href} 
                                                                    type="primary"
                                                                    size="small"
                                                                >
                                                                    {action.label}
                                                                </Button>
                                                            ))}
                                                        </Space>
                                                    ) : (
                                                        <Text type="secondary" style={{ fontSize: '12px' }}>
                                                            {copy.copyAddress}
                                                        </Text>
                                                    )}
                                                </div>
                                            )}
                                        </Space>
                                    </Card>
                                </Col>
                            );
                        })}
                    </Row>
                </div>
            )}
        </div>
    );
}
