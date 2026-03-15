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
    assert.equal(notifications[0].type, 'server_health_connect_timeout');
    assert.equal(notifications[0].meta.reasonCode, 'connect_timeout');
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

test('serverHealthMonitor classifies panel login failures separately from network failures', async () => {
    const monitor = new ServerHealthMonitor();
    const notifications = [];
    const updates = [];

    const error = new Error('invalid username or password');
    error.code = 'PANEL_LOGIN_FAILED';
    error.isPanelAuthError = true;

    const result = await monitor.runOnce({
        listServers: async () => [{
            id: 'srv-4',
            name: 'Node D',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => {
            throw error;
        },
        notify: (payload) => notifications.push(payload),
        updateServer: (id, patch) => updates.push({ id, patch }),
    });

    assert.equal(result.summary.degraded, 1);
    assert.equal(result.summary.unreachable, 0);
    assert.equal(notifications[0].type, 'server_health_auth_failed');
    assert.equal(notifications[0].meta.reasonCode, 'auth_failed');
    assert.deepEqual(updates, [{ id: 'srv-4', patch: { health: 'degraded' } }]);
});

test('serverHealthMonitor distinguishes credential decryption issues from auth failures', async () => {
    const monitor = new ServerHealthMonitor();
    const notifications = [];

    const error = new Error('Stored panel credentials cannot be decrypted.');
    error.code = 'PANEL_CREDENTIAL_UNREADABLE';
    error.isPanelAuthError = true;

    const result = await monitor.runOnce({
        listServers: async () => [{
            id: 'srv-5',
            name: 'Node E',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => {
            throw error;
        },
        notify: (payload) => notifications.push(payload),
        updateServer: () => {},
    });

    assert.equal(result.summary.degraded, 1);
    assert.equal(notifications[0].type, 'server_health_credentials_unreadable');
    assert.equal(notifications[0].meta.reasonCode, 'credentials_unreadable');
});

test('serverHealthMonitor classifies unsupported status endpoints separately', async () => {
    const monitor = new ServerHealthMonitor();
    const notifications = [];

    const unsupported = new Error('Panel server status endpoint is not supported by this 3x-ui build.');
    unsupported.code = 'PANEL_STATUS_UNSUPPORTED';

    const result = await monitor.runOnce({
        listServers: async () => [{
            id: 'srv-6',
            name: 'Node F',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async () => {
                throw unsupported;
            },
            post: async () => {
                throw unsupported;
            },
        }),
        notify: (payload) => notifications.push(payload),
        updateServer: () => {},
    });

    assert.equal(result.summary.degraded, 1);
    assert.equal(notifications[0].type, 'server_health_status_unsupported');
    assert.equal(notifications[0].meta.reasonCode, 'status_unsupported');
});

test('serverHealthMonitor emits a dedicated notification for DNS failures', async () => {
    const monitor = new ServerHealthMonitor();
    const notifications = [];

    const error = new Error('getaddrinfo ENOTFOUND panel.example.com');
    error.code = 'ENOTFOUND';

    const result = await monitor.runOnce({
        listServers: async () => [{
            id: 'srv-7',
            name: 'Node G',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => {
            throw error;
        },
        notify: (payload) => notifications.push(payload),
        updateServer: () => {},
    });

    assert.equal(result.summary.unreachable, 1);
    assert.equal(notifications[0].type, 'server_health_dns_error');
    assert.equal(notifications[0].meta.reasonCode, 'dns_error');
});
