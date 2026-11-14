import { resolveLocaleTag } from './format';
import {
    UUID_PROTOCOLS,
    PASSWORD_PROTOCOLS,
    normalizeProtocol,
    normalizeEmail,
    getClientIdentifier as getProtocolClientIdentifier,
} from './protocol';

const FIELD_LABELS_BY_LOCALE: Record<'zh-CN' | 'en-US', Record<string, string>> = {
    'zh-CN': {
        id: 'UUID/ID',
        password: '密码',
        expiryTime: '有效期',
        totalGB: '总流量',
        enable: '启用状态',
        limitIp: 'IP 限制',
        flow: '流控参数',
        subId: '订阅标识',
        email: '邮箱',
    },
    'en-US': {
        id: 'UUID / ID',
        password: 'Password',
        expiryTime: 'Expiry Time',
        totalGB: 'Total Traffic',
        enable: 'Status',
        limitIp: 'IP Limit',
        flow: 'Flow',
        subId: 'Subscription ID',
        email: 'Email',
    },
};

const TYPE_PRIORITY: Record<string, number> = {
    credential_mismatch: 100,
    expiry_mismatch: 60,
    quota_mismatch: 50,
    enable_mismatch: 40,
    limit_ip_mismatch: 30,
    flow_mismatch: 20,
    subid_mismatch: 10,
    email_mismatch: 10,
};

const TYPE_TO_FIELD: Record<string, string[]> = {
    credential_mismatch: ['id', 'password'],
    expiry_mismatch: ['expiryTime'],
    quota_mismatch: ['totalGB'],
    enable_mismatch: ['enable'],
    limit_ip_mismatch: ['limitIp'],
    flow_mismatch: ['flow'],
    subid_mismatch: ['subId'],
    email_mismatch: ['email'],
};

const FIELD_TO_TYPE: Record<string, string> = {
    id: 'credential_mismatch',
    password: 'credential_mismatch',
    expiryTime: 'expiry_mismatch',
    totalGB: 'quota_mismatch',
    enable: 'enable_mismatch',
    limitIp: 'limit_ip_mismatch',
    flow: 'flow_mismatch',
    subId: 'subid_mismatch',
    email: 'email_mismatch',
};

const CONFLICT_TYPE_LABELS_BY_LOCALE: Record<'zh-CN' | 'en-US', Record<string, string>> = {
    'zh-CN': {
        credential_mismatch: '凭据不一致',
        expiry_mismatch: '有效期不一致',
        quota_mismatch: '流量配额不一致',
        enable_mismatch: '启用状态不一致',
        limit_ip_mismatch: 'IP 限制不一致',
        flow_mismatch: 'Flow 参数不一致',
        subid_mismatch: '订阅标识不一致',
        email_mismatch: '邮箱不一致',
    },
    'en-US': {
        credential_mismatch: 'Credential Mismatch',
        expiry_mismatch: 'Expiry Mismatch',
        quota_mismatch: 'Traffic Quota Mismatch',
        enable_mismatch: 'Status Mismatch',
        limit_ip_mismatch: 'IP Limit Mismatch',
        flow_mismatch: 'Flow Mismatch',
        subid_mismatch: 'Subscription ID Mismatch',
        email_mismatch: 'Email Mismatch',
    },
};

export const CONFLICT_TYPE_LABELS: Record<string, string> = CONFLICT_TYPE_LABELS_BY_LOCALE['zh-CN'];

function resolveConflictLocale(locale?: string): 'zh-CN' | 'en-US' {
    if (locale) return resolveLocaleTag(locale);
    if (typeof document !== 'undefined' && document.documentElement.lang) {
        return resolveLocaleTag(document.documentElement.lang);
    }
    return 'zh-CN';
}

