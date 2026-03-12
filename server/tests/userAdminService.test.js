import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adminResetUserPassword,
    buildUsersCsv,
    bulkSetUsersEnabled,
    createManagedUser,
    deleteManagedUser,
    provisionManagedUserSubscription,
    setManagedUserEnabled,
    updateManagedUserExpiry,
} from '../services/userAdminService.js';

test('createManagedUser creates a verified enabled user', () => {
    const calls = [];
    const repo = {
        add(payload) {
            calls.push(payload);
            return { id: 'u-1', username: payload.username, subscriptionEmail: payload.subscriptionEmail };
        },
    };

    const result = createManagedUser(
        {
            username: 'newuser',
            password: 'StrongPass123!',
            role: 'user',
            email: 'new@example.com',
        },
        { userRepository: repo }
    );

    assert.equal(result.user.id, 'u-1');
    assert.equal(calls[0].emailVerified, true);
    assert.equal(calls[0].enabled, true);
});

test('bulkSetUsersEnabled aggregates per-user results and delegates sync behavior', async () => {
    const calls = [];
    const result = await bulkSetUsersEnabled(
        { userIds: ['ok', 'missing'], enabled: true },
        'admin',
        {
            setManagedUserEnabled: async (id, payload, actor) => {
                calls.push({ id, payload, actor });
                if (id === 'missing') {
                    throw new Error('用户不存在');
                }
                return { enabled: payload.enabled };
            },
        }
    );

    assert.equal(result.successCount, 1);
    assert.equal(result.results[1].msg, '用户不存在');
    assert.deepEqual(calls, [
        { id: 'ok', payload: { enabled: true }, actor: 'admin' },
        { id: 'missing', payload: { enabled: true }, actor: 'admin' },
    ]);
});

test('buildUsersCsv renders escaped csv rows', () => {
    const csv = buildUsersCsv({
        userRepository: {
            list() {
                return [{
                    id: 'u-2',
                    username: 'name"quoted',
                    email: 'a@example.com',
                    subscriptionEmail: 'b@example.com',
                    role: 'user',
                    enabled: true,
                    emailVerified: true,
                    createdAt: '2026-03-09T00:00:00.000Z',
                    lastLoginAt: '',
                }];
            },
        },
    });

    assert.match(csv, /"name""quoted"/);
    assert.match(csv, /订阅邮箱/);
});

test('setManagedUserEnabled restores clients for enabled users with policy', async () => {
    const events = [];
    const result = await setManagedUserEnabled(
        'u-3',
        { enabled: true },
        'admin',
        {
            userRepository: {
                getById() {
                    return { id: 'u-3', username: 'eve', role: 'user', email: 'eve@example.com', subscriptionEmail: 'sub@example.com' };
                },
                setEnabled() {
                    return { id: 'u-3', enabled: true };
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1' }];
                },
            },
            autoSetManagedClientsEnabled: async (email, enabled) => {
                events.push(`toggle:${email}:${enabled}`);
                return { updated: 1 };
            },
            userPolicyRepository: {
                get(email) {
                    assert.equal(email, 'sub@example.com');
                    return { expiryTime: 1 };
                },
            },
            autoDeployClients: async (email) => {
                events.push(`deploy:${email}`);
                return { updated: 1 };
            },
            ensurePersistentSubscriptionToken: (email, actor) => {
                events.push(`token:${email}:${actor}`);
            },
        }
    );

    assert.equal(result.enabled, true);
    assert.deepEqual(events, ['toggle:sub@example.com:true', 'deploy:sub@example.com', 'token:sub@example.com:admin']);
});

test('setManagedUserEnabled disables managed clients without removing them or revoking tokens', async () => {
    const events = [];
    const result = await setManagedUserEnabled(
        'u-8',
        { enabled: false },
        'admin',
        {
            userRepository: {
                getById() {
                    return { id: 'u-8', username: 'kate', role: 'user', email: 'kate@example.com', subscriptionEmail: 'sub@example.com' };
                },
                setEnabled() {
                    return { id: 'u-8', enabled: false };
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1' }];
                },
            },
            userPolicyRepository: {
                get() {
                    events.push('policy:get');
                    return { expiryTime: 1 };
                },
            },
            autoSetManagedClientsEnabled: async (email, enabled) => {
                events.push(`toggle:${email}:${enabled}`);
                return { updated: 2 };
            },
            autoRemoveClients: async () => {
                events.push('remove:called');
                return { removed: 1 };
            },
            subscriptionTokenRepository: {
                revokeAllByEmail() {
                    events.push('revoke:called');
                    return 1;
                },
            },
        }
    );

    assert.equal(result.enabled, false);
    assert.deepEqual(events, ['policy:get', 'toggle:sub@example.com:false']);
});

