import fs from 'fs';
import path from 'path';
import config from '../config.js';
import auditStore from '../store/auditStore.js';
import { resolveClientIp } from './requestIp.js';

const AUDIT_FILE = path.join(config.dataDir, 'security_audit.log');

function ensureAuditDir() {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function redactSensitive(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return value;

    const blockedKeys = new Set([
        'password',
        'token',
        'authorization',
        'cookie',
        'secret',
        'tokensecret',
        'tokensecretenc',
        'tokensecrethash',
    ]);

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitive(item));
    }

    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        if (blockedKeys.has(String(key).toLowerCase())) {
            out[key] = '[REDACTED]';
            continue;
        }
        out[key] = redactSensitive(raw);
    }
    return out;
}

export function appendSecurityAudit(event, req, details = {}) {
    try {
        ensureAuditDir();
        const safeDetails = redactSensitive(details);
        const entry = {
            ts: new Date().toISOString(),
            event,
            ip: resolveClientIp(req),
            actor: req?.user?.role || 'anonymous',
            method: req?.method || null,
            path: req?.originalUrl || null,
            details: safeDetails,
        };
        fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(entry)}\n`, 'utf8');

        auditStore.appendEvent({
            event,
            req,
            details: safeDetails,
        });
    } catch {
        // Ignore audit errors to avoid affecting main request flow.
    }
}
