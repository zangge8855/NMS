import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adminResetUserPassword,
    buildManagedUserSyncJobPayload,
    buildUsersCsv,
    bulkSetUsersEnabled,
    createManagedUser,
    deleteManagedUser,
    provisionManagedUserSubscription,
    resyncManagedUserNodes,
    setManagedUserEnabled,
    syncAddedInboundsToExistingUsers,
    updateManagedUser,
    updateManagedUserExpiry,
    updateManagedUserPolicyByEmail,
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

test('syncAddedInboundsToExistingUsers only deploys to policy-eligible users', async () => {
    const deployments = [];
    const result = await syncAddedInboundsToExistingUsers(
        [
            {
                serverId: 'srv-1',
                serverName: 'Node A',
                inboundId: 101,
                inboundRemark: 'Premium A',
                protocol: 'vless',
                port: 443,
            },
        ],
        'ops',
        {
            userRepository: {
                list() {
                    return [
                        { id: 'u-1', username: 'alice', role: 'user', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true },
                        { id: 'u-2', username: 'bob', role: 'user', email: 'bob@example.com', subscriptionEmail: 'bob@example.com', enabled: true },
                        { id: 'u-3', username: 'cara', role: 'user', email: 'cara@example.com', subscriptionEmail: 'cara@example.com', enabled: false },
                        { id: 'admin-1', username: 'root', role: 'admin', email: 'root@example.com', subscriptionEmail: 'root@example.com', enabled: true },
                    ];
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1', name: 'Node A' }];
                },
            },
            userPolicyRepository: {
                get(email) {
                    if (email === 'alice@example.com') {
                        return {
                            serverScopeMode: 'selected',
                            allowedServerIds: ['srv-1'],
                            protocolScopeMode: 'selected',
                            allowedProtocols: ['vless'],
                            allowedInboundKeys: [],
                        };
                    }
                    if (email === 'bob@example.com') {
                        return {
                            serverScopeMode: 'selected',
                            allowedServerIds: ['srv-1'],
                            protocolScopeMode: 'selected',
                            allowedProtocols: ['vless'],
                            allowedInboundKeys: ['srv-1:old'],
                        };
                    }
                    return {
                        serverScopeMode: 'selected',
                        allowedServerIds: ['srv-1'],
                        protocolScopeMode: 'selected',
                        allowedProtocols: ['trojan'],
                        allowedInboundKeys: [],
                    };
                },
            },
            autoDeployClients: async (email, policy, options) => {
                deployments.push({ email, policy, options });
                return { total: 1, created: 1, updated: 0, skipped: 0, failed: 0, details: [] };
            },
        }
    );

    assert.equal(result.requestedInboundCount, 1);
    assert.equal(result.totalUsers, 3);
    assert.equal(result.eligibleUsers, 1);
    assert.equal(result.syncedUsers, 1);
    assert.equal(result.skippedUsers, 2);
    assert.equal(result.failedUsers, 0);
    assert.equal(result.created, 1);
    assert.deepEqual(deployments, [
        {
            email: 'alice@example.com',
            policy: {
                serverScopeMode: 'selected',
                allowedServerIds: ['srv-1'],
                protocolScopeMode: 'selected',
                allowedProtocols: ['vless'],
                allowedInboundKeys: [],
            },
            options: {
                allServers: [{ id: 'srv-1', name: 'Node A' }],
                allowedInboundKeys: ['srv-1:101'],
                clientEnabled: true,
            },
        },
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
            autoSetManagedClientsEnabled: async (email, enabled, options) => {
                events.push(`toggle:${email}:${enabled}:${(options?.emailAliases || []).join(',')}`);
                return { updated: 1 };
            },
            userPolicyRepository: {
                get(email) {
                    assert.equal(email, 'sub@example.com');
                    return { expiryTime: 1 };
                },
            },
            autoDeployClients: async (email, _policy, options) => {
                events.push(`deploy:${email}:${(options?.emailAliases || []).join(',')}`);
                return { updated: 1 };
            },
            ensurePersistentSubscriptionToken: (email, actor) => {
                events.push(`token:${email}:${actor}`);
            },
        }
    );

    assert.equal(result.enabled, true);
    assert.deepEqual(events, [
        'toggle:sub@example.com:true:eve@example.com',
        'deploy:sub@example.com:eve@example.com',
        'token:sub@example.com:admin',
    ]);
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
            autoSetManagedClientsEnabled: async (email, enabled, options) => {
                events.push(`toggle:${email}:${enabled}:${(options?.emailAliases || []).join(',')}`);
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
    assert.deepEqual(events, ['policy:get', 'toggle:sub@example.com:false:kate@example.com']);
});

test('buildManagedUserSyncJobPayload flattens sync details for retry history', () => {
    const payload = buildManagedUserSyncJobPayload({
        operation: 'set_enabled',
        target: { id: 'u-9', username: 'nina' },
        subscriptionEmail: 'nina@example.com',
        enabled: true,
        clientSync: {
            details: [
                {
                    serverId: 'srv-1',
                    serverName: 'Node A',
                    inboundId: 101,
                    inboundRemark: 'Inbound A',
                    protocol: 'vless',
                    status: 'failed',
                    error: 'Auth failed',
                },
            ],
        },
        deployment: {
            details: [
                {
                    serverId: 'srv-2',
                    serverName: 'Node B',
                    inboundId: 202,
                    inboundRemark: 'Inbound B',
                    protocol: 'trojan',
                    status: 'updated',
                },
            ],
        },
    });

    assert.equal(payload.action, 'set_enabled');
    assert.equal(payload.output.summary.total, 2);
    assert.equal(payload.output.summary.failed, 1);
    assert.equal(payload.requestSnapshot.userId, 'u-9');
    assert.equal(payload.output.results[0].stage, 'client_toggle');
    assert.equal(payload.output.results[0].success, false);
    assert.equal(payload.output.results[1].stage, 'client_deploy');
    assert.equal(payload.output.results[1].success, true);
});

test('updateManagedUser auto-follows login email and migrates managed subscription state without rotating credentials', async () => {
    const calls = [];
    const result = await updateManagedUser(
        'u-10',
        {
            username: 'alice',
            email: 'alice.new@example.com',
        },
        'ops',
        {
            userRepository: {
                getById() {
                    return {
                        id: 'u-10',
                        username: 'alice',
                        email: 'alice@example.com',
                        subscriptionEmail: 'alice@example.com',
                        role: 'user',
                    };
                },
                getByUsername() {
                    return { id: 'u-10' };
                },
                getByEmail() {
                    return null;
                },
                getBySubscriptionEmail() {
                    return null;
                },
                update(id, data) {
                    calls.push({ type: 'user:update', id, data });
                    return {
                        id,
                        username: data.username,
                        email: data.email,
                        subscriptionEmail: data.subscriptionEmail,
                        role: 'user',
                        enabled: true,
                    };
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1', name: 'Node A' }];
                },
            },
            listPanelInbounds: async () => ({
                client: { post: async () => ({}) },
                inbounds: [
                    {
                        id: 101,
                        protocol: 'vless',
                        enable: true,
                        remark: 'Inbound A',
                        settings: JSON.stringify({
                            clients: [{
                                email: 'alice@example.com',
                                id: '11111111-1111-1111-1111-111111111111',
                                enable: true,
                                expiryTime: 0,
                                limitIp: 0,
                                totalGB: 0,
                            }],
                        }),
                    },
                ],
            }),
            postUpdateClient: async (_panelClient, inboundId, clientIdentifier, clientData) => {
                calls.push({ type: 'client:update', inboundId, clientIdentifier, clientData });
                return {};
            },
            userPolicyRepository: {
                reassignEmail(fromEmail, toEmail, actor) {
                    calls.push({ type: 'policy:reassign', fromEmail, toEmail, actor });
                    return {
                        moved: true,
                        fromEmail,
                        toEmail,
                        policy: { email: toEmail },
                    };
                },
            },
            subscriptionTokenRepository: {
                reassignEmail(fromEmail, toEmail) {
                    calls.push({ type: 'token:reassign', fromEmail, toEmail });
                    return {
                        moved: 1,
                        fromEmail,
                        toEmail,
                        tokenIds: ['tok-1'],
                        publicTokenIds: ['pub-1'],
                    };
                },
            },
        }
    );

    assert.equal(result.user.email, 'alice.new@example.com');
    assert.equal(result.user.subscriptionEmail, 'alice.new@example.com');
    assert.equal(result.subscriptionMigration.updated, 1);
    assert.equal(calls[0].type, 'client:update');
    assert.equal(calls[0].clientIdentifier, '11111111-1111-1111-1111-111111111111');
    assert.equal(calls[0].clientData.id, '11111111-1111-1111-1111-111111111111');
    assert.equal(calls[0].clientData.email, 'alice.new@example.com');
    assert.deepEqual(
        calls.slice(1).map((item) => item.type),
        ['policy:reassign', 'token:reassign', 'user:update']
    );
    assert.equal(calls[3].data.subscriptionEmail, 'alice.new@example.com');
});

test('updateManagedUser rolls back client email migration when policy migration fails', async () => {
    const updates = [];
    let clientEmail = 'alice@example.com';
    await assert.rejects(
        updateManagedUser(
            'u-11',
            {
                subscriptionEmail: 'alice.new@example.com',
            },
            'ops',
            {
                userRepository: {
                    getById() {
                        return {
                            id: 'u-11',
                            username: 'alice',
                            email: 'alice@example.com',
                            subscriptionEmail: 'alice@example.com',
                            role: 'user',
                        };
                    },
                    getBySubscriptionEmail() {
                        return null;
                    },
                    update() {
                        throw new Error('should-not-update-user');
                    },
                },
                serverRepository: {
                    list() {
                        return [{ id: 'srv-1', name: 'Node A' }];
                    },
                },
                listPanelInbounds: async () => ({
                    client: { post: async () => ({}) },
                    inbounds: [
                        {
                            id: 101,
                            protocol: 'vless',
                            enable: true,
                            remark: 'Inbound A',
                            settings: JSON.stringify({
                                clients: [{
                                    email: clientEmail,
                                    id: '11111111-1111-1111-1111-111111111111',
                                    enable: true,
                                    expiryTime: 0,
                                    limitIp: 0,
                                    totalGB: 0,
                                }],
                            }),
                        },
                    ],
                }),
                postUpdateClient: async (_panelClient, _inboundId, _clientIdentifier, clientData) => {
                    clientEmail = clientData.email;
                    updates.push(clientData.email);
                    return {};
                },
                userPolicyRepository: {
                    reassignEmail() {
                        throw new Error('policy-conflict');
                    },
                },
                subscriptionTokenRepository: {
                    reassignEmail() {
                        throw new Error('should-not-reassign-token');
                    },
                },
            }
        ),
        /policy-conflict/
    );

    assert.deepEqual(updates, ['alice.new@example.com', 'alice@example.com']);
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
                steps.push(`deploy:${email}:${policy.expiryTime}:${options.clientEnabled}`);
                return { updated: 2, failed: 0 };
            },
        }
    );

    assert.equal(result.expiryTime, 7200);
    assert.deepEqual(steps, [
        'upsert:tom@example.com:7200:alice',
        'deploy:tom@example.com:7200:true',
    ]);
});

