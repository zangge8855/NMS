import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildExpiryNotification,
    collectSubscriptionExpirySnapshot,
    createSubscriptionExpiryNotifier,
} from '../lib/subscriptionExpiryNotifier.js';

test('collectSubscriptionExpirySnapshot summarizes upcoming and expired users', () => {
    const now = new Date('2026-03-16T00:00:00.000Z').getTime();
    const snapshot = collectSubscriptionExpirySnapshot({
        now,
        userStore: {
            getAll() {
                return [
                    { username: 'alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', role: 'user', enabled: true },
                    { username: 'bob', email: 'bob@example.com', subscriptionEmail: 'bob@example.com', role: 'user', enabled: true },
                    { username: 'carol', email: 'carol@example.com', subscriptionEmail: 'carol@example.com', role: 'user', enabled: false },
                ];
            },
        },
        policyStore: {
            get(email) {
                if (email === 'alice@example.com') {
                    return { expiryTime: now + (2 * 24 * 60 * 60 * 1000) };
                }
                if (email === 'bob@example.com') {
                    return { expiryTime: now - (2 * 60 * 60 * 1000) };
                }
                return { expiryTime: 0 };
            },
        },
    });

    assert.equal(snapshot.total, 2);
    assert.equal(snapshot.warningCount, 1);
    assert.equal(snapshot.expiredCount, 1);
    assert.deepEqual(snapshot.items.map((item) => item.stage), ['expired', '3d']);
});

test('subscriptionExpiryNotifier emits stage-based notifications without duplicates', () => {
    let now = new Date('2026-03-16T00:00:00.000Z').getTime();
    const expiryTime = now + (3 * 24 * 60 * 60 * 1000);
    const calls = [];
    const service = createSubscriptionExpiryNotifier({
        now: () => now,
        userStore: {
            getAll() {
                return [
                    { username: 'alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', role: 'user', enabled: true },
                ];
            },
        },
        policyStore: {
            get() {
                return { expiryTime };
            },
        },
        notificationService: {
            notify(payload) {
                calls.push(payload);
                return payload;
            },
        },
    });

    service.runOnce();
    service.runOnce();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'subscription_user_expiry_warning');
    assert.match(calls[0].body, /还有 3 天到期/);

    now += 2 * 24 * 60 * 60 * 1000;
    service.runOnce();
    assert.equal(calls.length, 2);
    assert.match(calls[1].body, /还有 1 天到期/);
});

test('subscriptionExpiryNotifier notifies every in-window user, not just the first 50', () => {
    const now = new Date('2026-03-16T00:00:00.000Z').getTime();
    // 60 users all inside the warning window — more than the old 50-item cap.
    const users = Array.from({ length: 60 }, (_, i) => ({
        username: `user${i}`,
        email: `user${i}@example.com`,
        subscriptionEmail: `user${i}@example.com`,
        role: 'user',
        enabled: true,
    }));
    const calls = [];
    const service = createSubscriptionExpiryNotifier({
        now: () => now,
        userStore: { getAll: () => users },
        policyStore: {
            // Stagger expiry so sort order is well-defined; all within 3 days.
            get(email) {
                const idx = Number(String(email).replace(/\D/g, '')) || 0;
                return { expiryTime: now + (2 * 24 * 60 * 60 * 1000) + idx * 1000 };
            },
        },
        notificationService: { notify: (p) => { calls.push(p); return p; } },
    });

    service.runOnce();
    assert.equal(calls.length, 60);
    // Second run with no stage change must not re-fire any (dedup intact for all).
    service.runOnce();
    assert.equal(calls.length, 60);
});

test('subscriptionExpiryNotifier attaches bilingual meta.localized and respects en-US locale', () => {
    const now = new Date('2026-03-16T00:00:00.000Z').getTime();
    const calls = [];
    const service = createSubscriptionExpiryNotifier({
        locale: 'en-US',
        now: () => now,
        userStore: {
            getAll() {
                return [
                    { username: 'alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', role: 'user', enabled: true },
                    { username: 'bob', email: 'bob@example.com', subscriptionEmail: 'bob@example.com', role: 'user', enabled: true },
                ];
            },
        },
        policyStore: {
            get(email) {
                if (email === 'alice@example.com') {
                    return { expiryTime: now + (24 * 60 * 60 * 1000) };
                }
                if (email === 'bob@example.com') {
                    return { expiryTime: now - (60 * 60 * 1000) };
                }
                return { expiryTime: 0 };
            },
        },
        notificationService: {
            notify(payload) {
                calls.push(payload);
                return payload;
            },
        },
    });

    service.runOnce();
    assert.equal(calls.length, 2);

    const expiredNotice = calls.find((item) => item.type === 'subscription_user_expired');
    assert.ok(expiredNotice);
    assert.equal(expiredNotice.title, 'User subscription expired');
    assert.match(expiredNotice.body, /^bob · bob@example\.com has expired\. Expiry time: /);
    assert.doesNotMatch(expiredNotice.title + expiredNotice.body, /[\u4e00-\u9fff]/);
    assert.equal(expiredNotice.meta.localized['zh-CN'].title, '用户订阅已到期');
    assert.match(expiredNotice.meta.localized['zh-CN'].body, /bob · bob@example\.com 已到期/);
    assert.equal(expiredNotice.meta.localized['en-US'].title, 'User subscription expired');
    assert.equal(expiredNotice.meta.localized['en-US'].body, expiredNotice.body);

    const warningNotice = calls.find((item) => item.type === 'subscription_user_expiry_warning');
    assert.ok(warningNotice);
    assert.equal(warningNotice.title, 'User subscription expiring soon');
    assert.match(warningNotice.body, /^alice · alice@example\.com expires in 1 day\. Expiry time: /);
    assert.doesNotMatch(warningNotice.title + warningNotice.body, /[\u4e00-\u9fff]/);
    assert.equal(warningNotice.meta.localized['zh-CN'].title, '用户订阅即将到期');
    assert.match(warningNotice.meta.localized['zh-CN'].body, /alice · alice@example\.com 还有 1 天到期/);
    assert.equal(warningNotice.meta.localized['en-US'].title, 'User subscription expiring soon');
    assert.equal(warningNotice.meta.localized['en-US'].body, warningNotice.body);

    const zhDefault = buildExpiryNotification({
        username: 'carol',
        email: 'carol@example.com',
        expiryTime: now + (3 * 24 * 60 * 60 * 1000),
        remainingDays: 3,
        stage: '3d',
    }, 'zh-CN');
    assert.equal(zhDefault.title, '用户订阅即将到期');
    assert.match(zhDefault.body, /还有 3 天到期/);
    assert.equal(zhDefault.meta.localized['en-US'].title, 'User subscription expiring soon');
    assert.match(zhDefault.meta.localized['en-US'].body, /expires in 3 days/);
});
