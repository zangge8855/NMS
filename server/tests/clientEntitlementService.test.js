import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listEntitlementOverrides, updateClientEntitlement } from '../services/clientEntitlementService.js';

describe('clientEntitlementService', () => {
    it('filters override list by server and inbound', () => {
        const items = listEntitlementOverrides(
            { serverId: 'srv-1', inboundId: '10' },
            {
                overrideRepository: {
                    list: ({ serverId, inboundId }) => [
                        { serverId, inboundId, clientIdentifier: 'a' },
                    ],
                },
            }
        );
        assert.deepEqual(items, [{ serverId: 'srv-1', inboundId: '10', clientIdentifier: 'a' }]);
    });

    it('applies follow_policy entitlement and clears override', async () => {
        const postCalls = [];
        const result = await updateClientEntitlement({
            serverId: 'srv-1',
            inboundId: '10',
            clientIdentifier: 'uuid-1',
            protocol: 'vless',
            mode: 'follow_policy',
            email: 'user@example.com',
        }, 'admin', {
            serverRepository: {
                getById: () => ({ id: 'srv-1', name: 'srv-1' }),
            },
            userPolicyRepository: {
                get: () => ({
                    expiryTime: 1000,
                    limitIp: 2,
                    trafficLimitBytes: 2048,
                }),
            },
            overrideRepository: {
                remove: (...args) => {
                    postCalls.push(['remove', ...args]);
                    return true;
                },
            },
            listPanelInbounds: async () => ({
                client: {
                    post: async (...args) => {
                        postCalls.push(['post', ...args]);
                        return { data: { success: true } };
                    },
                },
                inbounds: [{
                    id: '10',
                    protocol: 'vless',
                    settings: JSON.stringify({
                        clients: [{
                            id: 'uuid-1',
                            email: 'user@example.com',
                            expiryTime: 0,
                            limitIp: 0,
                            totalGB: 0,
                        }],
                    }),
                }],
            }),
        });

        assert.equal(result.overrideActive, false);
        assert.deepEqual(result.entitlement, {
            expiryTime: 1000,
            limitIp: 2,
            trafficLimitBytes: 2048,
        });
        assert.equal(postCalls[0][0], 'post');
        assert.equal(postCalls[1][0], 'remove');
    });
});
