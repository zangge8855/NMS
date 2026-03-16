import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiOutlineArrowPath, HiOutlineClipboard, HiOutlineExclamationTriangle, HiOutlineLink } from 'react-icons/hi2';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { copyToClipboard, formatBytes, formatDateOnly } from '../../utils/format.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import Header from '../Layout/Header.jsx';
import SubscriptionClientLinks from './SubscriptionClientLinks.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy.js';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';

function normalizeInactiveReason(reason, locale = 'zh-CN') {
    const text = String(reason || '').trim().toLowerCase();
    if (locale === 'en-US') {
        if (!text) return 'Available';
        if (text === 'all-expired-or-disabled') return 'All nodes have expired or are disabled';
        if (text === 'blocked-by-policy') return 'Blocked by subscription policy';
        if (text === 'user-not-found') return 'User not found';
        if (text === 'no-links-found') return 'No usable node links were generated';
        return reason;
    }
    if (!text) return '可用';
    if (text === 'all-expired-or-disabled') return '全部节点已过期或禁用';
    if (text === 'blocked-by-policy') return '被订阅权限策略限制';
    if (text === 'user-not-found') return '未找到该用户';
    if (text === 'no-links-found') return '未生成可用节点链接';
    return reason;
}

function clampProgress(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, numeric));
}

function pickProgressTone(progress, { inverse = false } = {}) {
    if (!inverse) {
        if (progress >= 85) return 'danger';
        if (progress >= 60) return 'warning';
        return 'info';
    }
    if (progress <= 15) return 'danger';
    if (progress <= 40) return 'warning';
    return 'success';
}

function buildExpiryProgress(expiryTime, locale = 'zh-CN') {
    const timestamp = Number(expiryTime || 0);
    if (!(timestamp > 0)) {
        return {
            progress: 100,
            tone: 'success',
            meta: '∞',
        };
    }

    const remainingMs = timestamp - Date.now();
    if (remainingMs <= 0) {
        return {
            progress: 0,
            tone: 'danger',
            meta: locale === 'en-US' ? 'Expired' : '已到期',
        };
    }

    const remainingDays = Math.max(1, Math.ceil(remainingMs / 86400000));
    return {
        progress: clampProgress((remainingDays / 30) * 100),
        tone: remainingDays <= 3 ? 'danger' : remainingDays <= 7 ? 'warning' : 'success',
        meta: locale === 'en-US' ? `${remainingDays}d` : `${remainingDays}天`,
    };
}

