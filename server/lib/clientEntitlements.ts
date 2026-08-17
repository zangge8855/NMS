import {
    postAddClientCompat,
    postUpdateClientCompat,
} from './panelApiCompat.js';

const CLIENT_PROTOCOLS = new Set<string>(['vmess', 'vless', 'trojan', 'shadowsocks']);
const UUID_PROTOCOLS = new Set<string>(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set<string>(['trojan', 'shadowsocks']);

function normalizeEmail(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeProtocol(value: unknown): string {
    return normalizeText(value).toLowerCase();
}

function normalizeNonNegativeInt(value: unknown, fallback: number = 0): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function parseInboundClients(inbound: any = {}): any[] {
    try {
        const settings = typeof inbound.settings === 'string'
            ? JSON.parse(inbound.settings)
            : (inbound.settings || {});
        return Array.isArray(settings.clients) ? settings.clients : [];
    } catch {
        return [];
    }
}

function resolveClientIdentifier(client: any = {}, protocol: string = ''): string {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.password || client.id || client.email);
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.id || client.password || client.email);
    }
    return normalizeText(client.id || client.password || client.email);
}

function applyEntitlementToClient(clientRecord: any = {}, entitlement: any = {}): any {
    return {
        ...clientRecord,
        expiryTime: normalizeNonNegativeInt(entitlement.expiryTime, normalizeNonNegativeInt(clientRecord.expiryTime, 0)),
        limitIp: normalizeNonNegativeInt(entitlement.limitIp, normalizeNonNegativeInt(clientRecord.limitIp, 0)),
        totalGB: normalizeNonNegativeInt(entitlement.trafficLimitBytes, normalizeNonNegativeInt(clientRecord.totalGB, 0)),
        speedLimitUp: normalizeNonNegativeInt(entitlement.speedLimitUp, normalizeNonNegativeInt(clientRecord.speedLimitUp, 0)),
        speedLimitDown: normalizeNonNegativeInt(entitlement.speedLimitDown, normalizeNonNegativeInt(clientRecord.speedLimitDown, 0)),
        tgId: entitlement.tgId !== undefined ? Number(entitlement.tgId) || 0 : clientRecord.tgId,
        group: entitlement.group !== undefined ? normalizeText(entitlement.group) : clientRecord.group,
        comment: entitlement.comment !== undefined ? normalizeText(entitlement.comment) : clientRecord.comment,
        reset: entitlement.reset !== undefined ? Number(entitlement.reset) || 0 : clientRecord.reset,
    };
}

async function postAddClient(panelClient: any, inboundId: any, clientData: any): Promise<any> {
    return postAddClientCompat(panelClient, inboundId, clientData);
}

async function postUpdateClient(panelClient: any, inboundId: any, clientIdentifier: any, clientData: any): Promise<any> {
    return postUpdateClientCompat(panelClient, inboundId, clientIdentifier, clientData);
}

function buildManagedClientData({
    email,
    protocol,
    inbound,
    sharedCredentials = {},
    entitlement = {},
    resolveFlow = () => '',
}: {
    email: string;
    protocol?: string;
    inbound?: any;
    sharedCredentials?: { uuid?: string; password?: string; subId?: string };
    entitlement?: any;
    resolveFlow?: (protocol: string, inbound: any) => string;
}): any {
    const normalizedProtocol = normalizeProtocol(protocol || inbound?.protocol);
    const payload = applyEntitlementToClient({
        email: normalizeEmail(email),
        enable: true,
        id: normalizeText(sharedCredentials.uuid),
        tgId: entitlement.tgId !== undefined ? Number(entitlement.tgId) || 0 : 0,
        subId: normalizeText(sharedCredentials.subId),
        group: entitlement.group !== undefined ? normalizeText(entitlement.group) : '',
        comment: entitlement.comment !== undefined ? normalizeText(entitlement.comment) : '',
        reset: entitlement.reset !== undefined ? Number(entitlement.reset) || 0 : 0,
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
