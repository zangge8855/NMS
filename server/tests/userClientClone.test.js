import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import config from '../config.js';
import serverStore from '../store/serverStore.js';
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';
import {
    cloneUserClientOnServer,
    removeUserExtraClientBinding,
    updateUserExtraClientBinding,
} from '../services/userClientCloneService.js';
import { listUsers } from '../services/userAdminService.js';
import { collectByServer } from '../routes/subscriptions.js';
import { autoRemoveClients, autoSetManagedClientsEnabled } from '../services/subscriptionSyncService.js';

function createInMemoryRepos(initialUser, server, inbound) {
    let userState = {
        ...initialUser,
        extraClients: Array.isArray(initialUser.extraClients) ? [...initialUser.extraClients] : [],
    };
    const overrides = new Map();
    const addedPayloads = [];
    const deletedClients = [];

    const userRepository = {
        getById(id) {
            return id === userState.id ? { ...userState, extraClients: [...userState.extraClients] } : null;
        },
        listExtraClients(userId) {
            return userId === userState.id ? [...userState.extraClients] : [];
        },
        addExtraClient(userId, binding) {
            assert.equal(userId, userState.id);
            const record = {
                id: `extra-${userState.extraClients.length + 1}`,
                createdAt: '2026-04-01T00:00:00.000Z',
                ...binding,
            };
            userState.extraClients.push(record);
            return record;
        },
        updateExtraClient(userId, bindingId, patch) {
            assert.equal(userId, userState.id);
            const idx = userState.extraClients.findIndex((item) => item.id === bindingId);
            if (idx === -1) return null;
            userState.extraClients[idx] = { ...userState.extraClients[idx], ...patch };
            return userState.extraClients[idx];
        },
        removeExtraClient(userId, bindingId) {
            assert.equal(userId, userState.id);
            const idx = userState.extraClients.findIndex((item) => item.id === bindingId);
            if (idx === -1) return null;
            const [removed] = userState.extraClients.splice(idx, 1);
            return removed;
        },
    };

    const serverRepository = {
        getById(id) {
            return id === server.id ? server : null;
        },
    };

    const userPolicyRepository = {
        get() {
            return {
                trafficLimitBytes: 100 * 1024 * 1024 * 1024,
                expiryTime: 1800000000000,
                limitIp: 3,
                serverScopeMode: 'all',
                protocolScopeMode: 'all',
            };
        },
    };

    const userGroupRepository = {
        getById() {
            return null;
        },
    };

    const overrideRepository = {
        upsert(payload) {
            overrides.set(`${payload.serverId}:${payload.inboundId}:${payload.clientIdentifier}`, payload);
            return payload;
        },
        remove(serverId, inboundId, clientIdentifier) {
            overrides.delete(`${serverId}:${inboundId}:${clientIdentifier}`);
        },
    };

    const panelClients = JSON.parse(inbound.settings).clients;

    const listPanelInbounds = async () => ({
        client: { mockPanel: true },
        inbounds: [{
            ...inbound,
            settings: JSON.stringify({ clients: panelClients, decryption: 'none' }),
        }],
    });

    const postAddClient = async (_panelClient, inboundId, clientData) => {
        addedPayloads.push({ inboundId, clientData });
        panelClients.push(clientData);
        return { success: true };
    };

    const postDeleteClientFromInboundCompat = async (_panelClient, inboundId, clientId) => {
        deletedClients.push({ inboundId, clientId });
        const idx = panelClients.findIndex((c) => c.id === clientId || c.email === clientId);
        if (idx >= 0) panelClients.splice(idx, 1);
        return { success: true };
    };

    return {
        getUserState: () => userState,
        overrides,
        addedPayloads,
        deletedClients,
        deps: {
            userRepository,
            serverRepository,
            userPolicyRepository,
            userGroupRepository,
            overrideRepository,
            listPanelInbounds,
            postAddClient,
            postDeleteClientFromInboundCompat,
            invalidateServerPanelSnapshotCache: () => {},
            invalidatePublicSubCache: () => {},
        },
    };
}

