import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ClientIpModal from '../UI/ClientIpModal.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { formatBytes, copyToClipboard, formatDateOnly, formatDateTime } from '../../utils/format.js';
import { resolveAccessGeoDisplay } from '../../utils/accessGeo.js';
import { mergeInboundClientStats } from '../../utils/inboundClients.js';
import { buildOnlineMatchMap, countClientOnlineSessions } from '../../utils/clientPresence.js';
import { isUnsupportedPanelClientIpsError, normalizePanelClientIps } from '../../utils/panelClientIps.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import SubscriptionClientLinks from '../Subscriptions/SubscriptionClientLinks.jsx';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import { QRCodeSVG } from 'qrcode.react';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { fetchServerPanelData } from '../../utils/serverPanelDataCache.js';
import {
    HiOutlineArrowLeft,
    HiOutlineClipboard,
    HiOutlineNoSymbol,
    HiOutlinePlayCircle,
    HiOutlineCalendarDays,
    HiOutlineClock,
    HiOutlineEnvelope,
    HiOutlineShieldCheck,
    HiOutlineKey,
    HiOutlineArrowPath,
    HiOutlinePencilSquare,
    HiOutlineGlobeAlt,
} from 'react-icons/hi2';

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

function resolveClientPresence(client, copy) {
    const sessions = Number(client?.onlineSessions || 0);
    if (sessions > 0) {
        return {
            online: true,
            label: copy.labels.online,
            detail: copy.labels.onlineSessions.replace('{count}', String(sessions)),
        };
    }
    return {
        online: false,
        label: copy.labels.offline,
        detail: '',
    };
}

function collectTrackedUserEmails(user) {
    return Array.from(new Set(
        [user?.subscriptionEmail, user?.email]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
    ));
}

function getUserDetailCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            unsetEmail: 'No email set',
            backToUsers: 'Back to Users',
            userMissingTitle: 'User not found',
            userMissingSubtitle: 'The user may have been deleted',
            tabs: {
                overview: 'Overview',
                subscription: 'Subscription',
                clients: 'Nodes',
                activity: 'Activity',
            },
            auditLabels: {
                login_success: 'Sign-in Succeeded',
                login_failed: 'Sign-in Failed',
                login_denied_email_unverified: 'Sign-in Denied',
                login_denied_user_disabled: 'Sign-in Denied',
                password_changed: 'Password Changed',
                account_email_updated: 'Account Updated',
                user_updated: 'User Updated',
                user_enabled: 'User Enabled',
                user_disabled: 'User Disabled',
                user_deleted: 'User Deleted',
                user_subscription_binding_updated: 'Subscription Binding Updated',
                user_subscription_provisioned: 'Subscription Enabled',
                user_expiry_updated: 'Expiry Updated',
                user_password_reset_by_admin: 'Password Reset by Admin',
                user_policy_updated: 'User Policy Updated',
                subscription_token_issued: 'Subscription Token Issued',
                subscription_token_revoked: 'Subscription Token Revoked',
            },
            labels: {
                subscriptionAccess: 'Subscription Access',
                auditEvent: 'Audit Event',
                success: 'Success',
                expired: 'Expired',
                revoked: 'Revoked',
                failed: 'Failed',
                info: 'Info',
                unknown: 'Unknown',
                target: 'Target',
                subscriptionEmail: 'Subscription Email',
                statusEnabled: 'Status Enabled',
                statusDisabled: 'Status Disabled',
                expiry: 'Expiry',
                servers: 'Servers',
                protocols: 'Protocols',
                limitIp: 'IP Limit',
                trafficLimit: 'Traffic Limit',
                deployment: 'Deployment',
                cleanupError: 'Cleanup Error',
                mode: 'Mode',
                format: 'Format',
                userId: 'User ID',
                registeredAt: 'Registered',
                lastLoginAt: 'Last Sign-in',
                copiedUserId: 'User ID copied',
                loadUserFailed: 'Failed to load user detail',
                loadSubscriptionFailed: 'Failed to load subscription detail',
                noCopyableSubscription: 'No subscription address to copy',
                copiedSubscription: '{label} subscription address copied',
                resetTitle: 'Reset Subscription Link',
                resetMessage: 'Resetting invalidates the old address immediately. The client must import the new address again.',
                resetTarget: 'Target Email',
                resetConfirm: 'Reset Link',
                resetDone: 'Subscription link reset',
                resetFailed: 'Failed to reset subscription link',
                userEnabled: 'User enabled',
                userDisabled: 'User disabled',
                actionFailed: 'Action failed',
                clientIpTitle: 'Node Access IP - {server}',
                clientIpSubtitle: '{email} · Node-level record{inbound}',
                clientIpInbound: ' · Inbound {name}',
                clientIpLoadFailed: 'Failed to load node access IPs',
                clientIpUnsupported: 'This node uses an older 3x-ui version and does not support the clientIps API',
                clearClientIpTitle: 'Clear Node Access IPs',
                clearClientIpMessage: 'Clear node access IPs for {email} on {server}?',
                clearClientIpConfirm: 'Clear',
                clearClientIpDone: 'Node access IPs cleared',
                clearClientIpFailed: 'Failed to clear node access IPs',
                roleAdmin: 'Admin',
                roleUser: 'User',
                enabled: 'Enabled',
                disabled: 'Disabled',
                emailVerified: 'Email Verified',
                totalTraffic: 'Total Traffic',
                usedTraffic: 'Used Traffic',
                availableTraffic: 'Available Traffic',
                nodeCount: 'Nodes',
                accessCount: 'Subscription Access',
                auditCount: 'Audit Records',
                clientSummaryLoading: 'Loading node summary...',
                online: 'Online',
                offline: 'Offline',
                onlineSessions: '{count} sessions',
                accessPolicy: 'Access Policy',
                unlimited: 'Unlimited',
                blocked: 'Blocked',
                available: 'Available',
                unavailable: 'Unavailable',
                refresh: 'Refresh',
                resetLink: 'Reset Link',
                copyAddress: 'Copy Address',
                noSubscriptionTitle: 'No subscription info',
                noSubscriptionSubtitle: 'This user does not have an available subscription address yet',
                subscriptionInfo: 'Subscription Details',
                subscriptionIntro: 'Choose a profile, copy the address, and import it.',
                selectedProfile: 'Current Profile',
                selectedProfileHint: 'Use this profile for direct import or copy the address below.',
                currentAddress: 'Current Address',
                noSubscriptionAddress: 'No address is available for this format',
                converterEnabled: 'External converter enabled',
                converterBuiltin: 'Generated by built-in NMS subscription service',
                matchedNodes: 'Active nodes {active} / matched nodes {raw}',
                filteredStats: 'Filtering',
                filteredSummary: 'Filtered: expired {expired} / disabled {disabled} / policy {policy}',
                justThreeSteps: 'Only these three steps',
                justThreeStepsText: 'Choose a profile, copy the address, and import it.',
                availableProfiles: '{count} profiles available',
                stepChooseProfileTitle: 'Choose Profile',
                stepChooseProfileText: 'Pick the format that matches the client you will use.',
                stepCopyAddressTitle: 'Copy Address',
                stepCopyAddressText: 'The address below is the core item the user actually needs.',
                stepImportClientTitle: 'Import Client',
                stepImportClientText: 'Use the QR code or the client suggestions below to finish import.',
                qrTitle: 'QR Code',
                qrHint: 'Scan with {label} to import',
                qrUnavailable: 'No QR code is available for this format',
                clientIpNotice: 'If the node runs an older 3x-ui build without the clientIps API, the Node IP button is disabled automatically.',
                noClientsTitle: 'No node records',
                noClientsSubtitle: 'This user is not linked to any node yet',
                server: 'Server',
                inbound: 'Inbound',
                protocol: 'Protocol',
                traffic: 'Traffic',
                expiryTime: 'Expiry Time',
                status: 'Status',
                actions: 'Actions',
                permanent: 'Permanent',
                nodeIp: 'Node IP',
                missingEmailForClient: 'This node record does not include an email identifier',
                viewNodeIp: 'View proxy access IPs for this user on the current node',
                noActivityTitle: 'No activity yet',
                noActivitySubtitle: 'This user has no audit or access records yet',
                actor: 'Actor',
                node: 'Node',
                ip: 'IP',
                ua: 'UA',
                location: 'Location',
                carrier: 'Carrier',
                requestPath: 'Path',
                requestMethod: 'Method',
                resource: 'Resource',
                redacted: 'Redacted',
            },
        };
    }

    return {
        unsetEmail: '未设置邮箱',
        backToUsers: '返回用户列表',
        userMissingTitle: '用户不存在',
        userMissingSubtitle: '该用户可能已被删除',
        tabs: {
            overview: '概览',
            subscription: '订阅',
            clients: '节点',
            activity: '活动日志',
        },
        auditLabels: {
            login_success: '登录成功',
            login_failed: '登录失败',
            login_denied_email_unverified: '登录被拒绝',
            login_denied_user_disabled: '登录被拒绝',
            password_changed: '修改密码',
            account_email_updated: '更新账号信息',
            user_updated: '更新用户资料',
            user_enabled: '启用用户',
            user_disabled: '停用用户',
            user_deleted: '删除用户',
            user_subscription_binding_updated: '更新订阅绑定',
            user_subscription_provisioned: '开通订阅',
            user_expiry_updated: '更新到期时间',
            user_password_reset_by_admin: '管理员重置密码',
            user_policy_updated: '更新用户策略',
            subscription_token_issued: '签发订阅令牌',
            subscription_token_revoked: '撤销订阅令牌',
        },
        labels: {
            subscriptionAccess: '订阅访问',
            auditEvent: '审计事件',
            success: '成功',
            expired: '已过期',
            revoked: '已撤销',
            failed: '失败',
            info: '信息',
            unknown: '未知',
            target: '目标',
            subscriptionEmail: '订阅邮箱',
            statusEnabled: '状态 已启用',
            statusDisabled: '状态 已停用',
            expiry: '到期',
            servers: '服务器',
            protocols: '协议',
            limitIp: '限 IP',
            trafficLimit: '限流量',
            deployment: '部署',
            cleanupError: '清理异常',
            mode: '模式',
            format: '格式',
            userId: '用户 ID',
            registeredAt: '注册',
            lastLoginAt: '最后登录',
            copiedUserId: '用户 ID 已复制',
            loadUserFailed: '加载用户详情失败',
            loadSubscriptionFailed: '加载订阅详情失败',
            noCopyableSubscription: '暂无可复制订阅地址',
            copiedSubscription: '{label} 订阅地址已复制',
            resetTitle: '重置订阅链接',
            resetMessage: '重置后旧订阅地址会立即失效，客户端需要重新导入新地址。',
            resetTarget: '目标邮箱',
            resetConfirm: '确认重置',
            resetDone: '订阅链接已重置',
            resetFailed: '重置订阅链接失败',
            userEnabled: '用户已启用',
            userDisabled: '用户已停用',
            actionFailed: '操作失败',
            clientIpTitle: '节点访问 IP — {server}',
            clientIpSubtitle: '{email} · 节点级记录{inbound}',
            clientIpInbound: ' · 入站 {name}',
            clientIpLoadFailed: '加载节点访问 IP 失败',
            clientIpUnsupported: '当前节点的 3x-ui 版本不支持节点 IP 接口',
            clearClientIpTitle: '清空节点访问 IP',
            clearClientIpMessage: '确定清空 {email} 在 {server} 的节点访问 IP 记录吗？',
            clearClientIpConfirm: '确认清空',
            clearClientIpDone: '节点访问 IP 记录已清空',
            clearClientIpFailed: '清空节点访问 IP 失败',
            roleAdmin: '管理员',
            roleUser: '用户',
            enabled: '已启用',
            disabled: '已停用',
            emailVerified: '邮箱已验证',
            totalTraffic: '总流量',
            usedTraffic: '已用流量',
            availableTraffic: '可用流量',
            nodeCount: '节点数',
            accessCount: '订阅访问',
            auditCount: '审计记录',
            clientSummaryLoading: '节点汇总加载中...',
            online: '在线',
            offline: '离线',
            onlineSessions: '{count} 会话',
            accessPolicy: '访问策略',
            unlimited: '不限',
            blocked: '禁止',
            available: '可用',
            unavailable: '失效',
            refresh: '刷新',
            resetLink: '重置链接',
            copyAddress: '复制地址',
            noSubscriptionTitle: '暂无订阅信息',
            noSubscriptionSubtitle: '该用户尚未生成可用订阅地址',
            subscriptionInfo: '订阅资料',
            subscriptionIntro: '选类型，复制地址，导入客户端。',
            selectedProfile: '当前配置文件',
            selectedProfileHint: '按这个配置文件直接导入，或复制下面的地址即可。',
            currentAddress: '当前地址',
            noSubscriptionAddress: '当前格式暂无可用订阅地址',
            converterEnabled: '已启用外部订阅转换器',
            converterBuiltin: '使用 NMS 内置订阅生成',
            matchedNodes: '活跃节点 {active} / 匹配节点 {raw}',
            filteredStats: '过滤情况',
            filteredSummary: '已过滤: 过期 {expired} / 禁用 {disabled} / 策略限制 {policy}',
            justThreeSteps: '就这三步',
            justThreeStepsText: '选类型，复制地址，导入客户端。',
            availableProfiles: '共 {count} 个配置文件',
            stepChooseProfileTitle: '选择配置文件',
            stepChooseProfileText: '先选和客户端对应的配置文件格式。',
            stepCopyAddressTitle: '复制订阅地址',
            stepCopyAddressText: '下面这条地址就是用户真正要用的核心信息。',
            stepImportClientTitle: '导入客户端',
            stepImportClientText: '扫码或按下面的客户端下载后导入。',
            qrTitle: '二维码',
            qrHint: '使用 {label} 扫码导入',
            qrUnavailable: '当前格式暂无二维码',
            clientIpNotice: '旧版 3x-ui 节点不支持 `clientIps` 接口时，节点 IP 按钮会自动禁用。',
            noClientsTitle: '暂无节点记录',
            noClientsSubtitle: '该用户在各节点上还没有关联配置',
            server: '服务器',
            inbound: '入站',
            protocol: '协议',
            traffic: '流量',
            expiryTime: '到期时间',
            status: '状态',
            actions: '操作',
            permanent: '永久',
            nodeIp: '节点 IP',
            missingEmailForClient: '该节点记录缺少邮箱标识',
            viewNodeIp: '查看该用户在当前节点上的代理访问 IP',
            noActivityTitle: '暂无活动记录',
            noActivitySubtitle: '该用户尚无审计或访问记录',
            actor: '操作者',
            node: '节点',
            ip: 'IP',
            ua: 'UA',
            location: '地区',
            carrier: '运营商',
            requestPath: '路径',
            requestMethod: '方法',
            resource: '资源',
            redacted: '已脱敏',
        },
    };
}

function UserAvatar({ username }) {
    const initial = String(username || '?').charAt(0).toUpperCase();
    return <div className="user-avatar user-avatar-lg">{initial}</div>;
}

