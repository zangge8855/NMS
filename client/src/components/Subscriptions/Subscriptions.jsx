import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiOutlineArrowPath, HiOutlineClipboard, HiOutlineLink, HiOutlineQrCode, HiOutlineXMark } from 'react-icons/hi2';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import { copyToClipboard } from '../../utils/format.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import Header from '../Layout/Header.jsx';
import SubscriptionClientLinks from './SubscriptionClientLinks.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import ModalShell from '../UI/ModalShell.jsx';

function normalizeInactiveReason(reason) {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return '可用';
    if (text === 'all-expired-or-disabled') return '全部节点已过期或禁用';
    if (text === 'blocked-by-policy') return '被订阅权限策略限制';
    if (text === 'user-not-found') return '未找到该用户';
    if (text === 'no-links-found') return '未生成可用节点链接';
    return reason;
}

function formatTokenDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN');
}

function renderTokenStatus(status) {
    if (status === 'active') return <span className="badge badge-success">活跃</span>;
    if (status === 'expired') return <span className="badge badge-warning">已过期</span>;
    if (status === 'revoked') return <span className="badge badge-danger">已撤销</span>;
    return <span className="badge badge-neutral">{status || '未知'}</span>;
}

export default function Subscriptions() {
    const { servers } = useServer();
    const { user } = useAuth();
    const [searchParams] = useSearchParams();
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
    const [tokenName, setTokenName] = useState('');
    const [tokenTtlDays, setTokenTtlDays] = useState('30');
    const [tokenLoading, setTokenLoading] = useState(false);
    const [tokenActionId, setTokenActionId] = useState('');
    const [lastIssuedToken, setLastIssuedToken] = useState(null);

    const normalizedEmail = useMemo(() => String(selectedEmail || '').trim(), [selectedEmail]);
    const activeProfile = useMemo(
        () => findSubscriptionProfile(result?.bundle, profileKey),
        [result, profileKey]
    );

    const syncFromQuery = () => {
        const emailFromQuery = String(searchParams.get('email') || '').trim();
        const serverIdFromQuery = String(searchParams.get('serverId') || '').trim();
        if (emailFromQuery) setSelectedEmail(emailFromQuery);
        if (isAdmin && serverIdFromQuery) setSelectedServerId(serverIdFromQuery);
    };

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

            if (!normalizedEmail && list.length > 0 && !searchParams.get('email')) {
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
                token: payload.token || null,
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
        syncFromQuery();
    }, [searchParams, isAdmin]);

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

    const handleIssueToken = async () => {
        if (!isAdmin || !normalizedEmail) return;
        setTokenLoading(true);
        try {
            const payload = {};
            const trimmedName = String(tokenName || '').trim();
            if (trimmedName) payload.name = trimmedName;
            const ttl = Number(tokenTtlDays);
            if (Number.isFinite(ttl)) payload.ttlDays = ttl;
            const res = await api.post(`/subscriptions/${encodeURIComponent(normalizedEmail)}/issue`, payload);
            setLastIssuedToken(res.data?.obj || null);
            toast.success('订阅 token 已签发');
            setTokenName('');
            await loadSubscription();
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '签发 token 失败');
        }
        setTokenLoading(false);
    };

    const handleRevokeToken = async (tokenId) => {
        if (!isAdmin || !normalizedEmail || !tokenId) return;
        setTokenActionId(tokenId);
        try {
            await api.post(`/subscriptions/${encodeURIComponent(normalizedEmail)}/revoke`, { tokenId });
            toast.success('订阅 token 已撤销');
            await loadSubscription();
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '撤销 token 失败');
        }
        setTokenActionId('');
    };

    const handleRevokeAllTokens = async () => {
        if (!isAdmin || !normalizedEmail) return;
        setTokenActionId('all');
        try {
            await api.post(`/subscriptions/${encodeURIComponent(normalizedEmail)}/revoke`, {
                revokeAll: true,
                reason: 'manual-revoke-all',
            });
            toast.success('全部 token 已撤销');
            await loadSubscription();
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '批量撤销失败');
        }
        setTokenActionId('');
    };

    return (
        <>
            <Header title="订阅中心" />
            <div className="page-content page-enter">
                <div className="card mb-8">
                    <div className="card-header">
                        <span className="card-title">节点合并订阅（自动生成并持久保留）</span>
                        {isAdmin && normalizedEmail && (
                            <Link className="btn btn-secondary btn-sm" to={`/clients?q=${encodeURIComponent(normalizedEmail)}`}>
                                用户管理
                            </Link>
                        )}
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

                        <div className="card mb-8">
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
                                常见客户端专用订阅地址已内置，Clash / Mihomo 会直接使用本机生成的配置地址。
                            </div>
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
                            <SubscriptionClientLinks bundle={result.bundle} />
                        </div>

                        {isAdmin && (
                            <div className="card mb-8">
                                <div className="card-header">
                                    <span className="card-title">Token 生命周期管理</span>
                                    <span className="badge badge-info">
                                        {result.token?.activeCount || 0}/{result.token?.activeLimit || 0}
                                    </span>
                                </div>
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                        gap: '12px',
                                        alignItems: 'end',
                                        marginBottom: '16px',
                                    }}
                                >
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">用途标注</label>
                                        <input
                                            className="form-input"
                                            value={tokenName}
                                            onChange={(e) => setTokenName(e.target.value)}
                                            placeholder="例如：Clash 客户端 / 用户自助"
                                        />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">有效期</label>
                                        <select className="form-select" value={tokenTtlDays} onChange={(e) => setTokenTtlDays(e.target.value)}>
                                            <option value="7">7 天</option>
                                            <option value="30">30 天</option>
                                            <option value="90">90 天</option>
                                            <option value="365">365 天</option>
                                            <option value="0">永久</option>
                                        </select>
                                    </div>
                                    <button className="btn btn-primary" onClick={handleIssueToken} disabled={tokenLoading || !normalizedEmail}>
                                        {tokenLoading ? <span className="spinner" /> : '签发 token'}
                                    </button>
                                    <button className="btn btn-secondary" onClick={handleRevokeAllTokens} disabled={tokenActionId === 'all' || !normalizedEmail}>
                                        {tokenActionId === 'all' ? <span className="spinner" /> : '撤销全部'}
                                    </button>
                                </div>

                                <div className="grid gap-3 mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                                    <div className="card p-3">
                                        <div className="text-sm text-muted">当前范围</div>
                                        <div className="text-lg font-semibold">{result.token?.scope === 'server' ? '单节点' : '全节点'}</div>
                                        <div className="text-xs text-muted mt-1">{result.token?.serverId || 'all'}</div>
                                    </div>
                                    <div className="card p-3">
                                        <div className="text-sm text-muted">当前作用中的范围 token</div>
                                        <div className="text-xs font-mono">{result.token?.currentTokenId || '-'}</div>
                                        <div className="text-xs text-muted mt-1">{result.token?.autoIssued ? '系统自动签发' : '已有手动 token'}</div>
                                    </div>
                                    <div className="card p-3">
                                        <div className="text-sm text-muted">当前作用中的 token 必须性</div>
                                        <div className="text-lg font-semibold">{result.token?.tokenRequired ? '需要补签发' : '已满足'}</div>
                                        <div className="text-xs text-muted mt-1">{result.token?.issueError || '当前范围已有可用 token'}</div>
                                    </div>
                                </div>

                                {lastIssuedToken && (
                                    <div className="card p-3 mb-4">
                                        <div className="text-sm text-muted mb-2">最近签发</div>
                                        <div className="text-xs text-muted mb-2">该 token 明文只在签发时返回一次。</div>
                                        <div className="grid gap-2" style={{ display: 'grid', gap: '8px' }}>
                                            <input className="form-input font-mono text-xs" readOnly value={lastIssuedToken.token || ''} />
                                            <div className="subscription-link-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '8px' }}>
                                                <input className="form-input font-mono text-xs" readOnly value={lastIssuedToken.subscriptionUrl || ''} />
                                                <button className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(lastIssuedToken.subscriptionUrl || '').then(() => toast.success('地址已复制'))}>
                                                    <HiOutlineClipboard /> 复制地址
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="table-container">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>用途</th>
                                                <th>状态</th>
                                                <th>到期时间</th>
                                                <th>最近使用</th>
                                                <th>操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(result.token?.tokens || []).length === 0 ? (
                                                <tr><td colSpan={5} className="text-center">暂无 token</td></tr>
                                            ) : (result.token?.tokens || []).map((token) => (
                                                <tr key={token.publicTokenId || token.id}>
                                                    <td data-label="用途">
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span>{token.name || '未命名 token'}</span>
                                                            <span className="text-xs text-muted font-mono">{token.publicTokenId || token.id}</span>
                                                        </div>
                                                    </td>
                                                    <td data-label="状态">{renderTokenStatus(token.status)}</td>
                                                    <td data-label="到期时间" className="text-sm text-muted">{formatTokenDate(token.expiresAt)}</td>
                                                    <td data-label="最近使用" className="text-sm text-muted">{formatTokenDate(token.lastUsedAt)}</td>
                                                    <td data-label="操作">
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => handleRevokeToken(token.id)}
                                                            disabled={tokenActionId === token.id || token.status !== 'active'}
                                                        >
                                                            {tokenActionId === token.id ? <span className="spinner" /> : '撤销'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {showQr && activeProfile?.url && (
                    <ModalShell isOpen={showQr} onClose={() => setShowQr(false)}>
                        <div
                            className="modal glass-panel"
                            onClick={(e) => e.stopPropagation()}
                            style={{ maxWidth: '380px', textAlign: 'center' }}
                        >
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">订阅二维码 · {activeProfile.label}</h3>
                                <button className="modal-close" onClick={() => setShowQr(false)}><HiOutlineXMark /></button>
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
                                <SubscriptionClientLinks bundle={result.bundle} />
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={() => setShowQr(false)}>关闭</button>
                                <button className="btn btn-primary" onClick={handleCopy}>
                                    <HiOutlineClipboard /> 复制地址
                                </button>
                            </div>
                        </div>
                    </ModalShell>
                )}
            </div>
        </>
    );
}
