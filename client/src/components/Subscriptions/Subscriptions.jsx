import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineArrowPath, HiOutlineClipboard, HiOutlineLink, HiOutlineQrCode } from 'react-icons/hi2';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import { copyToClipboard } from '../../utils/format.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import Header from '../Layout/Header.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';

function normalizeInactiveReason(reason) {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return '可用';
    if (text === 'all-expired-or-disabled') return '全部节点已过期或禁用';
    if (text === 'blocked-by-policy') return '被订阅权限策略限制';
    if (text === 'user-not-found') return '未找到该用户';
    if (text === 'no-links-found') return '未生成可用节点链接';
    return reason;
}

export default function Subscriptions() {
    const { servers } = useServer();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const isUserOnly = !isAdmin;
    const defaultIdentity = useMemo(
        () => String(user?.subscriptionEmail || '').trim(),
        [user?.subscriptionEmail]
    );
    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersAccessDenied, setUsersAccessDenied] = useState(false);
    const [selectedEmail, setSelectedEmail] = useState('');
    const [selectedServerId, setSelectedServerId] = useState('all');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [showQr, setShowQr] = useState(false);
    const [profileKey, setProfileKey] = useState('v2rayn');

    const normalizedEmail = useMemo(() => String(selectedEmail || '').trim(), [selectedEmail]);
    const activeProfile = useMemo(
        () => findSubscriptionProfile(result?.bundle, profileKey),
        [result, profileKey]
    );

    const loadUsers = async () => {
        if (!isAdmin) {
            setUsers([]);
            setUsersAccessDenied(true);
            return;
        }
        setUsersLoading(true);
        try {
            const res = await api.get('/subscriptions/users');
            const payload = res.data?.obj || {};
            const list = Array.isArray(payload.users) ? payload.users : [];
            setUsers(list);
            setUsersAccessDenied(false);

            if (!normalizedEmail && list.length > 0) {
                setSelectedEmail(list[0]);
            }

            const warningCount = Array.isArray(payload.warnings) ? payload.warnings.length : 0;
            if (warningCount > 0) {
                toast.error(`有 ${warningCount} 个节点用户列表拉取失败`);
            }
        } catch (error) {
            if (error.response?.status === 403) {
                setUsers([]);
                setUsersAccessDenied(true);
            } else {
                const msg = error.response?.data?.msg || error.message || '用户列表加载失败';
                toast.error(msg);
            }
        }
        setUsersLoading(false);
    };

    const loadSubscription = async () => {
        if (!normalizedEmail) {
            setResult(null);
            return;
        }

        setLoading(true);
        try {
            const query = new URLSearchParams();
            if (isAdmin && selectedServerId && selectedServerId !== 'all') {
                query.append('serverId', selectedServerId);
            }

            const res = await api.get(`/subscriptions/${encodeURIComponent(normalizedEmail)}${query.toString() ? `?${query.toString()}` : ''}`);
            const payload = res.data?.obj || {};
            const bundle = buildSubscriptionProfileBundle(payload);

            setResult({
                email: payload.email || normalizedEmail,
                total: Number(payload.total || 0),
                sourceMode: payload.sourceMode || 'unknown',
                mergedUrl: bundle.mergedUrl,
                bundle,
                subscriptionActive: payload.subscriptionActive !== false,
                inactiveReason: normalizeInactiveReason(payload.inactiveReason),
                filteredExpired: Number(payload.filteredExpired || 0),
                filteredDisabled: Number(payload.filteredDisabled || 0),
                filteredByPolicy: Number(payload.filteredByPolicy || 0),
                matchedClientsRaw: Number(payload.matchedClientsRaw || 0),
                matchedClientsActive: Number(payload.matchedClientsActive || 0),
                scope: selectedServerId && selectedServerId !== 'all' ? 'server' : 'all',
                serverId: selectedServerId && selectedServerId !== 'all' ? selectedServerId : '',
            });
            if (bundle.defaultProfileKey) {
                setProfileKey(bundle.defaultProfileKey);
            }
        } catch (error) {
            setResult(null);
            const msg = error.response?.data?.msg || error.message || '订阅加载失败';
            toast.error(msg);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadUsers();
    }, [isAdmin]);

    useEffect(() => {
        if (!isUserOnly) return;
        if (!selectedEmail && defaultIdentity) {
            setSelectedEmail(defaultIdentity);
        }
    }, [defaultIdentity, isUserOnly, selectedEmail]);

    useEffect(() => {
        loadSubscription();
    }, [normalizedEmail, selectedServerId]);

    const handleCopy = async () => {
        if (!activeProfile?.url) {
            toast.error('暂无可复制地址');
            return;
        }
        await copyToClipboard(activeProfile.url);
        toast.success(`${activeProfile.label} 订阅地址已复制`);
    };

    return (
        <>
            <Header title="订阅中心" />
            <div className="page-content page-enter">
                <div className="card mb-8">
                    <div className="card-header">
                        <span className="card-title">节点合并订阅（自动生成并持久保留）</span>
                    </div>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '12px',
                            alignItems: 'end',
                        }}
                    >
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">用户邮箱</label>
                            <input
                                type="email"
                                className="form-input"
                                placeholder="user@example.com"
                                list="subscription-user-list"
                                value={selectedEmail}
                                onChange={(e) => setSelectedEmail(e.target.value)}
                                readOnly={isUserOnly}
                            />
                            <datalist id="subscription-user-list">
                                {users.map((email) => (
                                    <option key={email} value={email} />
                                ))}
                            </datalist>
                            {isUserOnly ? (
                                <div className="text-xs text-muted mt-1">
                                    {defaultIdentity
                                        ? '普通用户仅可查看管理员分配给自己的订阅连接'
                                        : '尚未绑定订阅邮箱，请联系管理员分配后再查看'}
                                </div>
                            ) : usersAccessDenied ? (
                                <div className="text-xs text-muted mt-1">当前角色无全量用户列表权限，请手动输入邮箱</div>
                            ) : (
                                <div className="text-xs text-muted mt-1">已加载 {users.length} 个用户，可输入或选择</div>
                            )}
                        </div>
                        {isAdmin && (
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">订阅范围</label>
                                <select
                                    className="form-select"
                                    value={selectedServerId}
                                    onChange={(e) => setSelectedServerId(e.target.value)}
                                >
                                    <option value="all">全部节点</option>
                                    {servers.map((server) => (
                                        <option key={server.id} value={server.id}>{server.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {isAdmin && (
                            <button className="btn btn-secondary" onClick={loadUsers} disabled={usersLoading || !isAdmin}>
                                {usersLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 刷新用户列表</>}
                            </button>
                        )}
                        <button className="btn btn-primary" onClick={loadSubscription} disabled={loading || !normalizedEmail}>
                            {loading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 重新加载</>}
                        </button>
                    </div>
                </div>

                {!result ? (
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineLink /></div>
                        <div className="empty-state-text">输入邮箱后会自动加载订阅地址</div>
                    </div>
                ) : (
                    <>
                        <div
                            className="grid gap-4 mb-8"
                            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}
                        >
                            <div className="card">
                                <div className="text-sm text-muted">用户</div>
                                <div style={{ fontSize: '18px', fontWeight: 700 }}>{result.email}</div>
                            </div>
                            <div className="card">
                                <div className="text-sm text-muted">状态</div>
                                <div style={{ fontSize: '24px', fontWeight: 700 }}>
                                    {result.subscriptionActive ? '可用' : '失效'}
                                </div>
                                <div className="text-sm text-muted">{result.inactiveReason || '-'}</div>
                            </div>
                            <div className="card">
                                <div className="text-sm text-muted">有效节点链接数</div>
                                <div style={{ fontSize: '24px', fontWeight: 700 }}>{result.total}</div>
                            </div>
                            <div className="card">
                                <div className="text-sm text-muted">过滤统计</div>
                                <div className="text-sm text-muted">
                                    过期 {result.filteredExpired} / 禁用 {result.filteredDisabled} / 权限 {result.filteredByPolicy}
                                </div>
                                <div className="text-sm text-muted">
                                    匹配 {result.matchedClientsActive}/{result.matchedClientsRaw}
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-header">
                                <span className="card-title">持久订阅地址（多客户端）</span>
                            </div>
                            <div
                                className="grid gap-2 mb-3"
                                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}
                            >
                                {(result.bundle?.availableProfiles || []).map((item) => (
                                    <button
                                        key={item.key}
                                        type="button"
                                        className={`btn btn-sm ${profileKey === item.key ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setProfileKey(item.key)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <div className="text-xs text-muted mb-2">{activeProfile?.hint || '请选择订阅类型'}</div>
                            <div className="text-xs text-muted mb-2">
                                直连订阅：v2rayN / Raw / Native / Reconstructed；转换订阅：Clash / sing-box（可选附加规则模板）。
                            </div>
                            {!result.bundle?.converterConfigured && (
                                <div className="text-xs text-muted mb-2">
                                    提示：未配置“系统设置 → 订阅转换器 → 转换器地址”，Clash/sing-box 配置入口已隐藏。
                                </div>
                            )}
                            <div className="subscription-link-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: '10px' }}>
                                <input className="form-input font-mono text-xs" value={activeProfile?.url || ''} readOnly />
                                <button className="btn btn-primary" onClick={handleCopy} disabled={!activeProfile?.url || !result.subscriptionActive}>
                                    <HiOutlineClipboard /> 复制地址
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowQr(true)}
                                    disabled={!activeProfile?.url || !result.subscriptionActive}
                                    title="显示二维码"
                                >
                                    <HiOutlineQrCode /> QR
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* QR Code Modal */}
                {showQr && activeProfile?.url && (
                    <div className="modal-overlay" onClick={() => setShowQr(false)}>
                        <div
                            className="modal glass-panel"
                            onClick={(e) => e.stopPropagation()}
                            style={{ maxWidth: '380px', textAlign: 'center' }}
                        >
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">订阅二维码 · {activeProfile.label}</h3>
                                <button className="modal-close" onClick={() => setShowQr(false)}>×</button>
                            </div>
                            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                                <div className="qr-surface qr-surface-lg">
                                    <QRCodeSVG
                                        value={activeProfile.url}
                                        size={256}
                                        level="M"
                                        includeMargin={false}
                                    />
                                </div>
                                <p className="text-sm text-muted" style={{ wordBreak: 'break-all' }}>
                                    {result.email}
                                </p>
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={() => setShowQr(false)}>关闭</button>
                                <button className="btn btn-primary" onClick={handleCopy}>
                                    <HiOutlineClipboard /> 复制地址
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
