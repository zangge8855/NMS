import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import {
    HiOutlineArrowPath,
    HiOutlineDocumentText,
    HiOutlineFunnel,
    HiOutlineClipboardDocument,
    HiOutlineServerStack,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';

const LOG_LEVELS = [
    { value: '', label: '全部级别' },
    { value: 'debug', label: 'Debug', color: '#6b7280' },
    { value: 'info', label: 'Info', color: '#3b82f6' },
    { value: 'warning', label: 'Warning', color: '#f59e0b' },
    { value: 'error', label: 'Error', color: '#ef4444' },
    { value: 'none', label: 'None', color: '#8b5cf6' },
];

function levelColor(line) {
    const lower = line.toLowerCase();
    if (lower.includes('[error]') || lower.includes('error:') || lower.includes('level=error'))
        return 'var(--accent-danger)';
    if (lower.includes('[warning]') || lower.includes('warn:') || lower.includes('level=warning'))
        return 'var(--accent-warning)';
    if (lower.includes('[info]') || lower.includes('level=info'))
        return 'var(--accent-info)';
    if (lower.includes('[debug]') || lower.includes('level=debug'))
        return 'var(--text-muted)';
    return 'var(--text-secondary)';
}

function LogLine({ line, showServer, serverName }) {
    const color = levelColor(line);
    return (
        <div className="log-line log-line-dynamic" style={{ '--log-line-color': color }}>
            {showServer && serverName && (
                <span className="badge badge-info badge-tiny">
                    {serverName}
                </span>
            )}
            <span>{line}</span>
        </div>
    );
}

export default function Logs({ embedded = false }) {
    const { activeServerId, panelApi, activeServer, servers } = useServer();
    const isGlobal = activeServerId === 'global';

    // State
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [keywords, setKeywords] = useState('');
    const [levelFilter, setLevelFilter] = useState('');
    const [syslog, setSyslog] = useState(false);
    const [count, setCount] = useState(100);

    // Global mode: server selection
    const [selectedServerIds, setSelectedServerIds] = useState([]);

    // Initialize selected servers when entering global mode
    useEffect(() => {
        if (isGlobal && servers.length > 0 && selectedServerIds.length === 0) {
            setSelectedServerIds(servers.map(s => s.id));
        }
    }, [isGlobal, servers, selectedServerIds.length]);

    const logContainerRef = useRef(null);

    // ── Fetch Logs ───────────────────────────────────────
    const fetchSingleLogs = useCallback(async () => {
        if (!activeServerId || activeServerId === 'global') return;
        setLoading(true);
        try {
            const body = { count, level: levelFilter || undefined };
            const endpoint = syslog ? '/server/api/server/log' : '/panel/api/server/log';
            const res = await panelApi('post', endpoint, body);
            const raw = res.data?.obj || '';
            const lines = typeof raw === 'string' ? raw.split('\n').filter(Boolean) : [];
            setLogs(lines.map(line => ({ line, serverName: activeServer?.name || '' })));
        } catch (err) {
            toast.error('获取日志失败: ' + (err.response?.data?.msg || err.message));
            setLogs([]);
        }
        setLoading(false);
    }, [activeServerId, panelApi, activeServer?.name, count, levelFilter, syslog]);

    const fetchGlobalLogs = useCallback(async () => {
        if (!isGlobal || selectedServerIds.length === 0) {
            setLogs([]);
            return;
        }
        setLoading(true);
        try {
            const targetServers = servers.filter(s => selectedServerIds.includes(s.id));
            const results = await Promise.allSettled(
                targetServers.map(async (server) => {
                    const res = await api.post(
                        `/panel/${server.id}/panel/api/server/log`,
                        { count: Math.ceil(count / targetServers.length), level: levelFilter || undefined }
                    );
                    const raw = res.data?.obj || '';
                    const lines = typeof raw === 'string' ? raw.split('\n').filter(Boolean) : [];
                    return lines.map(line => ({ line, serverName: server.name }));
                })
            );

            const allLogs = [];
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    allLogs.push(...result.value);
                }
            }
            setLogs(allLogs);
        } catch (err) {
            toast.error('获取全局日志失败: ' + (err.message || '未知错误'));
            setLogs([]);
        }
        setLoading(false);
    }, [isGlobal, selectedServerIds, servers, count, levelFilter]);

    const fetchLogs = isGlobal ? fetchGlobalLogs : fetchSingleLogs;

    useEffect(() => {
        if (activeServerId) fetchLogs();
    }, [activeServerId, fetchLogs]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    // ── Filter ───────────────────────────────────────────
    const filteredLogs = useMemo(() => {
        let result = logs;
        if (keywords.trim()) {
            const kw = keywords.toLowerCase();
            result = result.filter(entry => entry.line.toLowerCase().includes(kw));
        }
        return result;
    }, [logs, keywords]);

    // ── Copy ─────────────────────────────────────────────
    const copyLogs = () => {
        const text = filteredLogs.map(e =>
            isGlobal ? `[${e.serverName}] ${e.line}` : e.line
        ).join('\n');
        navigator.clipboard.writeText(text).then(
            () => toast.success('已复制到剪贴板'),
            () => toast.error('复制失败')
        );
    };

    // ── Toggle server selection ──────────────────────────
    const toggleServer = (serverId) => {
        setSelectedServerIds(prev =>
            prev.includes(serverId)
                ? prev.filter(id => id !== serverId)
                : [...prev, serverId]
        );
    };

    const selectAllServers = () => setSelectedServerIds(servers.map(s => s.id));
    const selectNoneServers = () => setSelectedServerIds([]);

    // ── Render ────────────────────────────────────────────
    return (
        <>
            {!embedded && <Header title={isGlobal ? '集群日志' : '系统日志'} />}
            <div className={embedded ? '' : 'page-content page-enter'}>
                {/* Toolbar */}
                <div className="card mb-4">
                    <div className="card-header card-header-flat">
                        <div className="flex items-center gap-8 flex-wrap flex-1">
                            <HiOutlineFunnel className="text-muted" />

                            <select
                                className="form-select w-120"
                                value={levelFilter}
                                onChange={e => setLevelFilter(e.target.value)}
                            >
                                {LOG_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                            </select>

                            <select
                                className="form-select w-100"
                                value={count}
                                onChange={e => setCount(Number(e.target.value))}
                            >
                                <option value={50}>50 行</option>
                                <option value={100}>100 行</option>
                                <option value={200}>200 行</option>
                                <option value={500}>500 行</option>
                            </select>

                            {!isGlobal && (
                                <label className="flex items-center gap-4 cursor-pointer">
                                    <input type="checkbox" checked={syslog} onChange={e => setSyslog(e.target.checked)} />
                                    <span className="text-sm">系统日志</span>
                                </label>
                            )}

                            <input
                                className="form-input w-200"
                                placeholder="关键词过滤..."
                                value={keywords}
                                onChange={e => setKeywords(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center gap-8">
                            <button className="btn btn-secondary btn-sm" onClick={copyLogs} title="复制日志">
                                <HiOutlineClipboardDocument /> 复制
                            </button>
                            <button className="btn btn-primary btn-sm" onClick={fetchLogs} disabled={loading}>
                                <HiOutlineArrowPath className={loading ? 'spinning' : ''} />
                                {loading ? '加载中...' : '刷新'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Global Mode: Server Selector */}
                {isGlobal && (
                    <div className="card mb-4">
                        <div className="card-header card-header-flat-tight">
                            <div className="flex items-center gap-8">
                                <HiOutlineServerStack className="text-muted" />
                                <span className="card-title text-sm">节点选择</span>
                                <button className="btn btn-ghost btn-sm" onClick={selectAllServers}>全选</button>
                                <button className="btn btn-ghost btn-sm" onClick={selectNoneServers}>清空</button>
                            </div>
                            <span className="text-sm text-muted">
                                已选 {selectedServerIds.length} / {servers.length}
                            </span>
                        </div>
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
                                        className="checkbox-14"
                                    />
                                    <span className="text-sm">{server.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {/* Log Viewer */}
                <div className="card flex-1">
                    <div className="card-header">
                        <div className="flex items-center gap-8">
                            <HiOutlineDocumentText className="text-muted" />
                            <span className="card-title">日志输出</span>
                        </div>
                        <span className="text-sm text-muted">{filteredLogs.length} 行</span>
                    </div>
                    <div
                        ref={logContainerRef}
                        className="log-container log-pane"
                    >
                        {loading && filteredLogs.length === 0 ? (
                            <div className="empty-state empty-state-medium">
                                <span className="spinner spinner-20" />
                                <div className="empty-state-text mt-3">正在加载日志...</div>
                            </div>
                        ) : filteredLogs.length === 0 ? (
                            <div className="empty-state empty-state-medium">
                                <div className="empty-state-icon"><HiOutlineDocumentText /></div>
                                <div className="empty-state-text">暂无日志</div>
                                <div className="empty-state-sub">点击刷新按钮获取最新日志</div>
                            </div>
                        ) : (
                            filteredLogs.map((entry, index) => (
                                <LogLine
                                    key={index}
                                    line={entry.line}
                                    showServer={isGlobal}
                                    serverName={entry.serverName}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