function getSubscriptionCopy(locale = 'zh-CN', { userCount = 0, nodeCount = 0 } = {}) {
    if (locale === 'en-US') {
        return {
            allNodes: 'All Nodes',
            adminRole: 'Admin',
            userEmail: 'User Email',
            scope: 'Scope',
            manageUsers: 'User Management',
            refreshUsers: 'Refresh Users',
            reload: 'Reload',
            listDenied: 'Your role cannot view the full user list. Enter the email manually.',
            listLoaded: `Loaded ${userCount} users. Search or pick one directly.`,
            loadingAddress: 'Loading subscription address',
            noAssignedLink: 'No subscription link has been assigned yet',
            inputEmailHint: 'Enter an email to load the subscription address',
            userTitle: 'Your Subscription',
            adminTitle: 'Subscription Address & Import',
            userSubtitle: 'Choose a config, then copy or scan it.',
                adminSubtitle: 'For end users, these two steps are enough.',
            available: 'Subscription Ready',
            unavailable: 'Subscription Unavailable',
            nodeCount: `${nodeCount} nodes`,
            currentProfileFallback: 'Choose a config',
            currentType: 'Current Config',
            copyAddress: 'Copy Address',
            scanImport: 'Scan to Import',
            noQr: 'No QR code is available for this format.',
            noQuickImport: 'This config does not support one-tap import. Copy the address instead.',
            resetLink: 'Reset Subscription Link',
            passwordTitle: 'Current Login Password',
            currentPassword: 'Current Password',
            newPassword: 'New Password',
            confirmPassword: 'Confirm New Password',
            changePassword: 'Change Login Password',
            copiedAddress: '{label} subscription address copied',
            selectedNode: 'Node {id}',
            currentNode: 'Current node ({id})',
            resetDetailsTarget: 'Target Email',
            resetDetailsScope: 'Scope',
            userStepKicker: 'Flow',
                userStepTitle: 'Choose a config, then import it',
                userStepText: 'Start with the device card below. The URL can stay collapsed because users only need the copy button.',
                pickTypeTitle: 'Choose a config',
                pickTypeText: '',
                copyOrScanTitle: 'Address and import',
                copyOrScanText: 'Copy, scan and quick import stay together here.',
                deviceOpenTitle: 'Downloads',
                deviceOpenText: '',
                resetRiskTitle: 'Reset only if leaked',
                resetRiskText: 'The old link stops working immediately.',
                heroTitle: 'Choose a config -> Copy or import it',
                heroText: 'If you are unsure which one to choose, start by downloading the client for your device below.',
                manualImportHint: 'If one-tap import does not work, copy the address below into the client.',
                adminConverterHint: 'Admin note: dedicated subscriptions currently use an external converter',
                goSettings: 'Change it in Settings',
                qrAriaLabel: 'Subscription QR code · {label}',
                quickImportHint: 'You can also use the quick import buttons below.',
                adminQuickImportHint: 'Quick import buttons for the current config stay here as well.',
                simpleReminder: 'Choose a config -> Copy or import',
                qrHint: 'You can also scan the QR code.',
                guideTitle: 'How to share it',
                guideSubtitle: 'Just explain these two steps.',
                guideStep1Title: 'Choose a config',
                guideStep1Text: 'If they are unsure, tell them to download the client for their device first.',
                guideStep2Title: 'Copy or import it',
                guideStep2Text: 'Use one-tap import when available. Otherwise, copy the address above and paste it into the client.',
                summaryTitle: 'Current Subscription Summary',
            summarySubtitle: 'Key details stay in one place for quick checks.',
            summaryUser: 'Current User',
            summaryStatus: 'Subscription Status',
            summaryStatusReady: 'Ready to import',
            summaryStatusBlocked: 'Unavailable',
            summaryNodes: 'Available Nodes',
            summaryMatched: 'Matched {active}/{raw}',
            summaryScope: 'Current Scope',
            summaryFilters: 'Expired {expired} / Disabled {disabled} / Policy {policy}',
            usedTraffic: 'Used Traffic',
            availableTraffic: 'Available Traffic',
            expiryTime: 'Expiry Time',
            unlimited: 'Unlimited',
            permanent: 'Permanent',
        };
    }

    return {
        allNodes: '全部节点',
        adminRole: '管理员',
        userEmail: '用户邮箱',
        scope: '订阅范围',
        manageUsers: '用户管理',
        refreshUsers: '刷新用户列表',
        reload: '重新加载',
        listDenied: '当前角色无全量用户列表权限，请手动输入邮箱',
        listLoaded: `已加载 ${userCount} 个用户，可直接搜索或选择`,
        loadingAddress: '正在加载订阅地址',
        noAssignedLink: '管理员尚未为当前账号分配订阅链接',
        inputEmailHint: '输入邮箱后会自动加载订阅地址',
        userTitle: '你的订阅地址',
        adminTitle: '订阅地址与导入',
        userSubtitle: '先选配置文件，再导入。',
        adminSubtitle: '给用户时，直接按这两步说明就够了。',
        available: '订阅可用',
        unavailable: '订阅不可用',
        nodeCount: `${nodeCount} 个节点`,
        currentProfileFallback: '请选择订阅类型',
        currentType: '当前配置文件',
        copyAddress: '复制地址',
        scanImport: '扫码导入',
        noQr: '当前格式暂无二维码',
        noQuickImport: '当前配置文件不支持一键导入，复制地址即可。',
        resetLink: '重置订阅链接',
        passwordTitle: '当前登录账号密码',
        currentPassword: '当前密码',
        newPassword: '新密码',
        confirmPassword: '确认新密码',
        changePassword: '修改登录密码',
        copiedAddress: '{label} 订阅地址已复制',
        selectedNode: '节点 {id}',
        currentNode: '当前节点 ({id})',
        resetDetailsTarget: '目标邮箱',
        resetDetailsScope: '范围',
        userStepKicker: '使用顺序',
        userStepTitle: '选配置文件 -> 导入客户端',
        userStepText: '导入按钮、复制按钮和二维码都在下面这一块。',
        pickTypeTitle: '选配置文件',
        pickTypeText: '',
        copyOrScanTitle: '订阅地址与导入',
        copyOrScanText: '复制、扫码和一键导入都在这里。',
        deviceOpenTitle: '软件下载',
        deviceOpenText: '',
        resetRiskTitle: '地址泄露再重置',
        resetRiskText: '重置后旧地址立即失效。',
        heroTitle: '选配置文件 -> 复制或导入',
        heroText: '不知道选哪个时，先在下面下载适合自己设备的软件。',
        manualImportHint: '不会导入时，直接复制这条地址。',
        adminConverterHint: '管理提示：专用订阅当前走外部转换器',
        goSettings: '去系统设置修改',
        qrAriaLabel: '订阅二维码 · {label}',
        quickImportHint: '也可以直接点导入按钮。',
        adminQuickImportHint: '当前配置文件的快捷导入按钮也在这里。',
        simpleReminder: '选配置文件 -> 复制或导入',
        qrHint: '也可以扫码导入。',
        guideTitle: '怎么使用订阅',
        guideSubtitle: '就按这两步，不用讲别的。',
        guideStep1Title: '选配置文件',
        guideStep1Text: '不知道怎么选，就先按设备下载软件，再选对应配置文件。',
        guideStep2Title: '复制地址并导入',
        guideStep2Text: '支持一键导入就直接点导入；不会时就复制上面的地址，在客户端里粘贴导入。',
        summaryTitle: '当前订阅概览',
        summarySubtitle: '重点信息集中显示，方便快速确认。',
        summaryUser: '当前用户',
        summaryStatus: '订阅状态',
        summaryStatusReady: '可正常导入',
        summaryStatusBlocked: '暂不可用',
        summaryNodes: '可用节点',
        summaryMatched: '已匹配 {active}/{raw}',
        summaryScope: '查看范围',
        summaryFilters: '过期 {expired} / 禁用 {disabled} / 限制 {policy}',
        usedTraffic: '已用流量',
        availableTraffic: '可用流量',
        expiryTime: '到期时间',
        unlimited: '不限',
        permanent: '永久',
    };
}

