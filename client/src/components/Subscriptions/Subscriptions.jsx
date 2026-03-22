import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiOutlineArrowPath, HiOutlineExclamationTriangle, HiOutlineLink, HiOutlineArrowDownTray, HiOutlineQrCode } from 'react-icons/hi2';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { 
    Card, 
    Typography, 
    Button, 
    Input, 
    Select, 
    Space, 
    Row, 
    Col, 
    Tag, 
    Modal, 
    Empty, 
    Divider, 
    Badge, 
    Tooltip,
    Progress,
    Descriptions
} from 'antd';
import api from '../../api/client.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { formatBytes, formatDateOnly } from '../../utils/format.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import Header from '../Layout/Header.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import CopyFeedbackButton from '../UI/CopyFeedbackButton.jsx';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

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

function pickProgressStatus(progress, { inverse = false } = {}) {
    if (!inverse) {
        if (progress >= 95) return 'exception';
        if (progress >= 80) return 'normal'; // Ant Design doesn't have a 'warning' status for Progress that changes color easily without custom strokeColor
        return 'active';
    }
    if (progress <= 5) return 'exception';
    if (progress <= 20) return 'normal';
    return 'success';
}

function buildExpiryProgress(expiryTime, locale = 'zh-CN') {
    const timestamp = Number(expiryTime || 0);
    if (!(timestamp > 0)) {
        return {
            progress: 100,
            status: 'success',
            meta: '∞',
        };
    }

    const remainingMs = timestamp - Date.now();
    if (remainingMs <= 0) {
        return {
            progress: 0,
            status: 'exception',
            meta: locale === 'en-US' ? 'Expired' : '已到期',
        };
    }

    const remainingDays = Math.max(1, Math.ceil(remainingMs / 86400000));
    return {
        progress: clampProgress((remainingDays / 30) * 100),
        status: remainingDays <= 3 ? 'exception' : 'normal',
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
            copiedAddress: '{label} subscription address copied',
            selectedNode: 'Node {id}',
            currentNode: 'Current node ({id})',
            resetDetailsTarget: 'Target Email',
            resetDetailsScope: 'Scope',
            userStepKicker: 'Flow',
            userStepTitle: 'Choose a config, then import it',
            userStepText: 'Start with the device card below. The URL can stay collapsed because users only need the copy button.',
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
            moreImports: 'More imports',
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
        copiedAddress: '{label} 订阅地址已复制',
        selectedNode: '节点 {id}',
        currentNode: '当前节点 ({id})',
        resetDetailsTarget: '目标邮箱',
        resetDetailsScope: '范围',
        userStepKicker: '使用顺序',
        userStepTitle: '选配置文件 -> 导入客户端',
        userStepText: '导入按钮、复制按钮和二维码都在下面这一块。',
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
        moreImports: '更多导入',
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
    const isCompactViewport = useMediaQuery('(max-width: 768px)');
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
    const [qrModalOpen, setQrModalOpen] = useState(false);
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
    const activeProfileSupportedClientsLabel = useMemo(
        () => activeProfile?.supportedClientsLabel || (locale === 'en-US' ? 'Compatible Clients' : '适用软件'),
        [activeProfile, locale]
    );
    const activeProfileLabel = useMemo(
        () => (isUserOnly ? getUserFacingProfileLabel(activeProfile) : String(activeProfile?.label || '').trim()),
        [activeProfile, isUserOnly]
    );
    const shouldShowProfileContext = activeProfileSupportedClients.length > 0;
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
    const selectedImportActions = useMemo(
        () => buildSelectedImportActions(result?.bundle, profileKey, locale),
        [result, profileKey, locale]
    );
    const primaryImportActions = useMemo(
        () => (isCompactViewport ? selectedImportActions.slice(0, 1) : selectedImportActions),
        [isCompactViewport, selectedImportActions]
    );
    const secondaryImportActions = useMemo(
        () => (isCompactViewport ? selectedImportActions.slice(1) : []),
        [isCompactViewport, selectedImportActions]
    );
    const linkedUserHref = normalizedEmail ? `/clients?q=${encodeURIComponent(normalizedEmail)}` : '';
    const summaryScopeLabel = isAdmin && selectedServerId && selectedServerId !== 'all'
        ? ui.selectedNode.replace('{id}', selectedServerId)
        : ui.allNodes;
    
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

    useEffect(() => {
        if (!canShowQr) {
            setQrModalOpen(false);
        }
    }, [canShowQr]);

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

    const canShowQr = Boolean(activeProfile?.url && result?.subscriptionActive);

    return (
        <>
            <Header title={t('pages.subscriptions.title')} />
            <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
                {isAdmin && (
                    <Card style={{ marginBottom: 24 }}>
                        <Row gutter={[16, 16]} align="bottom">
                            <Col xs={24} md={12}>
                                <Text strong block style={{ marginBottom: 8 }}>{ui.userEmail}</Text>
                                <Select
                                    showSearch
                                    style={{ width: '100%' }}
                                    placeholder="user@example.com"
                                    value={selectedEmail}
                                    onChange={setSelectedEmail}
                                    onSearch={(val) => setSelectedEmail(val)}
                                    disabled={isUserOnly}
                                >
                                    {users.map((email) => (
                                        <Option key={email} value={email}>{email}</Option>
                                    ))}
                                </Select>
                            </Col>
                            <Col xs={24} md={12}>
                                <Text strong block style={{ marginBottom: 8 }}>{ui.scope}</Text>
                                <Select
                                    style={{ width: '100%' }}
                                    value={selectedServerId}
                                    onChange={setSelectedServerId}
                                >
                                    <Option value="all">{ui.allNodes}</Option>
                                    {servers.map((server) => (
                                        <Option key={server.id} value={server.id}>{server.name}</Option>
                                    ))}
                                </Select>
                            </Col>
                            <Col xs={24}>
                                <Space wrap>
                                    {normalizedEmail && (
                                        <Link to={linkedUserHref}>
                                            <Button>{ui.manageUsers}</Button>
                                        </Link>
                                    )}
                                    <Button 
                                        icon={<HiOutlineArrowPath />} 
                                        onClick={loadUsers} 
                                        loading={usersLoading}
                                    >
                                        {ui.refreshUsers}
                                    </Button>
                                    <Button 
                                        type="primary" 
                                        icon={<HiOutlineArrowPath />} 
                                        onClick={() => loadSubscription()} 
                                        loading={loading}
                                        disabled={!normalizedEmail}
                                    >
                                        {ui.reload}
                                    </Button>
                                </Space>
                            </Col>
                        </Row>
                    </Card>
                )}

                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={isAdmin ? 16 : 24}>
                        {!result ? (
                            <Card>
                                <Empty
                                    image={<HiOutlineLink style={{ fontSize: '48px', color: '#ccc' }} />}
                                    description={
                                        <Title level={5}>
                                            {isUserOnly ? (defaultIdentity ? ui.loadingAddress : ui.noAssignedLink) : ui.inputEmailHint}
                                        </Title>
                                    }
                                >
                                    {isUserOnly && !defaultIdentity && (
                                        <Link to="/downloads">
                                            <Button icon={<HiOutlineArrowDownTray />}>{t('comp.common.goDownloads')}</Button>
                                        </Link>
                                    )}
                                </Empty>
                            </Card>
                        ) : (
                            <Card 
                                title={<Title level={4} style={{ margin: 0 }}>{isUserOnly ? ui.userTitle : ui.adminTitle}</Title>}
                                extra={
                                    <Button 
                                        danger 
                                        onClick={handleResetLink} 
                                        loading={resetLoading}
                                        disabled={!normalizedEmail}
                                    >
                                        {ui.resetLink}
                                    </Button>
                                }
                            >
                                <Paragraph type="secondary">{isUserOnly ? ui.userSubtitle : ui.adminSubtitle}</Paragraph>
                                
                                <Divider />

                                <Space direction="vertical" style={{ width: '100%' }} size="large">
                                    <div>
                                        <Text strong block style={{ marginBottom: 12 }}>{ui.simpleReminder}</Text>
                                        <Space wrap>
                                            {displayedProfiles.map((item) => (
                                                <Button
                                                    key={item.key}
                                                    type={profileKey === item.key ? 'primary' : 'default'}
                                                    onClick={() => setProfileKey(item.key)}
                                                >
                                                    {item.label}
                                                </Button>
                                            ))}
                                        </Space>
                                    </div>

                                    <Card size="small" style={{ backgroundColor: '#fafafa' }}>
                                        <Row gutter={[16, 16]}>
                                            <Col xs={24} md={canShowQr && !isCompactViewport ? 16 : 24}>
                                                <Space direction="vertical" style={{ width: '100%' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <Text strong>{ui.copyOrScanTitle}</Text>
                                                        <Tag color={result.subscriptionActive ? 'success' : 'error'}>
                                                            {result.subscriptionActive ? ui.available : ui.unavailable}
                                                        </Tag>
                                                    </div>

                                                    {shouldShowProfileContext && (
                                                        <div>
                                                            <Text type="secondary" size="small" style={{ marginRight: 8 }}>{activeProfileSupportedClientsLabel}:</Text>
                                                            <Space wrap>
                                                                {activeProfileSupportedClients.map((client) => (
                                                                    <Tag key={client}>{client}</Tag>
                                                                ))}
                                                            </Space>
                                                        </div>
                                                    )}

                                                    <Input.Group compact style={{ marginTop: 8 }}>
                                                        <Input 
                                                            style={{ width: 'calc(100% - 100px)' }} 
                                                            value={activeProfile?.url || ''} 
                                                            readOnly 
                                                        />
                                                        <CopyFeedbackButton
                                                            style={{ width: '100px' }}
                                                            type="primary"
                                                            text={activeProfile?.url || ''}
                                                            successText={ui.copiedAddress.replace('{label}', activeProfileLabel || activeProfile?.label || ui.copyAddress)}
                                                            errorText={t('comp.common.noCopyableUrl')}
                                                            disabled={!activeProfile?.url || !result.subscriptionActive}
                                                        >
                                                            {ui.copyAddress}
                                                        </CopyFeedbackButton>
                                                    </Input.Group>

                                                    <Space wrap style={{ marginTop: 8 }}>
                                                        {isCompactViewport && canShowQr && (
                                                            <Button icon={<HiOutlineQrCode />} onClick={() => setQrModalOpen(true)}>
                                                                {ui.scanImport}
                                                            </Button>
                                                        )}
                                                        {primaryImportActions.map((item) => (
                                                            <Button key={item.label} href={item.href}>
                                                                {item.label}
                                                            </Button>
                                                        ))}
                                                        {secondaryImportActions.length > 0 && (
                                                            <Select placeholder={ui.moreImports} style={{ width: 120 }} onChange={(val) => window.location.href = val}>
                                                                {secondaryImportActions.map(item => (
                                                                    <Option key={item.label} value={item.href}>{item.label}</Option>
                                                                ))}
                                                            </Select>
                                                        )}
                                                    </Space>

                                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                                        {selectedImportActions.length > 0 ? ui.quickImportHint : ui.noQuickImport}
                                                    </Text>
                                                </Space>
                                            </Col>

                                            {canShowQr && !isCompactViewport && (
                                                <Col xs={24} md={8} style={{ textAlign: 'center' }}>
                                                    <div style={{ padding: '8px', background: '#fff', borderRadius: '8px', display: 'inline-block' }}>
                                                        <QRCodeSVG
                                                            value={activeProfile?.url || ''}
                                                            size={128}
                                                            level="M"
                                                            includeMargin={false}
                                                        />
                                                    </div>
                                                    <Paragraph type="secondary" style={{ marginTop: 8, fontSize: '12px' }}>{ui.qrHint}</Paragraph>
                                                </Col>
                                            )}
                                        </Row>
                                    </Card>

                                    <Row gutter={[16, 16]}>
                                        <Col xs={24} sm={8}>
                                            <Card size="small" title={<Text style={{ fontSize: '12px' }}>{ui.usedTraffic}</Text>}>
                                                <Title level={4} style={{ margin: 0 }}>{usedTrafficLabel}</Title>
                                                <Progress 
                                                    percent={usedTrafficProgress} 
                                                    status={pickProgressStatus(usedTrafficProgress)} 
                                                    showInfo={false} 
                                                    size="small" 
                                                />
                                            </Card>
                                        </Col>
                                        <Col xs={24} sm={8}>
                                            <Card size="small" title={<Text style={{ fontSize: '12px' }}>{ui.availableTraffic}</Text>}>
                                                <Title level={4} style={{ margin: 0 }}>{availableTrafficLabel}</Title>
                                                <Progress 
                                                    percent={availableTrafficProgress} 
                                                    status={pickProgressStatus(availableTrafficProgress, { inverse: true })} 
                                                    showInfo={false} 
                                                    size="small" 
                                                />
                                            </Card>
                                        </Col>
                                        <Col xs={24} sm={8}>
                                            <Card size="small" title={<Text style={{ fontSize: '12px' }}>{ui.expiryTime}</Text>}>
                                                <Title level={4} style={{ margin: 0 }}>{expiryTimeLabel}</Title>
                                                <Progress 
                                                    percent={expiryProgressState.progress} 
                                                    status={expiryProgressState.status} 
                                                    showInfo={false} 
                                                    size="small" 
                                                />
                                            </Card>
                                        </Col>
                                    </Row>

                                    <Card size="small" style={{ backgroundColor: '#fffbe6', borderColor: '#ffe58f' }}>
                                        <Space align="start">
                                            <HiOutlineExclamationTriangle style={{ color: '#faad14', fontSize: '16px', marginTop: '4px' }} />
                                            <div>
                                                <Text strong>{ui.resetRiskTitle}</Text>
                                                <br />
                                                <Text type="secondary" style={{ fontSize: '12px' }}>{ui.resetRiskText}</Text>
                                            </div>
                                        </Space>
                                    </Card>
                                </Space>
                            </Card>
                        )}
                    </Col>

                    {isAdmin && result && (
                        <Col xs={24} lg={8}>
                            <Space direction="vertical" style={{ width: '100%' }} size="large">
                                <Card title={<Title level={5} style={{ margin: 0 }}>{ui.summaryTitle}</Title>}>
                                    <Descriptions column={1} size="small" bordered>
                                        <Descriptions.Item label={ui.summaryUser}>
                                            <Link to={linkedUserHref}>{result.email}</Link>
                                        </Descriptions.Item>
                                        <Descriptions.Item label={ui.summaryStatus}>
                                            <Badge 
                                                status={result.subscriptionActive ? 'success' : 'error'} 
                                                text={result.subscriptionActive ? ui.summaryStatusReady : ui.summaryStatusBlocked} 
                                            />
                                            <div style={{ fontSize: '12px', color: '#999' }}>{result.inactiveReason || '-'}</div>
                                        </Descriptions.Item>
                                        <Descriptions.Item label={ui.summaryNodes}>
                                            <Text>{result.total}</Text>
                                            <div style={{ fontSize: '12px', color: '#999' }}>
                                                {ui.summaryMatched.replace('{active}', String(result.matchedClientsActive)).replace('{raw}', String(result.matchedClientsRaw))}
                                            </div>
                                        </Descriptions.Item>
                                        <Descriptions.Item label={ui.summaryScope}>
                                            <Text>{summaryScopeLabel}</Text>
                                            <div style={{ fontSize: '12px', color: '#999' }}>
                                                {ui.summaryFilters
                                                    .replace('{expired}', String(result.filteredExpired))
                                                    .replace('{disabled}', String(result.filteredDisabled))
                                                    .replace('{policy}', String(result.filteredByPolicy))}
                                            </div>
                                        </Descriptions.Item>
                                    </Descriptions>
                                </Card>

                                <Card title={<Title level={5} style={{ margin: 0 }}>{ui.guideTitle}</Title>}>
                                    <Space direction="vertical">
                                        <div>
                                            <Badge count={1} style={{ backgroundColor: '#1890ff', marginRight: 8 }} />
                                            <Text strong>{ui.guideStep1Title}</Text>
                                            <Paragraph type="secondary" style={{ fontSize: '12px', marginTop: 4 }}>{ui.guideStep1Text}</Paragraph>
                                        </div>
                                        <div>
                                            <Badge count={2} style={{ backgroundColor: '#1890ff', marginRight: 8 }} />
                                            <Text strong>{ui.guideStep2Title}</Text>
                                            <Paragraph type="secondary" style={{ fontSize: '12px', marginTop: 4 }}>{ui.guideStep2Text}</Paragraph>
                                        </div>
                                    </Space>
                                </Card>
                            </Space>
                        </Col>
                    )}
                </Row>
            </div>

            <Modal
                title={ui.scanImport}
                open={qrModalOpen}
                onCancel={() => setQrModalOpen(false)}
                footer={null}
                centered
            >
                {canShowQr ? (
                    <div style={{ textAlign: 'center', padding: '24px' }}>
                        <div style={{ padding: '16px', background: '#fff', borderRadius: '8px', display: 'inline-block', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                            <QRCodeSVG
                                value={activeProfile?.url || ''}
                                size={220}
                                level="M"
                                includeMargin={false}
                            />
                        </div>
                        <Paragraph style={{ marginTop: 24 }}>{ui.qrHint}</Paragraph>
                    </div>
                ) : (
                    <Empty description={ui.noQr} />
                )}
            </Modal>
        </>
    );
}
