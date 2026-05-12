import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HiOutlineArrowPath, HiOutlineCheck, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../utils/format.js';
import RoutingRulesEditor from './tabs/RoutingRulesEditor.jsx';
import OutboundsEditor from './tabs/OutboundsEditor.jsx';
import DnsEditor from './tabs/DnsEditor.jsx';
import BalancersEditor from './tabs/BalancersEditor.jsx';

const TABS = ['routing', 'outbounds', 'dns', 'balancers'];

function getCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Xray Settings',
            subtitle: 'Manage routing rules, outbounds, DNS and balancers on a single node.',
            refresh: 'Refresh',
            selectServer: 'Select a server',
            selectServerHint: 'Switch to a specific node from the header to manage Xray settings.',
            loadError: 'Failed to load Xray configuration',
            loadingTitle: 'Loading Xray configuration...',
            unsupported: 'This node did not return a parseable Xray template configuration.',
            sources: { xrayTemplateConfig: 'Panel template', xrayConfig: 'Wrapped config', inline: 'Inline config', unknown: 'Unknown' },
            sectionLabels: {
                routing: 'Routing',
                outbounds: 'Outbounds',
                dns: 'DNS',
                balancers: 'Balancers',
            },
        };
    }
    return {
        title: 'Xray 设置',
        subtitle: '集中管理单个节点的路由、出站、DNS 与负载均衡器。',
        refresh: '刷新',
        selectServer: '请先选择节点',
        selectServerHint: '从顶部切换到具体节点后才能管理 Xray 设置。',
        loadError: '读取 Xray 配置失败',
        loadingTitle: '加载 Xray 配置中...',
        unsupported: '当前节点未返回可解析的 Xray 模板配置。',
        sources: { xrayTemplateConfig: '面板模板', xrayConfig: '包装配置', inline: '内联配置', unknown: '未知' },
        sectionLabels: {
            routing: '路由',
            outbounds: '出站',
            dns: 'DNS',
            balancers: '负载均衡',
        },
    };
}

export default function XrayConsole() {
    const { activeServerId } = useServer();
    const { locale } = useI18n();
    const copy = useMemo(() => getCopy(locale), [locale]);

    const [activeTab, setActiveTab] = useState('routing');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [snapshot, setSnapshot] = useState(null);
    const [source, setSource] = useState('');

    const singleServerSelected = useMemo(
        () => typeof activeServerId === 'string' && activeServerId !== 'global' && activeServerId.length > 0,
        [activeServerId]
    );

    const loadConfig = useCallback(async () => {
        if (!singleServerSelected) return;
        setLoading(true);
        try {
            const res = await api.get(`/xray/${activeServerId}/config`);
            const obj = res?.data?.obj;
            if (!obj || !obj.snapshot) {
                throw new Error(copy.unsupported);
            }
            setSnapshot(obj.snapshot);
            setSource(String(obj.source || ''));
        } catch (err) {
            const message = getErrorMessage(err) || copy.loadError;
            toast.error(message);
            setSnapshot(null);
            setSource('');
        } finally {
            setLoading(false);
        }
    }, [activeServerId, copy.loadError, copy.unsupported, singleServerSelected]);

    useEffect(() => {
        if (!singleServerSelected) {
            setSnapshot(null);
            return;
        }
        loadConfig();
    }, [activeServerId, singleServerSelected, loadConfig]);

    const handleSave = useCallback(async (section, payload) => {
        if (!singleServerSelected || saving) return;
        setSaving(true);
        try {
            const res = await api.put(`/xray/${activeServerId}/${section}`, payload);
            const next = res?.data?.obj;
            if (next?.snapshot) {
                setSnapshot(next.snapshot);
                if (next?.source) setSource(String(next.source));
            } else {
                await loadConfig();
            }
            toast.success(locale === 'en-US' ? 'Saved' : '已保存');
        } catch (err) {
            toast.error(getErrorMessage(err) || (locale === 'en-US' ? 'Save failed' : '保存失败'));
        } finally {
            setSaving(false);
        }
    }, [activeServerId, loadConfig, locale, saving, singleServerSelected]);

    return (
        <>
            <Header title={copy.title} subtitle={copy.subtitle} />
            <PageToolbar>
                <div className="flex items-center gap-2">
                    {source ? (
                        <span className="badge badge-neutral text-xs">
                            <HiOutlineCheck className="text-success" /> {copy.sources[source] || source}
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    className="btn btn-secondary rounded-lg flex items-center gap-2"
                    onClick={loadConfig}
                    disabled={!singleServerSelected || loading}
                >
                    <HiOutlineArrowPath className={loading ? 'animate-spin' : ''} />
                    {copy.refresh}
                </button>
            </PageToolbar>

            {!singleServerSelected ? (
                <EmptyState
                    icon={<HiOutlineExclamationTriangle />}
                    title={copy.selectServer}
                    subtitle={copy.selectServerHint}
                />
            ) : (
                <div className="rounded-xl border border-stroke-soft bg-surface-soft p-4">
                    <div className="flex flex-wrap gap-2 mb-4 border-b border-stroke-soft pb-3">
                        {TABS.map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                className={`px-3 py-1.5 rounded-md text-sm transition ${
                                    activeTab === tab
                                        ? 'bg-primary text-white'
                                        : 'bg-surface text-secondary hover:bg-surface-strong'
                                }`}
                                onClick={() => setActiveTab(tab)}
                            >
                                {copy.sectionLabels[tab]}
                            </button>
                        ))}
                    </div>

                    {loading && !snapshot ? (
                        <SectionHeader title={copy.loadingTitle} subtitle="" />
                    ) : null}

                    {snapshot ? (
                        <>
                            {activeTab === 'routing' && (
                                <RoutingRulesEditor
                                    locale={locale}
                                    value={snapshot.routing}
                                    onSave={(payload) => handleSave('routing', payload)}
                                    saving={saving}
                                />
                            )}
                            {activeTab === 'outbounds' && (
                                <OutboundsEditor
                                    locale={locale}
                                    value={snapshot.outbounds}
                                    onSave={(payload) => handleSave('outbounds', payload)}
                                    saving={saving}
                                />
                            )}
                            {activeTab === 'dns' && (
                                <DnsEditor
                                    locale={locale}
                                    value={snapshot.dns}
                                    onSave={(payload) => handleSave('dns', payload)}
                                    saving={saving}
                                />
                            )}
                            {activeTab === 'balancers' && (
                                <BalancersEditor
                                    locale={locale}
                                    value={snapshot.balancers}
                                    onSave={(payload) => handleSave('balancers', payload)}
                                    saving={saving}
                                />
                            )}
                        </>
                    ) : null}
                </div>
            )}
        </>
    );
}
