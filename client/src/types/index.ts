/**
 * Core Domain Models and Type Definitions for NMS Client
 */

export type UserRole = 'admin' | 'user';

export interface User {
    id: string;
    username: string;
    role: UserRole;
    email?: string;
    subscriptionEmail?: string;
    subscriptionAliasPath?: string | null;
    enabled?: boolean;
    groupId?: string | null;
    createdAt: number | string;
    updatedAt?: number | string;
    lastLogin?: number | string | null;
    twoFactorEnabled?: boolean;
}

export interface ServerNode {
    id: string;
    name: string;
    url: string;
    username?: string;
    password?: string;
    apiKey?: string;
    token?: string;
    cookie?: string;
    enabled: boolean;
    type?: '3x-ui' | 'v2ray' | 'xray' | string;
    status?: 'online' | 'offline' | 'error' | 'unreachable';
    version?: string;
    inboundsCount?: number;
    totalTraffic?: number;
    onlineCount?: number;
    lastCheck?: number | string | null;
    lastError?: string | null;
    xrayVersion?: string;
    cpu?: number;
    mem?: {
        current: number;
        total: number;
    };
    disk?: {
        current: number;
        total: number;
    };
    uptime?: number;
    loads?: number[];
    tags?: string[];
    weight?: number;
    createdAt: number | string;
    updatedAt?: number | string;
}

export interface InboundClientConfig {
    id: string;
    email: string;
    uuid?: string;
    password?: string;
    flow?: string;
    totalGB?: number;
    expiryTime?: number;
    enable?: boolean;
    tgId?: string | number;
    subId?: string;
    limitIp?: number;
    reset?: number;
    fingerprint?: string;
    alterId?: number;
    security?: string;
    encryption?: string;
}

export interface InboundConfig {
    id: number | string;
    up: number;
    down: number;
    total: number;
    remark: string;
    enable: boolean;
    expiryTime: number;
    listen?: string;
    port: number;
    protocol: string;
    settings?: string | Record<string, any>;
    streamSettings?: string | Record<string, any>;
    tag?: string;
    sniffing?: string | Record<string, any>;
    allocate?: string | Record<string, any>;
    clientStats?: any[];
}

export interface UserGroup {
    id: string;
    name: string;
    description?: string;
    inboundTags?: string[];
    serverIds?: string[];
    speedLimit?: number | null;
    trafficLimitGB?: number | null;
    expireDays?: number | null;
    clientLimitIp?: number | null;
    createdAt: number | string;
    updatedAt?: number | string;
}

export interface UserPolicy {
    id: string;
    userId?: string;
    email?: string;
    groupId?: string | null;
    inheritGroup?: boolean;
    enabled?: boolean;
    allowedServers?: string[];
    allowedInbounds?: (number | string)[];
    speedLimitKB?: number | null;
    trafficLimitBytes?: number | null;
    expiryTimestamp?: number | null;
    ipLimit?: number | null;
    overrideDefaults?: boolean;
    updatedAt?: number | string;
}

export interface SystemSettings {
    siteTitle?: string;
    siteUrl?: string;
    allowRegistration?: boolean;
    requireInviteCode?: boolean;
    defaultUserGroupId?: string | null;
    jwtExpiryDays?: number;
    tokenExpiryHours?: number;
    telegram?: {
        botToken?: string;
        adminChatId?: string | number;
        notifyOnUserRegister?: boolean;
        notifyOnNodeOffline?: boolean;
        notifyOnTrafficLimit?: boolean;
        enabled?: boolean;
    };
    smtp?: {
        host?: string;
        port?: number;
        secure?: boolean;
        user?: string;
        pass?: string;
        fromEmail?: string;
        fromName?: string;
        enabled?: boolean;
    };
    trafficSamplingIntervalSeconds?: number;
    trafficHistoryRetentionDays?: number;
    auditLogRetentionDays?: number;
    camouflage?: {
        enabled?: boolean;
        defaultPath?: string;
        redirectUrl?: string;
        fakePageTemplate?: string;
    };
    security?: {
        passwordMinLength?: number;
        requireMixedCase?: boolean;
        requireNumbers?: boolean;
        requireSpecialChars?: boolean;
        maxLoginAttempts?: number;
        lockoutDurationMinutes?: number;
        sessionIdleTimeoutMinutes?: number;
    };
    customCss?: string;
    language?: string;
}

export interface AuditLog {
    id: string;
    timestamp: number | string;
    userId?: string;
    username?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, any> | string;
    ip?: string;
    userAgent?: string;
    status: 'success' | 'failure' | 'denied' | 'pending';
}

export interface InviteCode {
    code: string;
    role?: UserRole;
    groupId?: string | null;
    maxUses: number;
    usedCount: number;
    usedBy?: string[];
    expiresAt?: number | null;
    createdAt: number | string;
    createdBy?: string;
    note?: string;
}

export interface SubscriptionToken {
    token: string;
    userId: string;
    email?: string;
    createdAt: number | string;
    expiresAt?: number | null;
    lastAccessedAt?: number | null;
    lastAccessedIp?: string | null;
    userAgent?: string | null;
    aliasPath?: string | null;
    label?: string;
    isRevoked?: boolean;
}

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    msg?: string;
    error?: string;
    total?: number;
    timestamp?: number;
}
