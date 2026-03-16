import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
