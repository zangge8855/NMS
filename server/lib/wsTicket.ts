import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import userStore from '../store/userStore.js';

const WS_TICKET_ISSUER = 'nms';
const WS_TICKET_AUDIENCE = 'nms-websocket';
const MAX_CONSUMED_TICKET_JTIS = 10_000;
const consumedTicketJtis = new Map<string, number>();

function toSafeString(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function normalizeTokenVersion(value: unknown): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function pruneConsumedTicketJtis(nowMs: number): void {
    for (const [jti, expiresAtMs] of consumedTicketJtis) {
        if (expiresAtMs <= nowMs) {
            consumedTicketJtis.delete(jti);
        }
    }
    while (consumedTicketJtis.size >= MAX_CONSUMED_TICKET_JTIS) {
        const oldestKey = consumedTicketJtis.keys().next().value;
        if (!oldestKey) break;
        consumedTicketJtis.delete(oldestKey);
    }
}

export interface WsTicketUser {
    userId?: string;
    username?: string;
    role?: string;
    tokenVersion?: number;
}

export interface WsTicketResult {
    ticket: string;
    expiresAt: string;
    expiresInSeconds: number;
}

export function issueWsTicket(user: WsTicketUser = {}): WsTicketResult {
    const userId = toSafeString(user.userId);
    const username = toSafeString(user.username);
    const role = toSafeString(user.role) || 'user';
    const storedUser = userId ? userStore.getById(userId) : null;
    const tokenVersion = normalizeTokenVersion(
        user.tokenVersion !== undefined ? user.tokenVersion : storedUser?.tokenVersion
    );
    const expiresInSeconds = Math.max(60, Number(config.ws?.ticketTtlSeconds || 600));
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + (expiresInSeconds * 1000);
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    const jti = crypto.randomUUID();

    const payload = {
        type: 'ws_ticket',
        userId,
        username,
        role,
        tokenVersion,
    };

    const ticket = jwt.sign(payload, config.jwt.secret, {
        algorithm: 'HS256',
        issuer: WS_TICKET_ISSUER,
        audience: WS_TICKET_AUDIENCE,
        expiresIn: expiresInSeconds,
        jwtid: jti,
    });

    return {
        ticket,
        expiresAt: expiresAtIso,
        expiresInSeconds,
    };
}

export function verifyWsTicket(ticket: unknown): any {
    const decoded: any = jwt.verify(String(ticket || ''), config.jwt.secret, {
        algorithms: ['HS256'],
        issuer: WS_TICKET_ISSUER,
        audience: WS_TICKET_AUDIENCE,
    });
    if (decoded?.type !== 'ws_ticket') {
        throw new Error('Invalid ticket type');
    }
    const jti = toSafeString(decoded?.jti);
    if (!jti) {
        throw new Error('Missing ticket jti');
    }
    const nowMs = Date.now();
    pruneConsumedTicketJtis(nowMs);
    if (consumedTicketJtis.has(jti)) {
        throw new Error('Ticket already used');
    }
    const fallbackTtlSeconds = Math.max(60, Number(config.ws?.ticketTtlSeconds || 600));
    const expMs = Number.isFinite(Number(decoded?.exp))
        ? Number(decoded.exp) * 1000
        : nowMs + (fallbackTtlSeconds * 1000);
    consumedTicketJtis.set(jti, expMs);
    return {
        ...decoded,
        tokenVersion: normalizeTokenVersion(decoded?.tokenVersion),
    };
}
