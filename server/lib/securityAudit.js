import fs from 'fs';
import path from 'path';
import config from '../config.js';
import auditStore from '../store/auditStore.js';
import { resolveClientIp } from './requestIp.js';
import notificationService, { SEVERITY } from './notifications.js';
import { enrichAuditEvent } from './auditEventEnrichment.js';

const AUDIT_FILE = path.join(config.dataDir, 'security_audit.log');

// Persistent write stream for audit log — avoids blocking the event loop on
// every appendSecurityAudit call.  The stream is created lazily so the data
// directory can be ensured first.
let auditStream = null;
function getAuditStream() {
    if (!auditStream) {
        ensureAuditDir();
        auditStream = fs.createWriteStream(AUDIT_FILE, { flags: 'a' });
        auditStream.on('error', (err) => {
            console.error('[SecurityAudit] write stream error:', err);
            // Discard broken stream so the next call creates a fresh one.
            auditStream = null;
        });
    }
    return auditStream;
}

const LOGIN_PATTERN_WINDOW_MS = 5 * 60 * 1000;
const ACCESS_PATTERN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_PATTERN_EVENTS = new Set([
    'login_failed',
    'login_denied_email_unverified',
    'login_denied_user_disabled',
    'login_rate_limited',
]);
const ACCESS_PATTERN_EVENTS = new Set([
    'subscription_public_denied',
    'subscription_public_denied_legacy',
]);

// ── Lightweight in-memory sliding window for pattern matching ──
// Instead of querying auditStore for 200 records on every call, we maintain a
// small ring buffer of security-relevant event summaries that is appended to
// inside appendSecurityAudit.  getRecentMatchingEvents reads from this buffer.
const recentSecurityEvents = [];
const MAX_RECENT_EVENTS = 500;
const SECURITY_PATTERN_EVENT_TYPES = new Set([
    ...LOGIN_PATTERN_EVENTS,
    ...ACCESS_PATTERN_EVENTS,
]);

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

function getRecentMatchingEvents(windowMs, predicate) {
    const cutoff = Date.now() - windowMs;
    return recentSecurityEvents.filter((item) => item.ts >= cutoff && predicate(item));
}

function summarizeLoginPattern(entry = {}, details = {}) {
    const ip = String(entry.ip || '').trim();
    if (!ip) return null;
    const recentEvents = getRecentMatchingEvents(LOGIN_PATTERN_WINDOW_MS, (item) => (
        LOGIN_PATTERN_EVENTS.has(String(item?.eventType || '').trim().toLowerCase())
        && String(item?.ip || '').trim() === ip
    ));
    if (recentEvents.length === 0) return null;

    const targets = new Set();
    let rateLimited = false;
    recentEvents.forEach((item) => {
        const candidate = String(
            item?.details?.username
            || item?.details?.email
            || item?.targetEmail
            || details?.username
            || details?.email
            || ''
        ).trim().toLowerCase();
        if (candidate) targets.add(candidate);
        if (String(item?.eventType || '').trim().toLowerCase() === 'login_rate_limited') {
            rateLimited = true;
        }
    });

    return {
        recentAttempts: recentEvents.length,
        distinctTargets: targets.size,
        rateLimited,
        suspectedBruteforce: recentEvents.length >= 8 || targets.size >= 3 || rateLimited,
    };
}

function summarizeAccessPattern(entry = {}) {
    const ip = String(entry.ip || '').trim();
    if (!ip) return null;
    const recentEvents = getRecentMatchingEvents(ACCESS_PATTERN_WINDOW_MS, (item) => (
        ACCESS_PATTERN_EVENTS.has(String(item?.eventType || '').trim().toLowerCase())
        && String(item?.ip || '').trim() === ip
    ));
    if (recentEvents.length === 0) return null;

    const paths = new Set();
    recentEvents.forEach((item) => {
        const pathValue = String(item?.path || '').trim();
        if (pathValue) paths.add(pathValue);
    });

    return {
        recentDeniedCount: recentEvents.length,
        distinctPaths: paths.size || 1,
        suspectedScan: recentEvents.length >= 12 || paths.size >= 3,
    };
}

