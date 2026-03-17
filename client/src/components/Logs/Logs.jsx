import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import {
    HiOutlineArrowPath,
    HiOutlineDocumentText,
    HiOutlineFunnel,
    HiOutlineClipboardDocument,
    HiOutlinePauseCircle,
    HiOutlinePlayCircle,
    HiOutlineServerStack,
    HiOutlineTrash,
    HiOutlineExclamationTriangle,
    HiOutlineArrowsPointingOut,
    HiOutlineArrowsPointingIn,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import EmptyState from '../UI/EmptyState.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';

function getSummaryToneMeta(tone) {
    if (tone === 'danger') {
        return {
            badge: 'badge-danger',
            iconColor: 'var(--accent-danger)',
            style: {
                borderColor: 'var(--accent-danger)',
                background: 'var(--accent-danger-bg)',
                color: 'var(--accent-danger)',
            },
        };
    }
    if (tone === 'warning') {
        return {
            badge: 'badge-warning',
            iconColor: 'var(--accent-warning)',
            style: {
                borderColor: 'var(--accent-warning)',
                background: 'var(--accent-warning-bg)',
                color: 'var(--accent-warning)',
            },
        };
    }
    return {
        badge: 'badge-info',
        iconColor: 'var(--accent-info)',
        style: {
            borderColor: 'var(--accent-info)',
            background: 'var(--accent-info-bg)',
            color: 'var(--accent-info)',
        },
    };
}

function detectLogLevel(line) {
    const lower = line.toLowerCase();
    if (lower.includes('[error]') || lower.includes('error:') || lower.includes('level=error')) return 'error';
    if (lower.includes('[warning]') || lower.includes('warn:') || lower.includes('level=warning')) return 'warning';
    if (lower.includes('[info]') || lower.includes('level=info')) return 'info';
    if (lower.includes('[debug]') || lower.includes('level=debug')) return 'debug';
    return 'none';
}

function levelColor(line) {
    const level = detectLogLevel(line);
    if (level === 'error') return 'var(--accent-danger)';
    if (level === 'warning') return 'var(--accent-warning)';
    if (level === 'info') return 'var(--accent-info)';
    if (level === 'debug') return 'var(--text-muted)';
    return 'var(--text-secondary)';
}

function lineMatchesLevel(line, level) {
    if (!level) return true;
    return detectLogLevel(line) === level;
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedLine(line, keyword) {
    const text = String(line || '');
    const query = String(keyword || '').trim();
    if (!query) return text;
    const matcher = new RegExp(`(${escapeRegExp(query)})`, 'ig');
    const parts = text.split(matcher);
    return parts.map((part, index) => (
        part.toLowerCase() === query.toLowerCase()
            ? <mark key={`${part}-${index}`} className="log-mark">{part}</mark>
            : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    ));
}

function LogLine({ line, showServer, serverName, highlight, index }) {
    const color = levelColor(line);
    const level = detectLogLevel(line);
    return (
        <div
            className={`log-line log-line-dynamic ${showServer && serverName ? 'has-server' : 'no-server'}`}
            style={{ '--log-line-color': color }}
            data-level={level}
        >
            <span className="log-line-index">{String(index + 1).padStart(3, '0')}</span>
            {showServer && serverName && (
                <span className="badge badge-info badge-tiny">
                    {serverName}
                </span>
            )}
            <span className="log-line-content">{renderHighlightedLine(line, highlight)}</span>
        </div>
    );
}

function extractLogTimestamp(line) {
    const text = String(line || '');
    const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
    if (isoMatch) {
        const ts = new Date(isoMatch[0]).getTime();
        if (Number.isFinite(ts)) return ts;
    }

    const localMatch = text.match(/\d{4}[/-]\d{2}[/-]\d{2}[ T]\d{2}:\d{2}:\d{2}/);
    if (localMatch) {
        const normalized = localMatch[0].replace(/\//g, '-');
        const ts = new Date(normalized).getTime();
        if (Number.isFinite(ts)) return ts;
    }

    return null;
}

export default function Logs({ embedded = false, sourceMode = 'auto', displayLabel = '' }) {
    const { activeServerId, activeServer, servers } = useServer();
    const { t, locale } = useI18n();
    const isGlobal = activeServerId === 'global';
    const lockedSourceMode = ['auto', 'panel', 'system', 'xray'].includes(sourceMode) ? sourceMode : 'auto';
    const logLevels = useMemo(() => ([
        { value: '', label: t('pages.logs.levelAll') },
        { value: 'debug', label: t('pages.logs.levelDebug') },
        { value: 'info', label: t('pages.logs.levelInfo') },
        { value: 'warning', label: t('pages.logs.levelWarning') },
        { value: 'error', label: t('pages.logs.levelError') },
        { value: 'none', label: t('pages.logs.levelNone') },
    ]), [t]);
    const logSources = useMemo(() => ([
        { value: 'panel', label: t('pages.logs.sourcePanel') },
        { value: 'xray', label: t('pages.logs.sourceXray') },
        { value: 'system', label: t('pages.logs.sourceSystem') },
    ]), [t]);

    // State
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [keywords, setKeywords] = useState('');
    const [levelFilter, setLevelFilter] = useState('');
    const [selectedSource, setSelectedSource] = useState('panel');
    const [count, setCount] = useState(100);
    const [fetchSummary, setFetchSummary] = useState(null);
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
    const [wrapLines, setWrapLines] = useState(true);
    const [immersiveMode, setImmersiveMode] = useState(false);

    // Global mode: server selection
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const hasInitializedGlobalSelectionRef = useRef(false);

    // Only auto-select all servers the first time we enter global mode.
    // After that, an empty selection is treated as an intentional filter state.
    useEffect(() => {
        if (!isGlobal) {
            hasInitializedGlobalSelectionRef.current = false;
            return;
        }

        const availableServerIds = servers.map((server) => server.id);
        if (availableServerIds.length === 0) {
            setSelectedServerIds([]);
            return;
        }

        if (!hasInitializedGlobalSelectionRef.current) {
            hasInitializedGlobalSelectionRef.current = true;
            setSelectedServerIds((prev) => {
                const preserved = prev.filter((id) => availableServerIds.includes(id));
                return preserved.length > 0 ? preserved : availableServerIds;
            });
            return;
        }

        setSelectedServerIds((prev) => prev.filter((id) => availableServerIds.includes(id)));
    }, [isGlobal, servers]);

    const logContainerRef = useRef(null);
    const resolvedSource = lockedSourceMode === 'auto'
        ? selectedSource
        : lockedSourceMode;
    const activeSourceMeta = logSources.find((item) => item.value === resolvedSource) || logSources[0];
    const activeLevelMeta = logLevels.find((item) => item.value === levelFilter) || null;
    const sourceLabel = String(displayLabel || '').trim() || (
        activeSourceMeta.label || t('pages.logs.sourcePanel')
    );
    const fetchSummaryMeta = getSummaryToneMeta(fetchSummary?.tone);
    // Reuse the shared form surface and rounded tokens so controls stay visually consistent.
    const filterSelectClassName = 'form-select rounded-lg';
    const keywordInputClassName = 'form-input w-200 rounded-lg';
    const serverCheckboxClassName = 'checkbox-14 rounded';
    const activeLogFilterCount = [
        String(keywords || '').trim(),
        levelFilter,
        lockedSourceMode === 'auto' && selectedSource !== 'panel' ? selectedSource : '',
    ].filter(Boolean).length;
    const logToolbarMeta = [
        locale === 'en-US' ? `${count} lines` : `${count} 行`,
        activeLogFilterCount > 0
            ? (locale === 'en-US' ? `${activeLogFilterCount} filters` : `${activeLogFilterCount} 个筛选`)
            : (locale === 'en-US' ? 'No filters' : '无筛选'),
        isGlobal
            ? (locale === 'en-US'
                ? `Nodes ${selectedServerIds.length}/${servers.length}`
                : `节点 ${selectedServerIds.length}/${servers.length}`)
            : null,
        String(keywords || '').trim()
            ? (locale === 'en-US' ? `Keyword: ${keywords}` : `关键词: ${keywords}`)
            : null,
    ].filter(Boolean);

    const fetchSingleLogs = useCallback(async () => {
        if (!activeServerId || activeServerId === 'global') return;
        setLoading(true);
        setFetchSummary(null);
        try {
            const res = await api.get(`/servers/${encodeURIComponent(activeServerId)}/logs`, {
                params: { source: resolvedSource, count },
            });
            const payload = res.data?.obj || {};
            const lines = Array.isArray(payload.lines) ? payload.lines : [];
            setLogs(lines.map((line) => ({ line, serverName: activeServer?.name || '' })));
            if (payload.supported === false || payload.warning) {
                setFetchSummary({
                    tone: payload.supported === false ? 'warning' : 'info',
                    message: payload.warning || t('pages.logs.sourceUnsupported', { source: sourceLabel }),
                });
            }
        } catch (err) {
            const message = err.response?.data?.msg || err.message;
            toast.error(t('pages.logs.fetchFailed', { message }));
            setFetchSummary({
                tone: 'danger',
                message: t('pages.logs.loadFailed', { source: sourceLabel, message }),
            });
            setLogs([]);
        }
        setLoading(false);
    }, [activeServerId, activeServer?.name, count, resolvedSource, sourceLabel, t]);

    const fetchGlobalLogs = useCallback(async () => {
        if (!isGlobal || selectedServerIds.length === 0) {
            setLogs([]);
            setFetchSummary({
                tone: 'info',
                message: t('pages.logs.selectNodeHint'),
            });
            return;
        }
        setLoading(true);
        setFetchSummary(null);
        try {
            const targetServers = servers.filter(s => selectedServerIds.includes(s.id));
            const results = await Promise.allSettled(
                targetServers.map(async (server) => {
                    const res = await api.get(`/servers/${encodeURIComponent(server.id)}/logs`, {
                        params: {
                            source: resolvedSource,
                            count: Math.max(1, Math.ceil(count / targetServers.length)),
                        },
                    });
                    const payload = res.data?.obj || {};
                    const lines = Array.isArray(payload.lines) ? payload.lines : [];
                    return lines.map((line, index) => ({
                        line,
                        serverName: server.name,
                        sortTs: extractLogTimestamp(line),
                        seq: index,
                    }));
                })
            );

            const allLogs = [];
            const failedServers = [];
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    allLogs.push(...result.value);
                } else {
                    failedServers.push(result.reason?.response?.data?.msg || result.reason?.message || '未知错误');
                }
            }
            allLogs.sort((left, right) => {
                if (left.sortTs !== null && right.sortTs !== null && left.sortTs !== right.sortTs) {
                    return left.sortTs - right.sortTs;
                }
                return left.seq - right.seq;
            });
            setLogs(allLogs);
            if (failedServers.length > 0) {
                setFetchSummary({
                    tone: 'warning',
                    message: t('pages.logs.partialFailed', {
                        source: sourceLabel,
                        failed: failedServers.length,
                        total: targetServers.length,
                    }),
                });
            } else {
                setFetchSummary(null);
            }
        } catch (err) {
            toast.error(t('pages.logs.globalFetchFailed', { message: err.message || t('pages.logs.unknownError') }));
            setFetchSummary({
                tone: 'danger',
                message: t('pages.logs.globalLoadFailed', {
                    source: sourceLabel,
                    message: err.message || t('pages.logs.unknownError'),
                }),
            });
            setLogs([]);
        }
        setLoading(false);
    }, [isGlobal, selectedServerIds, servers, count, resolvedSource, sourceLabel, t]);

    const fetchLogs = isGlobal ? fetchGlobalLogs : fetchSingleLogs;

    useEffect(() => {
        if (activeServerId) fetchLogs();
    }, [activeServerId, fetchLogs]);

    useEffect(() => {
        if (autoScrollEnabled && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [autoScrollEnabled, logs]);

    const filteredLogs = useMemo(() => {
        let result = logs;
        if (keywords.trim()) {
            const kw = keywords.toLowerCase();
            result = result.filter(entry => entry.line.toLowerCase().includes(kw));
        }
        if (levelFilter) {
            result = result.filter((entry) => lineMatchesLevel(entry.line, levelFilter));
        }
        return result;
    }, [keywords, levelFilter, logs]);

    const copyLogs = () => {
        const text = filteredLogs.map(e =>
            isGlobal ? `[${e.serverName}] ${e.line}` : e.line
        ).join('\n');
        navigator.clipboard.writeText(text).then(
            () => toast.success(t('pages.logs.copySuccess')),
            () => toast.error(t('pages.logs.copyError'))
        );
    };

    const clearViewer = () => {
        setLogs([]);
        setFetchSummary({
            tone: 'info',
            message: t('pages.logs.viewerCleared'),
        });
    };

    const toggleServer = (serverId) => {
        setSelectedServerIds(prev =>
            prev.includes(serverId)
                ? prev.filter(id => id !== serverId)
                : [...prev, serverId]
        );
    };

    const selectAllServers = () => setSelectedServerIds(servers.map(s => s.id));
    const selectNoneServers = () => setSelectedServerIds([]);

    return (
        <>
            {!embedded && <Header title={isGlobal ? `${t('pages.logs.clusterPrefix')}${sourceLabel}` : sourceLabel} />}
            <div className={`${embedded ? '' : 'page-content page-enter '}logs-page${immersiveMode ? ' logs-page-immersive' : ''}`.trim()}>
                {/* Toolbar */}
                <PageToolbar
                    className="card rounded-xl mb-4 logs-toolbar"
                    main={(
                        <>
                            <HiOutlineFunnel className="text-muted" />
                            <select
                                className={`${filterSelectClassName} w-120`}
                                value={levelFilter}
                                onChange={e => setLevelFilter(e.target.value)}
                            >
                                {logLevels.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                            </select>

                            <select
                                className={`${filterSelectClassName} w-100`}
                                value={count}
                                onChange={e => setCount(Number(e.target.value))}
                            >
                                <option value={50}>{t('pages.logs.lineOption', { count: 50 })}</option>
                                <option value={100}>{t('pages.logs.lineOption', { count: 100 })}</option>
                                <option value={200}>{t('pages.logs.lineOption', { count: 200 })}</option>
                                <option value={500}>{t('pages.logs.lineOption', { count: 500 })}</option>
                            </select>

                            {lockedSourceMode === 'auto' && (
                                <select
                                    className={`${filterSelectClassName} w-140`}
                                    value={selectedSource}
                                    onChange={(e) => setSelectedSource(e.target.value)}
                                >
                                    {logSources.map((item) => (
                                        <option key={item.value} value={item.value}>{item.label}</option>
                                    ))}
                                </select>
                            )}

                            <input
                                className={keywordInputClassName}
                                placeholder={t('pages.logs.keywordPlaceholder')}
                                value={keywords}
                                onChange={e => setKeywords(e.target.value)}
                            />
                        </>
                    )}
                    actions={(
                        <>
                            <div className="logs-toolbar-toggle-group" role="group" aria-label={locale === 'en-US' ? 'Viewer controls' : '查看控制'}>
                                <button
                                    className="btn btn-ghost btn-sm rounded-lg"
                                    onClick={() => setAutoScrollEnabled((value) => !value)}
                                    title={autoScrollEnabled ? t('pages.logs.pauseScrollTitle') : t('pages.logs.resumeScrollTitle')}
                                >
                                    {autoScrollEnabled ? <HiOutlinePauseCircle /> : <HiOutlinePlayCircle />}
                                    {autoScrollEnabled ? t('pages.logs.pauseScroll') : t('pages.logs.resumeScroll')}
                                </button>
                                <button
                                    className={`btn btn-sm rounded-lg ${wrapLines ? 'btn-secondary' : 'btn-ghost'}`}
                                    onClick={() => setWrapLines((value) => !value)}
                                    title={wrapLines ? t('pages.logs.wrapDisableTitle') : t('pages.logs.wrapEnableTitle')}
                                >
                                    {wrapLines ? t('pages.logs.wrapEnabled') : t('pages.logs.wrapDisabled')}
                                </button>
                                <button
                                    className={`btn btn-sm rounded-lg ${immersiveMode ? 'btn-secondary' : 'btn-ghost'}`}
                                    onClick={() => setImmersiveMode((value) => !value)}
                                    title={immersiveMode ? t('pages.logs.immersiveExitTitle') : t('pages.logs.immersiveEnterTitle')}
                                >
                                    {immersiveMode ? <HiOutlineArrowsPointingIn /> : <HiOutlineArrowsPointingOut />}
                                    {immersiveMode ? t('pages.logs.immersiveExit') : t('pages.logs.immersiveEnter')}
                                </button>
                            </div>
                            <div className="logs-toolbar-primary-group">
                                <button className="btn btn-ghost btn-sm rounded-lg" onClick={clearViewer} title={t('pages.logs.clearViewTitle')}>
                                    <HiOutlineTrash /> {t('pages.logs.clearView')}
                                </button>
                                <button className="btn btn-secondary btn-sm rounded-lg" onClick={copyLogs} title={t('pages.logs.copyTitle')}>
                                    <HiOutlineClipboardDocument /> {t('pages.logs.copy')}
                                </button>
                                <button className="btn btn-primary btn-sm rounded-lg" onClick={fetchLogs} disabled={loading}>
                                    <HiOutlineArrowPath className={loading ? 'spinning' : ''} />
                                    {loading ? t('pages.logs.loading') : t('pages.logs.refresh')}
                                </button>
                            </div>
                        </>
                    )}
                    meta={(
                        <div className="logs-toolbar-meta">
                            {logToolbarMeta.map((item) => (
                                <span key={item} className="logs-toolbar-chip">{item}</span>
                            ))}
                        </div>
                    )}
                />

                {/* Global Mode: Server Selector */}
                {isGlobal && (
                    <div className="card rounded-xl mb-4 logs-server-card">
                        <SectionHeader
                            className="card-header card-header-flat-tight section-header section-header--compact"
                            title={(
                                <div className="flex items-center gap-8">
                                    <HiOutlineServerStack className="text-muted" />
                                    <span className="card-title text-sm">{t('pages.logs.serverSelection')}</span>
                                </div>
                            )}
                            meta={(
                                <span className="text-sm text-muted">
                                    {t('pages.logs.selectedServers', { selected: selectedServerIds.length, total: servers.length })}
                                </span>
                            )}
                            actions={(
                                <>
                                    <button className="btn btn-ghost btn-sm rounded-lg" onClick={selectAllServers}>{t('pages.logs.selectAll')}</button>
                                    <button className="btn btn-ghost btn-sm rounded-lg" onClick={selectNoneServers}>{t('pages.logs.clearSelection')}</button>
                                </>
                            )}
                        />
                        <div className="log-server-chips">
                            {servers.map(server => (
                                <label
                                    key={server.id}
                                    className={`flex items-center gap-4 server-chip ${selectedServerIds.includes(server.id) ? 'active' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedServerIds.includes(server.id)}
                                        onChange={() => toggleServer(server.id)}
                                        className={serverCheckboxClassName}
                                    />
                                    <span className="text-sm">{server.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {fetchSummary?.message && (
                    <div className="card rounded-xl mb-4 logs-summary-card" style={fetchSummaryMeta.style}>
                        <SectionHeader
                            className="card-header card-header-flat-tight section-header section-header--compact"
                            title={(
                                <div className="flex items-center gap-8">
                                    <HiOutlineExclamationTriangle style={{ color: fetchSummaryMeta.iconColor }} />
                                    <span className="text-sm">{fetchSummary.message}</span>
                                </div>
                            )}
                            meta={<span className={`badge ${fetchSummaryMeta.badge}`}>{activeSourceMeta.label}</span>}
                        />
                    </div>
                )}

                {/* Log Viewer */}
                <div className="card rounded-xl flex-1 logs-viewer-card">
                    <SectionHeader
                        className="card-header section-header section-header--compact"
                        title={(
                            <div className="flex items-center gap-8 flex-wrap">
                                <HiOutlineDocumentText className="text-muted" />
                                <span className="card-title">{sourceLabel}</span>
                                <span className="badge badge-neutral">{activeSourceMeta.label}</span>
                                {levelFilter && activeLevelMeta && <span className="badge badge-info">{t('pages.logs.levelBadge', { level: activeLevelMeta.label })}</span>}
                            </div>
                        )}
                        meta={(
                            <div className="logs-viewer-meta">
                                <span className="text-sm text-muted">{t('pages.logs.lineCount', { count: filteredLogs.length })}</span>
                                <span className={`logs-scroll-chip ${autoScrollEnabled ? 'is-live' : 'is-paused'}`}>
                                    {autoScrollEnabled ? t('pages.logs.autoScroll') : t('pages.logs.paused')}
                                </span>
                            </div>
                        )}
                    />
                    <div
                        ref={logContainerRef}
                        className={`log-container log-pane ${wrapLines ? 'is-wrapped' : 'is-nowrap'}`}
                    >
                        {loading && filteredLogs.length === 0 ? (
                            <EmptyState
                                title={t('pages.logs.loadingLogs')}
                                size="compact"
                                icon={<span className="spinner spinner-20" aria-hidden="true" />}
                            />
                        ) : filteredLogs.length === 0 ? (
                            <EmptyState
                                title={t('pages.logs.empty')}
                                subtitle={t('pages.logs.emptySubtitle')}
                                size="compact"
                                icon={<HiOutlineDocumentText />}
                            />
                        ) : (
                            filteredLogs.map((entry, index) => (
                                <LogLine
                                    key={index}
                                    line={entry.line}
                                    showServer={isGlobal}
                                    serverName={entry.serverName}
                                    highlight={keywords}
                                    index={index}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
