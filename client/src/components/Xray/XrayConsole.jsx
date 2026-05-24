import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HiOutlineArrowPath, HiOutlineCheck, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import PageServerSelector from '../UI/PageServerSelector.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import usePageServerTarget from '../../hooks/usePageServerTarget.js';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../utils/format.js';
import RoutingRulesEditor from './tabs/RoutingRulesEditor.jsx';
import OutboundsEditor from './tabs/OutboundsEditor.jsx';
import DnsEditor from './tabs/DnsEditor.jsx';
import BalancersEditor from './tabs/BalancersEditor.jsx';
import LogEditor from './tabs/LogEditor.jsx';
import PolicyEditor from './tabs/PolicyEditor.jsx';
import AdvancedEditor from './tabs/AdvancedEditor.jsx';

const TABS = ['routing', 'outbounds', 'dns', 'balancers', 'log', 'policy', 'advanced'];

function getCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Xray Settings',
            subtitle: 'Manage routing rules, outbounds, DNS and balancers on a single node.',
            refresh: 'Refresh',
            selectServer: 'Select a server',
            selectServerHint: 'Choose a node to manage its Xray settings.',
            confirmServerTitle: 'Confirm target node',
            confirmServerHint: 'A node is preselected. Open it to load Xray settings.',
            noServersHint: 'Add a server before managing Xray settings.',
            goToServers: 'Open Servers',
            serverSelectorLabel: 'Target node',
            serverPlaceholder: 'Select node',
            openSelectedServer: 'Open Node',
            loadError: 'Failed to load Xray configuration',
            loadingTitle: 'Loading Xray configuration...',
            unsupported: 'This node did not return a parseable Xray template configuration.',
            sources: { xrayTemplateConfig: 'Panel template', xrayConfig: 'Wrapped config', inline: 'Inline config', unknown: 'Unknown' },
            sectionLabels: {
                routing: 'Routing',
                outbounds: 'Outbounds',
                dns: 'DNS',
                balancers: 'Balancers',
                log: 'Log Settings',
                policy: 'Policy Settings',
                advanced: 'Advanced (Full JSON)',
            },
        };
    }
    return {
        title: 'Xray 设置',
        subtitle: '集中管理单个节点的路由、出站、DNS 与负载均衡器。',
        refresh: '刷新',
        selectServer: '请先选择节点',
        selectServerHint: '选择一个节点后管理它的 Xray 设置。',
        confirmServerTitle: '确认目标节点',
        confirmServerHint: '已预选节点，点击打开节点后加载 Xray 设置。',
        noServersHint: '请先添加服务器，再管理 Xray 设置。',
        goToServers: '前往服务器管理',
        serverSelectorLabel: '目标节点',
        serverPlaceholder: '选择节点',
        openSelectedServer: '打开节点',
        loadError: '读取 Xray 配置失败',
        loadingTitle: '加载 Xray 配置中...',
        unsupported: '当前节点未返回可解析的 Xray 模板配置。',
        sources: { xrayTemplateConfig: '面板模板', xrayConfig: '包装配置', inline: '内联配置', unknown: '未知' },
        sectionLabels: {
            routing: '路由',
            outbounds: '出站',
            dns: 'DNS',
            balancers: '负载均衡',
            log: '日志配置',
            policy: '系统策略',
            advanced: '高级 (完整 JSON)',
        },
    };
}