function StatCard({ label, value }) {
    const animated = useAnimatedCounter(typeof value === 'number' ? value : 0);
    const displayValue = typeof value === 'number' ? String(animated) : '...';
    return (
        <div className="stat-mini-card">
            <div className="stat-mini-value" title={displayValue}>
                <span className="stat-mini-value-text">{displayValue}</span>
            </div>
            <div className="stat-mini-label">{label}</div>
        </div>
    );
}

function formatTime(ts, locale = 'zh-CN') {
    return formatDateTime(ts, locale);
}

function timelineOutcomeClass(outcome) {
    if (outcome === 'success' || outcome === 'ok') return 'success';
    if (outcome === 'failed' || outcome === 'denied') return 'danger';
    if (outcome === 'info') return 'info';
    return '';
}

function normalizeAccessOutcome(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'success' || value === 'ok') return 'success';
    if (value === 'expired') return 'expired';
    if (value === 'revoked') return 'revoked';
    return 'failed';
}

function formatTimelineTitle(item, copy) {
    if (item.type === 'access') return copy.labels.subscriptionAccess;
    return copy.auditLabels[item.eventKey] || item.eventKey || copy.labels.auditEvent;
}

function formatOutcomeLabel(item, copy) {
    if (item.type === 'access') {
        if (item.accessStatus === 'success' || item.accessStatus === 'ok') return copy.labels.success;
        if (item.accessStatus === 'expired') return copy.labels.expired;
        if (item.accessStatus === 'revoked') return copy.labels.revoked;
        return copy.labels.failed;
    }
    if (item.outcome === 'success' || item.outcome === 'ok') return copy.labels.success;
    if (item.outcome === 'failed' || item.outcome === 'denied') return copy.labels.failed;
    if (item.outcome === 'info') return copy.labels.info;
    return copy.labels.unknown;
}

function formatSummaryText(item, copy) {
    const parts = [];

    if (item.type === 'access') {
        const geoDisplay = resolveAccessGeoDisplay(item);
        if (item.reason) parts.push(item.reason);
        if (item.mode) parts.push(`${copy.labels.mode} ${item.mode}`);
        if (item.format) parts.push(`${copy.labels.format} ${item.format}`);
        if (geoDisplay.location && geoDisplay.location !== '-') parts.push(`${copy.labels.location} ${geoDisplay.location}`);
        if (geoDisplay.carrier) parts.push(`${copy.labels.carrier} ${geoDisplay.carrier}`);
        return parts.join(' · ');
    }

    if (item.summary) parts.push(item.summary);
    if (item.path) parts.push(item.path);
    return parts.join(' · ');
}

function formatTimelineIp(item, copy) {
    if (item.ip) return item.ip;
    if (item.ipMasked) return copy.labels.redacted;
    return '-';
}

function formatTimelineUserAgent(item, copy) {
    if (item.userAgent) return item.userAgent;
    if (item.userAgentMasked) return copy.labels.redacted;
    return '';
}

function buildTimelineFacts(item, copy) {
    const facts = [];
    const geoDisplay = resolveAccessGeoDisplay(item);
    const userAgent = formatTimelineUserAgent(item, copy);
    const resource = [item.resourceType, item.resourceId].filter(Boolean).join(' / ');

    facts.push({ label: copy.labels.ip, value: formatTimelineIp(item, copy) });
    if (geoDisplay.location && geoDisplay.location !== '-') {
        facts.push({ label: copy.labels.location, value: geoDisplay.location });
    }
    if (geoDisplay.carrier) {
        facts.push({ label: copy.labels.carrier, value: geoDisplay.carrier });
    }
    if (item.actor) {
        facts.push({ label: copy.labels.actor, value: item.actor });
    }
    if (item.serverId) {
        facts.push({ label: copy.labels.node, value: item.serverId });
    }
    if (item.method) {
        facts.push({ label: copy.labels.requestMethod, value: item.method });
    }
    if (item.path) {
        facts.push({ label: copy.labels.requestPath, value: item.path });
    }
    if (resource) {
        facts.push({ label: copy.labels.resource, value: resource });
    }
    if (userAgent) {
        facts.push({ label: copy.labels.ua, value: userAgent });
    }
    return facts;
}

function normalizeDetailTab(value) {
    const text = String(value || '').trim().toLowerCase();
    if (['overview', 'subscription', 'clients', 'activity'].includes(text)) {
        return text;
    }
    return 'overview';
}

