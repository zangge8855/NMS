import test from 'node:test';
import assert from 'node:assert/strict';
import serverTelemetryStore from '../store/serverTelemetryStore.js';

test('serverTelemetryStore confirms single retryable offline samples before showing offline', () => {
    const originalSamples = JSON.parse(JSON.stringify(serverTelemetryStore.samplesByServerId || {}));
    const now = Date.now();

    try {
        serverTelemetryStore.pendingOfflineByServerId.clear();
        serverTelemetryStore.samplesByServerId = {
            'srv-telemetry': [{
                ts: new Date(now - 120_000).toISOString(),
                serverName: 'Node Telemetry',
                online: true,
                latencyMs: 24,
                health: 'healthy',
                reasonCode: 'none',
            }],
        };

        serverTelemetryStore.recordSnapshot({
            items: [{
                serverId: 'srv-telemetry',
                name: 'Node Telemetry',
                online: false,
                latencyMs: 30000,
                health: 'unreachable',
                reasonCode: 'connect_timeout',
                checkedAt: new Date(now - 60_000).toISOString(),
            }],
        });

        let overview = serverTelemetryStore.getOverview({
            servers: [{ id: 'srv-telemetry', name: 'Node Telemetry' }],
            hours: 24,
            points: 4,
        });
        assert.equal(overview.byServerId['srv-telemetry'].current.online, true);

        serverTelemetryStore.recordSnapshot({
            items: [{
                serverId: 'srv-telemetry',
                name: 'Node Telemetry',
                online: false,
                latencyMs: 30000,
                health: 'unreachable',
                reasonCode: 'connect_timeout',
                checkedAt: new Date(now).toISOString(),
            }],
        });

        overview = serverTelemetryStore.getOverview({
            servers: [{ id: 'srv-telemetry', name: 'Node Telemetry' }],
            hours: 24,
            points: 4,
        });
        assert.equal(overview.byServerId['srv-telemetry'].current.online, false);
        assert.equal(overview.byServerId['srv-telemetry'].current.reasonCode, 'connect_timeout');
    } finally {
        serverTelemetryStore.pendingOfflineByServerId.clear();
        serverTelemetryStore.samplesByServerId = originalSamples;
        serverTelemetryStore.persist();
    }
});