test('cloneUserClientOnServer creates an independent client binding with its own traffic quota and supports update/remove', async () => {
    const server = { id: 'srv-jp', name: 'Tokyo 01', countryCode: 'JP', url: 'https://jp.example.com:2053' };
    const inbound = {
        id: 10,
        remark: 'VLESS-Reality',
        protocol: 'vless',
        port: 443,
        enable: true,
        settings: JSON.stringify({
            clients: [{
                id: '11111111-1111-1111-1111-111111111111',
                email: 'alice@example.com',
                enable: true,
                totalGB: 100 * 1024 * 1024 * 1024,
                expiryTime: 1800000000000,
                limitIp: 3,
            }],
        }),
        streamSettings: JSON.stringify({ network: 'tcp', security: 'reality' }),
    };
    const user = {
        id: 'u-1',
        username: 'alice',
        email: 'alice@example.com',
        subscriptionEmail: 'alice@example.com',
        enabled: true,
    };

    const ctx = createInMemoryRepos(user, server, inbound);

    // 1. First clone with independent 20 GB traffic quota
    const twentyGb = 20 * 1024 * 1024 * 1024;
    const first = await cloneUserClientOnServer('u-1', {
        serverId: 'srv-jp',
        inboundId: '10',
        nodeLabel: '纯净IP',
        trafficLimitBytes: twentyGb,
    }, 'admin', ctx.deps);

    assert.equal(first.binding.serverId, 'srv-jp');
    assert.equal(first.binding.inboundId, '10');
    assert.equal(first.binding.nodeLabel, '纯净IP');
    assert.equal(first.binding.clientEmail, 'alice@example.com-ip');
    assert.equal(ctx.addedPayloads.length, 1);
    assert.equal(ctx.addedPayloads[0].clientData.email, 'alice@example.com-ip');
    assert.equal(ctx.addedPayloads[0].clientData.totalGB, twentyGb);
    assert.equal(ctx.addedPayloads[0].clientData.flow, 'xtls-rprx-vision');
    assert.notEqual(ctx.addedPayloads[0].clientData.id, '11111111-1111-1111-1111-111111111111');
    assert.equal(
        ctx.overrides.get(`srv-jp:10:${first.clientIdentifier}`)?.trafficLimitBytes,
        twentyGb
    );

    // 2. Second clone on same inbound automatically picks a non-colliding suffix
    const second = await cloneUserClientOnServer('u-1', {
        serverId: 'srv-jp',
        inboundId: '10',
        nodeLabel: '纯净IP',
    }, 'admin', ctx.deps);
    assert.equal(second.binding.clientEmail, 'alice@example.com-ip2');
    assert.equal(ctx.getUserState().extraClients.length, 2);

    // 3. Explicit duplicate email is rejected with 409
    await assert.rejects(
        () => cloneUserClientOnServer('u-1', {
            serverId: 'srv-jp',
            inboundId: '10',
            nodeLabel: '重复',
            clientEmail: 'alice@example.com-ip',
        }, 'admin', ctx.deps),
        (err) => err.status === 409
    );

    // 4. Update nodeLabel on first binding
    const updated = updateUserExtraClientBinding('u-1', first.binding.id, { nodeLabel: '住宅IP' }, ctx.deps);
    assert.equal(updated.nodeLabel, '住宅IP');

    // 5. Remove first binding deletes panel client & removes user binding
    const removed = await removeUserExtraClientBinding('u-1', first.binding.id, ctx.deps);
    assert.equal(removed.panelRemoved, true);
    assert.equal(removed.removed.id, first.binding.id);
    assert.equal(ctx.deletedClients.length, 1);
    assert.equal(ctx.getUserState().extraClients.length, 1);
    assert.equal(ctx.overrides.has(`srv-jp:10:${first.clientIdentifier}`), false);
});

test('collectByServer outputs both primary server-IP node and cloned clean-IP node in one subscription', async () => {
    const mockInbounds = [{
        id: 10,
        remark: 'VLESS-443',
        protocol: 'vless',
        port: 443,
        listen: '0.0.0.0',
        enable: true,
        settings: JSON.stringify({
            clients: [
                {
                    id: '11111111-1111-1111-1111-111111111111',
                    email: 'alice@example.com',
                    enable: true,
                    totalGB: 100 * 1024 * 1024 * 1024,
                    expiryTime: 0,
                },
                {
                    id: '22222222-2222-2222-2222-222222222222',
                    email: 'alice@example.com-pure',
                    enable: true,
                    totalGB: 20 * 1024 * 1024 * 1024,
                    expiryTime: 0,
                },
            ],
            decryption: 'none',
        }),
        streamSettings: JSON.stringify({
            network: 'tcp',
            security: 'none',
        }),
        clientStats: [
            { email: 'alice@example.com', up: 100, down: 200, total: 100 * 1024 * 1024 * 1024 },
            { email: 'alice@example.com-pure', up: 300, down: 400, total: 20 * 1024 * 1024 * 1024 },
        ],
    }];

    const mockPanel = http.createServer((req, res) => {
        const urlPath = String(req.url || '').split('?')[0];
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST' && urlPath === '/login') {
            res.setHeader('Set-Cookie', '3x-ui=mock-cookie; Path=/');
            res.end(JSON.stringify({ success: true, msg: '' }));
            return;
        }
        if (req.method === 'GET' && urlPath === '/panel/api/inbounds/list') {
            res.end(JSON.stringify({ success: true, obj: mockInbounds }));
            return;
        }
        res.end(JSON.stringify({ success: true, obj: [] }));
    });

    const prevAllowPrivate = config.servers.allowPrivateServerUrl;
    let addedServer = null;
    try {
        config.servers.allowPrivateServerUrl = true;
        await new Promise((resolve) => mockPanel.listen(0, '127.0.0.1', resolve));
        const { port } = mockPanel.address();
        addedServer = serverStore.add({
            name: 'Tokyo 01',
            countryCode: 'JP',
            url: `http://127.0.0.1:${port}`,
            username: 'admin',
            password: 'password',
        });

        const result = await collectByServer(addedServer, 'alice@example.com', 'auto', {
            extraClients: [{
                id: 'extra-1',
                serverId: addedServer.id,
                inboundId: '10',
                clientEmail: 'alice@example.com-pure',
                nodeLabel: '纯净IP',
            }],
        });

        assert.equal(result.links.length, 2);
        const decodedTags = result.links.map((link) => decodeURIComponent(link.split('#')[1] || ''));
        assert.deepEqual(decodedTags, [
            '🇯🇵 VLESS-443',
            '🇯🇵 VLESS-443 - 纯净IP',
        ]);
        assert.ok(result.links[0].includes('11111111-1111-1111-1111-111111111111'));
        assert.ok(result.links[1].includes('22222222-2222-2222-2222-222222222222'));
        assert.equal(result.perServer.usedTrafficBytes, 1000);
    } finally {
        if (addedServer) {
            invalidateServerPanelSnapshotCache(addedServer.id);
            serverStore.remove(addedServer.id);
        }
        config.servers.allowPrivateServerUrl = prevAllowPrivate;
        await new Promise((resolve) => mockPanel.close(resolve));
    }
});