function toNumber(value: any, fallback: number = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFieldValue(field: string, value: any): any {
    if (field === 'expiryTime' || field === 'totalGB' || field === 'limitIp') {
        return toNumber(value, 0);
    }
    if (field === 'enable') {
        return Boolean(value);
    }
    return String(value || '').trim();
}

function comparableFieldsForProtocol(protocol: string, identityType: string): string[] {
    const normalized = normalizeProtocol(protocol);
    const fields = ['expiryTime', 'totalGB', 'enable', 'limitIp', 'flow', 'subId'];
    if (identityType !== 'email') fields.push('email');
    if (UUID_PROTOCOLS.has(normalized)) {
        fields.unshift('id');
    } else if (PASSWORD_PROTOCOLS.has(normalized)) {
        fields.unshift('password');
    } else {
        fields.unshift('id', 'password');
    }
    return fields;
}

function buildDistinctMap(entries: any[], fields: string[]): Record<string, any[]> {
    const result: Record<string, any[]> = {};
    fields.forEach((field) => {
        const rawSet = new Set<string>();
        entries.forEach((entry) => {
            const normalized = normalizeFieldValue(field, entry?.[field]);
            rawSet.add(JSON.stringify(normalized));
        });
        const values = Array.from(rawSet.values()).map((item) => JSON.parse(item));
        if (values.length > 1) {
            result[field] = values;
        }
    });
    return result;
}

export function getClientIdentifier(entry: Record<string, any> = {}): string {
    return String(getProtocolClientIdentifier(entry) || '').trim();
}

export function buildClientEntryLocator(entry: Record<string, any> = {}): string {
    const serverId = String(entry.serverId || '').trim();
    const inboundId = String(entry.inboundId || '').trim();
    const protocol = normalizeProtocol(entry.protocol);
    const identifier = getClientIdentifier(entry);
    const email = normalizeEmail(entry.email);
    return `${serverId}|${inboundId}|${protocol}|${identifier}|${email}`;
}

function scoreSourceEntry(entry: Record<string, any> = {}): number {
    const enabledScore = entry.enable === false ? 0 : 1_000_000_000_000;
    const expiryScore = toNumber(entry.expiryTime, 0);
    const totalScore = toNumber(entry.totalGB, 0);
    const limitScore = toNumber(entry.limitIp, 0);
    return enabledScore + expiryScore + totalScore + limitScore;
}

export interface SourceCandidate {
    sourceKey: string;
    serverId: string;
    serverName?: string;
    inboundId: string | number;
    inboundRemark: string;
    identifier: string;
    email: string;
    enable: boolean;
    expiryTime: number;
    totalGB: number;
}

export interface AnalyzedProtocolGroup {
    protocol: string;
    entryCount: number;
    entries: any[];
    diffFields: string[];
    fieldDistinct: Record<string, any[]>;
    conflictTypes: string[];
    hasConflict: boolean;
    recommendedSourceKey: string;
    sourceCandidates: SourceCandidate[];
}

function analyzeProtocolGroup(entries: any[], identityType: string): AnalyzedProtocolGroup {
    const protocol = normalizeProtocol(entries[0]?.protocol);
    const fields = comparableFieldsForProtocol(protocol, identityType);
    const fieldDistinct = buildDistinctMap(entries, fields);
    const diffFields = Object.keys(fieldDistinct);
    const conflictTypeSet = new Set(diffFields.map((field) => FIELD_TO_TYPE[field]).filter(Boolean));
    const conflictTypes = Array.from(conflictTypeSet.values())
        .sort((a, b) => (TYPE_PRIORITY[b] || 0) - (TYPE_PRIORITY[a] || 0));

    const sortedByPriority = [...entries].sort((a, b) => scoreSourceEntry(b) - scoreSourceEntry(a));
    const recommended = sortedByPriority[0] || null;
    const recommendedSourceKey = recommended ? buildClientEntryLocator(recommended) : '';

    return {
        protocol,
        entryCount: entries.length,
        entries,
        diffFields,
        fieldDistinct,
        conflictTypes,
        hasConflict: diffFields.length > 0,
        recommendedSourceKey,
        sourceCandidates: sortedByPriority.map((item) => ({
            sourceKey: buildClientEntryLocator(item),
            serverId: item.serverId,
            serverName: item.serverName,
            inboundId: item.inboundId,
            inboundRemark: item.inboundRemark || '',
            identifier: getClientIdentifier(item),
            email: normalizeEmail(item.email),
            enable: item.enable !== false,
            expiryTime: toNumber(item.expiryTime, 0),
            totalGB: toNumber(item.totalGB, 0),
        })),
    };
}

export interface ConflictGroup {
    groupKey: string;
    identityType: string;
    identityValue: string;
    displayIdentity: string;
    entryCount: number;
    serverCount: number;
    conflictTypes: string[];
    conflictFieldLabels: string[];
    severity: 'high' | 'medium';
    protocols: AnalyzedProtocolGroup[];
}

export interface ClientConflictReport {
    scannedAt: string;
    summary: {
        totalGroups: number;
        conflictGroups: number;
        high: number;
        medium: number;
    };
    groups: ConflictGroup[];
}

export function buildClientConflictReport(clients: any[] = [], locale?: string): ClientConflictReport {
    const resolvedLocale = resolveConflictLocale(locale);
    const fieldLabels = FIELD_LABELS_BY_LOCALE[resolvedLocale];
    const identityPrefix = resolvedLocale === 'en-US' ? 'ID' : '标识';
    const identityGroups = new Map<string, { groupKey: string; identityType: string; identityValue: string; entries: any[] }>();
    const list = Array.isArray(clients) ? clients : [];

    list.forEach((item) => {
        const email = normalizeEmail(item.email);
        const identifier = getClientIdentifier(item);
        if (!email && !identifier) return;

        const identityType = email ? 'email' : 'identifier';
        const identityValue = email || `${normalizeProtocol(item.protocol)}:${identifier}`;
        const groupKey = `${identityType}:${identityValue}`;
        if (!identityGroups.has(groupKey)) {
            identityGroups.set(groupKey, {
                groupKey,
                identityType,
                identityValue,
                entries: [],
            });
        }
        identityGroups.get(groupKey)!.entries.push(item);
    });

    const conflictGroups: ConflictGroup[] = [];
    let highCount = 0;
    let mediumCount = 0;

    identityGroups.forEach((group) => {
        if (group.entries.length < 2) return;
        const protocolGroupsMap = new Map<string, any[]>();
        group.entries.forEach((entry) => {
            const protocol = normalizeProtocol(entry.protocol);
            if (!protocolGroupsMap.has(protocol)) protocolGroupsMap.set(protocol, []);
            protocolGroupsMap.get(protocol)!.push(entry);
        });

        const protocolConflicts: AnalyzedProtocolGroup[] = [];
        protocolGroupsMap.forEach((entries) => {
            if (entries.length < 2) return;
            const analyzed = analyzeProtocolGroup(entries, group.identityType);
            if (analyzed.hasConflict) {
                protocolConflicts.push(analyzed);
            }
        });

        if (protocolConflicts.length === 0) return;

        const groupConflictTypes = Array.from(
            new Set(protocolConflicts.flatMap((item) => item.conflictTypes))
        ).sort((a, b) => (TYPE_PRIORITY[b] || 0) - (TYPE_PRIORITY[a] || 0));

        const hasHighConflict = groupConflictTypes.includes('credential_mismatch');
        const severity = hasHighConflict ? 'high' : 'medium';
        if (severity === 'high') highCount += 1;
        else mediumCount += 1;

        const serverCount = new Set(group.entries.map((entry) => String(entry.serverId || '').trim()).filter(Boolean)).size;

        conflictGroups.push({
            groupKey: group.groupKey,
            identityType: group.identityType,
            identityValue: group.identityValue,
            displayIdentity: group.identityType === 'email'
                ? group.identityValue
                : `${identityPrefix} ${group.identityValue}`,
            entryCount: group.entries.length,
            serverCount,
            conflictTypes: groupConflictTypes,
            conflictFieldLabels: Array.from(new Set(
                protocolConflicts.flatMap((item) => item.diffFields)
            )).map((field) => fieldLabels[field] || field),
            severity,
            protocols: protocolConflicts
                .sort((a, b) => b.entryCount - a.entryCount),
        });
    });

    conflictGroups.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
        return b.entryCount - a.entryCount;
    });

    return {
        scannedAt: new Date().toISOString(),
        summary: {
            totalGroups: identityGroups.size,
            conflictGroups: conflictGroups.length,
            high: highCount,
            medium: mediumCount,
        },
        groups: conflictGroups,
    };
}

export function findConflictSourceEntry(protocolGroup?: { entries?: any[] } | null, sourceKey?: string): any | null {
    const entries = Array.isArray(protocolGroup?.entries) ? protocolGroup.entries : [];
    if (!sourceKey) return entries[0] || null;
    return entries.find((item) => buildClientEntryLocator(item) === sourceKey) || null;
}

export function getConflictTypeLabels(types: string[] = [], locale?: string): string[] {
    const resolvedLocale = resolveConflictLocale(locale);
    const typeLabels = CONFLICT_TYPE_LABELS_BY_LOCALE[resolvedLocale];
    return (Array.isArray(types) ? types : [])
        .map((item) => typeLabels[item] || item)
        .filter(Boolean);
}

export function getConflictFieldLabelsFromTypes(types: string[] = [], locale?: string): string[] {
    const resolvedLocale = resolveConflictLocale(locale);
    const fieldLabels = FIELD_LABELS_BY_LOCALE[resolvedLocale];
    const fieldSet = new Set<string>();
    (Array.isArray(types) ? types : []).forEach((type) => {
        const fields = TYPE_TO_FIELD[type] || [];
        fields.forEach((field) => fieldSet.add(fieldLabels[field] || field));
    });
    return Array.from(fieldSet.values());
}
