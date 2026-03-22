import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ClientIpModal from '../UI/ClientIpModal.jsx';
import VirtualList from '../UI/VirtualList.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { formatBytes, formatDateOnly, formatDateTime } from '../../utils/format.js';
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

import { 
  ConfigProvider, 
  theme, 
  Card, 
  Button, 
  Table, 
  Tabs, 
  Row, 
  Col, 
  Tag, 
  Statistic, 
  Modal, 
  Descriptions, 
  Space, 
  Typography, 
  Tooltip, 
  Input, 
  Badge,
  Spin
} from 'antd';
const { Title, Text, Paragraph } = Typography;

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
    return (
        <div style={{ 
            width: 64, height: 64, borderRadius: '50%', backgroundColor: '#177ddc', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            fontSize: 24, fontWeight: 'bold', color: '#fff' 
        }}>
            {initial}
        </div>
    );
}

function StatCard({ label, value }) {
    const animated = useAnimatedCounter(typeof value === 'number' ? value : 0);
    const displayValue = typeof value === 'number' ? String(animated) : '...';
    return (
        <Card bordered={false} style={{ background: '#1f1f1f', textAlign: 'center' }}>
            <Statistic 
                title={<span style={{ color: '#a6a6a6' }}>{label}</span>} 
                value={displayValue} 
                valueStyle={{ color: '#fff', fontSize: '24px', fontWeight: 600 }} 
            />
        </Card>
    );
}

