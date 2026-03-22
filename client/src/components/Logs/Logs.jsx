import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, Button, Select, Input, Checkbox, Space, Typography, Badge, Tag, Row, Col, Empty, Tooltip, Switch } from 'antd';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import {
    HiOutlineArrowPath,
    HiOutlineDocumentText,
    HiOutlineFunnel,
    HiOutlinePauseCircle,
    HiOutlinePlayCircle,
    HiOutlineServerStack,
    HiOutlineTrash,
    HiOutlineExclamationTriangle,
    HiOutlineArrowsPointingOut,
    HiOutlineArrowsPointingIn,
    HiOutlineClipboard,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import VirtualList from '../UI/VirtualList.jsx';
import { copyToClipboard } from '../../utils/format.js';

const { Text, Title } = Typography;
const { Option } = Select;

function getSummaryToneMeta(tone) {
    if (tone === 'danger') {
        return {
            color: 'var(--accent-danger)',
            bg: 'var(--accent-danger-bg)',
            badge: 'error',
        };
    }
    if (tone === 'warning') {
        return {
            color: 'var(--accent-warning)',
            bg: 'var(--accent-warning-bg)',
            badge: 'warning',
        };
    }
    return {
        color: 'var(--accent-info)',
        bg: 'var(--accent-info-bg)',
        badge: 'info',
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
                <Tag color="processing" className="badge-tiny" style={{ margin: 0, fontSize: '10px' }}>
                    {serverName}
                </Tag>
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

    const copiedLogText = useMemo(() => {
        return filteredLogs.map((entry) => (
            isGlobal ? `[${entry.serverName}] ${entry.line}` : entry.line
        )).join('\n');
    }, [filteredLogs, isGlobal]);

    const handleCopyLogs = async () => {
        try {
            await copyToClipboard(copiedLogText);
            toast.success(t('pages.logs.copySuccess'));
        } catch {
            toast.error(t('pages.logs.copyError'));
        }
    };

    const logLevelSummary = useMemo(() => {
        const counts = {
            error: 0,
            warning: 0,
            info: 0,
            debug: 0,
            none: 0,
        };

        filteredLogs.forEach((entry) => {
            const level = detectLogLevel(entry.line);
            counts[level] = (counts[level] || 0) + 1;
        });

        return [
            { value: 'error', label: 'Error', count: counts.error },
            { value: 'warning', label: 'Warning', count: counts.warning },
            { value: 'info', label: 'Info', count: counts.info },
            { value: 'debug', label: 'Debug', count: counts.debug },
            { value: 'none', label: locale === 'en-US' ? 'Other' : '其他', count: counts.none },
        ].filter((item) => item.count > 0);
    }, [filteredLogs, locale]);

    const shouldVirtualizeLogs = filteredLogs.length > 180;

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
                <Card bordered={false} className="mb-4 glass-panel">
                    <Row gutter={[16, 16]} align="middle">
                        <Col xs={24} lg={14}>
                            <Space wrap>
                                <HiOutlineFunnel className="text-muted" />
                                <Select
                                    style={{ width: 120 }}
                                    value={levelFilter}
                                    onChange={val => setLevelFilter(val)}
                                    options={logLevels.map(l => ({ label: l.label, value: l.value }))}
                                />
                                <Select
                                    style={{ width: 100 }}
                                    value={count}
                                    onChange={val => setCount(val)}
                                >
                                    <Option value={50}>{t('pages.logs.lineOption', { count: 50 })}</Option>
                                    <Option value={100}>{t('pages.logs.lineOption', { count: 100 })}</Option>
                                    <Option value={200}>{t('pages.logs.lineOption', { count: 200 })}</Option>
                                    <Option value={500}>{t('pages.logs.lineOption', { count: 500 })}</Option>
                                </Select>
                                {lockedSourceMode === 'auto' && (
                                    <Select
                                        style={{ width: 140 }}
                                        value={selectedSource}
                                        onChange={val => setSelectedSource(val)}
                                        options={logSources.map(item => ({ label: item.label, value: item.value }))}
                                    />
                                )}
                                <Input
                                    style={{ width: 200 }}
                                    placeholder={t('pages.logs.keywordPlaceholder')}
                                    value={keywords}
                                    onChange={e => setKeywords(e.target.value)}
                                />
                            </Space>
                        </Col>
                        <Col xs={24} lg={10} style={{ textAlign: 'right' }}>
                            <Space wrap className="justify-end">
                                <Space.Compact>
                                    <Tooltip title={autoScrollEnabled ? t('pages.logs.pauseScrollTitle') : t('pages.logs.resumeScrollTitle')}>
                                        <Button
                                            onClick={() => setAutoScrollEnabled(v => !v)}
                                            icon={autoScrollEnabled ? <HiOutlinePauseCircle /> : <HiOutlinePlayCircle />}
                                        >
                                            {autoScrollEnabled ? t('pages.logs.pauseScroll') : t('pages.logs.resumeScroll')}
                                        </Button>
                                    </Tooltip>
                                    <Button
                                        type={wrapLines ? 'primary' : 'default'}
                                        onClick={() => setWrapLines(v => !v)}
                                    >
                                        {wrapLines ? t('pages.logs.wrapEnabled') : t('pages.logs.wrapDisabled')}
                                    </Button>
                                    <Button
                                        type={immersiveMode ? 'primary' : 'default'}
                                        onClick={() => setImmersiveMode(v => !v)}
                                        icon={immersiveMode ? <HiOutlineArrowsPointingIn /> : <HiOutlineArrowsPointingOut />}
                                    >
                                        {immersiveMode ? t('pages.logs.immersiveExit') : t('pages.logs.immersiveEnter')}
                                    </Button>
                                </Space.Compact>
                                <Space.Compact>
                                    <Button icon={<HiOutlineTrash />} onClick={clearViewer} />
                                    <Button icon={<HiOutlineClipboard />} onClick={handleCopyLogs} />
                                    <Button
                                        type="primary"
                                        icon={<HiOutlineArrowPath />}
                                        onClick={fetchLogs}
                                        loading={loading}
                                    >
                                        {loading ? t('pages.logs.loading') : t('pages.logs.refresh')}
                                    </Button>
                                </Space.Compact>
                            </Space>
                        </Col>
                        <Col span={24}>
                            <Space size={[8, 8]} wrap>
                                {logToolbarMeta.map((item) => (
                                    <Tag key={item} color="blue" bordered={false} style={{ borderRadius: '12px' }}>{item}</Tag>
                                ))}
                            </Space>
                        </Col>
                    </Row>
                </Card>

                {isGlobal && (
                    <Card bordered={false} className="mb-4 glass-panel"
                        title={
                            <Space>
                                <HiOutlineServerStack className="text-muted" />
                                <Text strong style={{ fontSize: '13px' }}>{t('pages.logs.serverSelection')}</Text>
                            </Space>
                        }
                        extra={
                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                {t('pages.logs.selectedServers', { selected: selectedServerIds.length, total: servers.length })}
                            </Text>
                        }
                    >
                        <Row gutter={[12, 12]} align="middle">
                            <Col span={24}>
                                <Space>
                                    <Button size="small" onClick={selectAllServers}>{t('pages.logs.selectAll')}</Button>
                                    <Button size="small" onClick={selectNoneServers}>{t('pages.logs.clearSelection')}</Button>
                                </Space>
                            </Col>
                            <Col span={24}>
                                <div className="log-server-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {servers.map(server => (
                                        <Checkbox
                                            key={server.id}
                                            checked={selectedServerIds.includes(server.id)}
                                            onChange={() => toggleServer(server.id)}
                                            style={{ margin: 0 }}
                                        >
                                            <span className="text-sm">{server.name}</span>
                                        </Checkbox>
                                    ))}
                                </div>
                            </Col>
                        </Row>
                    </Card>
                )}

                {fetchSummary?.message && (
                    <Card bordered={false} className="mb-4" style={{ background: fetchSummaryMeta.bg, border: `1px solid ${fetchSummaryMeta.color}` }}>
                        <Row justify="space-between" align="middle">
                            <Col>
                                <Space>
                                    <HiOutlineExclamationTriangle style={{ color: fetchSummaryMeta.color }} />
                                    <Text style={{ color: fetchSummaryMeta.color }}>{fetchSummary.message}</Text>
                                </Space>
                            </Col>
                            <Col>
                                <Badge status={fetchSummaryMeta.badge} text={activeSourceMeta.label} />
                            </Col>
                        </Row>
                    </Card>
                )}

                <Card bordered={false} className="logs-viewer-card glass-panel" style={{ display: 'flex', flexDirection: 'column' }}
                    title={
                        <Space wrap>
                            <HiOutlineDocumentText className="text-muted" />
                            <Title level={5} style={{ margin: 0 }}>{sourceLabel}</Title>
                            <Tag>{activeSourceMeta.label}</Tag>
                            {levelFilter && activeLevelMeta && <Tag color="blue">{t('pages.logs.levelBadge', { level: activeLevelMeta.label })}</Tag>}
                        </Space>
                    }
                    extra={
                        <Space>
                            <Text type="secondary" style={{ fontSize: '12px' }}>{t('pages.logs.lineCount', { count: filteredLogs.length })}</Text>
                            <Tag color={autoScrollEnabled ? 'success' : 'default'}>
                                {autoScrollEnabled ? t('pages.logs.autoScroll') : t('pages.logs.paused')}
                            </Tag>
                        </Space>
                    }
                >
                    {logLevelSummary.length > 0 && (
                        <div style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {logLevelSummary.map((item) => (
                                <Tag.CheckableTag
                                    key={item.value}
                                    checked={levelFilter === item.value}
                                    onChange={() => setLevelFilter(current => (current === item.value ? '' : item.value))}
                                    className={`logs-level-chip--${item.value}`}
                                    style={{
                                        border: '1px solid var(--border-color)',
                                        padding: '4px 12px',
                                        borderRadius: '16px'
                                    }}
                                >
                                    <Space>
                                        <span>{item.label}</span>
                                        <Badge count={item.count} size="small" overflowCount={999} style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
                                    </Space>
                                </Tag.CheckableTag>
                            ))}
                        </div>
                    )}
                    <div
                        ref={shouldVirtualizeLogs ? undefined : logContainerRef}
                        className={`log-container log-pane ${wrapLines ? 'is-wrapped' : 'is-nowrap'}`}
                        style={{ flex: 1, minHeight: 0 }}
                    >
                        {loading && filteredLogs.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center' }}>
                                <HiOutlineArrowPath className="spinning" style={{ fontSize: '32px', color: 'var(--accent-primary)', marginBottom: '12px' }} />
                                <Text type="secondary" block>{t('pages.logs.loadingLogs')}</Text>
                            </div>
                        ) : filteredLogs.length === 0 ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    <Space direction="vertical">
                                        <Text strong>{t('pages.logs.empty')}</Text>
                                        <Text type="secondary">{t('pages.logs.emptySubtitle')}</Text>
                                    </Space>
                                }
                                style={{ padding: '40px' }}
                            />
                        ) : shouldVirtualizeLogs ? (
                            <VirtualList
                                ref={logContainerRef}
                                items={filteredLogs}
                                itemSize={wrapLines ? 56 : 38}
                                overscan={10}
                                renderItem={(entry, index) => (
                                    <LogLine
                                        line={entry.line}
                                        showServer={isGlobal}
                                        serverName={entry.serverName}
                                        highlight={keywords}
                                        index={index}
                                    />
                                )}
                                getKey={(entry, index) => `${entry.serverName || 'single'}-${index}-${entry.line}`}
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
                </Card>
            </div>
        </>
    );
}
