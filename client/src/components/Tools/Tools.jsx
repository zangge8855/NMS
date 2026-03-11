import React, { useEffect, useMemo, useState } from 'react';
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

function formatToolValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

export default function Tools() {
    const { activeServerId, panelApi } = useServer();
    const { t } = useI18n();
    const [results, setResults] = useState({});
    const [loading, setLoading] = useState({});
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [tools, setTools] = useState([]);

    const fetchCatalog = async () => {
        if (!activeServerId) return;
        setCatalogLoading(true);
        try {
            const res = await api.get(`/capabilities/${activeServerId}`);
            const entries = Object.values(res.data?.obj?.tools || {})
                .filter((item) => item.uiAction === 'node_console' || item.uiAction === 'node_tools')
                .filter((item) => item.supportedByNms === true);
            setTools(entries);
        } catch (error) {
            const msg = error.response?.data?.msg || error.message || '加载节点工具失败';
            toast.error(msg);
        }
        setCatalogLoading(false);
    };

    useEffect(() => {
        fetchCatalog();
        setResults({});
    }, [activeServerId]);

    const enabledTools = useMemo(
        () => tools.filter((item) => item.available !== false),
        [tools]
    );

    const handleGenerate = async (tool) => {
        if (!activeServerId) {
            toast.error('请先选择一台服务器');
            return;
        }
        setLoading((prev) => ({ ...prev, [tool.key]: true }));
        try {
            const method = tool.method || 'get';
            const res = await panelApi(method, tool.path);
            setResults((prev) => ({
                ...prev,
                [tool.key]: formatToolValue(res.data?.obj),
            }));
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '执行失败');
        }
        setLoading((prev) => ({ ...prev, [tool.key]: false }));
    };

    const handleCopy = async (text) => {
        await copyToClipboard(text);
        toast.success('已复制');
    };

    if (!activeServerId) {
        return (
            <>
                <Header title={t('pages.tools.title')} />
                <div className="page-content page-enter">
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineWrench /></div>
                        <div className="empty-state-text">请先选择一台服务器</div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header title={t('pages.tools.title')} />
            <div className="page-content page-enter">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>3x-ui 节点工具</h2>
                        <p className="text-sm text-muted mt-1">
                            根据当前节点实时能力生成 UUID、X25519、后量子密钥与 ECH 证书
                        </p>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={fetchCatalog} disabled={catalogLoading}>
                        <HiOutlineArrowPath className={catalogLoading ? 'spinning' : ''} /> 刷新工具列表
                    </button>
                </div>

                {tools.length === 0 && !catalogLoading ? (
                    <div className="card text-center" style={{ padding: '36px' }}>
                        暂无可用节点工具
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
                        {(enabledTools.length > 0 ? enabledTools : tools).map((tool) => (
                            <div className="card" key={tool.key}>
                                <div className="card-header">
                                    <div>
                                        <span className="card-title" style={{ display: 'block' }}>{tool.label || tool.key}</span>
                                        <span className="text-sm text-muted">{tool.description || '当前节点工具'}</span>
                                    </div>
                                    <span className={`badge ${tool.available === false ? 'badge-danger' : 'badge-success'}`}>
                                        {tool.available === false ? '不可用' : '可执行'}
                                    </span>
                                </div>

                                {results[tool.key] && (
                                    <div style={{
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '12px',
                                        marginBottom: '12px',
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '11px',
                                        wordBreak: 'break-all',
                                        whiteSpace: 'pre-wrap',
                                        maxHeight: '200px',
                                        overflowY: 'auto',
                                    }}>
                                        {results[tool.key]}
                                    </div>
                                )}

                                <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => handleGenerate(tool)}
                                        disabled={loading[tool.key] || tool.available === false}
                                    >
                                        {loading[tool.key] ? <span className="spinner" /> : <HiOutlineArrowPath />}
                                        生成
                                    </button>
                                    {results[tool.key] && (
                                        <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(results[tool.key])}>
                                            <HiOutlineClipboard /> 复制
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