function buildAuditNotification(entry = {}) {
    const eventKey = String(entry.eventType || entry.event || '').trim().toLowerCase();
    const ip = String(entry.ip || '').trim() || 'unknown';
    const actor = String(entry.actor || '').trim() || 'anonymous';
    const pathValue = String(entry.path || '').trim() || '-';
    const details = entry?.details && typeof entry.details === 'object' && !Array.isArray(entry.details)
        ? entry.details
        : {};
    const loginPattern = LOGIN_PATTERN_EVENTS.has(eventKey) ? summarizeLoginPattern(entry, details) : null;
    const accessPattern = ACCESS_PATTERN_EVENTS.has(eventKey) ? summarizeAccessPattern(entry) : null;

    const definitions = {
        login_failed: {
            type: 'security_login_failed',
            severity: loginPattern?.suspectedBruteforce ? SEVERITY.CRITICAL : SEVERITY.WARNING,
            title: loginPattern?.suspectedBruteforce ? '疑似登录爆破' : '登录失败',
            body: `检测到登录失败请求。IP ${ip} · 用户 ${String(details.username || details.email || actor || '-').trim() || '-'} · 路径 ${pathValue}${loginPattern ? ` · 近 5 分钟同源 ${loginPattern.recentAttempts} 次 / ${loginPattern.distinctTargets} 个账号` : ''}`,
            dedupKey: `security:${eventKey}:${ip}:${String(details.username || details.email || '-').trim().toLowerCase()}`,
            telegramTopics: loginPattern?.suspectedBruteforce ? ['security_audit', 'emergency_alert'] : ['security_audit'],
        },
        login_denied_email_unverified: {
            type: 'security_login_denied_email_unverified',
            severity: loginPattern?.suspectedBruteforce ? SEVERITY.CRITICAL : SEVERITY.WARNING,
            title: '未验证邮箱尝试登录',
            body: `检测到未完成邮箱验证的登录尝试。IP ${ip} · 用户 ${String(details.username || details.email || actor || '-').trim() || '-'} · 路径 ${pathValue}${loginPattern ? ` · 近 5 分钟同源 ${loginPattern.recentAttempts} 次 / ${loginPattern.distinctTargets} 个账号` : ''}`,
            dedupKey: `security:${eventKey}:${ip}:${String(details.username || details.email || '-').trim().toLowerCase()}`,
            telegramTopics: loginPattern?.suspectedBruteforce ? ['security_audit', 'emergency_alert'] : ['security_audit'],
        },
        login_denied_user_disabled: {
            type: 'security_login_denied_user_disabled',
            severity: loginPattern?.suspectedBruteforce ? SEVERITY.CRITICAL : SEVERITY.WARNING,
            title: '停用账号尝试登录',
            body: `检测到停用账号登录尝试。IP ${ip} · 用户 ${String(details.username || details.email || actor || '-').trim() || '-'} · 路径 ${pathValue}${loginPattern ? ` · 近 5 分钟同源 ${loginPattern.recentAttempts} 次 / ${loginPattern.distinctTargets} 个账号` : ''}`,
            dedupKey: `security:${eventKey}:${ip}:${String(details.username || details.email || '-').trim().toLowerCase()}`,
            telegramTopics: loginPattern?.suspectedBruteforce ? ['security_audit', 'emergency_alert'] : ['security_audit'],
        },
        login_rate_limited: {
            type: 'security_attack_login_rate_limited',
            severity: SEVERITY.CRITICAL,
            title: loginPattern?.distinctTargets >= 3 ? '登录接口疑似爆破并触发限流' : '登录接口触发限流',
            body: `检测到登录接口被频繁尝试，IP ${ip} 已触发限流。路径: ${pathValue}${loginPattern ? ` · 近 5 分钟同源 ${loginPattern.recentAttempts} 次 / ${loginPattern.distinctTargets} 个账号` : ''}`,
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
            severity: accessPattern?.suspectedScan ? SEVERITY.CRITICAL : SEVERITY.WARNING,
            title: accessPattern?.suspectedScan ? '公开订阅入口疑似扫描' : '公开订阅访问被拒绝',
            body: `公开订阅入口收到异常访问并被拒绝。IP ${ip} · 路径 ${pathValue}${accessPattern ? ` · 近 10 分钟同源 ${accessPattern.recentDeniedCount} 次` : ''}`,
            dedupKey: `security:${eventKey}:${ip}:${pathValue}`,
            telegramTopics: accessPattern?.suspectedScan ? ['security_audit', 'emergency_alert'] : ['security_audit'],
        },
        subscription_public_denied_legacy: {
            type: 'security_subscription_denied_legacy',
            severity: accessPattern?.suspectedScan ? SEVERITY.CRITICAL : SEVERITY.WARNING,
            title: accessPattern?.suspectedScan ? '旧版订阅入口疑似扫描' : '旧版订阅访问被拒绝',
            body: `旧版订阅入口收到异常访问并被拒绝。IP ${ip} · 路径 ${pathValue}${accessPattern ? ` · 近 10 分钟同源 ${accessPattern.recentDeniedCount} 次` : ''}`,
            dedupKey: `security:${eventKey}:${ip}:${pathValue}`,
            telegramTopics: accessPattern?.suspectedScan ? ['security_audit', 'emergency_alert'] : ['security_audit'],
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
                recentAttempts: loginPattern?.recentAttempts || 0,
                distinctTargets: loginPattern?.distinctTargets || 0,
                rateLimited: loginPattern?.rateLimited || false,
                suspectedBruteforce: loginPattern?.suspectedBruteforce || false,
                recentDeniedCount: accessPattern?.recentDeniedCount || 0,
                distinctPaths: accessPattern?.distinctPaths || 0,
                suspectedScan: accessPattern?.suspectedScan || false,
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
        getAuditStream().write(`${JSON.stringify(entry)}\n`);

        const storedEntry = auditStore.appendEvent({
            event,
            req,
            details: safeDetails,
            outcome: typeof options?.outcome === 'string' ? options.outcome : '',
        });

        // Push security-relevant events into the in-memory ring buffer so
        // pattern queries avoid hitting the full audit store.
        const eventKey = String(event || '').trim().toLowerCase();
        if (SECURITY_PATTERN_EVENT_TYPES.has(eventKey)) {
            recentSecurityEvents.push({
                eventType: eventKey,
                ip: entry.ip,
                ts: Date.now(),
                details: safeDetails,
                path: entry.path,
            });
            if (recentSecurityEvents.length > MAX_RECENT_EVENTS) {
                recentSecurityEvents.splice(0, recentSecurityEvents.length - MAX_RECENT_EVENTS);
            }
        }

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