export default function UserDetail() {
    const { locale, t } = useI18n();
    const copy = useMemo(() => getUserDetailCopy(locale), [locale]);
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const { servers, loading: serversLoading } = useServer();
    const { userId } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const confirmAction = useConfirm();
    const clientRequestIdRef = useRef(0);
    const serverInventoryKey = useMemo(
        () => servers.map((server) => String(server?.id || '')).filter(Boolean).join('|'),
        [servers]
    );

    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);
    const [activeTab, setActiveTab] = useState(() => normalizeDetailTab(searchParams.get('tab')));

    const [subscriptionLoading, setSubscriptionLoading] = useState(false);
    const [subscriptionResult, setSubscriptionResult] = useState(null);
    const [subscriptionProfileKey, setSubscriptionProfileKey] = useState('v2rayn');
    const [subscriptionResetLoading, setSubscriptionResetLoading] = useState(false);

    // Client data from servers
    const [clientData, setClientData] = useState([]);
    const [clientsLoading, setClientsLoading] = useState(false);
    const [clientsFetched, setClientsFetched] = useState(false);
    const [clientIpSupportByServer, setClientIpSupportByServer] = useState({});
    const [subscriptionFetched, setSubscriptionFetched] = useState(false);
    const [clientIpModal, setClientIpModal] = useState({
        open: false,
        serverId: '',
        serverName: '',
        email: '',
        title: '',
        subtitle: '',
        items: [],
        loading: false,
        clearing: false,
        error: '',
    });

    const applyTab = (tabKey) => {
        const normalized = normalizeDetailTab(tabKey);
        setActiveTab(normalized);
        const nextParams = new URLSearchParams(searchParams);
        if (normalized === 'overview') {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', normalized);
        }
        setSearchParams(nextParams, { replace: true });
    };

    const fetchDetail = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/users/${encodeURIComponent(userId)}/detail`);
            if (res.data?.success) {
                setDetail(res.data.obj);
            } else {
                toast.error(res.data?.msg || copy.labels.loadUserFailed);
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || copy.labels.loadUserFailed);
        }
        setLoading(false);
    };

    const loadSubscription = async (options = {}) => {
        const quiet = options.quiet === true;
        const email = String(
            detail?.user?.subscriptionEmail
            || detail?.user?.email
            || ''
        ).trim().toLowerCase();

        if (!email) {
            setSubscriptionResult(null);
            setSubscriptionFetched(true);
            return;
        }

        setSubscriptionLoading(true);
        try {
            const res = await api.get(`/subscriptions/${encodeURIComponent(email)}`);
            const payload = res.data?.obj || {};
            const bundle = buildSubscriptionProfileBundle(payload, locale);
            setSubscriptionResult({
                email: payload.email || email,
                total: Number(payload.total || 0),
                sourceMode: payload.sourceMode || 'unknown',
                bundle,
                mergedUrl: bundle.mergedUrl,
                subscriptionActive: payload.subscriptionActive !== false,
                inactiveReason: payload.inactiveReason || '',
                filteredExpired: Number(payload.filteredExpired || 0),
                filteredDisabled: Number(payload.filteredDisabled || 0),
                filteredByPolicy: Number(payload.filteredByPolicy || 0),
                usedTrafficBytes: Number(payload.usedTrafficBytes || 0),
                trafficLimitBytes: Number(payload.trafficLimitBytes || 0),
                remainingTrafficBytes: Number(payload.remainingTrafficBytes || 0),
                expiryTime: Number(payload.expiryTime || 0),
                matchedClientsRaw: Number(payload.matchedClientsRaw || 0),
                matchedClientsActive: Number(payload.matchedClientsActive || 0),
                token: payload.token || null,
            });
            if (bundle.defaultProfileKey) {
                setSubscriptionProfileKey(bundle.defaultProfileKey);
            }
        } catch (err) {
            setSubscriptionResult(null);
            if (!quiet) {
                toast.error(err.response?.data?.msg || copy.labels.loadSubscriptionFailed);
            }
        }
        setSubscriptionFetched(true);
        setSubscriptionLoading(false);
    };

    const fetchClients = async () => {
        const requestId = clientRequestIdRef.current + 1;
        clientRequestIdRef.current = requestId;
        const trackedEmails = collectTrackedUserEmails(detail?.user);
        if (trackedEmails.length === 0) {
            if (requestId !== clientRequestIdRef.current) return;
            setClientData([]);
            setClientsFetched(true);
            return;
        }
        setClientsLoading(true);
        try {
            if (servers.length === 0) {
                if (requestId !== clientRequestIdRef.current) return;
                setClientData([]);
                setClientsFetched(true);
                setClientsLoading(false);
                return;
            }
            const emailSet = new Set(trackedEmails);
            const clients = [];
            const serverResults = await fetchServerPanelData(api, servers, { includeOnlines: true });
            if (requestId !== clientRequestIdRef.current) return;

            serverResults.forEach((result) => {
                const server = result.server;
                const inbounds = Array.isArray(result?.inbounds) ? result.inbounds : [];
                const onlineMatchMap = buildOnlineMatchMap(result?.onlines);
                inbounds.forEach((ib) => {
                    const ibClients = mergeInboundClientStats(ib);
                    if (ibClients.length === 0) return;
                    const protocol = String(ib.protocol || '').toLowerCase();
                    ibClients.forEach((cl) => {
                        const clientEmail = String(cl.email || '').trim().toLowerCase();
                        if (!emailSet.has(clientEmail)) return;
                        clients.push({
                            serverId: server.id,
                            serverName: server.name,
                            inboundId: ib.id,
                            inboundRemark: ib.remark || '',
                            email: clientEmail,
                            protocol,
                            port: ib.port,
                            up: Number(cl.up) || 0,
                            down: Number(cl.down) || 0,
                            expiryTime: Number(cl.expiryTime) || 0,
                            enable: cl.enable !== false,
                            onlineSessions: countClientOnlineSessions(cl, protocol, onlineMatchMap),
                        });
                    });
                });
            });

            if (requestId !== clientRequestIdRef.current) return;
            setClientData(clients);
        } catch {
            if (requestId !== clientRequestIdRef.current) return;
            setClientData([]);
        }
        if (requestId !== clientRequestIdRef.current) return;
        setClientsFetched(true);
        setClientsLoading(false);
    };

    useEffect(() => {
        setClientData([]);
        setClientsFetched(false);
        setSubscriptionResult(null);
        setSubscriptionFetched(false);
        setClientIpSupportByServer({});
        clientRequestIdRef.current += 1;
        fetchDetail();
    }, [userId]);

    useEffect(() => {
        if (!detail) return;
        setClientData([]);
        setClientsFetched(false);
        clientRequestIdRef.current += 1;
    }, [detail?.user?.id, serverInventoryKey]);

    useEffect(() => {
        const nextTab = normalizeDetailTab(searchParams.get('tab'));
        setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
    }, [searchParams]);

    useEffect(() => {
        if (!detail) return;
        if (serversLoading) return;
        if (!clientsFetched && !clientsLoading && (activeTab === 'overview' || activeTab === 'clients')) {
            fetchClients();
        }
    }, [detail, activeTab, clientsFetched, clientsLoading, serversLoading, serverInventoryKey]);

    useEffect(() => {
        if (!detail) return;
        if (!subscriptionFetched && !subscriptionLoading && activeTab === 'subscription') {
            loadSubscription({ quiet: true });
        }
    }, [detail, activeTab, subscriptionFetched, subscriptionLoading]);

    const user = detail?.user;
    const recentAudit = detail?.recentAudit?.items || [];
    const subscriptionAccess = detail?.subscriptionAccess?.items || [];
    const clientsPanelLoading = !!detail && clientData.length === 0 && (clientsLoading || (serversLoading && !clientsFetched));
    const clientSummaryLoading = clientsPanelLoading && (activeTab === 'overview' || activeTab === 'clients');

    // Merge audit + subscription access into timeline
    const timeline = useMemo(() => {
        if (!detail) return [];
        const items = [];
        recentAudit.forEach(e => {
            const details = e.details || {};
            const auditUserAgent = typeof e.userAgent === 'string' ? e.userAgent : '';
            const summaryParts = [];
            if (details.targetUsername) summaryParts.push(`${copy.labels.target} ${details.targetUsername}`);
            if (details.subscriptionEmail && details.subscriptionEmail !== details.email) summaryParts.push(`${copy.labels.subscriptionEmail} ${details.subscriptionEmail}`);
            if (typeof details.enabled === 'boolean') summaryParts.push(details.enabled ? copy.labels.statusEnabled : copy.labels.statusDisabled);
            if (details.expiryTime > 0) summaryParts.push(`${copy.labels.expiry} ${formatDateOnly(details.expiryTime, locale)}`);
            if (typeof details.allowedServerCount === 'number') summaryParts.push(`${copy.labels.servers} ${details.allowedServerCount}`);
            if (typeof details.allowedProtocolCount === 'number') summaryParts.push(`${copy.labels.protocols} ${details.allowedProtocolCount}`);
            if (typeof details.limitIp === 'number' && details.limitIp > 0) summaryParts.push(`${copy.labels.limitIp} ${details.limitIp}`);
            if (typeof details.trafficLimitBytes === 'number' && details.trafficLimitBytes > 0) summaryParts.push(`${copy.labels.trafficLimit} ${formatBytes(details.trafficLimitBytes)}`);
            if (typeof details.updated === 'number' || typeof details.failed === 'number') {
                summaryParts.push(`${copy.labels.deployment} ${Number(details.updated || 0)} ${copy.labels.success} / ${Number(details.failed || 0)} ${copy.labels.failed}`);
            }
            if (details.cleanupError) summaryParts.push(`${copy.labels.cleanupError} ${details.cleanupError}`);

            items.push({
                id: `audit-${e.id || `${e.ts}-${e.eventType}`}`,
                ts: e.ts,
                type: 'audit',
                eventKey: e.eventType,
                outcome: e.outcome,
                path: e.path || '',
                method: e.method || '',
                ip: typeof e.ip === 'string' ? e.ip : '',
                ipMasked: e.ipMasked === true,
                actor: e.actor || '',
                serverId: e.serverId || '',
                tokenId: details.publicTokenId || details.tokenId || '',
                userAgent: auditUserAgent || (e.userAgentMasked === true ? '' : (details.userAgent || '')),
                userAgentMasked: e.userAgentMasked === true,
                ipLocation: e.ipLocation || '',
                ipCarrier: e.ipCarrier || '',
                resourceType: e.resourceType || '',
                resourceId: e.resourceId || '',
                summary: summaryParts.join(' · '),
            });
        });
        subscriptionAccess.forEach(e => {
            items.push({
                id: `access-${e.id || `${e.ts}-${e.tokenId || e.ip}`}`,
                ts: e.ts,
                type: 'access',
                eventKey: 'subscription_access',
                accessStatus: e.status,
                outcome: normalizeAccessOutcome(e.status),
                reason: e.reason || '',
                ip: e.clientIp || e.ip,
                tokenId: e.tokenId || '',
                serverId: e.serverId || '',
                userAgent: e.userAgent || '',
                ipLocation: e.ipLocation || '',
                ipCarrier: e.ipCarrier || '',
                cfCountry: e.cfCountry || '',
                mode: e.mode || '',
                format: e.format || '',
            });
        });
        return items.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 50);
    }, [detail, copy, locale, recentAudit, subscriptionAccess]);

    // Stats
    const totalTraffic = useMemo(() => {
        return clientData.reduce((sum, c) => sum + (c.up || 0) + (c.down || 0), 0);
    }, [clientData]);
    const activeSubscriptionProfile = useMemo(
        () => findSubscriptionProfile(subscriptionResult?.bundle, subscriptionProfileKey),
        [subscriptionResult, subscriptionProfileKey]
    );
    const availableSubscriptionProfiles = Array.isArray(subscriptionResult?.bundle?.availableProfiles)
        ? subscriptionResult.bundle.availableProfiles
        : [];
    const hasSubscriptionFilters = Boolean(
        subscriptionResult?.filteredExpired
        || subscriptionResult?.filteredDisabled
        || subscriptionResult?.filteredByPolicy
    );
    const usedTrafficBytes = Number(subscriptionResult?.usedTrafficBytes || 0);
    const trafficLimitBytes = Number(subscriptionResult?.trafficLimitBytes || 0);
    const remainingTrafficBytes = Number(subscriptionResult?.remainingTrafficBytes || 0);
    const usedTrafficProgress = trafficLimitBytes > 0
        ? clampProgress((usedTrafficBytes / trafficLimitBytes) * 100)
        : 100;
    const availableTrafficProgress = trafficLimitBytes > 0
        ? clampProgress((remainingTrafficBytes / trafficLimitBytes) * 100)
        : 100;
    const expiryProgressState = buildExpiryProgress(subscriptionResult?.expiryTime, locale);
    const subscriptionStatusCards = [
        {
            key: 'used',
            label: copy.labels.usedTraffic,
            value: formatBytes(usedTrafficBytes),
            meta: trafficLimitBytes > 0 ? `${Math.round(usedTrafficProgress)}%` : '∞',
            tone: trafficLimitBytes > 0 ? pickProgressTone(usedTrafficProgress) : 'info',
        },
        {
            key: 'available',
            label: copy.labels.availableTraffic,
            value: trafficLimitBytes > 0 ? formatBytes(remainingTrafficBytes) : copy.labels.unlimited,
            meta: trafficLimitBytes > 0 ? `${Math.round(availableTrafficProgress)}%` : '∞',
            tone: trafficLimitBytes > 0 ? pickProgressTone(availableTrafficProgress, { inverse: true }) : 'success',
        },
        {
            key: 'expiry',
            label: copy.labels.expiryTime,
            value: Number(subscriptionResult?.expiryTime || 0) > 0
                ? formatDateOnly(Number(subscriptionResult.expiryTime), locale)
                : copy.labels.permanent,
            meta: expiryProgressState.meta,
            tone: expiryProgressState.tone,
        },
    ];
    const subscriptionFilterSummary = hasSubscriptionFilters
        ? copy.labels.filteredSummary
            .replace('{expired}', String(subscriptionResult?.filteredExpired || 0))
            .replace('{disabled}', String(subscriptionResult?.filteredDisabled || 0))
            .replace('{policy}', String(subscriptionResult?.filteredByPolicy || 0))
        : '';

    const handleCopySubscription = async () => {
        if (!activeSubscriptionProfile?.url) {
            toast.error(copy.labels.noCopyableSubscription);
            return;
        }
        await copyToClipboard(activeSubscriptionProfile.url);
        toast.success(copy.labels.copiedSubscription.replace('{label}', activeSubscriptionProfile.label));
    };

    const handleResetSubscription = async () => {
        const targetEmail = String(subscriptionResult?.email || user?.subscriptionEmail || user?.email || '').trim().toLowerCase();
        if (!targetEmail) return;

        const ok = await confirmAction({
            title: copy.labels.resetTitle,
            message: copy.labels.resetMessage,
            details: `${copy.labels.resetTarget}: ${targetEmail}`,
            confirmText: copy.labels.resetConfirm,
            tone: 'danger',
        });
        if (!ok) return;

        setSubscriptionResetLoading(true);
        try {
            await api.post(`/subscriptions/${encodeURIComponent(targetEmail)}/reset-link`, {});
            toast.success(copy.labels.resetDone);
            await Promise.all([
                loadSubscription({ quiet: true }),
                fetchDetail(),
            ]);
        } catch (err) {
            toast.error(err.response?.data?.msg || copy.labels.resetFailed);
        }
        setSubscriptionResetLoading(false);
    };

    const handleToggleEnabled = async () => {
        if (!user) return;
        const newEnabled = !user.enabled;
        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(user.id)}/set-enabled`, { enabled: newEnabled });
            if (res.data?.success) {
                const message = res.data?.msg || (newEnabled ? copy.labels.userEnabled : copy.labels.userDisabled);
                if (res.data?.obj?.partialFailure) {
                    toast.error(message);
                } else {
                    toast.success(message);
                }
                fetchDetail();
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || copy.labels.actionFailed);
        }
    };

    const closeClientIpModal = () => {
        setClientIpModal({
            open: false,
            serverId: '',
            serverName: '',
            email: '',
            title: '',
            subtitle: '',
            items: [],
            loading: false,
            clearing: false,
            error: '',
        });
    };

    const loadClientIps = async (target, options = {}) => {
        if (!target?.serverId || !target?.email) return;
        const supportState = clientIpSupportByServer[target.serverId];
        if (supportState?.supported === false) return;

        if (options.preserveOpen !== true) {
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                serverId: target.serverId,
                serverName: target.serverName || '',
                email: target.email,
                title: copy.labels.clientIpTitle.replace('{server}', target.serverName || target.serverId),
                subtitle: copy.labels.clientIpSubtitle
                    .replace('{email}', target.email)
                    .replace('{inbound}', target.inboundRemark ? copy.labels.clientIpInbound.replace('{name}', target.inboundRemark) : ''),
                items: [],
                loading: true,
                clearing: false,
                error: '',
            }));
        } else {
            setClientIpModal((prev) => ({
                ...prev,
                loading: true,
                error: '',
            }));
        }

        try {
            const res = await api.post(`/panel/${encodeURIComponent(target.serverId)}/panel/api/inbounds/clientIps/${encodeURIComponent(target.email)}`);
            const items = normalizePanelClientIps(res.data?.obj);
            setClientIpSupportByServer((prev) => ({
                ...prev,
                [target.serverId]: { supported: true, reason: '' },
            }));
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                serverId: target.serverId,
                serverName: target.serverName || '',
                email: target.email,
                title: copy.labels.clientIpTitle.replace('{server}', target.serverName || target.serverId),
                subtitle: copy.labels.clientIpSubtitle
                    .replace('{email}', target.email)
                    .replace('{inbound}', target.inboundRemark ? copy.labels.clientIpInbound.replace('{name}', target.inboundRemark) : ''),
                items,
                loading: false,
                error: '',
            }));
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.labels.clientIpLoadFailed;
            if (isUnsupportedPanelClientIpsError(err)) {
                setClientIpSupportByServer((prev) => ({
                    ...prev,
                    [target.serverId]: {
                        supported: false,
                        reason: msg || copy.labels.clientIpUnsupported,
                    },
                }));
            }
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                loading: false,
                error: msg,
                items: [],
            }));
            toast.error(msg);
        }
    };

    const clearClientIps = async () => {
        if (!clientIpModal.serverId || !clientIpModal.email) return;
        const ok = await confirmAction({
            title: copy.labels.clearClientIpTitle,
            message: copy.labels.clearClientIpMessage
                .replace('{email}', clientIpModal.email)
                .replace('{server}', clientIpModal.serverName || clientIpModal.serverId),
            confirmText: copy.labels.clearClientIpConfirm,
            tone: 'danger',
        });
        if (!ok) return;

        setClientIpModal((prev) => ({
            ...prev,
            clearing: true,
            error: '',
        }));

        try {
            await api.post(`/panel/${encodeURIComponent(clientIpModal.serverId)}/panel/api/inbounds/clearClientIps/${encodeURIComponent(clientIpModal.email)}`);
            toast.success(copy.labels.clearClientIpDone);
            await loadClientIps({
                serverId: clientIpModal.serverId,
                serverName: clientIpModal.serverName,
                email: clientIpModal.email,
                inboundRemark: '',
                inboundId: '',
            }, { preserveOpen: true });
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.labels.clearClientIpFailed;
            setClientIpModal((prev) => ({
                ...prev,
                clearing: false,
                error: msg,
            }));
            toast.error(msg);
            return;
        }

        setClientIpModal((prev) => ({
            ...prev,
            clearing: false,
        }));
    };

    if (loading) {
        return (
            <>
                <Header
                    title={t('pages.userDetail.title')}
                    eyebrow={t('pages.userDetail.eyebrow')}
                />
                <div className="page-content page-enter">
                    <div className="glass-panel p-6">
                        <SkeletonTable rows={3} cols={4} />
                    </div>
                </div>
            </>
        );
    }

    if (!user) {
        return (
            <>
                <Header
                    title={t('pages.userDetail.title')}
                    eyebrow={t('pages.userDetail.eyebrow')}
                />
                <div className="page-content page-enter">
                    <EmptyState title={copy.userMissingTitle} subtitle={copy.userMissingSubtitle} action={
                        <button className="btn btn-secondary" onClick={() => navigate('/clients')}>
                            <HiOutlineArrowLeft /> {copy.backToUsers}
                        </button>
                    } />
                </div>
            </>
        );
    }

    const tabs = [
        { key: 'overview', label: copy.tabs.overview },
        { key: 'subscription', label: copy.tabs.subscription },
        { key: 'clients', label: copy.tabs.clients },
        { key: 'activity', label: copy.tabs.activity },
    ];

    const renderClientActionButton = (client, supportState) => {
        const clientIpUnsupported = supportState?.supported === false;
        const clientIpDisabled = !client.email || clientIpUnsupported;
        const clientIpTitle = !client.email
            ? copy.labels.missingEmailForClient
            : (clientIpUnsupported ? supportState.reason : copy.labels.viewNodeIp);

        return (
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => loadClientIps(client)}
                disabled={clientIpDisabled}
                title={clientIpTitle}
            >
                <HiOutlineGlobeAlt /> {copy.labels.nodeIp}
            </button>
        );
    };

    return (
        <>
            <Header
                title={t('pages.userDetail.titleWithName', { name: user.username })}
                eyebrow={t('pages.userDetail.eyebrow')}
            />
            <div className="page-content page-enter">
                <button className="btn btn-secondary btn-sm mb-4" onClick={() => navigate('/clients')}>
                    <HiOutlineArrowLeft /> {copy.backToUsers}
                </button>

                <div className="glass-panel mb-6">
                    <div className="user-profile-card">
                        <UserAvatar username={user.username} />
                        <div className="user-profile-info">
                            <div className="user-profile-name">{user.username}</div>
                            <div className="user-profile-email">{user.email || user.subscriptionEmail || copy.unsetEmail}</div>
                            <div className="user-profile-badges">
                                <span className={`badge ${user.role === 'admin' ? 'badge-info' : 'badge-neutral'}`}>{user.role === 'admin' ? copy.labels.roleAdmin : copy.labels.roleUser}</span>
                                <span className={`badge ${user.enabled ? 'badge-success' : 'badge-danger'}`}>{user.enabled ? copy.labels.enabled : copy.labels.disabled}</span>
                                {user.emailVerified && <span className="badge badge-success">{copy.labels.emailVerified}</span>}
                            </div>
                            <div className="user-profile-meta">
                                <div className="user-profile-meta-item">
                                    <HiOutlineKey /> {copy.labels.userId}: {user.id}
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-xs btn-icon"
                                        title={copy.labels.userId}
                                        onClick={async () => {
                                            await copyToClipboard(user.id);
                                            toast.success(copy.labels.copiedUserId);
                                        }}
                                    >
                                        <HiOutlineClipboard />
                                    </button>
                                </div>
                                <div className="user-profile-meta-item">
                                    <HiOutlineCalendarDays /> {copy.labels.registeredAt}: {formatTime(user.createdAt, locale)}
                                </div>
                                <div className="user-profile-meta-item">
                                    <HiOutlineClock /> {copy.labels.lastLoginAt}: {formatTime(user.lastLoginAt, locale)}
                                </div>
                                {user.subscriptionEmail && user.subscriptionEmail !== user.email && (
                                    <div className="user-profile-meta-item">
                                        <HiOutlineEnvelope /> {copy.labels.subscriptionEmail}: {user.subscriptionEmail}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="user-profile-actions">
                            <button
                                className={`btn btn-sm ${user.enabled ? 'btn-danger' : 'btn-success'}`}
                                onClick={handleToggleEnabled}
                            >
                                {user.enabled ? <><HiOutlineNoSymbol /> {copy.labels.disabled}</> : <><HiOutlinePlayCircle /> {copy.labels.enabled}</>}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/clients?edit=${user.id}`)}>
                                <HiOutlinePencilSquare /> {t('comp.common.edit')}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={fetchDetail}>
                                <HiOutlineArrowPath /> {copy.labels.refresh}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="user-detail-tabs">
                    <div className="tabs">
                        {tabs.map(t => (
                            <button
                                key={t.key}
                                className={`tab ${activeTab === t.key ? 'active' : ''}`}
                                onClick={() => applyTab(t.key)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="user-detail-tab-content tab-content-enter" key={activeTab}>
                        {activeTab === 'overview' && (
                            <div>
                                <div className="stat-mini-grid">
                                    <StatCard label={copy.labels.totalTraffic} value={clientSummaryLoading ? null : (totalTraffic > 0 ? Math.round(totalTraffic / (1024 * 1024)) : 0)} />
                                    <StatCard label={copy.labels.nodeCount} value={clientSummaryLoading ? null : clientData.length} />
                                    <StatCard label={copy.labels.accessCount} value={detail?.subscriptionAccess?.total || 0} />
                                    <StatCard label={copy.labels.auditCount} value={detail?.recentAudit?.total || 0} />
                                </div>
                                {clientSummaryLoading && (
                                    <p className="text-muted text-sm mb-4">{copy.labels.clientSummaryLoading}</p>
                                )}
                                {totalTraffic > 0 && (
                                    <p className="text-muted text-sm mb-4">{copy.labels.totalTraffic}: {formatBytes(totalTraffic)}</p>
                                )}
                                {detail?.policy && (
                                    <div className="card mb-4">
                                        <div className="card-header pb-0 mb-0" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 8 }}>
                                            <span className="card-title"><HiOutlineShieldCheck className="inline-flex mr-2" /> {copy.labels.accessPolicy}</span>
                                        </div>
                                        <div className="p-3">
                                            <div className="flex gap-4 text-sm">
                                                <span>{copy.labels.server}: <strong>{detail.policy.serverScopeMode === 'all' ? copy.labels.unlimited : detail.policy.serverScopeMode === 'none' ? copy.labels.blocked : `${(detail.policy.allowedServerIds || []).length}`}</strong></span>
                                                <span>{copy.labels.protocol}: <strong>{detail.policy.protocolScopeMode === 'all' ? copy.labels.unlimited : detail.policy.protocolScopeMode === 'none' ? copy.labels.blocked : (detail.policy.allowedProtocols || []).join(', ')}</strong></span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'subscription' && (
                            <div>
                                <SectionHeader
                                    className="mb-4"
                                    compact
                                    title={copy.labels.subscriptionInfo}
                                    meta={subscriptionResult && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`badge ${subscriptionResult.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                                                {subscriptionResult.subscriptionActive ? copy.labels.available : copy.labels.unavailable}
                                            </span>
                                            {subscriptionResult.inactiveReason ? (
                                                <span className="text-xs text-muted">{subscriptionResult.inactiveReason}</span>
                                            ) : null}
                                        </div>
                                    )}
                                    actions={(
                                        <div className="flex gap-2 flex-wrap">
                                            <button className="btn btn-secondary btn-sm" onClick={() => loadSubscription()} disabled={subscriptionLoading}>
                                                {subscriptionLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> {copy.labels.refresh}</>}
                                            </button>
                                        </div>
                                    )}
                                />

                                {subscriptionLoading && !subscriptionResult ? (
                                    <SkeletonTable rows={3} cols={3} />
                                ) : !subscriptionResult ? (
                                    <EmptyState title={copy.labels.noSubscriptionTitle} subtitle={copy.labels.noSubscriptionSubtitle} />
                                ) : (
                                    <div className="user-detail-subscription-layout">
                                        <div className="subscription-link-with-qr user-detail-subscription-main">
                                            <div className="subscription-link-card subscription-link-card--import-focus user-detail-subscription-card">
                                                <div className="subscription-profile-switches">
                                                    {availableSubscriptionProfiles.map((item) => (
                                                        <button
                                                            key={item.key}
                                                            type="button"
                                                            className={`btn btn-sm ${subscriptionProfileKey === item.key ? 'btn-primary' : 'btn-secondary'}`}
                                                            onClick={() => setSubscriptionProfileKey(item.key)}
                                                        >
                                                            {item.label}
                                                        </button>
                                                    ))}
                                                </div>

                                                <div className="subscription-profile-notes">
                                                    <div className="text-xs text-muted">
                                                        {copy.labels.availableProfiles.replace('{count}', String(availableSubscriptionProfiles.length || 0))}
                                                        {' · '}
                                                        {copy.labels.selectedProfileHint}
                                                    </div>
                                                    {hasSubscriptionFilters ? (
                                                        <div className="text-xs text-muted">{subscriptionFilterSummary}</div>
                                                    ) : null}
                                                </div>

                                                <div className="subscription-user-address-head">
                                                    <div className="subscription-user-address-copy">
                                                        <div className="subscription-user-address-label">{copy.labels.subscriptionInfo}</div>
                                                        <div className="subscription-user-address-kicker">{activeSubscriptionProfile?.label || copy.labels.copyAddress}</div>
                                                    </div>
                                                    <span className={`badge ${subscriptionResult.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                                                        {subscriptionResult.subscriptionActive ? copy.labels.available : copy.labels.unavailable}
                                                    </span>
                                                </div>

                                                <div className="subscription-link-grid subscription-link-grid--compact">
                                                    <input
                                                        className="form-input font-mono subscription-url-input"
                                                        value={activeSubscriptionProfile?.url || ''}
                                                        readOnly
                                                        placeholder={copy.labels.noSubscriptionAddress}
                                                    />
                                                    <button
                                                        className="btn btn-primary subscription-copy-btn"
                                                        onClick={handleCopySubscription}
                                                        disabled={!activeSubscriptionProfile?.url || subscriptionResult.subscriptionActive === false}
                                                    >
                                                        <HiOutlineClipboard /> {copy.labels.copyAddress}
                                                    </button>
                                                </div>

                                                <div className="subscription-address-status-grid" aria-label={locale === 'en-US' ? 'Subscription status summary' : '订阅状态摘要'}>
                                                    {subscriptionStatusCards.map((item) => (
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
                                                    {copy.labels.subscriptionEmail}: {subscriptionResult.email}
                                                    {subscriptionResult.bundle?.externalConverterConfigured ? ` · ${copy.labels.converterEnabled}` : ` · ${copy.labels.converterBuiltin}`}
                                                </div>

                                                <div className="subscription-user-address-foot">
                                                    <button
                                                        className="btn btn-secondary subscription-user-reset-inline-btn"
                                                        onClick={handleResetSubscription}
                                                        disabled={subscriptionResetLoading || !subscriptionResult.email}
                                                    >
                                                        {subscriptionResetLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> {copy.labels.resetLink}</>}
                                                    </button>
                                                    <div className="subscription-user-reset-inline-copy">
                                                        <div className="subscription-user-reset-inline-title">
                                                            <HiOutlineArrowPath />
                                                            {copy.labels.resetTitle}
                                                        </div>
                                                        <div className="subscription-user-reset-inline-text">{copy.labels.resetMessage}</div>
                                                    </div>
                                                </div>

                                                <div className="user-detail-subscription-guides">
                                                    <div className="subscription-user-address-copy">
                                                        <div className="subscription-user-address-label">{copy.labels.stepImportClientTitle}</div>
                                                        <div className="subscription-user-address-note">
                                                            {copy.labels.matchedNodes
                                                                .replace('{active}', String(subscriptionResult.matchedClientsActive || 0))
                                                                .replace('{raw}', String(subscriptionResult.matchedClientsRaw || 0))}
                                                        </div>
                                                    </div>
                                                    <SubscriptionClientLinks
                                                        bundle={subscriptionResult.bundle}
                                                        compact
                                                        showHeading={false}
                                                    />
                                                </div>
                                            </div>

                                            <div className="subscription-inline-qr subscription-inline-qr--featured user-detail-subscription-qr">
                                                {activeSubscriptionProfile?.url && subscriptionResult.subscriptionActive ? (
                                                    <>
                                                        <div className="subscription-inline-qr-title">{copy.labels.qrTitle}</div>
                                                        <div className="subscription-inline-qr-surface rounded-xl bg-white">
                                                            <QRCodeSVG value={activeSubscriptionProfile.url} size={176} />
                                                        </div>
                                                        <div className="subscription-inline-qr-text">
                                                            {copy.labels.qrHint.replace('{label}', activeSubscriptionProfile.label)}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="subscription-inline-qr-text">{copy.labels.qrUnavailable}</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Clients Tab */}
                        {activeTab === 'clients' && (
                            <div>
                                {Object.values(clientIpSupportByServer).some((item) => item?.supported === false) && (
                                    <div className="text-xs text-muted mb-3">{copy.labels.clientIpNotice}</div>
                                )}
                                {clientsPanelLoading ? (
                                    <SkeletonTable rows={4} cols={6} />
                                ) : clientData.length === 0 ? (
                                    <EmptyState title={copy.labels.noClientsTitle} subtitle={copy.labels.noClientsSubtitle} />
                                ) : isCompactLayout ? (
                                    <div className="user-detail-client-list">
                                        {clientData.map((client, index) => {
                                            const supportState = clientIpSupportByServer[client.serverId];
                                            const presence = resolveClientPresence(client, copy);
                                            return (
                                                <div key={`${client.serverId}-${client.inboundId || index}`} className="user-detail-client-card">
                                                    <div className="user-detail-client-head">
                                                        <div className="user-detail-client-copy">
                                                            <div className="user-detail-client-title-row">
                                                                <div className="user-detail-client-title">{client.serverName}</div>
                                                                <span
                                                                    className={`user-detail-presence${presence.online ? ' is-online' : ''}`}
                                                                    title={presence.detail || presence.label}
                                                                >
                                                                    <span className="user-detail-presence-dot" aria-hidden="true" />
                                                                    <span className="user-detail-presence-label">{presence.label}</span>
                                                                    {presence.detail ? <span className="user-detail-presence-detail">{presence.detail}</span> : null}
                                                                </span>
                                                            </div>
                                                            <div className="user-detail-client-subtitle">{client.inboundRemark || client.inboundId}</div>
                                                        </div>
                                                        <span className={`badge ${client.enable ? 'badge-success' : 'badge-danger'}`}>
                                                            {client.enable ? copy.labels.enabled : copy.labels.disabled}
                                                        </span>
                                                    </div>
                                                    <div className="user-detail-client-meta">
                                                        <span className="badge badge-neutral">{client.protocol}</span>
                                                        <span className="user-detail-client-meta-pill">:{client.port}</span>
                                                    </div>
                                                    <div className="user-detail-client-metrics">
                                                        <div className="user-detail-client-metric">
                                                            <span className="user-detail-client-metric-label">{copy.labels.traffic}</span>
                                                            <span className="user-detail-client-metric-value">{formatBytes((client.up || 0) + (client.down || 0))}</span>
                                                        </div>
                                                        <div className="user-detail-client-metric">
                                                            <span className="user-detail-client-metric-label">{copy.labels.expiryTime}</span>
                                                            <span className="user-detail-client-metric-value">
                                                                {client.expiryTime > 0 ? formatDateOnly(client.expiryTime, locale) : copy.labels.permanent}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="user-detail-client-actions">
                                                        {renderClientActionButton(client, supportState)}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="table-container">
                                        <table className="table user-detail-clients-table">
                                            <thead>
                                                <tr>
                                                    <th>{copy.labels.server}</th>
                                                    <th>{copy.labels.inbound}</th>
                                                    <th className="table-cell-center user-detail-protocol-column">{copy.labels.protocol}</th>
                                                    <th className="table-cell-right user-detail-traffic-column">{copy.labels.traffic}</th>
                                                    <th className="table-cell-center user-detail-expiry-column">{copy.labels.expiryTime}</th>
                                                    <th className="table-cell-center user-detail-status-column">{copy.labels.status}</th>
                                                    <th className="table-cell-actions user-detail-actions-column">{copy.labels.actions}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {clientData.map((c, i) => {
                                                    const supportState = clientIpSupportByServer[c.serverId];
                                                    const presence = resolveClientPresence(c, copy);
                                                    return (
                                                    <tr key={i}>
                                                        <td data-label={copy.labels.server} className="user-detail-server-cell">
                                                            <div className="user-detail-server-stack">
                                                                <span className="user-detail-server-name">{c.serverName}</span>
                                                                <span
                                                                    className={`user-detail-presence${presence.online ? ' is-online' : ''}`}
                                                                    title={presence.detail || presence.label}
                                                                >
                                                                    <span className="user-detail-presence-dot" aria-hidden="true" />
                                                                    <span className="user-detail-presence-label">{presence.label}</span>
                                                                    {presence.detail ? <span className="user-detail-presence-detail">{presence.detail}</span> : null}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td data-label={copy.labels.inbound}>{c.inboundRemark || c.inboundId}</td>
                                                        <td data-label={copy.labels.protocol} className="table-cell-center user-detail-protocol-cell"><span className="badge badge-neutral">{c.protocol}</span></td>
                                                        <td data-label={copy.labels.traffic} className="table-cell-right cell-mono-right user-detail-traffic-cell">{formatBytes((c.up || 0) + (c.down || 0))}</td>
                                                        <td data-label={copy.labels.expiryTime} className="table-cell-center cell-mono user-detail-expiry-cell">{c.expiryTime > 0 ? formatDateOnly(c.expiryTime, locale) : copy.labels.permanent}</td>
                                                        <td data-label={copy.labels.status} className="table-cell-center user-detail-status-cell"><span className={`badge ${c.enable ? 'badge-success' : 'badge-danger'}`}>{c.enable ? copy.labels.enabled : copy.labels.disabled}</span></td>
                                                        <td data-label={copy.labels.actions} className="table-cell-actions user-detail-actions-cell">
                                                            {renderClientActionButton(c, supportState)}
                                                        </td>
                                                    </tr>
                                                );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Activity Tab */}
                        {activeTab === 'activity' && (
                            <div>
                                {timeline.length === 0 ? (
                                    <EmptyState title={copy.labels.noActivityTitle} subtitle={copy.labels.noActivitySubtitle} />
                                ) : (
                                    <div className="timeline-list">
                                        {timeline.map((item, i) => (
                                                <div key={item.id || i} className="timeline-item">
                                                    <div className={`timeline-dot ${timelineOutcomeClass(item.outcome)}`} />
                                                    <div className="timeline-content">
                                                    <div className="timeline-head">
                                                        <span className="font-medium">{formatTimelineTitle(item, copy)}</span>
                                                        <span className="timeline-time">{formatTime(item.ts, locale)}</span>
                                                    </div>
                                                    <div className="flex gap-2 flex-wrap mt-2">
                                                        <span className={`badge ${item.type === 'access' ? 'badge-info' : 'badge-neutral'}`}>
                                                            {item.type === 'access' ? copy.labels.subscriptionAccess : copy.labels.auditEvent}
                                                        </span>
                                                        <span className={`badge ${item.outcome === 'success' || item.outcome === 'ok' ? 'badge-success' : item.outcome === 'failed' || item.outcome === 'denied' ? 'badge-danger' : 'badge-neutral'}`}>
                                                            {formatOutcomeLabel(item, copy)}
                                                        </span>
                                                        {item.actor && <span className="badge badge-neutral">{copy.labels.actor} {item.actor}</span>}
                                                        {item.serverId && <span className="badge badge-info">{copy.labels.node} {item.serverId}</span>}
                                                        {item.tokenId && <span className="badge badge-neutral">Token {item.tokenId}</span>}
                                                    </div>
                                                    {formatSummaryText(item, copy) && <div className="text-sm text-muted mt-2">{formatSummaryText(item, copy)}</div>}
                                                    <div className="timeline-fact-grid mt-3">
                                                        {buildTimelineFacts(item, copy).map((fact) => (
                                                            <div key={`${item.id}-${fact.label}`} className="timeline-fact-card">
                                                                <div className="timeline-fact-label">{fact.label}</div>
                                                                <div className="timeline-fact-value">{fact.value}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ClientIpModal
                isOpen={clientIpModal.open}
                title={clientIpModal.title}
                subtitle={clientIpModal.subtitle}
                loading={clientIpModal.loading}
                clearing={clientIpModal.clearing}
                items={clientIpModal.items}
                error={clientIpModal.error}
                onClose={closeClientIpModal}
                onRefresh={() => loadClientIps({
                    serverId: clientIpModal.serverId,
                    serverName: clientIpModal.serverName,
                    email: clientIpModal.email,
                    inboundRemark: '',
                    inboundId: '',
                }, { preserveOpen: true })}
                onClear={clientIpSupportByServer[clientIpModal.serverId]?.supported === false ? undefined : clearClientIps}
            />
        </>
    );
}