function normalizeProfileKey(profileKey) {
    return String(profileKey || '').trim() === 'mihomo' ? 'clash' : String(profileKey || '').trim();
}

function getUserFacingProfileLabel(profile) {
    if (String(profile?.key || '').trim() !== 'v2rayn') {
        return String(profile?.label || '').trim();
    }
    return 'v2rayN / Shadowrocket';
}

function buildSelectedImportActions(bundle, profileKey, locale = 'zh-CN') {
    const normalizedProfileKey = normalizeProfileKey(profileKey);
    const importActions = Array.isArray(bundle?.importActions) ? bundle.importActions : [];
    const pushLink = (items, href, label) => {
        if (!String(href || '').trim() || !String(label || '').trim()) return;
        items.push({ href, label });
    };

    if (normalizedProfileKey === 'v2rayn') {
        const shadowrocket = importActions.find((item) => item.key === 'shadowrocket');
        return shadowrocket?.href ? [{ href: shadowrocket.href, label: locale === 'en-US' ? `Import to ${shadowrocket.label}` : `导入到 ${shadowrocket.label}` }] : [];
    }

    if (normalizedProfileKey === 'clash') {
        const clashFamily = importActions.find((item) => item.key === 'clash-family');
        const items = [];
        (Array.isArray(clashFamily?.actions) ? clashFamily.actions : []).forEach((action) => {
            pushLink(items, action.href, locale === 'en-US' ? `Import to ${action.label}` : `导入到 ${action.label}`);
        });
        return items;
    }

    if (normalizedProfileKey === 'surge') {
        const surge = importActions.find((item) => item.key === 'surge');
        return surge?.href ? [{ href: surge.href, label: locale === 'en-US' ? `Import to ${surge.label}` : `导入到 ${surge.label}` }] : [];
    }

    if (normalizedProfileKey === 'singbox') {
        const singbox = importActions.find((item) => item.key === 'singbox');
        return singbox?.href ? [{ href: singbox.href, label: locale === 'en-US' ? `Import to ${singbox.label}` : `导入到 ${singbox.label}` }] : [];
    }

    return [];
}

