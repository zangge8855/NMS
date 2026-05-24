const ALLOWED_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const POLICY_SCOPE_MODES = new Set(['all', 'selected', 'none']);
const TRAFFIC_RESET_CYCLES = new Set(['none', 'hourly', 'daily', 'weekly', 'monthly']);
const IP_LIMIT_POLICIES = new Set(['first-wins', 'last-wins']);

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeStringList(input = [], mapper = normalizeText) {
    const result = [];
    const seen = new Set();
    (Array.isArray(input) ? input : []).forEach((item) => {
        const text = mapper(item);
        if (!text || seen.has(text)) return;
        seen.add(text);
        result.push(text);
    });
    return result;
}

function normalizeScopeMode(value, selectedItems = [], fallback = 'all') {
    const selected = Array.isArray(selectedItems) ? selectedItems : [];
    const normalizedFallback = POLICY_SCOPE_MODES.has(String(fallback || '').trim().toLowerCase())
        ? String(fallback || '').trim().toLowerCase()
        : (selected.length > 0 ? 'selected' : 'all');
    const text = String(value || '').trim().toLowerCase();
    if (!text) return normalizedFallback;
    if (!POLICY_SCOPE_MODES.has(text)) return normalizedFallback;
    if (text === 'selected' && selected.length === 0) return 'none';
    return text;
}

function normalizeNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function normalizeTrafficResetCycle(value, fallback = 'none') {
    const text = String(value || '').trim().toLowerCase();
    if (TRAFFIC_RESET_CYCLES.has(text)) return text;
    return TRAFFIC_RESET_CYCLES.has(fallback) ? fallback : 'none';
}

function normalizeIpLimitPolicy(value, fallback = 'first-wins') {
    const text = String(value || '').trim().toLowerCase();
    if (IP_LIMIT_POLICIES.has(text)) return text;
    return IP_LIMIT_POLICIES.has(fallback) ? fallback : 'first-wins';
}

function sanitizePolicy(input = {}, options = {}) {
    const defaults = options.defaults && typeof options.defaults === 'object' ? options.defaults : {};
    const blockedServerIds = normalizeStringList(
        input.blockedServerIds ?? input.deniedServerIds ?? defaults.blockedServerIds ?? defaults.deniedServerIds
    );
    const blockedServerIdSet = new Set(blockedServerIds);
    const allowedServerIds = normalizeStringList(input.allowedServerIds ?? defaults.allowedServerIds)
        .filter((item) => !blockedServerIdSet.has(item));
    const allowedProtocols = normalizeStringList(
        input.allowedProtocols ?? defaults.allowedProtocols,
        (item) => normalizeText(item).toLowerCase()
    ).filter((item) => ALLOWED_PROTOCOLS.has(item));
    const blockedInboundKeys = normalizeStringList(
        input.blockedInboundKeys ?? input.deniedInboundKeys ?? defaults.blockedInboundKeys ?? defaults.deniedInboundKeys
    );
    const blockedInboundKeySet = new Set(blockedInboundKeys);
    const allowedInboundKeys = normalizeStringList(input.allowedInboundKeys ?? defaults.allowedInboundKeys)
        .filter((item) => !blockedInboundKeySet.has(item));

    const inferredServerMode = allowedServerIds.length > 0 ? 'selected' : 'all';
    const inferredProtocolMode = allowedProtocols.length > 0 ? 'selected' : 'all';
    const serverScopeMode = normalizeScopeMode(
        input.serverScopeMode ?? defaults.serverScopeMode,
        allowedServerIds,
        inferredServerMode
    );
    const protocolScopeMode = normalizeScopeMode(
        input.protocolScopeMode ?? defaults.protocolScopeMode,
        allowedProtocols,
        inferredProtocolMode
    );

    return {
        allowedServerIds: serverScopeMode === 'selected' ? allowedServerIds : [],
        blockedServerIds,
        allowedProtocols: protocolScopeMode === 'selected' ? allowedProtocols : [],
        allowedInboundKeys,
        blockedInboundKeys,
        serverScopeMode,
        protocolScopeMode,
        expiryTime: normalizeNonNegativeInt(input.expiryTime, normalizeNonNegativeInt(defaults.expiryTime, 0)),
        limitIp: normalizeNonNegativeInt(input.limitIp, normalizeNonNegativeInt(defaults.limitIp, 0)),
        trafficLimitBytes: normalizeNonNegativeInt(
            input.trafficLimitBytes,
            normalizeNonNegativeInt(defaults.trafficLimitBytes, 0)
        ),
        speedLimitUp: normalizeNonNegativeInt(
            input.speedLimitUp,
            normalizeNonNegativeInt(defaults.speedLimitUp, 0)
        ),
        speedLimitDown: normalizeNonNegativeInt(
            input.speedLimitDown,
            normalizeNonNegativeInt(defaults.speedLimitDown, 0)
        ),
        trafficResetCycle: normalizeTrafficResetCycle(
            input.trafficResetCycle,
            normalizeTrafficResetCycle(defaults.trafficResetCycle, 'none')
        ),
        ipLimitPolicy: normalizeIpLimitPolicy(input.ipLimitPolicy, defaults.ipLimitPolicy || 'first-wins'),
    };
}