test('listUsers enriches users with effective policy trafficLimitBytes, expiryTime, and extraClients', () => {
    const users = listUsers({
        userRepository: {
            list() {
                return [{
                    id: 'u-1',
                    username: 'alice',
                    email: 'alice@example.com',
                    subscriptionEmail: 'alice@example.com',
                    role: 'user',
                    enabled: true,
                    groupId: 'grp-1',
                    extraClients: [{
                        id: 'extra-1',
                        serverId: 'srv-jp',
                        inboundId: '10',
                        clientEmail: 'alice@example.com-pure',
                        nodeLabel: '纯净IP',
                    }],
                }];
            },
        },
        userPolicyRepository: {
            get(email) {
                if (email === 'alice@example.com') {
                    return {
                        email,
                        inheritGroup: true,
                        trafficLimitBytes: 100 * 1024 * 1024 * 1024,
                        expiryTime: 1800000000000,
                    };
                }
                return null;
            },
        },
        userGroupRepository: {
            getById(id) {
                return id === 'grp-1' ? { id: 'grp-1', name: 'VIP' } : null;
            },
        },
    });

    assert.equal(users.length, 1);
    assert.equal(users[0].trafficLimitBytes, 100 * 1024 * 1024 * 1024);
    assert.equal(users[0].trafficLimit, 100 * 1024 * 1024 * 1024);
    assert.equal(users[0].expiryTime, 1800000000000);
    assert.equal(users[0].extraClients.length, 1);
    assert.equal(users[0].extraClients[0].nodeLabel, '纯净IP');
});

test('subscriptionSyncService preserves exact cloned email spelling when toggling and removing extra clients', async () => {
    const updatedEmails = [];
    const deletedUrls = [];
    const clients = [
        { id: 'uuid-main', email: 'Alice@Example.com', enable: true, totalGB: 100 },
        { id: 'uuid-pure', email: 'Alice@Example.com-Pure', enable: true, totalGB: 20 },
    ];
    const mockPanelClient = {
        post: async (url) => {
            deletedUrls.push(url);
            return { data: { success: true } };
        },
    };
    const deps = {
        serverRepository: {
            list() {
                return [{ id: 'srv-jp', name: 'Tokyo 01' }];
            },
        },
        listPanelInbounds: async () => ({
            client: mockPanelClient,
            inbounds: [{
                id: 10,
                protocol: 'vless',
                remark: 'VLESS',
                enable: true,
                settings: JSON.stringify({ clients }),
            }],
        }),
        postUpdateClient: async (_panelClient, _inboundId, _clientId, clientData) => {
            updatedEmails.push({ email: clientData.email, enable: clientData.enable, totalGB: clientData.totalGB });
        },
        overrideRepository: {
            remove() {},
        },
        invalidateServerPanelSnapshotCache: () => {},
    };

    const extraClients = [{
        id: 'extra-1',
        serverId: 'srv-jp',
        inboundId: '10',
        clientEmail: 'Alice@Example.com-Pure',
        nodeLabel: '纯净IP',
    }];

    const toggleSummary = await autoSetManagedClientsEnabled('alice@example.com', false, { extraClients }, deps);
    assert.equal(toggleSummary.updated, 2);
    assert.deepEqual(updatedEmails, [
        { email: 'Alice@Example.com', enable: false, totalGB: 100 },
        { email: 'Alice@Example.com-Pure', enable: false, totalGB: 20 },
    ]);

    const removeSummary = await autoRemoveClients('alice@example.com', { extraClients }, deps);
    assert.equal(removeSummary.removed, 2);
    assert.ok(deletedUrls.some((url) => url.includes('uuid-main')));
    assert.ok(deletedUrls.some((url) => url.includes('uuid-pure')));
});