test('updateManagedUserExpiry writes policy then deploys clients', async () => {
    const steps = [];
    const result = await updateManagedUserExpiry(
        'u-4',
        { expiryTime: 7200 },
        'alice',
        {
            userRepository: {
                getById() {
                    return { id: 'u-4', username: 'tom', role: 'user', email: 'tom@example.com', subscriptionEmail: 'tom@example.com' };
                },
            },
            userPolicyRepository: {
                get() {
                    return { limitIp: 1 };
                },
                upsert(email, payload, actor) {
                    steps.push(`upsert:${email}:${payload.expiryTime}:${actor}`);
                    return payload;
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1' }];
                },
            },
            autoDeployClients: async (email, policy, options) => {
                steps.push(`deploy:${email}:${policy.expiryTime}:${options.expiryTime}`);
                return { updated: 2, failed: 0 };
            },
        }
    );

    assert.equal(result.expiryTime, 7200);
    assert.deepEqual(steps, [
        'upsert:tom@example.com:7200:alice',
        'deploy:tom@example.com:7200:7200',
    ]);
});

test('provisionManagedUserSubscription validates and delegates to sync service', async () => {
    const result = await provisionManagedUserSubscription(
        'u-5',
        { subscriptionEmail: 'bind@example.com' },
        'admin',
        {
            userRepository: {
                getById() {
                    return { id: 'u-5', username: 'zoe', role: 'user', email: 'zoe@example.com', subscriptionEmail: '' };
                },
            },
            provisionSubscriptionForUser: async (target, payload, actor) => ({
                user: { id: target.id },
                policy: {},
                subscription: {},
                deployment: {},
                context: { subscriptionEmail: payload.subscriptionEmail, allowedServerIds: [], allowedProtocols: [], expiryTime: 0, limitIp: 0, trafficLimitBytes: 0, tokenState: { autoIssued: false, issueError: '' } },
            }),
        }
    );

    assert.equal(result.target.username, 'zoe');
    assert.equal(result.context.subscriptionEmail, 'bind@example.com');
});

test('adminResetUserPassword clears reset state after updating password', () => {
    const updated = [];
    const cleared = [];
    const result = adminResetUserPassword(
        'u-6',
        { newPassword: 'AdminReset123!' },
        {
            userRepository: {
                getById() {
                    return { id: 'u-6', username: 'mike' };
                },
                update(id, payload) {
                    updated.push({ id, payload });
                    return { id, username: 'mike' };
                },
                clearPasswordResetCode(id) {
                    cleared.push(id);
                },
            },
        }
    );

    assert.equal(result.target.username, 'mike');
    assert.deepEqual(updated, [{ id: 'u-6', payload: { password: 'AdminReset123!' } }]);
    assert.deepEqual(cleared, ['u-6']);
});

test('deleteManagedUser revokes tokens, removes policies, and cleans up clients', async () => {
    const removals = [];
    const result = await deleteManagedUser(
        'u-7',
        {
            userRepository: {
                getById() {
                    return { id: 'u-7', username: 'nina', role: 'user', email: 'nina@example.com', subscriptionEmail: 'sub@example.com' };
                },
                remove() {
                    return true;
                },
            },
            userPolicyRepository: {
                remove(email) {
                    removals.push(`policy:${email}`);
                    return true;
                },
            },
            subscriptionTokenRepository: {
                revokeAllByEmail(email) {
                    removals.push(`token:${email}`);
                    return 1;
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1' }];
                },
            },
            autoRemoveClients: async (email) => {
                removals.push(`client:${email}`);
                return { total: 1, removed: 1, failed: 0 };
            },
        }
    );

    assert.equal(result.revokedTokenCount, 2);
    assert.deepEqual(removals, [
        'token:nina@example.com',
        'policy:nina@example.com',
        'token:sub@example.com',
        'policy:sub@example.com',
        'client:nina@example.com',
        'client:sub@example.com',
    ]);
});
