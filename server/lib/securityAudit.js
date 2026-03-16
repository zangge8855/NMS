import fs from 'fs';
import path from 'path';
import config from '../config.js';
import auditStore from '../store/auditStore.js';
import { resolveClientIp } from './requestIp.js';
import notificationService, { SEVERITY } from './notifications.js';
import { enrichAuditEvent } from './auditEventEnrichment.js';

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

function buildAuditNotification(entry = {}) {
    const eventKey = String(entry.eventType || entry.event || '').trim().toLowerCase();
    const ip = String(entry.ip || '').trim() || 'unknown';
    const actor = String(entry.actor || '').trim() || 'anonymous';
    const pathValue = String(entry.path || '').trim() || '-';
    const details = entry?.details && typeof entry.details === 'object' && !Array.isArray(entry.details)
        ? entry.details
        : {};

    const definitions = {
        login_rate_limited: {
            type: 'security_attack_login_rate_limited',
            severity: SEVERITY.CRITICAL,
            title: '登录接口触发限流',
            body: `检测到登录接口被频繁尝试，IP ${ip} 已触发限流。路径: ${pathValue}`,
            dedupKey: `security:${eventKey}:${ip}`,
            telegramTopics: ['security_audit', 'emergency_alert'],
        },
        register_rate_limited: {
            type: 'security_attack_register_rate_limited',
            severity: SEVERITY.CRITICAL,
            title: '注册接口触发限流',
            body: `检测到注册接口被频繁请求，IP ${ip} 已触发限流。路径: ${pathValue}`,
            dedupKey: `security:${eventKey}:${ip}`,
            telegramTopics: ['security_audit', 'emergency_alert'],
        },
        password_reset_request_rate_limited: {
            type: 'security_attack_password_reset_rate_limited',
            severity: SEVERITY.CRITICAL,
            title: '重置密码接口触发限流',
            body: `检测到密码重置接口被频繁请求，IP ${ip} 已触发限流。路径: ${pathValue}`,
            dedupKey: `security:${eventKey}:${ip}`,
            telegramTopics: ['security_audit', 'emergency_alert'],
        },
        subscription_public_denied: {
            type: 'security_subscription_denied',
            severity: SEVERITY.WARNING,
            title: '公开订阅访问被拒绝',
            body: `公开订阅入口收到异常访问并被拒绝。IP ${ip} · 路径 ${pathValue}`,
            dedupKey: `security:${eventKey}:${ip}:${pathValue}`,
            telegramTopics: ['security_audit'],
        },
        subscription_public_denied_legacy: {
            type: 'security_subscription_denied_legacy',
            severity: SEVERITY.WARNING,
            title: '旧版订阅访问被拒绝',
            body: `旧版订阅入口收到异常访问并被拒绝。IP ${ip} · 路径 ${pathValue}`,
            dedupKey: `security:${eventKey}:${ip}:${pathValue}`,
            telegramTopics: ['security_audit'],
        },
        batch_clients_high_risk_action: {
            type: 'security_batch_clients_high_risk_action',
            severity: SEVERITY.WARNING,
            title: '批量客户端高风险操作',
            body: `管理员 ${actor} 触发了批量客户端高风险操作。目标数: ${Number(details.targetCount || 0)}`,
            dedupKey: `security:${eventKey}:${actor}:${pathValue}`,
            telegramTopics: ['security_audit'],
        },
        batch_inbounds_high_risk_action: {
            type: 'security_batch_inbounds_high_risk_action',
            severity: SEVERITY.WARNING,
            title: '批量入站高风险操作',
            body: `管理员 ${actor} 触发了批量入站高风险操作。目标数: ${Number(details.targetCount || 0)}`,
            dedupKey: `security:${eventKey}:${actor}:${pathValue}`,
            telegramTopics: ['security_audit'],
        },
        batch_high_risk_retry: {
            type: 'security_batch_high_risk_retry',
            severity: SEVERITY.WARNING,
            title: '高风险批量任务重试',
            body: `管理员 ${actor} 重新执行了高风险批量任务。任务: ${String(details.taskId || '').trim() || '-'}`,
            dedupKey: `security:${eventKey}:${String(details.taskId || '').trim() || actor}`,
            telegramTopics: ['security_audit'],
        },
    };

    const matched = definitions[eventKey];
    if (!matched) return null;

        return {
            type: matched.type,
            severity: matched.severity,
            title: matched.title,
            body: matched.body,
            meta: {
                event: eventKey,
                ip,
                actor,
                path: pathValue,
                method: String(entry.method || '').trim(),
                telegramTopics: matched.telegramTopics,
            },
            dedupKey: matched.dedupKey,
        };
}

function applyAuditNotificationEnrichment(notification = {}, entry = {}) {
    return {
        ...notification,
        meta: {
            ...(notification.meta || {}),
            ip: String(entry.ip || notification.meta?.ip || '').trim(),
            ipLocation: String(entry.ipLocation || '').trim(),
            ipCarrier: String(entry.ipCarrier || '').trim(),
            method: String(entry.method || notification.meta?.method || '').trim(),
            path: String(entry.path || notification.meta?.path || '').trim(),
        },
    };
}

export function appendSecurityAudit(event, req, details = {}, options = {}) {
    try {
        ensureAuditDir();
        const safeDetails = redactSensitive(details);
        const entry = {
            ts: new Date().toISOString(),
            event,
            ip: resolveClientIp(req),
            actor: req?.user?.username || req?.user?.userId || 'anonymous',
            method: req?.method || null,
            path: req?.originalUrl || null,
            details: safeDetails,
        };
        fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(entry)}\n`, 'utf8');

        const storedEntry = auditStore.appendEvent({
            event,
            req,
            details: safeDetails,
            outcome: typeof options?.outcome === 'string' ? options.outcome : '',
        });
        const notification = buildAuditNotification(storedEntry);
        if (notification) {
            void (async () => {
                try {
                    const enrichedEntry = await enrichAuditEvent(storedEntry);
                    notificationService.notify(applyAuditNotificationEnrichment(notification, enrichedEntry || storedEntry));
                } catch {
                    notificationService.notify(notification);
                }
            })();
        }
    } catch {
        // Ignore audit errors to avoid affecting main request flow.
    }
}