export default function XrayConsole() {
    const { activeServerId, servers = [] } = useServer();
    const { locale } = useI18n();
    const navigate = useNavigate();
    const copy = useMemo(() => getCopy(locale), [locale]);
    const {
        serverList,
        hasServers,
        targetServerId,
        hasTargetServer,
        isUsingPageServer,
        draftServerId,
        setDraftServerId,
        setPageTargetServerId,
        commitDraftServer,
    } = usePageServerTarget({ activeServerId, servers });

    const [activeTab, setActiveTab] = useState('routing');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [snapshot, setSnapshot] = useState(null);
    const [template, setTemplate] = useState(null);
    const [source, setSource] = useState('');

    const loadConfig = useCallback(async () => {
        if (!hasTargetServer) return;
        setLoading(true);
        try {
            const res = await api.get(`/xray/${targetServerId}/config`);
            const obj = res?.data?.obj;
            if (!obj || !obj.snapshot) {
                throw new Error(copy.unsupported);
            }
            setSnapshot(obj.snapshot);
            setTemplate(obj.template || null);
            setSource(String(obj.source || ''));
        } catch (err) {
            const message = getErrorMessage(err) || copy.loadError;
            toast.error(message);
            setSnapshot(null);
            setTemplate(null);
            setSource('');
        } finally {
            setLoading(false);
        }
    }, [copy.loadError, copy.unsupported, hasTargetServer, targetServerId]);

    useEffect(() => {
        if (!hasTargetServer) {
            setSnapshot(null);
            setTemplate(null);
            setSource('');
            return;
        }
        loadConfig();
    }, [hasTargetServer, loadConfig, targetServerId]);

    const handleSave = useCallback(async (section, payload) => {
        if (!hasTargetServer || saving) return;
        setSaving(true);
        try {
            const res = await api.put(`/xray/${targetServerId}/${section}`, payload);
            const next = res?.data?.obj;
            if (next?.snapshot) {
                setSnapshot(next.snapshot);
                if (next?.template) setTemplate(next.template);
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
    }, [hasTargetServer, loadConfig, locale, saving, targetServerId]);

    const serverSelectionAction = hasServers ? (
        <div className="page-server-selection-action">
            <PageServerSelector
                servers={serverList}
                value={draftServerId}
                onChange={setDraftServerId}
                label={copy.serverSelectorLabel}
                placeholder={copy.serverPlaceholder}
            />
            <button
                type="button"
                className="btn btn-primary"
                onClick={commitDraftServer}
                disabled={!draftServerId}
            >
                {copy.openSelectedServer}
            </button>
        </div>
    ) : (
        <button type="button" className="btn btn-primary" onClick={() => navigate('/servers')}>
            {copy.goToServers}
        </button>
    );
    const hasDraftServer = hasServers && Boolean(draftServerId);

    return (
        <>
            <Header title={copy.title} />
            <div className="page-content page-content--wide page-enter xray-page">
                {hasTargetServer ? (
                    <PageToolbar
                        className="card mb-6 xray-toolbar"
                        compact
                        main={(
                            <div className="xray-toolbar-meta">
                                <span className="text-sm text-muted">{copy.subtitle}</span>
                                {source ? (
                                    <span className="badge badge-neutral">
                                        <HiOutlineCheck /> {copy.sources[source] || source}
                                    </span>
                                ) : null}
                            </div>
                        )}
                        actions={(
                            <>
                                {isUsingPageServer && hasServers ? (
                                    <PageServerSelector
                                        servers={serverList}
                                        value={targetServerId}
                                        onChange={setPageTargetServerId}
                                        label={copy.serverSelectorLabel}
                                        placeholder={copy.serverPlaceholder}
                                    />
                                ) : null}
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={loadConfig}
                                    disabled={loading}
                                >
                                    <HiOutlineArrowPath className={loading ? 'spinning' : ''} />
                                    {copy.refresh}
                                </button>
                            </>
                        )}
                    />
                ) : null}

                {!hasTargetServer ? (
                    <EmptyState
                        icon={<HiOutlineExclamationTriangle />}
                        title={hasDraftServer ? copy.confirmServerTitle : copy.selectServer}
                        subtitle={hasServers ? (hasDraftServer ? copy.confirmServerHint : copy.selectServerHint) : copy.noServersHint}
                        surface
                        action={serverSelectionAction}
                    />
                ) : (
                    <div className="card xray-workbench">
                        <div className="tabs xray-tabs" role="tablist" aria-label={copy.title}>
                            {TABS.map((tab) => (
                                <button
                                    key={tab}
                                    type="button"
                                    className={`tab ${activeTab === tab ? 'active' : ''}`}
                                    role="tab"
                                    aria-selected={activeTab === tab}
                                    onClick={() => setActiveTab(tab)}
                                >
                                    {copy.sectionLabels[tab]}
                                </button>
                            ))}
                        </div>

                        {loading && !snapshot ? (
                            <EmptyState
                                title={copy.loadingTitle}
                                size="compact"
                                icon={<span className="spinner spinner-20" aria-hidden="true" />}
                            />
                        ) : null}

                        {snapshot ? (
                            <div className="xray-tab-panel">
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
                                {activeTab === 'log' && (
                                    <LogEditor
                                        locale={locale}
                                        value={template?.log}
                                        onSave={(payload) => handleSave('log', payload)}
                                        saving={saving}
                                    />
                                )}
                                {activeTab === 'policy' && (
                                    <PolicyEditor
                                        locale={locale}
                                        value={template?.policy}
                                        onSave={(payload) => handleSave('policy', payload)}
                                        saving={saving}
                                    />
                                )}
                                {activeTab === 'advanced' && (
                                    <AdvancedEditor
                                        locale={locale}
                                        value={template}
                                        onSave={(payload) => handleSave('template', payload)}
                                        saving={saving}
                                    />
                                )}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </>
    );
}
