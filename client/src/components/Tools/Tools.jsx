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
import EmptyState from '../UI/EmptyState.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';

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
            <Header 
                title={t('pages.tools.title')}
                subtitle="根据当前节点实时能力生成 UUID、X25519、后量子密钥与 ECH 证书"
                showSubtitle={true}
            >
                <button className="btn btn-secondary btn-sm" onClick={fetchCatalog} disabled={catalogLoading}>
                    <HiOutlineArrowPath className={catalogLoading ? 'spinning' : ''} /> 刷新
                </button>
            </Header>
            <div className="page-content page-enter">
                {tools.length === 0 && !catalogLoading ? (
                    <EmptyState title="暂无可用节点工具" subtitle="当前节点尚未暴露可执行工具接口。" surface />
                ) : (
                    <div className="tools-grid">
                        {(enabledTools.length > 0 ? enabledTools : tools).map((tool) => (
                            <div className="card tool-card" key={tool.key}>
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title={tool.label || tool.key}
                                    subtitle={tool.description || '当前节点工具'}
                                    meta={(
                                        <span className={`badge ${tool.available === false ? 'badge-danger' : 'badge-success'}`}>
                                            {tool.available === false ? '不可用' : '可执行'}
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
