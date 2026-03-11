import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join(__dirname, '.test_data');
process.env.NODE_ENV = 'test';

const { rotateManagedSubscriptionCredentials } = await import('../services/subscriptionSyncService.js');

describe('subscriptionSyncService', () => {
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
});
