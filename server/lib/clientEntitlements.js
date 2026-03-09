const CLIENT_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeProtocol(value) {
    return normalizeText(value).toLowerCase();
}

function normalizeNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function parseInboundClients(inbound = {}) {
    try {
        const settings = typeof inbound.settings === 'string'
            ? JSON.parse(inbound.settings)
            : (inbound.settings || {});
        return Array.isArray(settings.clients) ? settings.clients : [];
    } catch {
        return [];
    }
}

function resolveClientIdentifier(client = {}, protocol = '') {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.password || client.id || client.email);
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.id || client.password || client.email);
    }
    return normalizeText(client.id || client.password || client.email);
}

function applyEntitlementToClient(clientRecord = {}, entitlement = {}) {
    return {
        ...clientRecord,
        expiryTime: normalizeNonNegativeInt(entitlement.expiryTime, normalizeNonNegativeInt(clientRecord.expiryTime, 0)),
        limitIp: normalizeNonNegativeInt(entitlement.limitIp, normalizeNonNegativeInt(clientRecord.limitIp, 0)),
        totalGB: normalizeNonNegativeInt(entitlement.trafficLimitBytes, normalizeNonNegativeInt(clientRecord.totalGB, 0)),
    };
}

function buildFormBody(data = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
        } else {
            params.append(key, String(value));
        }
    }
    return params.toString();
}

async function postAddClient(panelClient, inboundId, clientData) {
    return panelClient.post(
        '/panel/api/inbounds/addClient',
        buildFormBody({
            id: inboundId,
            settings: { clients: [clientData] },
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
}

async function postUpdateClient(panelClient, inboundId, clientIdentifier, clientData) {
    const encoded = encodeURIComponent(normalizeText(clientIdentifier));
    try {
        return await panelClient.post(
            `/panel/api/inbounds/updateClient/${encoded}`,
            buildFormBody({
                id: inboundId,
                settings: { clients: [clientData] },
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
    } catch {
        return panelClient.post(`/panel/api/inbounds/updateClient/${encoded}`, clientData);
    }
}

function buildManagedClientData({
    email,
    protocol,
    inbound,
    sharedCredentials = {},
    entitlement = {},
    resolveFlow = () => '',
}) {
    const normalizedProtocol = normalizeProtocol(protocol || inbound?.protocol);
    const payload = applyEntitlementToClient({
        email: normalizeEmail(email),
        enable: true,
        id: normalizeText(sharedCredentials.uuid),
        tgId: '',
        subId: normalizeText(sharedCredentials.subId),
        comment: '',
        reset: 0,
        totalGB: 0,
        expiryTime: 0,
        limitIp: 0,
    }, entitlement);

    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        payload.flow = resolveFlow(normalizedProtocol, inbound);
    }
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        payload.password = normalizeText(sharedCredentials.password);
    }

    return payload;
}

export {
    CLIENT_PROTOCOLS,
    PASSWORD_PROTOCOLS,
    UUID_PROTOCOLS,
    applyEntitlementToClient,
    buildManagedClientData,
    normalizeEmail,
    normalizeNonNegativeInt,
    normalizeProtocol,
    parseInboundClients,
    postAddClient,
    postUpdateClient,
    resolveClientIdentifier,
};
