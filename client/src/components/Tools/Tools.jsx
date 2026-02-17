import React, { useState } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import Header from '../Layout/Header.jsx';
import { copyToClipboard } from '../../utils/format.js';
import toast from 'react-hot-toast';
import {
    HiOutlineKey,
    HiOutlineClipboard,
    HiOutlineArrowPath,
    HiOutlineWrench,
} from 'react-icons/hi2';

const TOOLS = [
    { key: 'uuid', label: 'UUID', path: '/panel/api/server/getNewUUID', description: '生成新的 UUID (用于 VMess/VLESS)' },
    { key: 'x25519', label: 'X25519', path: '/panel/api/server/getNewX25519Cert', description: '生成 X25519 密钥对 (用于 Reality)' },
    { key: 'mldsa65', label: 'ML-DSA-65', path: '/panel/api/server/getNewmldsa65', description: '生成 ML-DSA-65 密钥 (后量子签名)' },
    { key: 'mlkem768', label: 'ML-KEM-768', path: '/panel/api/server/getNewmlkem768', description: '生成 ML-KEM-768 密钥 (后量子密钥交换)' },
    { key: 'vlessEnc', label: 'VLESS Enc', path: '/panel/api/server/getNewVlessEnc', description: '生成 VLESS 加密密钥' },
    { key: 'echCert', label: 'ECH Cert', path: '/panel/api/server/getNewEchCert', description: '生成 ECH 证书', method: 'post' },
];

export default function Tools() {
    const { activeServerId, panelApi } = useServer();
    const [results, setResults] = useState({});
    const [loading, setLoading] = useState({});

    const handleGenerate = async (tool) => {
        if (!activeServerId) { toast.error('请先选择一台服务器'); return; }
        setLoading(prev => ({ ...prev, [tool.key]: true }));
        try {
            const method = tool.method || 'get';
            const res = await panelApi(method, tool.path);
            const value = res.data?.obj;
            setResults(prev => ({
                ...prev,
                [tool.key]: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
            }));
        } catch {
            toast.error('生成失败');
        }
        setLoading(prev => ({ ...prev, [tool.key]: false }));
    };

    const handleCopy = async (text) => {
        await copyToClipboard(text);
        toast.success('已复制');
    };

    if (!activeServerId) {
        return (
            <>
                <Header title="工具箱" />
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
            <Header title="工具箱" />
            <div className="page-content page-enter">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
                    {TOOLS.map(tool => (
                        <div className="card" key={tool.key}>
                            <div className="card-header">
                                <div className="flex items-center gap-8">
                                    <div className="card-icon" style={{ background: 'var(--accent-primary-glow)', color: 'var(--accent-primary)', width: '32px', height: '32px', fontSize: '14px' }}>
                                        <HiOutlineKey />
                                    </div>
                                    <div>
                                        <span className="card-title" style={{ display: 'block' }}>{tool.label}</span>
                                        <span className="text-sm text-muted">{tool.description}</span>
                                    </div>
                                </div>
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

                            <div className="flex gap-8">
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleGenerate(tool)}
                                    disabled={loading[tool.key]}
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
            </div>
        </>
    );
}
