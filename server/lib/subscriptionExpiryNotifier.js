import userStore from '../store/userStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import notificationService, { SEVERITY } from './notifications.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

const STAGE_CONFIG = {
    expired: { label: '已到期', severity: SEVERITY.CRITICAL },
    '1d': { label: '1 天内到期', severity: SEVERITY.WARNING },
    '3d': { label: '3 天内到期', severity: SEVERITY.WARNING },
    '7d': { label: '7 天内到期', severity: SEVERITY.WARNING },
};

function startBackgroundInterval(fn, delayMs) {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function normalizeUserList(repo) {
    if (repo && typeof repo.getAll === 'function') {
        return repo.getAll();
    }
    if (repo && typeof repo.list === 'function') {
        return repo.list();
    }
    return [];
}

function formatDateTime(value) {
    if (!value) return '暂无';
    try {
        return new Date(value).toLocaleString('zh-CN', { hour12: false });
    } catch {
        return String(value);
    }
}

export function resolveSubscriptionExpiryStage(expiryTime, now = Date.now()) {
    const timestamp = Number(expiryTime || 0);
    if (!(timestamp > 0)) return null;

    const remainingMs = timestamp - Number(now || Date.now());
    const remainingDays = remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / DAY_MS)) : 0;

    if (remainingMs <= 0) {
        return {
            stage: 'expired',
            remainingMs,
            remainingDays: 0,
            ...STAGE_CONFIG.expired,
        };
    }
    if (remainingDays <= 1) {
        return {
            stage: '1d',
            remainingMs,
            remainingDays,
            ...STAGE_CONFIG['1d'],
        };
    }
    if (remainingDays <= 3) {
        return {
            stage: '3d',
            remainingMs,
            remainingDays,
            ...STAGE_CONFIG['3d'],
        };
    }
    if (remainingDays <= 7) {
        return {
            stage: '7d',
            remainingMs,
            remainingDays,
            ...STAGE_CONFIG['7d'],
        };
    }
    return null;
}

export function collectSubscriptionExpirySnapshot(options = {}) {
    const now = Number(options.now || Date.now());
    const userRepo = options.userStore || options.userRepository || userStore;
    const policyRepo = options.policyStore || userPolicyStore;
    const limit = Math.max(1, Number(options.limit || 8));
    const users = normalizeUserList(userRepo);
    const items = [];

    users.forEach((user) => {
        if (!user || String(user.role || '').trim().toLowerCase() !== 'user' || user.enabled === false) {
            return;
        }

        const email = String(user.email || '').trim().toLowerCase();
        const subscriptionEmail = String(user.subscriptionEmail || email).trim().toLowerCase();
        if (!subscriptionEmail) return;

        const policy = typeof policyRepo?.get === 'function'
            ? policyRepo.get(subscriptionEmail)
            : null;
        const expiryTime = Number(policy?.expiryTime || 0);
        const stage = resolveSubscriptionExpiryStage(expiryTime, now);
        if (!stage) return;

        items.push({
            username: String(user.username || '').trim(),
            email,
            subscriptionEmail,
            expiryTime,
            ...stage,
        });
    });

    items.sort((left, right) => {
        if (left.expiryTime !== right.expiryTime) return left.expiryTime - right.expiryTime;
        return left.subscriptionEmail.localeCompare(right.subscriptionEmail, 'zh-CN');
    });

    return {
        generatedAt: new Date(now).toISOString(),
        total: items.length,
        expiredCount: items.filter((item) => item.stage === 'expired').length,
        warningCount: items.filter((item) => item.stage !== 'expired').length,
        items: items.slice(0, limit),
    };
}

function buildExpiryNotification(item = {}) {
    const identity = [
        String(item.username || '').trim(),
        String(item.subscriptionEmail || item.email || '').trim(),
    ].filter(Boolean).join(' · ');
    const displayIdentity = identity || '未知用户';
    const expiryLabel = formatDateTime(item.expiryTime);

    if (item.stage === 'expired') {
        return {
            type: 'subscription_user_expired',
            severity: SEVERITY.CRITICAL,
            title: '用户订阅已到期',
            body: `${displayIdentity} 已到期。到期时间: ${expiryLabel}`,
            meta: {
                targetEmail: item.subscriptionEmail || item.email || '',
                targetUsername: item.username || '',
                expiryTime: item.expiryTime || 0,
                remainingDays: 0,
                stage: item.stage,
                telegramTopics: ['system_status', 'emergency_alert'],
            },
            dedupKey: `subscription_expiry:${item.subscriptionEmail || item.email || 'unknown'}:${item.stage}:${item.expiryTime || 0}`,
        };
    }

    return {
        type: 'subscription_user_expiry_warning',
        severity: SEVERITY.WARNING,
        title: '用户订阅即将到期',
        body: `${displayIdentity} 还有 ${item.remainingDays} 天到期。到期时间: ${expiryLabel}`,
        meta: {
            targetEmail: item.subscriptionEmail || item.email || '',
            targetUsername: item.username || '',
            expiryTime: item.expiryTime || 0,
            remainingDays: item.remainingDays || 0,
            stage: item.stage,
            telegramTopics: ['system_status'],
        },
        dedupKey: `subscription_expiry:${item.subscriptionEmail || item.email || 'unknown'}:${item.stage}:${item.expiryTime || 0}`,
    };
}

export function createSubscriptionExpiryNotifier(options = {}) {
    const intervalMs = Math.max(60_000, Number(options.intervalMs || DEFAULT_INTERVAL_MS));
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const notifications = options.notificationService || notificationService;
    const userRepo = options.userStore || options.userRepository || userStore;
    const policyRepo = options.policyStore || userPolicyStore;
    const stageCache = new Map();
    let timer = null;

    function clearResolvedUsers(activeKeys = new Set()) {
        for (const key of stageCache.keys()) {
            if (!activeKeys.has(key)) {
                stageCache.delete(key);
            }
        }
    }

    function runOnce() {
        const snapshot = collectSubscriptionExpirySnapshot({
            now: now(),
            userStore: userRepo,
            policyStore: policyRepo,
            limit: 50,
        });
        const activeKeys = new Set();

        snapshot.items.forEach((item) => {
            const cacheKey = String(item.subscriptionEmail || item.email || '').trim().toLowerCase();
            if (!cacheKey) return;
            activeKeys.add(cacheKey);

            const nextStageToken = `${item.stage}:${item.expiryTime}`;
            if (stageCache.get(cacheKey) === nextStageToken) {
                return;
            }

            stageCache.set(cacheKey, nextStageToken);
            notifications.notify(buildExpiryNotification(item));
        });

        clearResolvedUsers(activeKeys);
        return snapshot;
    }

    function start() {
        if (timer) return;
        runOnce();
        timer = startBackgroundInterval(runOnce, intervalMs);
    }

    function stop() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    }

    function resetForTests() {
        stop();
        stageCache.clear();
    }

    return {
        start,
        stop,
        runOnce,
        resetForTests,
        collectSnapshot: (snapshotOptions = {}) => collectSubscriptionExpirySnapshot({
            now: now(),
            userStore: userRepo,
            policyStore: policyRepo,
            ...snapshotOptions,
        }),
    };
}

const subscriptionExpiryNotifier = createSubscriptionExpiryNotifier();

export default subscriptionExpiryNotifier;
