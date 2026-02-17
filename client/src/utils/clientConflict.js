const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

const FIELD_LABELS = {
    id: 'UUID/ID',
    password: '密码',
    expiryTime: '有效期',
    totalGB: '总流量',
    enable: '启用状态',
    limitIp: 'IP 限制',
    flow: '流控参数',
    subId: '订阅标识',
    email: '邮箱',
};

const TYPE_PRIORITY = {
    credential_mismatch: 100,
    expiry_mismatch: 60,
    quota_mismatch: 50,
    enable_mismatch: 40,
    limit_ip_mismatch: 30,
    flow_mismatch: 20,
    subid_mismatch: 10,
    email_mismatch: 10,
};

const TYPE_TO_FIELD = {
    credential_mismatch: ['id', 'password'],
    expiry_mismatch: ['expiryTime'],
    quota_mismatch: ['totalGB'],
    enable_mismatch: ['enable'],
    limit_ip_mismatch: ['limitIp'],
    flow_mismatch: ['flow'],
    subid_mismatch: ['subId'],
    email_mismatch: ['email'],
};

const FIELD_TO_TYPE = {
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

export const CONFLICT_TYPE_LABELS = {
    credential_mismatch: '凭据不一致',
    expiry_mismatch: '有效期不一致',
    quota_mismatch: '流量配额不一致',
    enable_mismatch: '启用状态不一致',
    limit_ip_mismatch: 'IP 限制不一致',
    flow_mismatch: 'Flow 参数不一致',
    subid_mismatch: '订阅标识不一致',
    email_mismatch: '邮箱不一致',
};

function normalizeProtocol(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFieldValue(field, value) {
    if (field === 'expiryTime' || field === 'totalGB' || field === 'limitIp') {
        return toNumber(value, 0);
    }
    if (field === 'enable') {
        return Boolean(value);
    }
    return String(value || '').trim();
}

function comparableFieldsForProtocol(protocol, identityType) {
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

function buildDistinctMap(entries, fields) {
    const result = {};
    fields.forEach((field) => {
        const rawSet = new Set();
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

export function getClientIdentifier(entry = {}) {
    const protocol = normalizeProtocol(entry.protocol);
    if (PASSWORD_PROTOCOLS.has(protocol)) {
        return String(entry.password || entry.id || entry.email || '').trim();
    }
    if (UUID_PROTOCOLS.has(protocol)) {
        return String(entry.id || entry.password || entry.email || '').trim();
    }
    return String(entry.id || entry.password || entry.email || '').trim();
}

export function buildClientEntryLocator(entry = {}) {
    const serverId = String(entry.serverId || '').trim();
    const inboundId = String(entry.inboundId || '').trim();
    const protocol = normalizeProtocol(entry.protocol);
    const identifier = getClientIdentifier(entry);
    const email = normalizeEmail(entry.email);
    return `${serverId}|${inboundId}|${protocol}|${identifier}|${email}`;
}

function scoreSourceEntry(entry = {}) {
    const enabledScore = entry.enable === false ? 0 : 1_000_000_000_000;
    const expiryScore = toNumber(entry.expiryTime, 0);
    const totalScore = toNumber(entry.totalGB, 0);
    const limitScore = toNumber(entry.limitIp, 0);
    return enabledScore + expiryScore + totalScore + limitScore;
}

function analyzeProtocolGroup(entries, identityType) {
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

export function buildClientConflictReport(clients = []) {
    const identityGroups = new Map();
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
        identityGroups.get(groupKey).entries.push(item);
    });

    const conflictGroups = [];
    let highCount = 0;
    let mediumCount = 0;

    identityGroups.forEach((group) => {
        if (group.entries.length < 2) return;
        const protocolGroupsMap = new Map();
        group.entries.forEach((entry) => {
            const protocol = normalizeProtocol(entry.protocol);
            if (!protocolGroupsMap.has(protocol)) protocolGroupsMap.set(protocol, []);
            protocolGroupsMap.get(protocol).push(entry);
        });

        const protocolConflicts = [];
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
                : `标识 ${group.identityValue}`,
            entryCount: group.entries.length,
            serverCount,
            conflictTypes: groupConflictTypes,
            conflictFieldLabels: Array.from(new Set(
                protocolConflicts.flatMap((item) => item.diffFields)
            )).map((field) => FIELD_LABELS[field] || field),
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

export function findConflictSourceEntry(protocolGroup, sourceKey) {
    const entries = Array.isArray(protocolGroup?.entries) ? protocolGroup.entries : [];
    if (!sourceKey) return entries[0] || null;
    return entries.find((item) => buildClientEntryLocator(item) === sourceKey) || null;
}

export function getConflictTypeLabels(types = []) {
    return (Array.isArray(types) ? types : [])
        .map((item) => CONFLICT_TYPE_LABELS[item] || item)
        .filter(Boolean);
}

export function getConflictFieldLabelsFromTypes(types = []) {
    const fieldSet = new Set();
    (Array.isArray(types) ? types : []).forEach((type) => {
        const fields = TYPE_TO_FIELD[type] || [];
        fields.forEach((field) => fieldSet.add(FIELD_LABELS[field] || field));
    });
    return Array.from(fieldSet.values());
}