test('updateManagedUserPolicyByEmail saves policy on the subscription email and resyncs managed clients', async () => {
    const steps = [];
    const result = await updateManagedUserPolicyByEmail(
        'legacy@example.com',
        {
            allowedServerIds: ['srv-2'],
            allowedProtocols: ['trojan'],
            serverScopeMode: 'selected',
            protocolScopeMode: 'selected',
            limitIp: 3,
            trafficLimitBytes: 1024,
        },
        'alice',
        {
            userRepository: {
                getBySubscriptionEmail() {
                    return null;
                },
                getByEmail(email) {
                    assert.equal(email, 'legacy@example.com');
                    return {
                        id: 'u-14',
                        username: 'policy-user',
                        role: 'user',
                        enabled: true,
                        email: 'legacy@example.com',
                        subscriptionEmail: 'bound@example.com',
                    };
                },
            },
            userPolicyRepository: {
                get(email) {
                    assert.equal(email, 'bound@example.com');
                    return {
                        allowedInboundKeys: ['srv-1:101', 'srv-2:202'],
                        limitIp: 1,
                        trafficLimitBytes: 0,
                    };
                },
                upsert(email, payload, actor) {
                    steps.push(`upsert:${email}:${payload.serverScopeMode}:${payload.protocolScopeMode}:${actor}`);
                    assert.deepEqual(payload.allowedInboundKeys, ['srv-1:101', 'srv-2:202']);
                    return {
                        email,
                        ...payload,
                    };
                },
                remove(email) {
                    steps.push(`remove:${email}`);
                    return true;
                },
            },
            serverRepository: {
                list() {
                    return [
                        { id: 'srv-1', name: 'Node A' },
                        { id: 'srv-2', name: 'Node B' },
                    ];
                },
            },
            autoSetManagedClientsEnabled: async (email, enabled, options) => {
                steps.push(`toggle:${email}:${enabled}:${options.allServers.length}`);
                return { total: 2, updated: 2, skipped: 0, failed: 0, details: [] };
            },
            autoDeployClients: async (email, policy, options) => {
                steps.push(`deploy:${email}:${policy.allowedServerIds.join(',')}:${policy.allowedProtocols.join(',')}:${options.clientEnabled}`);
                assert.deepEqual(options.allowedInboundKeys, ['srv-1:101', 'srv-2:202']);
                return { total: 1, created: 0, updated: 1, skipped: 0, failed: 0, details: [] };
            },
        }
    );

    assert.equal(result.subscriptionEmail, 'bound@example.com');
    assert.equal(result.partialFailure, false);
    assert.deepEqual(steps, [
        'upsert:bound@example.com:selected:selected:alice',
        'remove:legacy@example.com',
        'toggle:bound@example.com:false:2',
        'deploy:bound@example.com:srv-2:trojan:true',
    ]);
});

