import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiOutlineArrowPath, HiOutlineClipboard, HiOutlineLink } from 'react-icons/hi2';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { copyToClipboard } from '../../utils/format.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import Header from '../Layout/Header.jsx';
import SubscriptionClientLinks from './SubscriptionClientLinks.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from '../../utils/passwordPolicy.js';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';

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
    const confirmAction = useConfirm();
    const { t } = useI18n();
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
    const [profileKey, setProfileKey] = useState('v2rayn');
    const [resetLoading, setResetLoading] = useState(false);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);

    const normalizedEmail = useMemo(() => String(selectedEmail || '').trim(), [selectedEmail]);
    const activeProfile = useMemo(
        () => findSubscriptionProfile(result?.bundle, profileKey),
        [result, profileKey]
    );
    const availableProfiles = useMemo(
        () => (Array.isArray(result?.bundle?.availableProfiles) ? result.bundle.availableProfiles : []),
        [result]
    );
    const linkedUserHref = normalizedEmail ? `/clients?q=${encodeURIComponent(normalizedEmail)}` : '';
    const summaryScopeLabel = isAdmin && selectedServerId && selectedServerId !== 'all'
        ? `节点 ${selectedServerId}`
        : '全部节点';
    const accountMeta = `${user?.username || '-'}${user?.role === 'admin' ? ' · 管理员' : ''}`;

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
                const msg = error.response?.data?.msg || error.message || t('comp.subscriptions.userListFailed');
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
            const msg = error.response?.data?.msg || error.message || t('comp.subscriptions.subLoadFailed');
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
            toast.error(t('comp.common.noCopyableUrl'));
            return;
        }
        await copyToClipboard(activeProfile.url);
        toast.success(`${activeProfile.label} 订阅地址已复制`);
    };

    const handleResetLink = async () => {
        if (!normalizedEmail) return;
        const scopeLabel = isAdmin && selectedServerId && selectedServerId !== 'all'
            ? `当前节点 (${selectedServerId})`
            : t('comp.subscriptions.currentScope');
        const resetMessage = isAdmin
            ? t('comp.subscriptions.resetAdminMsg')
            : t('comp.subscriptions.resetUserMsg');
        const ok = await confirmAction({
            title: t('comp.subscriptions.resetTitle'),
            message: resetMessage,
            details: `目标邮箱: ${normalizedEmail}\n范围: ${scopeLabel}`,
            confirmText: t('comp.common.confirmReset'),
            tone: 'danger',
        });
        if (!ok) return;
        setResetLoading(true);
        try {
            const payload = {};
            if (isAdmin && selectedServerId && selectedServerId !== 'all') {
                payload.serverId = selectedServerId;
            }
            await api.post(`/subscriptions/${encodeURIComponent(normalizedEmail)}/reset-link`, payload);
            toast.success(t('comp.subscriptions.subResetDone'));
            await loadSubscription();
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('comp.subscriptions.resetSubFailed'));
        }
        setResetLoading(false);
    };

    const handleChangePassword = async () => {
        const currentPassword = String(oldPassword || '');
        const nextPassword = String(newPassword || '');
        const repeatedPassword = String(confirmPassword || '');

        if (!currentPassword || !nextPassword || !repeatedPassword) {
            toast.error(t('comp.subscriptions.fillAllPwdFields'));
            return;
        }
        if (nextPassword !== repeatedPassword) {
            toast.error(t('comp.subscriptions.passwordMismatch'));
            return;
        }

        const passwordError = getPasswordPolicyError(nextPassword);
        if (passwordError) {
            toast.error(passwordError);
            return;
        }

        setPasswordLoading(true);
        try {
            await api.put('/auth/change-password', {
                oldPassword: currentPassword,
                newPassword: nextPassword,
            });
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
            toast.success(t('comp.subscriptions.passwordUpdated'));
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('comp.subscriptions.passwordUpdateFailed'));
        }
        setPasswordLoading(false);
    };

    return (
        <>
            <Header title={t('pages.subscriptions.title')} />
            <div className="page-content page-content--wide page-enter subscriptions-page">
                {isAdmin && (
                    <PageToolbar
                        className="card mb-8 subscriptions-toolbar"
                        main={(
                            <>
                                <div className="form-group subscriptions-toolbar-field">
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
                                </div>
                                <div className="form-group subscriptions-toolbar-field subscriptions-toolbar-field-sm">
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
                            </>
                        )}
                        actions={(
                            <>
                                {normalizedEmail && (
                                    <Link className="btn btn-secondary" to={linkedUserHref}>
                                        用户管理
                                    </Link>
                                )}
                                <button className="btn btn-secondary" onClick={loadUsers} disabled={usersLoading}>
                                    {usersLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 刷新用户列表</>}
                                </button>
                                <button className="btn btn-primary" onClick={loadSubscription} disabled={loading || !normalizedEmail}>
                                    {loading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 重新加载</>}
                                </button>
                            </>
                        )}
                        meta={(
                            <span className="subscriptions-toolbar-status">
                                {usersAccessDenied ? '当前角色无全量用户列表权限，请手动输入邮箱'
                                    : `已加载 ${users.length} 个用户，可直接搜索或选择`}
                            </span>
                        )}
                    />
                )}

                <div className="subscriptions-workbench">
                    <div className="subscriptions-main-column">
                        {!result ? (
                            <div className="card subscription-empty-card">
                                <div className="empty-state">
                                    <div className="empty-state-icon"><HiOutlineLink /></div>
                                    <div className="empty-state-text">
                                        {isUserOnly ? (defaultIdentity ? '正在加载订阅地址' : '管理员尚未为当前账号分配订阅链接') : '输入邮箱后会自动加载订阅地址'}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="card subscription-primary-card">
                                    <SectionHeader
                                        className="card-header section-header section-header--compact"
                                        title={isUserOnly ? '你的订阅地址' : '订阅地址与导入'}
                                        subtitle={isUserOnly ? '不会用也没关系，按右侧三步操作就能完成。' : '先选订阅类型，再复制地址或直接引导用户导入。'}
                                        actions={(
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={handleResetLink}
                                                disabled={resetLoading || !normalizedEmail}
                                            >
                                                {resetLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 重置订阅链接</>}
                                            </button>
                                        )}
                                    />
                                    <div className="subscription-hero-summary">
                                        <div className="subscription-hero-copy">
                                            <div className="subscription-hero-title">先选客户端类型，再复制或导入</div>
                                            <div className="subscription-hero-text">
                                                不知道怎么选时，先用“通用”；如果你用的是 Clash / Mihomo，再切到对应格式。
                                            </div>
                                        </div>
                                        <div className="subscription-hero-badges">
                                            <span className={`badge ${result.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                                                {result.subscriptionActive ? '订阅可用' : '订阅不可用'}
                                            </span>
                                            <span className="badge badge-neutral">{activeProfile?.label || '请选择类型'}</span>
                                            <span className="badge badge-neutral">{result.total} 个节点</span>
                                        </div>
                                    </div>
                                    <div className="subscription-profile-switches">
                                        {availableProfiles.map((item) => (
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
                                    <div className="subscription-profile-notes">
                                        <div className="text-xs text-muted">{activeProfile?.hint || '请选择订阅类型'}</div>
                                        <div className="text-xs text-muted">
                                            装好客户端后优先用“快捷导入”；如果不会导入，就先复制下面这条地址。
                                        </div>
                                        {isAdmin && result.bundle?.externalConverterConfigured && (
                                            <div className="text-xs text-muted">
                                                管理提示：专用订阅当前走外部转换器
                                                {' '}
                                                <a
                                                    href={result.bundle.externalConverterBaseUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    {result.bundle.externalConverterHost || result.bundle.externalConverterBaseUrl}
                                                </a>
                                                {' '}
                                                ·
                                                {' '}
                                                <Link to="/settings">去系统设置修改</Link>
                                            </div>
                                        )}
                                    </div>
                                    <div className="subscription-link-grid">
                                        <input
                                            className="form-input font-mono text-xs"
                                            value={activeProfile?.url || ''}
                                            readOnly
                                            title={activeProfile?.url || ''}
                                            dir="ltr"
                                            spellCheck={false}
                                        />
                                        <button className="btn btn-primary" onClick={handleCopy} disabled={!activeProfile?.url || !result.subscriptionActive}>
                                            <HiOutlineClipboard /> 复制地址
                                        </button>
                                    </div>
                                    <div className="subscription-inline-tip">
                                        给小白用户时，直接告诉他“选类型 -&gt; 复制地址 -&gt; 导入客户端”就够了。
                                    </div>
                                    <SubscriptionClientLinks bundle={result.bundle} />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="subscriptions-side-column">
                        <div className="card subscription-guide-card">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title="怎么使用订阅"
                                subtitle={isUserOnly ? '按这三步操作，基本就不会出错。' : '给用户说明时，照这三步说最简单。'}
                            />
                            <div className="subscription-guide-grid">
                                <div className="subscription-guide-step">
                                    <span className="subscription-guide-index">1</span>
                                    <div className="subscription-guide-copy">
                                        <div className="subscription-guide-title">先选客户端类型</div>
                                        <div className="subscription-guide-text">不知道怎么选，就先用“通用”；Clash / Mihomo 再切到对应格式。</div>
                                    </div>
                                </div>
                                <div className="subscription-guide-step">
                                    <span className="subscription-guide-index">2</span>
                                    <div className="subscription-guide-copy">
                                        <div className="subscription-guide-title">再复制地址或点导入</div>
                                        <div className="subscription-guide-text">已经装好客户端时，优先点“快捷导入”，最省事。</div>
                                    </div>
                                </div>
                                <div className="subscription-guide-step">
                                    <span className="subscription-guide-index">3</span>
                                    <div className="subscription-guide-copy">
                                        <div className="subscription-guide-title">节点变化时刷新订阅</div>
                                        <div className="subscription-guide-text">如果怀疑链接泄露，再点“重置订阅链接”换新地址。</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {result && (
                            <>
                                <div className="card subscription-summary-card">
                                    <SectionHeader
                                        className="card-header section-header section-header--compact"
                                        title="当前订阅概览"
                                        subtitle="重点信息集中显示，方便快速确认。"
                                    />
                                    <div className="subscription-summary-grid">
                                        <div className="subscription-summary-item">
                                            <div className="subscription-summary-label">当前用户</div>
                                            {isAdmin ? (
                                                <Link className="subscription-email-link" to={linkedUserHref}>
                                                    {result.email}
                                                </Link>
                                            ) : (
                                                <div className="subscription-summary-value subscription-summary-value--email">{result.email}</div>
                                            )}
                                        </div>
                                        <div className="subscription-summary-item">
                                            <div className="subscription-summary-label">订阅状态</div>
                                            <div className="subscription-summary-value">{result.subscriptionActive ? '可正常导入' : '暂不可用'}</div>
                                            <div className="subscription-summary-meta">{result.inactiveReason || '-'}</div>
                                        </div>
                                        <div className="subscription-summary-item">
                                            <div className="subscription-summary-label">可用节点</div>
                                            <div className="subscription-summary-value">{result.total}</div>
                                            <div className="subscription-summary-meta">已匹配 {result.matchedClientsActive}/{result.matchedClientsRaw}</div>
                                        </div>
                                        <div className="subscription-summary-item">
                                            <div className="subscription-summary-label">查看范围</div>
                                            <div className="subscription-summary-value">{summaryScopeLabel}</div>
                                            <div className="subscription-summary-meta">
                                                过期 {result.filteredExpired} / 禁用 {result.filteredDisabled} / 限制 {result.filteredByPolicy}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="card subscription-qr-card">
                                    <SectionHeader
                                        className="card-header section-header section-header--compact"
                                        title="扫码导入"
                                        subtitle="手机端或支持扫码的客户端，可以直接扫当前这条地址。"
                                    />
                                    <div className="subscription-qr-shell">
                                        {activeProfile?.url && result.subscriptionActive ? (
                                            <div
                                                className="qr-surface qr-surface-lg"
                                                role="img"
                                                aria-label={`订阅二维码 · ${activeProfile.label}`}
                                            >
                                                <QRCodeSVG
                                                    value={activeProfile.url}
                                                    size={176}
                                                    level="M"
                                                    includeMargin={false}
                                                />
                                            </div>
                                        ) : (
                                            <div className="text-sm text-muted">当前订阅暂无可用二维码</div>
                                        )}
                                        <div className="subscription-qr-copy">
                                            <div className="subscription-qr-title">{activeProfile?.label || '未选择类型'}</div>
                                            <div className="subscription-qr-text">二维码会跟随上面选择的订阅类型一起切换。</div>
                                            {result.email && (
                                                <div className="text-xs text-muted font-mono break-all">
                                                    {result.email}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="card subscription-password-card">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title="当前登录账号密码"
                                meta={(
                                    <span className="text-xs text-muted">
                                        {accountMeta}
                                    </span>
                                )}
                            />
                            <div className="grid grid-auto-220 gap-3 items-end">
                                <div className="form-group mb-0">
                                    <label className="form-label">当前密码</label>
                                    <input
                                        type="password"
                                        className="form-input"
                                        aria-label="当前密码"
                                        value={oldPassword}
                                        onChange={(e) => setOldPassword(e.target.value)}
                                        autoComplete="current-password"
                                    />
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">新密码</label>
                                    <input
                                        type="password"
                                        className="form-input"
                                        aria-label="新密码"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">确认新密码</label>
                                    <input
                                        type="password"
                                        className="form-input"
                                        aria-label="确认新密码"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleChangePassword}
                                    disabled={passwordLoading || !oldPassword || !newPassword || !confirmPassword}
                                >
                                    {passwordLoading ? <span className="spinner" /> : '修改登录密码'}
                                </button>
                            </div>
                            <div className="text-xs text-muted mt-3">{PASSWORD_POLICY_HINT}</div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
