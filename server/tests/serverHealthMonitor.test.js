import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerHealthMonitor } from '../lib/serverHealthMonitor.js';

test('serverHealthMonitor records healthy results and emits recovery alert on transition', async () => {
    const monitor = new ServerHealthMonitor();
    const notifications = [];
    const updates = [];
    let phase = 'unreachable';

    const deps = {
        listServers: async () => [{
            id: 'srv-1',
            name: 'Node A',
            health: phase === 'unreachable' ? 'unreachable' : 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async () => ({
                data: {
                    obj: {
                        xray: { state: 'running', errorMsg: '' },
                    },
                },
            }),
        }),
        notify: (payload) => notifications.push(payload),
        updateServer: (id, patch) => updates.push({ id, patch }),
    };

    monitor.serverStates.set('srv-1', {
        serverId: 'srv-1',
        name: 'Node A',
        health: 'unreachable',
        error: 'timeout',
        checkedAt: new Date().toISOString(),
    });
    phase = 'healthy';

    const result = await monitor.runOnce(deps);

    assert.equal(result.summary.healthy, 1);
    assert.equal(notifications[0].type, 'server_health_recovered');
    assert.deepEqual(updates, [{ id: 'srv-1', patch: { health: 'healthy' } }]);
});

test('serverHealthMonitor marks node unreachable and emits critical notification', async () => {
    const monitor = new ServerHealthMonitor();
    const notifications = [];
    const updates = [];

    const result = await monitor.runOnce({
        listServers: async () => [{
            id: 'srv-2',
            name: 'Node B',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => {
            throw new Error('connect timeout');
        },
        notify: (payload) => notifications.push(payload),
        updateServer: (id, patch) => updates.push({ id, patch }),
    });

    assert.equal(result.summary.unreachable, 1);
    assert.equal(notifications[0].severity, 'critical');
    assert.deepEqual(updates, [{ id: 'srv-2', patch: { health: 'unreachable' } }]);
});

test('serverHealthMonitor tolerates panels that only expose POST server status', async () => {
    const monitor = new ServerHealthMonitor();

    const result = await monitor.runOnce({
        listServers: async () => [{
            id: 'srv-3',
            name: 'Node C',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async () => {
                throw new Error('method not allowed');
            },
            post: async () => ({
                data: {
                    obj: {
                        xray: { state: 'running', errorMsg: '' },
                    },
                },
            }),
        }),
        notify: () => {},
        updateServer: () => {},
    });

    assert.equal(result.summary.healthy, 1);
    assert.equal(result.summary.unreachable, 0);
});