function sanitizeUserPolicy(input = {}) {
    const policy = sanitizePolicy(input);
    const overrideFields = normalizeStringList(input.overrideFields)
        .filter((field) => Object.prototype.hasOwnProperty.call(policy, field));
    return {
        ...policy,
        inheritGroup: input.inheritGroup === true,
        overrideFields,
    };
}

function sanitizeGroupPolicy(input = {}) {
    return {
        ...sanitizePolicy(input),
        name: normalizeText(input.name),
        description: normalizeText(input.description),
        enabled: input.enabled !== false,
    };
}

function getInboundScopeKey(serverId = '', inboundId = '') {
    const normalizedServerId = normalizeText(serverId);
    const normalizedInboundId = normalizeText(inboundId);
    if (!normalizedServerId || !normalizedInboundId) return '';
    return `${normalizedServerId}:${normalizedInboundId}`;
}

function isServerAllowedByPolicy(policy = {}, serverId = '') {
    const normalizedServerId = normalizeText(serverId);
    if (!normalizedServerId) return false;
    const sanitized = sanitizePolicy(policy);
    if (sanitized.blockedServerIds.includes(normalizedServerId)) return false;
    if (sanitized.serverScopeMode === 'none') return false;
    if (sanitized.serverScopeMode === 'selected' && !sanitized.allowedServerIds.includes(normalizedServerId)) return false;
    return true;
}

function isProtocolAllowedByPolicy(policy = {}, protocol = '') {
    const normalizedProtocol = normalizeText(protocol).toLowerCase();
    if (!normalizedProtocol) return false;
    const sanitized = sanitizePolicy(policy);
    if (sanitized.protocolScopeMode === 'none') return false;
    if (sanitized.protocolScopeMode === 'selected' && !sanitized.allowedProtocols.includes(normalizedProtocol)) return false;
    return true;
}

function isInboundAllowedByPolicy(policy = {}, serverId = '', inboundId = '') {
    const key = getInboundScopeKey(serverId, inboundId);
    if (!key) return false;
    const sanitized = sanitizePolicy(policy);
    if (sanitized.blockedInboundKeys.includes(key)) return false;
    if (sanitized.allowedInboundKeys.length > 0 && !sanitized.allowedInboundKeys.includes(key)) return false;
    return true;
}

function resolveEffectivePolicy(user = null, rawPolicy = {}, group = null) {
    const userPolicy = sanitizeUserPolicy(rawPolicy || {});
    const groupPolicy = group && group.enabled !== false ? sanitizePolicy(group) : null;
    const hasPersistedPolicy = Boolean(rawPolicy?.updatedAt);
    const shouldInheritGroup = groupPolicy
        && (userPolicy.inheritGroup === true || !hasPersistedPolicy);
    if (!groupPolicy || !shouldInheritGroup) {
        return {
            ...userPolicy,
            source: groupPolicy ? 'user' : 'user',
            groupId: normalizeText(user?.groupId),
            groupName: groupPolicy ? normalizeText(group?.name) : '',
            inheritGroup: userPolicy.inheritGroup,
        };
    }

    const effective = {
        ...groupPolicy,
    };
    userPolicy.overrideFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(userPolicy, field)) {
            effective[field] = userPolicy[field];
        }
    });

    return {
        ...sanitizePolicy(effective),
        inheritGroup: true,
        overrideFields: userPolicy.overrideFields,
        source: 'group',
        groupId: normalizeText(user?.groupId || group?.id),
        groupName: normalizeText(group?.name),
    };
}

export {
    ALLOWED_PROTOCOLS,
    IP_LIMIT_POLICIES,
    POLICY_SCOPE_MODES,
    TRAFFIC_RESET_CYCLES,
    getInboundScopeKey,
    isInboundAllowedByPolicy,
    isProtocolAllowedByPolicy,
    isServerAllowedByPolicy,
    normalizeEmail,
    normalizeNonNegativeInt,
    normalizeScopeMode,
    normalizeStringList,
    sanitizeGroupPolicy,
    sanitizePolicy,
    sanitizeUserPolicy,
    resolveEffectivePolicy,
};
