import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-subscription-sync-'));
process.on('exit', () => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
});
process.env.DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';

const {
    autoSetManagedClientsEnabled,
    migrateManagedSubscriptionEmail,
    provisionSubscriptionForUser,
    rotateManagedSubscriptionCredentials,
} = await import('../services/subscriptionSyncService.js');

describe('subscriptionSyncService', () => {
    it('toggles managed client enable status without deleting the client', async () => {
        const updates = [];
        const result = await autoSetManagedClientsEnabled('user@example.com', false, {}, {
            serverRepository: {
                list: () => [{ id: 'srv-1', name: 'Server 1' }],
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
                                email: 'user@example.com',
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
            postUpdateClient: async (panelClient, inboundId, clientIdentifier, clientData) => {
                updates.push({ inboundId, clientIdentifier, clientData });
                return { panelClient, inboundId, clientIdentifier, clientData };
            },
        });

        assert.equal(result.updated, 1);
        assert.equal(result.failed, 0);
        assert.equal(result.skipped, 0);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].inboundId, 101);
        assert.equal(updates[0].clientIdentifier, '11111111-1111-1111-1111-111111111111');
        assert.equal(updates[0].clientData.enable, false);
        assert.equal(result.details[0].status, 'disabled');
    });

    it('enables only clients that are still allowed by the current policy', async () => {
        const updates = [];
        const result = await autoSetManagedClientsEnabled('user@example.com', true, {
            policy: {
                serverScopeMode: 'selected',
                allowedServerIds: ['srv-1'],
                protocolScopeMode: 'selected',
                allowedProtocols: ['vless'],
                allowedInboundKeys: ['srv-1:101'],
            },
        }, {
            serverRepository: {
                list: () => [
                    { id: 'srv-1', name: 'Server 1' },
                    { id: 'srv-2', name: 'Server 2' },
                ],
            },
            listPanelInbounds: async (serverId) => {
                if (serverId === 'srv-1') {
                    return {
                        client: { post: async () => ({}) },
                        inbounds: [
                            {
                                id: 101,
                                protocol: 'vless',
                                enable: true,
                                remark: 'Inbound srv-1-allowed',
                                settings: JSON.stringify({
                                    clients: [{
                                        email: 'user@example.com',
                                        id: 'srv-1-client-allowed',
                                        enable: false,
                                        expiryTime: 0,
                                        limitIp: 0,
                                        totalGB: 0,
                                    }],
                                }),
                            },
                            {
                                id: 111,
                                protocol: 'vless',
                                enable: true,
                                remark: 'Inbound srv-1-blocked',
                                settings: JSON.stringify({
                                    clients: [{
                                        email: 'user@example.com',
                                        id: 'srv-1-client-blocked',
                                        enable: false,
                                        expiryTime: 0,
                                        limitIp: 0,
                                        totalGB: 0,
                                    }],
                                }),
                            },
                        ],
                    };
                }
                return {
                    client: { post: async () => ({}) },
                    inbounds: [
                        {
                            id: 202,
                            protocol: 'trojan',
                            enable: true,
                            remark: 'Inbound srv-2',
                            settings: JSON.stringify({
                                clients: [{
                                    email: 'user@example.com',
                                    id: 'srv-2-client',
                                    password: 'srv-2-password',
                                    enable: false,
                                    expiryTime: 0,
                                    limitIp: 0,
                                    totalGB: 0,
                                }],
                            }),
                        },
                    ],
                };
            },
            postUpdateClient: async (panelClient, inboundId, clientIdentifier, clientData) => {
                updates.push({ inboundId, clientIdentifier, clientData });
                return { panelClient, inboundId, clientIdentifier, clientData };
            },
        });

        assert.equal(result.updated, 1);
        assert.equal(result.skipped, 2);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].inboundId, 101);
        assert.equal(updates[0].clientData.enable, true);
        assert.equal(result.details[1].reason, 'inbound-not-allowed');
        assert.equal(result.details[2].reason, 'server-not-allowed');
    });

    it('migrates managed subscription email in place without rotating client credentials', async () => {
        const updates = [];
        const result = await migrateManagedSubscriptionEmail('user@example.com', 'user.new@example.com', {}, {
            serverRepository: {
                list: () => [{ id: 'srv-1', name: 'Server 1' }],
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
                                email: 'user@example.com',
                                id: '11111111-1111-1111-1111-111111111111',
                                subId: 'sub-a',
                                enable: true,
                                expiryTime: 0,
                                limitIp: 0,
                                totalGB: 0,
                            }],
                        }),
                    },
                    {
                        id: 102,
                        protocol: 'trojan',
                        enable: true,
                        remark: 'Inbound B',
                        settings: JSON.stringify({
                            clients: [{
                                email: 'user@example.com',
                                id: 'fallback-id',
                                password: 'trojan-pass',
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
                updates.push({ inboundId, clientIdentifier, clientData });
                return {};
            },
        });

        assert.equal(result.updated, 2);
        assert.equal(result.failed, 0);
        assert.equal(updates[0].clientIdentifier, '11111111-1111-1111-1111-111111111111');
        assert.equal(updates[0].clientData.id, '11111111-1111-1111-1111-111111111111');
        assert.equal(updates[0].clientData.subId, 'sub-a');
        assert.equal(updates[0].clientData.email, 'user.new@example.com');
        assert.equal(updates[1].clientIdentifier, 'trojan-pass');
        assert.equal(updates[1].clientData.password, 'trojan-pass');
        assert.equal(updates[1].clientData.email, 'user.new@example.com');
        assert.equal(result.details[0].status, 'migrated');
    });

    it('aborts migration when the target email already exists on an inbound', async () => {
        const updates = [];
        const result = await migrateManagedSubscriptionEmail('user@example.com', 'user.new@example.com', {}, {
            serverRepository: {
                list: () => [{ id: 'srv-1', name: 'Server 1' }],
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
                            clients: [
                                {
                                    email: 'user@example.com',
                                    id: '11111111-1111-1111-1111-111111111111',
                                    enable: true,
                                },
                                {
                                    email: 'user.new@example.com',
                                    id: '22222222-2222-2222-2222-222222222222',
                                    enable: true,
                                },
                            ],
                        }),
                    },
                ],
            }),
            postUpdateClient: async (_panelClient, inboundId, clientIdentifier, clientData) => {
                updates.push({ inboundId, clientIdentifier, clientData });
                return {};
            },
        });

        assert.equal(result.updated, 0);
        assert.equal(result.failed, 1);
        assert.equal(updates.length, 0);
        assert.equal(result.details[0].error, 'target-email-client-exists');
    });

    it('rotates managed client credentials and subId for matching clients', async () => {
        const updates = [];
        const result = await rotateManagedSubscriptionCredentials('user@example.com', {
            serverScopeMode: 'all',
            protocolScopeMode: 'all',
            allowedServerIds: [],
            allowedProtocols: [],
            expiryTime: 0,
            limitIp: 0,
            trafficLimitBytes: 0,
        }, {
            sharedCredentials: {
                uuid: '99999999-9999-9999-9999-999999999999',
                password: 'rotated-password',
                subId: 'rotated-sub-id',
            },
        }, {
            serverRepository: {
                list: () => [{ id: 'srv-1', name: 'Server 1' }],
            },
            overrideRepository: {
                get: () => null,
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
                                email: 'user@example.com',
                                id: '11111111-1111-1111-1111-111111111111',
                                subId: 'old-sub-id',
                                flow: '',
                                expiryTime: 0,
                                limitIp: 0,
                                totalGB: 0,
                            }],
                        }),
                    },
                ],
            }),
            postUpdateClient: async (panelClient, inboundId, clientIdentifier, clientData) => {
                updates.push({ inboundId, clientIdentifier, clientData });
                return { panelClient, inboundId, clientIdentifier, clientData };
            },
        });

        assert.equal(result.updated, 1);
        assert.equal(result.failed, 0);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].inboundId, 101);
        assert.equal(updates[0].clientIdentifier, '11111111-1111-1111-1111-111111111111');
        assert.equal(updates[0].clientData.id, '99999999-9999-9999-9999-999999999999');
        assert.equal(updates[0].clientData.subId, 'rotated-sub-id');
        assert.notEqual(updates[0].clientData.id, '11111111-1111-1111-1111-111111111111');
        assert.notEqual(updates[0].clientData.subId, 'old-sub-id');
        assert.equal(result.details[0].status, 'credentials-rotated');
    });

    it('provisions inbound-scoped policy before deploying managed clients', async () => {
        const policyWrites = [];
        const createdClients = [];
        const result = await provisionSubscriptionForUser({
            id: 'u-11',
            enabled: false,
            email: 'owner@example.com',
            subscriptionEmail: '',
        }, {
            subscriptionEmail: 'bind@example.com',
            allowedServerIds: ['srv-1'],
            allowedProtocols: ['vless'],
            allowedInboundKeys: ['srv-1:101'],
            expiryTime: 3600,
        }, 'admin', {
            userRepository: {
                setSubscriptionEmail(id, subscriptionEmail) {
                    return { id, subscriptionEmail };
                },
            },
            userPolicyRepository: {
                upsert(email, payload, actor) {
                    policyWrites.push({ email, payload, actor });
                    return { email, ...payload };
                },
            },
            serverRepository: {
                list() {
                    return [{ id: 'srv-1', name: 'Server 1' }];
                },
            },
            subscriptionTokenRepository: {
                getFirstActiveTokenByName() {
                    return {
                        metadata: { id: 'tok-1' },
                    };
                },
            },
            listPanelInbounds: async () => ({
                client: { post: async () => ({}) },
                inbounds: [
                    {
                        id: 101,
                        protocol: 'vless',
                        enable: true,
                        remark: 'Allowed inbound',
                        settings: JSON.stringify({ clients: [] }),
                    },
                    {
                        id: 102,
                        protocol: 'vless',
                        enable: true,
                        remark: 'Blocked inbound',
                        settings: JSON.stringify({ clients: [] }),
                    },
                ],
            }),
            postAddClient: async (panelClient, inboundId, clientData) => {
                createdClients.push({ inboundId, clientData });
                return { panelClient, inboundId, clientData };
            },
            postUpdateClient: async () => ({}),
            overrideRepository: {
                get() {
                    return null;
                },
            },
        });

        assert.equal(policyWrites.length, 1);
        assert.deepEqual(policyWrites[0].payload.allowedInboundKeys, ['srv-1:101']);
        assert.deepEqual(result.policy.allowedInboundKeys, ['srv-1:101']);
        assert.equal(result.deployment.created, 1);
        assert.equal(createdClients.length, 1);
        assert.equal(createdClients[0].inboundId, 101);
        assert.equal(createdClients[0].clientData.enable, false);
        assert.equal(result.subscription.email, 'bind@example.com');
    });
});