function formatTime(ts, locale = 'zh-CN') {
    return formatDateTime(ts, locale);
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

function getOutcomeColor(item) {
    if (item.type === 'access') {
        if (item.accessStatus === 'success' || item.accessStatus === 'ok') return 'success';
        if (item.accessStatus === 'expired') return 'warning';
        if (item.accessStatus === 'revoked') return 'error';
        return 'error';
    }
    if (item.outcome === 'success' || item.outcome === 'ok') return 'success';
    if (item.outcome === 'failed' || item.outcome === 'denied') return 'error';
    if (item.outcome === 'info') return 'processing';
    return 'default';
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

function normalizeUserDetailPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const nextUser = payload.user && typeof payload.user === 'object'
        ? {
            ...payload.user,
            enabled: payload.user.enabled !== false,
        }
        : payload.user;
    return {
        ...payload,
        user: nextUser,
    };
}

function TimelineEntry({ item, index, copy, locale }) {
    return (
        <Card bordered={true} style={{ marginBottom: 16, borderColor: '#303030', backgroundColor: '#141414' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text strong style={{ color: '#fff' }}>{formatTimelineTitle(item, copy)}</Text>
                <Text type="secondary">{formatTime(item.ts, locale)}</Text>
            </div>
            <Space wrap style={{ marginBottom: 8 }}>
                <Tag color={item.type === 'access' ? 'cyan' : 'default'}>
                    {item.type === 'access' ? copy.labels.subscriptionAccess : copy.labels.auditEvent}
                </Tag>
                <Tag color={getOutcomeColor(item)}>
                    {formatOutcomeLabel(item, copy)}
                </Tag>
                {item.actor && <Tag>{copy.labels.actor} {item.actor}</Tag>}
                {item.serverId && <Tag color="blue">{copy.labels.node} {item.serverId}</Tag>}
                {item.tokenId && <Tag>Token {item.tokenId}</Tag>}
            </Space>
            {formatSummaryText(item, copy) && (
                <div style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 12 }}>{formatSummaryText(item, copy)}</div>
            )}
            <Row gutter={[16, 16]}>
                {buildTimelineFacts(item, copy).map((fact) => (
                    <Col xs={24} sm={12} md={8} lg={6} key={`${item.id}-${fact.label}`}>
                        <div style={{ background: '#1f1f1f', padding: '8px 12px', borderRadius: 4 }}>
                            <div style={{ fontSize: 12, color: '#a6a6a6', marginBottom: 4 }}>{fact.label}</div>
                            <div style={{ color: '#fff', wordBreak: 'break-all' }}>{fact.value}</div>
                        </div>
                    </Col>
                ))}
            </Row>
        </Card>
    );
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
    const detailRequestIdRef = useRef(0);
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

    const [clientData, setClientData] = useState([]);
    const [clientsLoading, setClientsLoading] = useState(false);
    const [clientsFetched, setClientsFetched] = useState(false);
    const [clientIpSupportByServer, setClientIpSupportByServer] = useState({});
    const [subscriptionFetched, setSubscriptionFetched] = useState(false);
    const [clientIpModal, setClientIpModal] = useState({
        open: false, serverId: '', serverName: '', email: '', title: '', subtitle: '', items: [], loading: false, clearing: false, error: '',
    });

    const applyTab = (tabKey) => {
        const normalized = normalizeDetailTab(tabKey);
        setActiveTab(normalized);
        const nextParams = new URLSearchParams(searchParams);
        if (normalized === 'overview') nextParams.delete('tab');
        else nextParams.set('tab', normalized);
        setSearchParams(nextParams, { replace: true });
    };

    const fetchDetail = async (options = {}) => {
        const requestId = detailRequestIdRef.current + 1;
        detailRequestIdRef.current = requestId;
        const preserveCurrent = options.preserveCurrent === true || (options.preserveCurrent !== false && detail !== null);
        if (!preserveCurrent) setLoading(true);
        try {
            const res = await api.get(`/users/${encodeURIComponent(userId)}/detail`);
            if (requestId !== detailRequestIdRef.current) return null;
            if (res.data?.success) {
                const nextDetail = normalizeUserDetailPayload(res.data.obj);
                setDetail(nextDetail);
                return nextDetail;
            } else {
                toast.error(res.data?.msg || copy.labels.loadUserFailed);
            }
        } catch (err) {
            if (requestId !== detailRequestIdRef.current) return null;
            toast.error(err.response?.data?.msg || copy.labels.loadUserFailed);
        } finally {
            if (requestId === detailRequestIdRef.current) setLoading(false);
        }
        return null;
    };

    const loadSubscription = async (options = {}) => {
        const quiet = options.quiet === true;
        const email = String(detail?.user?.subscriptionEmail || detail?.user?.email || '').trim().toLowerCase();
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
            if (bundle.defaultProfileKey) setSubscriptionProfileKey(bundle.defaultProfileKey);
        } catch (err) {
            setSubscriptionResult(null);
            if (!quiet) toast.error(err.response?.data?.msg || copy.labels.loadSubscriptionFailed);
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
        detailRequestIdRef.current += 1;
        clientRequestIdRef.current += 1;
        fetchDetail({ preserveCurrent: false });
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
    
    const shouldVirtualizeTimeline = timeline.length > 80;

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

    const subscriptionFilterSummary = useMemo(() => {
        if (!hasSubscriptionFilters) return '';
        const parts = [];
        if (subscriptionResult?.filteredExpired > 0) parts.push(`过滤了 ${subscriptionResult.filteredExpired} 个过期节点`);
        if (subscriptionResult?.filteredDisabled > 0) parts.push(`过滤了 ${subscriptionResult.filteredDisabled} 个停用节点`);
        if (subscriptionResult?.filteredByPolicy > 0) parts.push(`根据策略过滤了 ${subscriptionResult.filteredByPolicy} 个节点`);
        return parts.join('，');
    }, [hasSubscriptionFilters, subscriptionResult]);
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
                const confirmedEnabled = typeof res.data?.obj?.enabled === 'boolean'
                    ? res.data.obj.enabled
                    : newEnabled;
                setDetail((prev) => {
                    if (!prev?.user) return prev;
                    return {
                        ...prev,
                        user: { ...prev.user, enabled: confirmedEnabled },
                    };
                });
                const message = res.data?.msg || (newEnabled ? copy.labels.userEnabled : copy.labels.userDisabled);
                if (res.data?.obj?.partialFailure) {
                    toast.error(message);
                } else {
                    toast.success(message);
                }
                await fetchDetail({ preserveCurrent: true });
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || copy.labels.actionFailed);
        }
    };

    const closeClientIpModal = () => {
        setClientIpModal({
            open: false, serverId: '', serverName: '', email: '', title: '', subtitle: '', items: [], loading: false, clearing: false, error: '',
        });
    };

    const loadClientIps = async (target, options = {}) => {
        if (!target?.serverId || !target?.email) return;
        const supportState = clientIpSupportByServer[target.serverId];
        if (supportState?.supported === false) return;

        if (options.preserveOpen !== true) {
            setClientIpModal((prev) => ({
                ...prev, open: true, serverId: target.serverId, serverName: target.serverName || '', email: target.email,
                title: copy.labels.clientIpTitle.replace('{server}', target.serverName || target.serverId),
                subtitle: copy.labels.clientIpSubtitle.replace('{email}', target.email).replace('{inbound}', target.inboundRemark ? copy.labels.clientIpInbound.replace('{name}', target.inboundRemark) : ''),
                items: [], loading: true, clearing: false, error: '',
            }));
        } else {
            setClientIpModal((prev) => ({ ...prev, loading: true, error: '' }));
        }

        try {
            const res = await api.post(`/panel/${encodeURIComponent(target.serverId)}/panel/api/inbounds/clientIps/${encodeURIComponent(target.email)}`);
            const items = normalizePanelClientIps(res.data?.obj);
            setClientIpSupportByServer((prev) => ({ ...prev, [target.serverId]: { supported: true, reason: '' } }));
            setClientIpModal((prev) => ({ ...prev, open: true, items, loading: false, error: '' }));
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.labels.clientIpLoadFailed;
            if (isUnsupportedPanelClientIpsError(err)) {
                setClientIpSupportByServer((prev) => ({ ...prev, [target.serverId]: { supported: false, reason: msg || copy.labels.clientIpUnsupported } }));
            }
            setClientIpModal((prev) => ({ ...prev, open: true, loading: false, error: msg, items: [] }));
            toast.error(msg);
        }
    };

    const clearClientIps = async () => {
        if (!clientIpModal.serverId || !clientIpModal.email) return;
        const ok = await confirmAction({
            title: copy.labels.clearClientIpTitle,
            message: copy.labels.clearClientIpMessage.replace('{email}', clientIpModal.email).replace('{server}', clientIpModal.serverName || clientIpModal.serverId),
            confirmText: copy.labels.clearClientIpConfirm, tone: 'danger',
        });
        if (!ok) return;

        setClientIpModal((prev) => ({ ...prev, clearing: true, error: '' }));
        try {
            await api.post(`/panel/${encodeURIComponent(clientIpModal.serverId)}/panel/api/inbounds/clearClientIps/${encodeURIComponent(clientIpModal.email)}`);
            toast.success(copy.labels.clearClientIpDone);
            await loadClientIps({ serverId: clientIpModal.serverId, serverName: clientIpModal.serverName, email: clientIpModal.email, inboundRemark: '', inboundId: '' }, { preserveOpen: true });
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.labels.clearClientIpFailed;
            setClientIpModal((prev) => ({ ...prev, clearing: false, error: msg }));
            toast.error(msg);
            return;
        }
        setClientIpModal((prev) => ({ ...prev, clearing: false }));
    };

    if (loading) {
        return (
            <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#177ddc', colorBgBase: '#000000', colorBgContainer: '#141414', borderRadius: 4 } }}>
                <Header title={t('pages.userDetail.title')} eyebrow={t('pages.userDetail.eyebrow')} />
                <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
                    <Card><Spin tip="Loading..." /></Card>
                </div>
            </ConfigProvider>
        );
    }

    if (!user) {
        return (
            <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#177ddc', colorBgBase: '#000000', colorBgContainer: '#141414', borderRadius: 4 } }}>
                <Header title={t('pages.userDetail.title')} eyebrow={t('pages.userDetail.eyebrow')} />
                <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
                    <Card style={{ textAlign: 'center' }}>
                        <Title level={4}>{copy.userMissingTitle}</Title>
                        <Text type="secondary">{copy.userMissingSubtitle}</Text>
                        <div style={{ marginTop: 16 }}>
                            <Button icon={<HiOutlineArrowLeft />} onClick={() => navigate('/clients')}>
                                {copy.backToUsers}
                            </Button>
                        </div>
                    </Card>
                </div>
            </ConfigProvider>
        );
    }

    const tabItems = [
        { 
            key: 'overview', 
            label: copy.tabs.overview,
            children: (
                <div>
                    <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                        <Col xs={12} sm={12} md={6}>
                            <StatCard label={copy.labels.totalTraffic} value={clientSummaryLoading ? null : (totalTraffic > 0 ? Math.round(totalTraffic / (1024 * 1024)) : 0)} />
                        </Col>
                        <Col xs={12} sm={12} md={6}>
                            <StatCard label={copy.labels.nodeCount} value={clientSummaryLoading ? null : clientData.length} />
                        </Col>
                        <Col xs={12} sm={12} md={6}>
                            <StatCard label={copy.labels.accessCount} value={detail?.subscriptionAccess?.total || 0} />
                        </Col>
                        <Col xs={12} sm={12} md={6}>
                            <StatCard label={copy.labels.auditCount} value={detail?.recentAudit?.total || 0} />
                        </Col>
                    </Row>
                    {clientSummaryLoading && <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>{copy.labels.clientSummaryLoading}</Text>}
                    {totalTraffic > 0 && <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>{copy.labels.totalTraffic}: {formatBytes(totalTraffic)}</Text>}
                    
                    {detail?.policy && (
                        <Card title={<><HiOutlineShieldCheck style={{ marginRight: 8 }} /> {copy.labels.accessPolicy}</>}>
                            <Descriptions column={{ xxl: 2, xl: 2, lg: 2, md: 2, sm: 1, xs: 1 }}>
                                <Descriptions.Item label={copy.labels.server}>
                                    <Text strong>
                                        {detail.policy.serverScopeMode === 'all' ? copy.labels.unlimited : detail.policy.serverScopeMode === 'none' ? copy.labels.blocked : `${(detail.policy.allowedServerIds || []).length}`}
                                    </Text>
                                </Descriptions.Item>
                                <Descriptions.Item label={copy.labels.protocol}>
                                    <Text strong>
                                        {detail.policy.protocolScopeMode === 'all' ? copy.labels.unlimited : detail.policy.protocolScopeMode === 'none' ? copy.labels.blocked : (detail.policy.allowedProtocols || []).join(', ')}
                                    </Text>
                                </Descriptions.Item>
                            </Descriptions>
                        </Card>
                    )}
                </div>
            )
        },
        { 
            key: 'subscription', 
            label: copy.tabs.subscription,
            children: (
                <div>
                    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                        <Col>
                            <Space align="center">
                                <Title level={5} style={{ margin: 0 }}>{copy.labels.subscriptionInfo}</Title>
                                {subscriptionResult && (
                                    <>
                                        <Badge status={subscriptionResult.subscriptionActive ? 'success' : 'warning'} text={subscriptionResult.subscriptionActive ? copy.labels.available : copy.labels.unavailable} />
                                        {subscriptionResult.inactiveReason && <Text type="secondary" style={{ fontSize: 12 }}>{subscriptionResult.inactiveReason}</Text>}
                                    </>
                                )}
                            </Space>
                        </Col>
                        <Col>
                            <Button icon={<HiOutlineArrowPath />} onClick={() => loadSubscription()} disabled={subscriptionLoading}>
                                {copy.labels.refresh}
                            </Button>
                        </Col>
                    </Row>
                    
                    {subscriptionLoading && !subscriptionResult ? (
                        <Card><Spin /></Card>
                    ) : !subscriptionResult ? (
                        <Card style={{ textAlign: 'center' }}>
                            <Title level={5}>{copy.labels.noSubscriptionTitle}</Title>
                            <Text type="secondary">{copy.labels.noSubscriptionSubtitle}</Text>
                        </Card>
                    ) : (
                        <Row gutter={[24, 24]}>
                            <Col xs={24} md={16}>
                                <Card>
                                    <Space wrap style={{ marginBottom: 16 }}>
                                        {availableSubscriptionProfiles.map((item) => (
                                            <Button 
                                                key={item.key} 
                                                type={subscriptionProfileKey === item.key ? 'primary' : 'default'} 
                                                onClick={() => setSubscriptionProfileKey(item.key)}
                                            >
                                                {item.label}
                                            </Button>
                                        ))}
                                    </Space>
                                    <div style={{ marginBottom: 16 }}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {copy.labels.availableProfiles.replace('{count}', String(availableSubscriptionProfiles.length || 0))} · {copy.labels.selectedProfileHint}
                                        </Text>
                                        {hasSubscriptionFilters && <div><Text type="secondary" style={{ fontSize: 12 }}>{subscriptionFilterSummary}</Text></div>}
                                    </div>
                                    <div style={{ marginBottom: 16 }}>
                                        <Title level={5}>{activeSubscriptionProfile?.label || copy.labels.copyAddress}</Title>
                                    </div>
                                    <Space.Compact style={{ width: '100%', marginBottom: 24 }}>
                                        <Input 
                                            value={activeSubscriptionProfile?.url || ''} 
                                            readOnly 
                                            placeholder={copy.labels.noSubscriptionAddress} 
                                            style={{ fontFamily: 'monospace' }}
                                        />
                                        <Button 
                                            type="primary" 
                                            disabled={!activeSubscriptionProfile?.url || subscriptionResult.subscriptionActive === false}
                                            onClick={() => {
                                                navigator.clipboard.writeText(activeSubscriptionProfile?.url || '');
                                                toast.success(copy.labels.copiedSubscription.replace('{label}', activeSubscriptionProfile?.label || copy.labels.copyAddress));
                                            }}
                                        >
                                            {copy.labels.copyAddress}
                                        </Button>
                                    </Space.Compact>
                                    <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                                        <Col span={8}>
                                            <Card size="small" style={{ background: '#1f1f1f' }}>
                                                <Statistic title={<span style={{ color: '#a6a6a6' }}>{copy.labels.usedTraffic}</span>} value={formatBytes(usedTrafficBytes)} />
                                            </Card>
                                        </Col>
                                        <Col span={8}>
                                            <Card size="small" style={{ background: '#1f1f1f' }}>
                                                <Statistic title={<span style={{ color: '#a6a6a6' }}>{copy.labels.availableTraffic}</span>} value={trafficLimitBytes > 0 ? formatBytes(remainingTrafficBytes) : copy.labels.unlimited} />
                                            </Card>
                                        </Col>
                                        <Col span={8}>
                                            <Card size="small" style={{ background: '#1f1f1f' }}>
                                                <Statistic title={<span style={{ color: '#a6a6a6' }}>{copy.labels.expiryTime}</span>} value={Number(subscriptionResult?.expiryTime || 0) > 0 ? formatDateOnly(Number(subscriptionResult.expiryTime), locale) : copy.labels.permanent} />
                                            </Card>
                                        </Col>
                                    </Row>
                                    <div style={{ marginBottom: 24 }}>
                                        <Text type="secondary">{copy.labels.subscriptionEmail}: {subscriptionResult.email}</Text>
                                        <Text type="secondary"> · {subscriptionResult.bundle?.externalConverterConfigured ? copy.labels.converterEnabled : copy.labels.converterBuiltin}</Text>
                                    </div>
                                    <Button onClick={handleResetSubscription} disabled={subscriptionResetLoading || !subscriptionResult.email} icon={<HiOutlineArrowPath />}>
                                        {copy.labels.resetLink}
                                    </Button>
                                </Card>
                            </Col>
                            <Col xs={24} md={8}>
                                <Card>
                                    <Title level={5}>{copy.labels.qrTitle}</Title>
                                    {activeSubscriptionProfile?.url && subscriptionResult.subscriptionActive ? (
                                        <div style={{ textAlign: 'center', background: '#fff', padding: 16, borderRadius: 8, display: 'inline-block' }}>
                                            <QRCodeSVG value={activeSubscriptionProfile.url} size={176} />
                                        </div>
                                    ) : (
                                        <Text type="secondary">{copy.labels.qrUnavailable}</Text>
                                    )}
                                    <div style={{ marginTop: 16 }}>
                                        <Text type="secondary">{copy.labels.qrHint.replace('{label}', activeSubscriptionProfile?.label || '')}</Text>
                                    </div>
                                </Card>
                            </Col>
                        </Row>
                    )}
                </div>
            )
        },
        { 
            key: 'clients', 
            label: copy.tabs.clients,
            children: (
                <div>
                    {Object.values(clientIpSupportByServer).some((item) => item?.supported === false) && (
                        <div style={{ marginBottom: 16 }}><Text type="secondary" style={{ fontSize: 12 }}>{copy.labels.clientIpNotice}</Text></div>
                    )}
                    {clientsPanelLoading ? (
                        <Card><Spin /></Card>
                    ) : clientData.length === 0 ? (
                        <Card style={{ textAlign: 'center' }}>
                            <Title level={5}>{copy.labels.noClientsTitle}</Title>
                            <Text type="secondary">{copy.labels.noClientsSubtitle}</Text>
                        </Card>
                    ) : (
                        <Table 
                            dataSource={clientData} 
                            rowKey={(record, i) => `${record.serverId}-${record.inboundId || i}`}
                            pagination={false}
                            scroll={{ x: 800 }}
                            columns={[
                                {
                                    title: copy.labels.server,
                                    dataIndex: 'serverName',
                                    render: (text, record) => {
                                        const presence = resolveClientPresence(record, copy);
                                        return (
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{text}</div>
                                                <Space size="small">
                                                    <Badge status={presence.online ? 'success' : 'default'} />
                                                    <Text type="secondary" style={{ fontSize: 12 }}>{presence.label}</Text>
                                                </Space>
                                            </div>
                                        );
                                    }
                                },
                                { title: copy.labels.inbound, render: (_, r) => r.inboundRemark || r.inboundId },
                                { title: copy.labels.protocol, dataIndex: 'protocol', render: text => <Tag>{text}</Tag> },
                                { title: copy.labels.traffic, render: (_, r) => formatBytes((r.up || 0) + (r.down || 0)) },
                                { title: copy.labels.expiryTime, render: (_, r) => r.expiryTime > 0 ? formatDateOnly(r.expiryTime, locale) : copy.labels.permanent },
                                { title: copy.labels.status, render: (_, r) => <Tag color={r.enable ? 'success' : 'error'}>{r.enable ? copy.labels.enabled : copy.labels.disabled}</Tag> },
                                {
                                    title: copy.labels.actions,
                                    render: (_, record) => {
                                        const supportState = clientIpSupportByServer[record.serverId];
                                        const clientIpUnsupported = supportState?.supported === false;
                                        const clientIpDisabled = !record.email || clientIpUnsupported;
                                        return (
                                            <Button 
                                                size="small" 
                                                onClick={() => loadClientIps(record)} 
                                                disabled={clientIpDisabled}
                                                icon={<HiOutlineGlobeAlt />}
                                            >
                                                {copy.labels.nodeIp}
                                            </Button>
                                        );
                                    }
                                }
                            ]}
                        />
                    )}
                </div>
            )
        },
        { 
            key: 'activity', 
            label: copy.tabs.activity,
            children: (
                <div>
                    {timeline.length === 0 ? (
                        <Card style={{ textAlign: 'center' }}>
                            <Title level={5}>{copy.labels.noActivityTitle}</Title>
                            <Text type="secondary">{copy.labels.noActivitySubtitle}</Text>
                        </Card>
                    ) : (
                        <div>
                            {timeline.map((item, i) => <TimelineEntry key={item.id || i} item={item} index={i} copy={copy} locale={locale} />)}
                        </div>
                    )}
                </div>
            )
        }
    ];

    return (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#177ddc', colorBgBase: '#000000', colorBgContainer: '#141414', borderRadius: 4 } }}>
            <Header title={t('pages.userDetail.titleWithName', { name: user.username })} eyebrow={t('pages.userDetail.eyebrow')} />
            <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
                <Button icon={<HiOutlineArrowLeft />} onClick={() => navigate('/clients')} style={{ marginBottom: 24 }}>
                    {copy.backToUsers}
                </Button>

                <Card style={{ marginBottom: 24 }}>
                    <Row wrap={false} align="middle" gutter={24}>
                        <Col flex="none"><UserAvatar username={user.username} /></Col>
                        <Col flex="auto">
                            <Title level={4} style={{ margin: 0 }}>{user.username}</Title>
                            <Text type="secondary">{user.email || user.subscriptionEmail || copy.unsetEmail}</Text>
                            <div style={{ marginTop: 8, marginBottom: 8 }}>
                                <Tag color={user.role === 'admin' ? 'blue' : 'default'}>{user.role === 'admin' ? copy.labels.roleAdmin : copy.labels.roleUser}</Tag>
                                <Tag color={user.enabled ? 'success' : 'error'}>{user.enabled ? copy.labels.enabled : copy.labels.disabled}</Tag>
                                {user.emailVerified && <Tag color="success">{copy.labels.emailVerified}</Tag>}
                            </div>
                            <Space size="middle" wrap style={{ color: '#a6a6a6', fontSize: 13 }}>
                                <span><HiOutlineKey /> {copy.labels.userId}: {user.id}</span>
                                <span><HiOutlineCalendarDays /> {copy.labels.registeredAt}: {formatTime(user.createdAt, locale)}</span>
                                <span><HiOutlineClock /> {copy.labels.lastLoginAt}: {formatTime(user.lastLoginAt, locale)}</span>
                            </Space>
                        </Col>
                        <Col flex="none">
                            <Space direction="vertical" align="end">
                                <Button 
                                    danger={user.enabled} 
                                    type={user.enabled ? 'default' : 'primary'} 
                                    icon={user.enabled ? <HiOutlineNoSymbol /> : <HiOutlinePlayCircle />} 
                                    onClick={handleToggleEnabled}
                                >
                                    {user.enabled ? copy.labels.disabled : copy.labels.enabled}
                                </Button>
                                <Space>
                                    <Button icon={<HiOutlinePencilSquare />} onClick={() => navigate(`/clients?edit=${user.id}`)}>
                                        {t('comp.common.edit')}
                                    </Button>
                                    <Button icon={<HiOutlineArrowPath />} onClick={fetchDetail}>
                                        {copy.labels.refresh}
                                    </Button>
                                </Space>
                            </Space>
                        </Col>
                    </Row>
                </Card>

                <Tabs 
                    activeKey={activeTab} 
                    onChange={applyTab} 
                    items={tabItems}
                    style={{ backgroundColor: '#141414', padding: '16px 24px', borderRadius: 8, border: '1px solid #303030' }}
                />
            </div>

            {/* TODO: Ant Design Modal for ClientIpModal if needed, assuming ClientIpModal itself might be separate or we just pass Antd styling. */}
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
                    serverId: clientIpModal.serverId, serverName: clientIpModal.serverName, email: clientIpModal.email, inboundRemark: '', inboundId: '',
                }, { preserveOpen: true })}
                onClear={clientIpSupportByServer[clientIpModal.serverId]?.supported === false ? undefined : clearClientIps}
            />
        </ConfigProvider>
    );
}