test('resyncManagedUserNodes scopes retry to selected failed servers and inbounds', async () => {
    const toggleCalls = [];
    const deployCalls = [];

    const result = await resyncManagedUserNodes(
        'u-10',
        {
            operation: 'set_enabled',
            includeToggle: true,
            includeDeploy: true,
            targetServerIds: ['srv-2'],
            targetInboundKeys: ['srv-2:202'],
        },
        'alice',
        {
            userRepository: {
                getById() {
                    return {
                        id: 'u-10',
                        username: 'iris',
                        role: 'user',
                        enabled: true,
                        email: 'iris@example.com',
                        subscriptionEmail: 'sub@example.com',
                    };
                },
            },
            serverRepository: {
                list() {
                    return [
                        { id: 'srv-1', name: 'Node A' },
                        { id: 'srv-2', name: 'Node B' },
                    ];
                },
            },
            userPolicyRepository: {
                get(email) {
                    assert.equal(email, 'sub@example.com');
                    return {
                        serverScopeMode: 'selected',
                        allowedServerIds: ['srv-1', 'srv-2'],
                        protocolScopeMode: 'selected',
                        allowedProtocols: ['vless'],
                        allowedInboundKeys: ['srv-1:101', 'srv-2:202'],
                    };
                },
            },
            autoSetManagedClientsEnabled: async (email, enabled, options) => {
                toggleCalls.push({ email, enabled, options });
                return { total: 1, updated: 1, skipped: 0, failed: 0, details: [] };
            },
            autoDeployClients: async (email, policy, options) => {
                deployCalls.push({ email, policy, options });
                return { total: 1, created: 0, updated: 1, skipped: 0, failed: 0, details: [] };
            },
        }
    );

    assert.equal(result.subscriptionEmail, 'sub@example.com');
    assert.equal(toggleCalls.length, 1);
    assert.deepEqual(toggleCalls[0].options.allServers, [{ id: 'srv-2', name: 'Node B' }]);
    assert.deepEqual(toggleCalls[0].options.policy.allowedInboundKeys, ['srv-2:202']);
    assert.equal(deployCalls.length, 1);
    assert.deepEqual(deployCalls[0].policy.allowedInboundKeys, ['srv-2:202']);
    assert.deepEqual(deployCalls[0].options.allowedInboundKeys, ['srv-2:202']);
    assert.deepEqual(deployCalls[0].options.allServers, [{ id: 'srv-2', name: 'Node B' }]);
});

