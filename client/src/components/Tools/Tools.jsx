import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import Header from '../Layout/Header.jsx';
import { copyToClipboard } from '../../utils/format.js';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import {
    HiOutlineClipboard,
    HiOutlineArrowPath,
    HiOutlineWrench,
} from 'react-icons/hi2';
import EmptyState from '../UI/EmptyState.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import { readSessionSnapshot, writeSessionSnapshot } from '../../utils/sessionSnapshot.js';

const TOOLS_SNAPSHOT_TTL_MS = 2 * 60_000;

function buildToolsSnapshotKey(serverId) {
    return `tools_view_v1:${String(serverId || '').trim()}`;
}

function readToolsSnapshot(serverId) {
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) return null;

    const snapshot = readSessionSnapshot(buildToolsSnapshotKey(normalizedServerId), {
        maxAgeMs: TOOLS_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    return {
        tools: Array.isArray(snapshot?.tools) ? snapshot.tools : [],
        results: snapshot?.results && typeof snapshot.results === 'object' ? snapshot.results : {},
    };
}

function formatToolValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

export default function Tools() {
    const { activeServerId, panelApi } = useServer();
    const { locale, t } = useI18n();
    const navigate = useNavigate();
    const hasTargetServer = Boolean(activeServerId && activeServerId !== 'global');
    const cachedState = hasTargetServer ? readToolsSnapshot(activeServerId) : null;
    const toolsCatalogRequestIdRef = useRef(0);
    const toolExecutionRequestIdRef = useRef(0);
    const [results, setResults] = useState(() => cachedState?.results || {});
    const [loading, setLoading] = useState({});
    const [catalogLoading, setCatalogLoading] = useState(() => hasTargetServer && cachedState == null);
    const [tools, setTools] = useState(() => cachedState?.tools || []);
    const copy = useMemo(() => (
        locale === 'en-US'
            ? {
                catalogLoadFailed: 'Failed to load node tools',
                selectServerFirst: 'Select a server first',
                selectServerHint: 'Node tools only run against a single server. Open the server list and switch to a target node first.',
                goToServers: 'Open Servers',
                executeFailed: 'Run failed',
                copied: 'Copied',
                toolbarTitle: 'Node Tooling',
                toolbarSubtitle: 'Run helper endpoints exposed by the current node and copy the result when needed.',
                refresh: 'Refresh',
                executable: 'Available',
                unavailable: 'Unavailable',
                currentTool: 'Current node tool',
                generate: 'Run',
                copy: 'Copy',
                meta: 'Available {enabled} / {total}',
                emptyTitle: 'No node tools available',
                emptySubtitle: 'Refresh once first. If it is still empty, check whether the node panel exposes any tool endpoints.',
                refreshCatalog: 'Refresh Tool Catalog',
            }
            : {
                catalogLoadFailed: '加载节点工具失败',
                selectServerFirst: '请先选择一台服务器',
                selectServerHint: '节点工具仅支持单节点执行，请先打开服务器列表并切换到具体节点。',
                goToServers: '前往服务器管理',
                executeFailed: '执行失败',
                copied: '已复制',
                toolbarTitle: '节点工具集',
                toolbarSubtitle: '执行当前节点暴露的辅助工具接口，并支持直接复制结果。',
                refresh: '刷新',
                executable: '可执行',
                unavailable: '不可用',
                currentTool: '当前节点工具',
                generate: '生成',
                copy: '复制',
                meta: '可执行 {enabled} / {total}',
                emptyTitle: '暂无可用节点工具',
                emptySubtitle: '可以先刷新一次；如果仍为空，请检查节点面板是否暴露工具接口。',
                refreshCatalog: '刷新工具目录',
            }
    ), [locale]);

    const fetchCatalog = async (options = {}) => {
        if (!hasTargetServer) {
            toolsCatalogRequestIdRef.current += 1;
            setTools([]);
            return;
        }
        const preserveCurrent = options.preserveCurrent === true;
        const requestId = toolsCatalogRequestIdRef.current + 1;
        toolsCatalogRequestIdRef.current = requestId;
        if (!preserveCurrent) {
            setCatalogLoading(true);
        }
        try {
            const res = await api.get(`/capabilities/${activeServerId}`);
            if (requestId !== toolsCatalogRequestIdRef.current) return;
            const entries = Object.values(res.data?.obj?.tools || {})
                .filter((item) => item.uiAction === 'node_console' || item.uiAction === 'node_tools')
                .filter((item) => item.supportedByNms === true);
            setTools(entries);
        } catch (error) {
            if (requestId !== toolsCatalogRequestIdRef.current) return;
            const msg = error.response?.data?.msg || error.message || copy.catalogLoadFailed;
            toast.error(msg);
            if (!preserveCurrent) {
                setTools([]);
            }
        } finally {
            if (requestId === toolsCatalogRequestIdRef.current) {
                setCatalogLoading(false);
            }
        }
    };

    useEffect(() => {
        if (!hasTargetServer) {
            toolsCatalogRequestIdRef.current += 1;
            toolExecutionRequestIdRef.current += 1;
            setResults({});
            setTools([]);
            setCatalogLoading(false);
            return;
        }
        toolExecutionRequestIdRef.current += 1;
        const snapshot = readToolsSnapshot(activeServerId);
        setResults(snapshot?.results || {});
        setTools(snapshot?.tools || []);
        setCatalogLoading(snapshot == null);
        fetchCatalog({ preserveCurrent: snapshot != null });
    }, [activeServerId, hasTargetServer]);

    useEffect(() => {
        if (!hasTargetServer) return;
        writeSessionSnapshot(buildToolsSnapshotKey(activeServerId), {
            tools,
            results,
        });
    }, [activeServerId, hasTargetServer, results, tools]);

    const enabledTools = useMemo(
        () => tools.filter((item) => item.available !== false),
        [tools]
    );
    const toolbarMeta = copy.meta
        .replace('{enabled}', String(enabledTools.length))
        .replace('{total}', String(tools.length));

    const handleGenerate = async (tool) => {
        if (!hasTargetServer) {
            toast.error(copy.selectServerFirst);
            return;
        }
        const requestId = toolExecutionRequestIdRef.current + 1;
        toolExecutionRequestIdRef.current = requestId;
        setLoading((prev) => ({ ...prev, [tool.key]: true }));
        try {
            const method = tool.method || 'get';
            const res = await panelApi(method, tool.path);
            if (requestId !== toolExecutionRequestIdRef.current) return;
            setResults((prev) => ({
                ...prev,
                [tool.key]: formatToolValue(res.data?.obj),
            }));
        } catch (error) {
            if (requestId !== toolExecutionRequestIdRef.current) return;
            toast.error(error.response?.data?.msg || error.message || copy.executeFailed);
        }
        if (requestId === toolExecutionRequestIdRef.current) {
            setLoading((prev) => ({ ...prev, [tool.key]: false }));
        }
    };

    const handleCopy = async (text) => {
        await copyToClipboard(text);
        toast.success(copy.copied);
    };

    if (!hasTargetServer) {
        return (
            <>
                <Header title={t('pages.tools.title')} />
                <div className="page-content page-enter tools-page">
                    <EmptyState
                        title={copy.selectServerFirst}
                        subtitle={copy.selectServerHint}
                        icon={<HiOutlineWrench style={{ fontSize: '48px' }} />}
                        surface
                        action={(
                            <button type="button" className="btn btn-primary rounded-lg" onClick={() => navigate('/servers')}>
                                {copy.goToServers}
                            </button>
                        )}
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <Header title={t('pages.tools.title')} />
            <div className="page-content page-enter tools-page">
                <PageToolbar
                    className="card rounded-xl mb-6 tools-toolbar"
                    compact
                    main={(
                        <div className="tools-toolbar-copy">
                            <div className="tools-toolbar-title">{copy.toolbarTitle}</div>
                            <div className="tools-toolbar-note">{copy.toolbarSubtitle}</div>
                        </div>
                    )}
                    actions={(
                        <button className="btn btn-secondary btn-sm rounded-lg" onClick={fetchCatalog} disabled={catalogLoading}>
                            <HiOutlineArrowPath className={catalogLoading ? 'spinning' : ''} /> {copy.refresh}
                        </button>
                    )}
                    meta={<span>{toolbarMeta}</span>}
                />
                {tools.length === 0 && !catalogLoading ? (
                    <EmptyState
                        title={copy.emptyTitle}
                        subtitle={copy.emptySubtitle}
                        surface
                        action={(
                            <button type="button" className="btn btn-secondary rounded-lg" onClick={fetchCatalog}>
                                <HiOutlineArrowPath /> {copy.refreshCatalog}
                            </button>
                        )}
                    />
                ) : (
                    <div className="tools-grid">
                        {(enabledTools.length > 0 ? enabledTools : tools).map((tool) => (
                            <div className="card rounded-xl tool-card" key={tool.key}>
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title={tool.label || tool.key}
                                    subtitle={tool.description || copy.currentTool}
                                    meta={(
                                        <span className={`badge ${tool.available === false ? 'badge-danger' : 'badge-success'}`}>
                                            {tool.available === false ? copy.unavailable : copy.executable}
                                        </span>
                                    )}
                                />

                                {results[tool.key] && (
                                    <div className="tool-card-result">
                                        {results[tool.key]}
                                    </div>
                                )}

                                <div className="tool-card-actions">
                                    <button
                                        className="btn btn-primary btn-sm rounded-lg"
                                        onClick={() => handleGenerate(tool)}
                                        disabled={loading[tool.key] || tool.available === false}
                                    >
                                        {loading[tool.key] ? <span className="spinner" /> : <HiOutlineArrowPath />}
                                        {copy.generate}
                                    </button>
                                    {results[tool.key] && (
                                        <button className="btn btn-secondary btn-sm rounded-lg" onClick={() => handleCopy(results[tool.key])}>
                                            <HiOutlineClipboard /> {copy.copy}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}