export default function Subscriptions() {
    const { servers } = useServer();
    const { user } = useAuth();
    const confirmAction = useConfirm();
    const { t, locale } = useI18n();
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
    const ui = useMemo(
        () => getSubscriptionCopy(locale, { userCount: users.length, nodeCount: Number(result?.total || 0) }),
        [locale, users.length, result?.total]
    );

    const normalizedEmail = useMemo(() => String(selectedEmail || '').trim(), [selectedEmail]);
    const deferredEmail = useDeferredValue(normalizedEmail);
    const activeProfile = useMemo(
        () => findSubscriptionProfile(result?.bundle, profileKey),
        [result, profileKey]
    );
    const activeProfileSupportedClients = useMemo(
        () => (Array.isArray(activeProfile?.supportedClients) ? activeProfile.supportedClients : []),
        [activeProfile]
    );
    const activeProfileLabel = useMemo(
        () => (isUserOnly ? getUserFacingProfileLabel(activeProfile) : String(activeProfile?.label || '').trim()),
        [activeProfile, isUserOnly]
    );
    const shouldShowUserProfileHint = activeProfileSupportedClients.length === 0
        && !!String(activeProfile?.hint || '').trim();
    const availableProfiles = useMemo(
        () => (Array.isArray(result?.bundle?.availableProfiles) ? result.bundle.availableProfiles : []),
        [result]
    );
    const displayedProfiles = useMemo(
        () => availableProfiles.map((item) => ({
            ...item,
            label: isUserOnly ? getUserFacingProfileLabel(item) : item.label,
        })),
        [availableProfiles, isUserOnly]
    );
    const userProfileLabelOverrides = useMemo(
        () => (isUserOnly ? { v2rayn: getUserFacingProfileLabel({ key: 'v2rayn' }) } : {}),
        [isUserOnly]
    );
    const selectedImportActions = useMemo(
        () => buildSelectedImportActions(result?.bundle, profileKey, locale),
        [result, profileKey, locale]
    );
    const linkedUserHref = normalizedEmail ? `/clients?q=${encodeURIComponent(normalizedEmail)}` : '';
    const summaryScopeLabel = isAdmin && selectedServerId && selectedServerId !== 'all'
        ? ui.selectedNode.replace('{id}', selectedServerId)
        : ui.allNodes;
    const accountMeta = `${user?.username || '-'}${user?.role === 'admin' ? ` · ${ui.adminRole}` : ''}`;
    const usedTrafficBytes = Number(result?.usedTrafficBytes || 0);
    const trafficLimitBytes = Number(result?.trafficLimitBytes || 0);
    const remainingTrafficBytes = Number(result?.remainingTrafficBytes || 0);
    const usedTrafficLabel = formatBytes(usedTrafficBytes);
    const availableTrafficLabel = trafficLimitBytes > 0
        ? formatBytes(remainingTrafficBytes)
        : ui.unlimited;
    const expiryTimeLabel = Number(result?.expiryTime || 0) > 0
        ? formatDateOnly(Number(result.expiryTime), locale)
        : ui.permanent;
    const usedTrafficProgress = trafficLimitBytes > 0
        ? clampProgress((usedTrafficBytes / trafficLimitBytes) * 100)
        : 100;
    const availableTrafficProgress = trafficLimitBytes > 0
        ? clampProgress((remainingTrafficBytes / trafficLimitBytes) * 100)
        : 100;
    const expiryProgressState = buildExpiryProgress(result?.expiryTime, locale);
    const statusCards = [
        {
            key: 'used',
            label: ui.usedTraffic,
            value: usedTrafficLabel,
            meta: trafficLimitBytes > 0 ? `${Math.round(usedTrafficProgress)}%` : '∞',
            progress: usedTrafficProgress,
            tone: trafficLimitBytes > 0 ? pickProgressTone(usedTrafficProgress) : 'info',
        },
        {
            key: 'available',
            label: ui.availableTraffic,
            value: availableTrafficLabel,
            meta: trafficLimitBytes > 0 ? `${Math.round(availableTrafficProgress)}%` : '∞',
            progress: availableTrafficProgress,
            tone: trafficLimitBytes > 0 ? pickProgressTone(availableTrafficProgress, { inverse: true }) : 'success',
        },
        {
            key: 'expiry',
            label: ui.expiryTime,
            value: expiryTimeLabel,
            meta: expiryProgressState.meta,
            progress: expiryProgressState.progress,
            tone: expiryProgressState.tone,
        },
    ];

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
                toast.error(locale === 'en-US'
                    ? `${warningCount} node user lists failed to load`
                    : `有 ${warningCount} 个节点用户列表拉取失败`);
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

    const loadSubscription = async (targetEmail = normalizedEmail) => {
        const resolvedEmail = String(targetEmail || '').trim();
        if (!resolvedEmail) {
            setResult(null);
            return;
        }

        setLoading(true);
        try {
            const query = new URLSearchParams();
            if (isAdmin && selectedServerId && selectedServerId !== 'all') {
                query.append('serverId', selectedServerId);
            }

            const res = await api.get(`/subscriptions/${encodeURIComponent(resolvedEmail)}${query.toString() ? `?${query.toString()}` : ''}`);
            const payload = res.data?.obj || {};
            const bundle = buildSubscriptionProfileBundle(payload, locale);

            setResult({
                email: payload.email || resolvedEmail,
                total: Number(payload.total || 0),
                sourceMode: payload.sourceMode || 'unknown',
                mergedUrl: bundle.mergedUrl,
                bundle,
                subscriptionActive: payload.subscriptionActive !== false,
                inactiveReason: normalizeInactiveReason(payload.inactiveReason, locale),
                filteredExpired: Number(payload.filteredExpired || 0),
                filteredDisabled: Number(payload.filteredDisabled || 0),
                filteredByPolicy: Number(payload.filteredByPolicy || 0),
                usedTrafficBytes: Number(payload.usedTrafficBytes || 0),
                trafficLimitBytes: Number(payload.trafficLimitBytes || 0),
                remainingTrafficBytes: Number(payload.remainingTrafficBytes || 0),
                expiryTime: Number(payload.expiryTime || 0),
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
        loadSubscription(deferredEmail);
    }, [deferredEmail, selectedServerId, locale]);

    const handleCopy = async () => {
        if (!activeProfile?.url) {
            toast.error(t('comp.common.noCopyableUrl'));
            return;
        }
        await copyToClipboard(activeProfile.url);
        toast.success(ui.copiedAddress.replace('{label}', activeProfileLabel || activeProfile.label));
    };

    const handleResetLink = async () => {
        if (!normalizedEmail) return;
        const scopeLabel = isAdmin && selectedServerId && selectedServerId !== 'all'
            ? ui.currentNode.replace('{id}', selectedServerId)
            : t('comp.subscriptions.currentScope');
        const resetMessage = isAdmin
            ? t('comp.subscriptions.resetAdminMsg')
            : t('comp.subscriptions.resetUserMsg');
        const ok = await confirmAction({
            title: t('comp.subscriptions.resetTitle'),
            message: resetMessage,
            details: `${ui.resetDetailsTarget}: ${normalizedEmail}\n${ui.resetDetailsScope}: ${scopeLabel}`,
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

        const passwordError = getPasswordPolicyError(nextPassword, locale);
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
                                    <label className="form-label">{ui.userEmail}</label>
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
                                    <label className="form-label">{ui.scope}</label>
                                    <select
                                        className="form-select"
                                        value={selectedServerId}
                                        onChange={(e) => setSelectedServerId(e.target.value)}
                                    >
                                        <option value="all">{ui.allNodes}</option>
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
                                        {ui.manageUsers}
                                    </Link>
                                )}
                                <button className="btn btn-secondary" onClick={loadUsers} disabled={usersLoading}>
                                    {usersLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> {ui.refreshUsers}</>}
                                </button>
                                <button className="btn btn-primary" onClick={() => loadSubscription()} disabled={loading || !normalizedEmail}>
                                    {loading ? <span className="spinner" /> : <><HiOutlineArrowPath /> {ui.reload}</>}
                                </button>
                            </>
                        )}
                        meta={(
                            <span className="subscriptions-toolbar-status">
                                {usersAccessDenied ? ui.listDenied : ui.listLoaded}
                            </span>
                        )}
                    />
                )}

                <div className={`subscriptions-workbench${isUserOnly ? ' subscriptions-workbench--simple' : ''}`}>
                    <div className="subscriptions-main-column">
                        {!result ? (
                            <div className="card subscription-empty-card">
                                <div className="empty-state">
                                    <div className="empty-state-icon"><HiOutlineLink /></div>
                                    <div className="empty-state-text">
                                        {isUserOnly ? (defaultIdentity ? ui.loadingAddress : ui.noAssignedLink) : ui.inputEmailHint}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="card subscription-primary-card">
                                    {!isUserOnly && (
                                        <SectionHeader
                                            className="card-header section-header section-header--compact"
                                            title={ui.adminTitle}
                                            actions={(
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={handleResetLink}
                                                    disabled={resetLoading || !normalizedEmail}
                                                >
                                                    {resetLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> {ui.resetLink}</>}
                                                </button>
                                            )}
                                        />
                                    )}
                                    {isUserOnly ? (
                                        <div className="subscription-user-flow">
                                            <div className="subscription-user-flow-note" role="note">
                                                <span className="subscription-user-flow-text">{ui.simpleReminder}</span>
                                            </div>

                                            <div className="subscription-user-panel subscription-user-panel--import">
                                                <div className="subscription-user-panel-topbar">
                                                    <div className="subscription-user-panel-head">
                                                        <div className="subscription-user-panel-title">{ui.pickTypeTitle}</div>
                                                        {ui.pickTypeText && (
                                                            <div className="subscription-user-panel-text">{ui.pickTypeText}</div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="subscription-profile-switches">
                                                    {displayedProfiles.map((item) => (
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
                                                {activeProfile?.label && (shouldShowUserProfileHint || activeProfileSupportedClients.length > 0) && (
                                                    <div className="subscription-current-profile-card">
                                                        {activeProfileSupportedClients.length > 0 && (
                                                            <div className="subscription-current-profile-tools">
                                                                <span className="subscription-current-profile-tools-label">
                                                                    {activeProfile.supportedClientsLabel || (locale === 'en-US' ? 'Compatible Clients' : '适用软件')}
                                                                </span>
                                                                <div className="subscription-current-profile-tools-list">
                                                                    {activeProfileSupportedClients.map((client) => (
                                                                        <span key={client} className="badge badge-neutral">{client}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {shouldShowUserProfileHint && (
                                                            <div className="subscription-current-profile-hint">{activeProfile.hint}</div>
                                                        )}
                                                    </div>
                                                )}
                                                <div className="subscription-link-card subscription-link-card--user-focus subscription-link-card--user-with-qr">
                                                    <div className="subscription-user-address-grid">
                                                        <div className="subscription-user-address-main">
                                                            <div className="subscription-user-address-head">
                                                                <div className="subscription-user-address-copy">
                                                                    <div className="subscription-user-address-label">{ui.copyOrScanTitle}</div>
                                                                    <div className="subscription-user-address-kicker">{activeProfileLabel || ui.currentProfileFallback}</div>
                                                                </div>
                                                                <span className={`badge ${result.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                                                                    {result.subscriptionActive ? ui.available : ui.unavailable}
                                                                </span>
                                                            </div>
                                                            <input
                                                                className="form-input font-mono text-xs subscription-url-input"
                                                                value={activeProfile?.url || ''}
                                                                readOnly
                                                                title={activeProfile?.url || ''}
                                                                dir="ltr"
                                                                spellCheck={false}
                                                            />
                                                            <div className="subscription-address-status-grid" aria-label={locale === 'en-US' ? 'Subscription status summary' : '订阅状态摘要'}>
                                                                {statusCards.map((item) => (
                                                                    <div key={item.key} className={`subscription-address-status-card subscription-address-status-card--${item.tone}`}>
                                                                        <div className="subscription-address-status-head">
                                                                            <div className="subscription-address-status-label">{item.label}</div>
                                                                            <div className="subscription-address-status-meta">{item.meta}</div>
                                                                        </div>
                                                                        <div className="subscription-address-status-value">{item.value}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className="subscription-user-address-actions">
                                                                <button
                                                                    className="btn btn-primary btn-sm subscription-user-copy-btn"
                                                                    onClick={handleCopy}
                                                                    disabled={!activeProfile?.url || !result.subscriptionActive}
                                                                >
                                                                    <HiOutlineClipboard /> {ui.copyAddress}
                                                                </button>
                                                                {selectedImportActions.map((item) => (
                                                                    <a key={item.label} href={item.href} className="btn btn-secondary btn-sm subscription-user-import-btn">
                                                                        {item.label}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                            <div className="subscription-user-address-note">
                                                                {selectedImportActions.length > 0 ? ui.quickImportHint : ui.noQuickImport}
                                                            </div>
                                                        </div>
                                                        <div className="subscription-inline-qr subscription-inline-qr--featured subscription-inline-qr--user-side">
                                                            {activeProfile?.url && result.subscriptionActive ? (
                                                                <>
                                                                    <div className="subscription-inline-qr-title">{ui.scanImport}</div>
                                                                    <div
                                                                        className="qr-surface subscription-inline-qr-surface"
                                                                        role="img"
                                                                        aria-label={ui.qrAriaLabel.replace('{label}', activeProfileLabel || activeProfile.label)}
                                                                    >
                                                                        <QRCodeSVG
                                                                            value={activeProfile.url}
                                                                            size={128}
                                                                            level="M"
                                                                            includeMargin={false}
                                                                        />
                                                                    </div>
                                                                    <div className="subscription-inline-qr-text">{ui.qrHint}</div>
                                                                </>
                                                            ) : (
                                                                <div className="text-sm text-muted">{ui.noQr}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="subscription-user-address-foot">
                                                        <button
                                                            className="btn btn-danger btn-sm subscription-user-reset-inline-btn"
                                                            onClick={handleResetLink}
                                                            disabled={resetLoading || !normalizedEmail}
                                                        >
                                                            {resetLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> {ui.resetLink}</>}
                                                        </button>
                                                        <div className="subscription-user-reset-inline-copy">
                                                            <div className="subscription-user-reset-inline-title">
                                                                <HiOutlineExclamationTriangle />
                                                                <span>{ui.resetRiskTitle}</span>
                                                            </div>
                                                            <div className="subscription-user-reset-inline-text">{ui.resetRiskText}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="subscription-user-panel subscription-user-panel--clients">
                                                <div className="subscription-user-panel-head">
                                                    <div className="subscription-user-panel-title">{ui.deviceOpenTitle}</div>
                                                    {ui.deviceOpenText && (
                                                        <div className="subscription-user-panel-text">{ui.deviceOpenText}</div>
                                                    )}
                                                </div>
                                                <SubscriptionClientLinks
                                                    bundle={result.bundle}
                                                    compact
                                                    showHeading={false}
                                                    showImportMethods={false}
                                                    profileLabelOverrides={userProfileLabelOverrides}
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="subscription-hero-summary">
                                                <div className="subscription-hero-copy">
                                                    <div className="subscription-hero-title">{ui.heroTitle}</div>
                                                    <div className="subscription-hero-text">
                                                        {ui.heroText}
                                                    </div>
                                                </div>
                                                <div className="subscription-hero-badges">
                                                    <span className={`badge ${result.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                                                        {result.subscriptionActive ? ui.available : ui.unavailable}
                                                    </span>
                                                    <span className="badge badge-neutral">{activeProfile?.label || ui.currentProfileFallback}</span>
                                                    <span className="badge badge-neutral">{ui.nodeCount}</span>
                                                </div>
                                            </div>
                                            <div className="subscription-admin-focus">
                                                <div className="subscription-admin-focus-copy">
                                                    <div className="subscription-admin-focus-label">{ui.summaryUser}</div>
                                                    <div className="subscription-admin-focus-value">
                                                        {isAdmin ? (
                                                            <Link className="subscription-email-link" to={linkedUserHref}>
                                                                {result.email}
                                                            </Link>
                                                        ) : result.email}
                                                    </div>
                                                    <div className="subscription-admin-focus-meta">
                                                        {ui.summaryScope}: {summaryScopeLabel}
                                                        {' · '}
                                                        {ui.summaryMatched.replace('{active}', String(result.matchedClientsActive)).replace('{raw}', String(result.matchedClientsRaw))}
                                                    </div>
                                                </div>
                                                <div className="subscription-admin-focus-badges">
                                                    <span className={`badge ${result.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                                                        {result.subscriptionActive ? ui.summaryStatusReady : ui.summaryStatusBlocked}
                                                    </span>
                                                    <span className="badge badge-neutral">{activeProfile?.label || ui.currentProfileFallback}</span>
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
                                                <div className="text-xs text-muted">{activeProfile?.hint || ui.currentProfileFallback}</div>
                                                {Array.isArray(activeProfile?.supportedClients) && activeProfile.supportedClients.length > 0 && (
                                                    <div className="subscription-current-profile-tools subscription-current-profile-tools--inline">
                                                        <span className="subscription-current-profile-tools-label">
                                                            {activeProfile.supportedClientsLabel || (locale === 'en-US' ? 'Compatible Clients' : '适用软件')}
                                                        </span>
                                                        <div className="subscription-current-profile-tools-list">
                                                            {activeProfile.supportedClients.map((client) => (
                                                                <span key={client} className="badge badge-neutral">{client}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="text-xs text-muted">{ui.manualImportHint}</div>
                                                {isAdmin && result.bundle?.externalConverterConfigured && (
                                                    <div className="text-xs text-muted">
                                                        {ui.adminConverterHint}
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
                                                        <Link to="/settings">{ui.goSettings}</Link>
                                                    </div>
                                                )}
                                            </div>
                                                <div className="subscription-link-with-qr">
                                                    <div className="subscription-link-card subscription-link-card--import-focus">
                                                        <div className="subscription-user-address-head">
                                                            <div className="subscription-user-address-copy">
                                                                <div className="subscription-user-address-label">{ui.copyOrScanTitle}</div>
                                                                <div className="subscription-user-address-kicker">{activeProfile?.label || ui.currentProfileFallback}</div>
                                                            </div>
                                                            <span className={`badge ${result.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                                                                {result.subscriptionActive ? ui.available : ui.unavailable}
                                                            </span>
                                                        </div>
                                                    <div className="subscription-link-grid">
                                                        <input
                                                            className="form-input font-mono text-xs subscription-url-input"
                                                            value={activeProfile?.url || ''}
                                                            readOnly
                                                            title={activeProfile?.url || ''}
                                                            dir="ltr"
                                                            spellCheck={false}
                                                        />
                                                        <button className="btn btn-primary" onClick={handleCopy} disabled={!activeProfile?.url || !result.subscriptionActive}>
                                                            <HiOutlineClipboard /> {ui.copyAddress}
                                                        </button>
                                                    </div>
                                                    <div className="subscription-address-status-grid" aria-label={locale === 'en-US' ? 'Subscription status summary' : '订阅状态摘要'}>
                                                        {statusCards.map((item) => (
                                                            <div key={item.key} className={`subscription-address-status-card subscription-address-status-card--${item.tone}`}>
                                                                <div className="subscription-address-status-head">
                                                                    <div className="subscription-address-status-label">{item.label}</div>
                                                                    <div className="subscription-address-status-meta">{item.meta}</div>
                                                                </div>
                                                                <div className="subscription-address-status-value">{item.value}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="subscription-user-address-note">
                                                        {selectedImportActions.length > 0 ? ui.adminQuickImportHint : ui.noQuickImport}
                                                    </div>
                                                </div>
                                                    <div className="subscription-inline-qr">
                                                        {activeProfile?.url && result.subscriptionActive ? (
                                                            <>
                                                                <div className="subscription-inline-qr-title">{ui.scanImport}</div>
                                                                <div
                                                                    className="qr-surface subscription-inline-qr-surface"
                                                                    role="img"
                                                                    aria-label={ui.qrAriaLabel.replace('{label}', activeProfile.label)}
                                                            >
                                                                <QRCodeSVG
                                                                    value={activeProfile.url}
                                                                    size={124}
                                                                    level="M"
                                                                        includeMargin={false}
                                                                    />
                                                                </div>
                                                                <div className="subscription-inline-qr-text">{ui.adminQuickImportHint}</div>
                                                                {selectedImportActions.length > 0 ? (
                                                                    <div className="subscription-inline-quick-actions">
                                                                        <div className="subscription-inline-quick-list">
                                                                            {selectedImportActions.map((item) => (
                                                                                <a key={item.label} href={item.href} className="btn btn-secondary btn-sm subscription-inline-quick-btn">
                                                                                    {item.label}
                                                                                </a>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="subscription-inline-quick-hint">{ui.noQuickImport}</div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <div className="text-sm text-muted">{ui.noQr}</div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="subscription-inline-tip">
                                                {ui.simpleReminder}
                                            </div>
                                            <SubscriptionClientLinks bundle={result.bundle} />
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="subscriptions-side-column">
                        {!isUserOnly && (
                            <div className="card subscription-guide-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title={ui.guideTitle}
                                />
                                <div className="subscription-guide-grid">
                                    <div className="subscription-guide-step">
                                        <span className="subscription-guide-index">1</span>
                                        <div className="subscription-guide-copy">
                                            <div className="subscription-guide-line">
                                                <span className="subscription-guide-title">{ui.guideStep1Title}</span>
                                                <span className="subscription-guide-separator" aria-hidden="true">·</span>
                                                <span className="subscription-guide-text">{ui.guideStep1Text}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="subscription-guide-step">
                                        <span className="subscription-guide-index">2</span>
                                        <div className="subscription-guide-copy">
                                            <div className="subscription-guide-line">
                                                <span className="subscription-guide-title">{ui.guideStep2Title}</span>
                                                <span className="subscription-guide-separator" aria-hidden="true">·</span>
                                                <span className="subscription-guide-text">{ui.guideStep2Text}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {!isUserOnly && result && (
                            <>
                                <div className="card subscription-summary-card">
                                    <SectionHeader
                                        className="card-header section-header section-header--compact"
                                        title={ui.summaryTitle}
                                    />
                                        <div className="subscription-summary-grid">
                                            <div className="subscription-summary-item">
                                                <div className="subscription-summary-label">{ui.summaryUser}</div>
                                            {isAdmin ? (
                                                <Link className="subscription-email-link" to={linkedUserHref}>
                                                    {result.email}
                                                </Link>
                                            ) : (
                                                <div className="subscription-summary-value subscription-summary-value--email">{result.email}</div>
                                            )}
                                        </div>
                                        <div className="subscription-summary-item">
                                            <div className="subscription-summary-label">{ui.summaryStatus}</div>
                                            <div className="subscription-summary-value">{result.subscriptionActive ? ui.summaryStatusReady : ui.summaryStatusBlocked}</div>
                                            <div className="subscription-summary-meta">{result.inactiveReason || '-'}</div>
                                        </div>
                                        <div className="subscription-summary-item">
                                            <div className="subscription-summary-label">{ui.summaryNodes}</div>
                                            <div className="subscription-summary-value">{result.total}</div>
                                            <div className="subscription-summary-meta">{ui.summaryMatched.replace('{active}', String(result.matchedClientsActive)).replace('{raw}', String(result.matchedClientsRaw))}</div>
                                        </div>
                                            <div className="subscription-summary-item">
                                                <div className="subscription-summary-label">{ui.summaryScope}</div>
                                                <div className="subscription-summary-value">{summaryScopeLabel}</div>
                                                <div className="subscription-summary-meta">
                                                    {ui.summaryFilters
                                                        .replace('{expired}', String(result.filteredExpired))
                                                        .replace('{disabled}', String(result.filteredDisabled))
                                                        .replace('{policy}', String(result.filteredByPolicy))}
                                                </div>
                                            </div>
                                        </div>
                                </div>

                            </>
                        )}

                        <div className="card subscription-password-card">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title={ui.passwordTitle}
                                meta={(
                                    <span className="text-xs text-muted">
                                        {accountMeta}
                                    </span>
                                )}
                            />
                            <div className="grid grid-auto-220 gap-3 items-end">
                                <div className="form-group mb-0">
                                    <label className="form-label">{ui.currentPassword}</label>
                                    <input
                                        type="password"
                                        className="form-input"
                                        aria-label={ui.currentPassword}
                                        value={oldPassword}
                                        onChange={(e) => setOldPassword(e.target.value)}
                                        autoComplete="current-password"
                                    />
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">{ui.newPassword}</label>
                                    <input
                                        type="password"
                                        className="form-input"
                                        aria-label={ui.newPassword}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">{ui.confirmPassword}</label>
                                    <input
                                        type="password"
                                        className="form-input"
                                        aria-label={ui.confirmPassword}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <div className="subscription-password-submit-shell">
                                    <button
                                        className="btn btn-primary btn-sm subscription-password-submit-btn"
                                        onClick={handleChangePassword}
                                        disabled={passwordLoading || !oldPassword || !newPassword || !confirmPassword}
                                    >
                                        {passwordLoading ? <span className="spinner" /> : ui.changePassword}
                                    </button>
                                </div>
                            </div>
                            <div className="text-xs text-muted mt-3">{getPasswordPolicyHint(locale)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