test('resyncManagedUserNodes honors explicit stage flags for set_enabled retries', async () => {
    let toggleCalls = 0;
    let deployCalls = 0;

    const result = await resyncManagedUserNodes(
        'u-12',
        {
            operation: 'set_enabled',
            includeToggle: true,
            includeDeploy: false,
        },
        'alice',
        {
            userRepository: {
                getById() {
                    return {
                        id: 'u-12',
                        username: 'maya',
                        role: 'user',
                        enabled: true,
                        email: 'maya@example.com',
                        subscriptionEmail: 'sub@example.com',
                    };
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1', name: 'Node A' }];
                },
            },
            userPolicyRepository: {
                get() {
                    return {
                        serverScopeMode: 'selected',
                        allowedServerIds: ['srv-1'],
                        protocolScopeMode: 'selected',
                        allowedProtocols: ['vless'],
                        allowedInboundKeys: ['srv-1:101'],
                    };
                },
            },
            autoSetManagedClientsEnabled: async () => {
                toggleCalls += 1;
                return { total: 1, updated: 1, skipped: 0, failed: 0, details: [] };
            },
            autoDeployClients: async () => {
                deployCalls += 1;
                return { total: 1, created: 0, updated: 1, skipped: 0, failed: 0, details: [] };
            },
        }
    );

    assert.equal(result.clientSync.updated, 1);
    assert.equal(result.deployment.total, 0);
    assert.equal(toggleCalls, 1);
    assert.equal(deployCalls, 0);
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
