import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineCheck, HiOutlineXMark } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import api from '../../api/client.js';

const PROTOCOL_OPTIONS = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
];
const PROTOCOL_KEY_SET = new Set(PROTOCOL_OPTIONS.map((item) => item.key));

function normalizeScopeMode(mode, selectedItems = []) {
    const hasSelected = Array.isArray(selectedItems) && selectedItems.length > 0;
    const fallback = hasSelected ? 'selected' : 'all';
    const text = String(mode || '').trim().toLowerCase();
    if (!text) return fallback;
    if (!['all', 'selected', 'none'].includes(text)) return fallback;
    if (text === 'selected' && !hasSelected) return 'none';
    return text;
}

export default function UserPolicyModal({ isOpen, email, servers = [], onClose }) {
    const normalizedEmail = useMemo(() => String(email || '').trim().toLowerCase(), [email]);
    const validServerIdSet = useMemo(() => new Set((Array.isArray(servers) ? servers : []).map((item) => item.id)), [servers]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [noServerLimit, setNoServerLimit] = useState(true);
    const [noProtocolLimit, setNoProtocolLimit] = useState(true);
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const [selectedProtocols, setSelectedProtocols] = useState([]);

    useEffect(() => {
        if (!isOpen || !normalizedEmail) return;
        let cancelled = false;

        const loadPolicy = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/user-policy/${encodeURIComponent(normalizedEmail)}`);
                const payload = res.data?.obj || {};
                const rawServerIds = Array.isArray(payload.allowedServerIds) ? payload.allowedServerIds : [];
                const serverIds = rawServerIds.filter((item) => validServerIdSet.has(item));
                const protocols = (Array.isArray(payload.allowedProtocols) ? payload.allowedProtocols : [])
                    .filter((item) => PROTOCOL_KEY_SET.has(String(item || '').trim().toLowerCase()));
                const serverScopeMode = normalizeScopeMode(payload.serverScopeMode, rawServerIds);
                const protocolScopeMode = normalizeScopeMode(payload.protocolScopeMode, protocols);
                if (cancelled) return;
                setSelectedServerIds(serverIds);
                setSelectedProtocols(protocols);
                setNoServerLimit(serverScopeMode === 'all');
                setNoProtocolLimit(protocolScopeMode === 'all');
            } catch (error) {
                if (!cancelled) {
                    const msg = error.response?.data?.msg || error.message || '权限策略加载失败';
                    toast.error(msg);
                }
            }
            if (!cancelled) setLoading(false);
        };

        loadPolicy();
        return () => { cancelled = true; };
    }, [isOpen, normalizedEmail, validServerIdSet]);

    const toggleServerId = (serverId, checked) => {
        setSelectedServerIds((prev) => {
            if (checked) return Array.from(new Set([...prev, serverId]));
            return prev.filter((item) => item !== serverId);
        });
    };

    const toggleProtocol = (protocol, checked) => {
        setSelectedProtocols((prev) => {
            if (checked) return Array.from(new Set([...prev, protocol]));
            return prev.filter((item) => item !== protocol);
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!normalizedEmail) {
            toast.error('邮箱为空');
            return;
        }

        const normalizedServerIds = selectedServerIds.filter((item) => validServerIdSet.has(item));
        const normalizedProtocols = selectedProtocols
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => PROTOCOL_KEY_SET.has(item));
        const serverScopeMode = noServerLimit ? 'all' : (normalizedServerIds.length > 0 ? 'selected' : 'none');
        const protocolScopeMode = noProtocolLimit ? 'all' : (normalizedProtocols.length > 0 ? 'selected' : 'none');
        const payload = {
            allowedServerIds: serverScopeMode === 'selected' ? normalizedServerIds : [],
            allowedProtocols: protocolScopeMode === 'selected' ? normalizedProtocols : [],
            serverScopeMode,
            protocolScopeMode,
        };

        setSaving(true);
        try {
            await api.put(`/user-policy/${encodeURIComponent(normalizedEmail)}`, payload);
            toast.success('订阅权限已保存');
            onClose();
        } catch (error) {
            const msg = error.response?.data?.msg || error.message || '保存失败';
            toast.error(msg);
        }
        setSaving(false);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">订阅权限策略</h3>
                    <button className="modal-close" onClick={onClose}><HiOutlineXMark /></button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div className="mb-4 p-3 rounded bg-white/5 border border-white/10 text-sm">
                            用户: <strong>{normalizedEmail || '-'}</strong>
                        </div>

                        {loading ? (
                            <div className="text-center p-6"><span className="spinner" /></div>
                        ) : (
                            <>
                                <div className="card mb-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="card-title">可访问服务器</span>
                                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={noServerLimit}
                                                onChange={(e) => setNoServerLimit(e.target.checked)}
                                            />
                                            不限制
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {servers.map((server) => (
                                            <label key={server.id} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    disabled={noServerLimit}
                                                    checked={selectedServerIds.includes(server.id)}
                                                    onChange={(e) => toggleServerId(server.id, e.target.checked)}
                                                />
                                                <span>{server.name}</span>
                                            </label>
                                        ))}
                                        {servers.length === 0 && <span className="text-sm text-muted">暂无服务器</span>}
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="card-title">可用协议</span>
                                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={noProtocolLimit}
                                                onChange={(e) => setNoProtocolLimit(e.target.checked)}
                                            />
                                            不限制
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {PROTOCOL_OPTIONS.map((item) => (
                                            <label key={item.key} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    disabled={noProtocolLimit}
                                                    checked={selectedProtocols.includes(item.key)}
                                                    onChange={(e) => toggleProtocol(item.key, e.target.checked)}
                                                />
                                                <span>{item.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
                        <button type="submit" className="btn btn-primary" disabled={saving || loading}>
                            {saving ? <span className="spinner" /> : <><HiOutlineCheck /> 保存策略</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
