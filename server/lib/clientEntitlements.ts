import {
    parseInboundClients,
    postAddClientCompat,
    postUpdateClientCompat,
} from './panelApiCompat.js';
import { isSuiPanelContext } from './clientProtocols.js';

const CLIENT_PROTOCOLS = new Set<string>(['vmess', 'vless', 'trojan', 'shadowsocks']);
const UUID_PROTOCOLS = new Set<string>(['vmess', 'vless', 'tuic']);
const PASSWORD_PROTOCOLS = new Set<string>(['trojan', 'shadowsocks']);
/** 3x-ui Hysteria clients authenticate with `auth` instead of a password. */
const AUTH_PROTOCOLS = new Set<string>(['hysteria', 'hysteria2', 'hy2']);

/** Fills the protocol-specific credential slots 3x-ui v3 expects beyond id/password. */
function applyExtraProtocolCredentials(payload: any, protocol: string, password: string, existing: any = {}): void {
    if (AUTH_PROTOCOLS.has(protocol)) {
        const secret = password || normalizeText(existing.auth || existing.password);
        payload.auth = secret;
        payload.password = secret;
    } else if (protocol === 'tuic') {
        const uuid = normalizeText(payload.id || payload.uuid || existing.uuid || existing.id);
        if (uuid) {
            payload.id = uuid;
            payload.uuid = uuid;
        }
        payload.password = password || normalizeText(existing.password);
    }
}

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

function resolveClientIdentifier(client: any = {}, protocol: string = ''): string {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.password || client.id || client.uuid || client.email);
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.uuid || client.id || client.password || client.email);
    }
    if (AUTH_PROTOCOLS.has(normalizedProtocol)) {
        return normalizeText(client.auth || client.password || client.id || client.email);
    }
    return normalizeText(client.id || client.uuid || client.password || client.auth || client.email);
}

function resolveShadowsocksMethod(inbound: any = {}, clientRecord: any = {}): string {
    const direct = normalizeProtocol(clientRecord?.method || inbound?.method);
    if (direct) return direct;
    try {
        const settings = typeof inbound?.settings === 'string'
            ? JSON.parse(inbound.settings)
            : (inbound?.settings || {});
        return normalizeProtocol(settings?.method);
    } catch {
        return '';
    }
}

function resolveShadowsocksPassword(
    inbound: any = {},
    sharedCredentials: { password?: string; ss2022Key16?: string; ss2022Key32?: string } = {},
    clientRecord: any = {}
): string {
    const method = resolveShadowsocksMethod(inbound, clientRecord);
    const fallbackPassword = normalizeText(sharedCredentials?.password);
    if (method === '2022-blake3-aes-128-gcm') {
        return normalizeText(sharedCredentials?.ss2022Key16) || fallbackPassword;
    }
    if (method.startsWith('2022-')) {
        return normalizeText(sharedCredentials?.ss2022Key32) || fallbackPassword;
    }
    return fallbackPassword;
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

async function postAddClient(panelClient: any, inboundId: any, clientData: any, options: any = {}): Promise<any> {
    return postAddClientCompat(panelClient, inboundId, clientData, options);
}

async function postUpdateClient(panelClient: any, inboundId: any, clientIdentifier: any, clientData: any, options: any = {}): Promise<any> {
    return postUpdateClientCompat(panelClient, inboundId, clientIdentifier, clientData, options);
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
    sharedCredentials?: { uuid?: string; password?: string; ss2022Key16?: string; ss2022Key32?: string; subId?: string };
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

    if (isSuiPanelContext(inbound)) {
        // One s-ui client carries credentials for every protocol, whatever inbound it joins first.
        payload.password = normalizeText(sharedCredentials.password);
        const ss2022Key16 = normalizeText(sharedCredentials.ss2022Key16);
        const ss2022Key32 = normalizeText(sharedCredentials.ss2022Key32);
        if (ss2022Key16) payload.ss2022Key16 = ss2022Key16;
        if (ss2022Key32) payload.ss2022Key32 = ss2022Key32;
        payload.flow = resolveFlow('vless', inbound);
        return payload;
    }
    if (normalizedProtocol === 'vmess' || normalizedProtocol === 'vless') {
        payload.flow = resolveFlow(normalizedProtocol, inbound);
    }
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        payload.password = normalizedProtocol === 'shadowsocks'
            ? resolveShadowsocksPassword(inbound, sharedCredentials)
            : normalizeText(sharedCredentials.password);
    }
    applyExtraProtocolCredentials(payload, normalizedProtocol, normalizeText(sharedCredentials.password));

    return payload;
}

export {
    AUTH_PROTOCOLS,
    CLIENT_PROTOCOLS,
    PASSWORD_PROTOCOLS,
    UUID_PROTOCOLS,
    applyEntitlementToClient,
    applyExtraProtocolCredentials,
    buildManagedClientData,
    normalizeEmail,
    normalizeNonNegativeInt,
    normalizeProtocol,
    parseInboundClients,
    postAddClient,
    postUpdateClient,
    resolveClientIdentifier,
    resolveShadowsocksPassword,
};
