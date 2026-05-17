import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilitiesPayload, detectToolCapabilities } from '../routes/capabilities.js';

describe('capabilities payload alignment', () => {
    it('canonicalizes legacy inbound protocol names in the response payload', () => {
        const payload = buildCapabilitiesPayload({
            serverId: 'node-a',
            status: { online: true },
            inbounds: [
                { protocol: 'dokodemo-door' },
                { protocol: 'tunnel' },
                { protocol: 'socks' },
                { protocol: 'mixed' },
            ],
            xrayVersions: ['1.8.24'],
            tools: {},
        });

        assert.deepEqual(payload.protocols, ['mixed', 'tunnel']);
        assert.deepEqual(payload.protocolDetails, [
            { key: 'mixed', label: 'Mixed', legacyKeys: ['socks'] },
            { key: 'tunnel', label: 'Tunnel', legacyKeys: ['dokodemo-door'] },
        ]);
    });

    it('exposes integrated and guided-only 3x-ui capability states', () => {
        const payload = buildCapabilitiesPayload({
            serverId: 'node-b',
            status: null,
            inbounds: [],
            xrayVersions: [],
            tools: {},
        });

        const databaseManagement = payload.systemModules.find((item) => item.key === 'databaseManagement');
        const telegramBot = payload.systemModules.find((item) => item.key === 'telegramBot');

        assert.equal(databaseManagement?.status, 'integrated');
        assert.equal(databaseManagement?.supportedByNms, true);
        assert.equal(telegramBot?.status, 'integrated');
        assert.equal(telegramBot?.supportedByNms, true);
    });

    it('probes current 3x-ui log capabilities with POST', async () => {
        const calls = [];
        const tools = await detectToolCapabilities(async (request) => {
            calls.push([request.method, request.url]);
            return { data: { success: true } };
        });

        assert.equal(tools.panelLogs.method, 'post');
        assert.equal(tools.xrayLogs.method, 'post');
        assert.deepEqual(
            calls.filter(([, url]) => url.includes('/logs/')),
            [['post', '/panel/api/server/logs/20']]
        );
        assert.deepEqual(
            calls.filter(([, url]) => url.includes('/xraylogs/')),
            [['post', '/panel/api/server/xraylogs/20']]
        );
    });
});
