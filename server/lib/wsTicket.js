import jwt from 'jsonwebtoken';
import config from '../config.js';

const WS_TICKET_ISSUER = 'nms';
const WS_TICKET_AUDIENCE = 'nms-websocket';

function toSafeString(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

export function issueWsTicket(user = {}) {
    const userId = toSafeString(user.userId);
    const username = toSafeString(user.username);
    const role = toSafeString(user.role) || 'user';
    const expiresInSeconds = Math.max(60, Number(config.ws?.ticketTtlSeconds || 600));
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + (expiresInSeconds * 1000);
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    const payload = {
        type: 'ws_ticket',
        userId,
        username,
        role,
    };

    const ticket = jwt.sign(payload, config.jwt.secret, {
        issuer: WS_TICKET_ISSUER,
        audience: WS_TICKET_AUDIENCE,
        expiresIn: expiresInSeconds,
    });

    return {
        ticket,
        expiresAt: expiresAtIso,
        expiresInSeconds,
    };
}

export function verifyWsTicket(ticket) {
    const decoded = jwt.verify(String(ticket || ''), config.jwt.secret, {
        issuer: WS_TICKET_ISSUER,
        audience: WS_TICKET_AUDIENCE,
    });
    if (decoded?.type !== 'ws_ticket') {
        throw new Error('Invalid ticket type');
    }
    return decoded;
}
