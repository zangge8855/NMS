import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildGlobalDashboardSnapshot,
    buildSingleDashboardSnapshot,
} from '../lib/dashboardSnapshotService.js';

test('buildGlobalDashboardSnapshot returns managed-user presence and traffic windows from warm caches', async () => {
    let collectForce = null;
    const snapshot = await buildGlobalDashboardSnapshot({ force: true }, {
        serverStore: {
            getAll: () => [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        },
        userStore: {
            getAll: () => [
                {
                    id: 'user-a',
                    role: 'user',
                    username: 'Alice',
                    email: 'alice@example.com',
                    subscriptionEmail: 'alice@example.com',
                    enabled: true,
                },
                {
                    id: 'user-b',
                    role: 'user',
                    username: 'Bob',
                    email: 'bob@example.com',
                    subscriptionEmail: 'bob@example.com',
                    enabled: false,
                },
            ],
        },
        trafficStatsStore: {
            collectIfStale: async (force) => {
                collectForce = force;
            },
            getOverview: (options = {}) => {
                if (options?.from) {
                    return { managedTotals: { upBytes: 180, downBytes: 360 } };
                }
                if (Number(options?.days) === 7) {
                    return { managedTotals: { upBytes: 210, downBytes: 420 } };
                }
                if (Number(options?.days) === 30) {
                    return { managedTotals: { upBytes: 220, downBytes: 440 } };
                }
                return { managedTotals: { upBytes: 0, downBytes: 0 } };
            },
        },
        collectClusterStatusSnapshot: async () => ({
            summary: {
                total: 2,
                onlineServers: 2,
                totalInbounds: 2,
                activeInbounds: 2,
            },
            byServerId: {
                'server-a': {
                    serverId: 'server-a',
                    name: 'Node A',
                    online: true,
                    inboundCount: 1,
                    activeInbounds: 1,
                    status: {
                        cpu: 12,
                        mem: { current: 256, total: 1024 },
                        uptime: 3600,
                        netTraffic: { sent: 1000, recv: 2000 },
                    },
                },
                'server-b': {
                    serverId: 'server-b',
                    name: 'Node B',
                    online: true,
                    inboundCount: 1,
                    activeInbounds: 1,
                    status: {
                        cpu: 18,
                        mem: { current: 512, total: 2048 },
                        uptime: 7200,
                        netTraffic: { sent: 3000, recv: 1500 },
                    },
                },
            },
        }),
        getServerPanelSnapshots: async () => [
            {
                server: { id: 'server-a', name: 'Node A' },
                inbounds: [
                    {
                        id: 'ib-a',
                        protocol: 'vless',
                        enable: true,
                        remark: '港口专线',
                        settings: JSON.stringify({
                            clients: [
                                { id: 'uuid-a', email: 'alice@example.com' },
                                { id: 'uuid-x', email: 'outsider@example.com' },
                            ],
                        }),
                        clientStats: [
                            { id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 },
                            { id: 'uuid-x', email: 'outsider@example.com', up: 900, down: 1800 },
                        ],
                    },
                ],
                onlines: [
                    { email: 'alice@example.com', id: 'uuid-a' },
                    { email: 'alice@example.com', id: 'uuid-a' },
                ],
            },
            {
                server: { id: 'server-b', name: 'Node B' },
                inbounds: [
                    {
                        id: 'ib-b',
                        protocol: 'vless',
                        enable: true,
                        remark: '实验楼节点',
                        settings: JSON.stringify({
                            clients: [
                                { id: 'uuid-a', email: 'alice@example.com' },
                                { id: 'uuid-y', email: 'outsider@example.com' },
                            ],
                        }),
                        clientStats: [
                            { id: 'uuid-a', email: 'alice@example.com', up: 120, down: 240 },
                            { id: 'uuid-y', email: 'outsider@example.com', up: 990, down: 1980 },
                        ],
                    },
                ],
                onlines: [
                    { email: 'alice@example.com', id: 'uuid-a' },
                    { email: 'unknown@example.com', id: 'uuid-x' },
                ],
            },
        ],
    });

    assert.equal(collectForce, true);
    assert.equal(snapshot.globalStats.totalUp, 220);
    assert.equal(snapshot.globalStats.totalDown, 440);
    assert.equal(snapshot.globalStats.totalOnline, 1);
    assert.equal(snapshot.globalOnlineSessionCount, 3);
    assert.equal(snapshot.globalAccountSummary.totalUsers, 2);
    assert.equal(snapshot.globalAccountSummary.pendingUsers, 1);
    assert.equal(snapshot.serverStatuses['server-a'].managedOnlineCount, 1);
    assert.equal(snapshot.serverStatuses['server-a'].managedTrafficTotal, 300);
    assert.deepEqual(snapshot.serverStatuses['server-a'].nodeRemarkPreview, ['港口专线']);
    assert.equal(snapshot.trafficWindowTotals.day.totalUp, 180);
    assert.equal(snapshot.trafficWindowTotals.week.totalDown, 420);
    assert.equal(snapshot.trafficWindowTotals.month.totalUp, 220);
    assert.equal(snapshot.globalOnlineUsers[0].displayName, 'Alice');
    assert.equal(snapshot.globalOnlineUsers[0].sessions, 3);
});

test('buildSingleDashboardSnapshot returns sorted inbounds and managed online sessions', async () => {
    const snapshot = await buildSingleDashboardSnapshot('server-a', { force: true }, {
        serverStore: {
            getById: (id) => (id === 'server-a'
                ? { id: 'server-a', name: 'Node A' }
                : null),
        },
        userStore: {
            getAll: () => [
                {
                    id: 'user-a',
                    role: 'user',
                    username: 'Alice',
                    email: 'alice@example.com',
                    subscriptionEmail: 'alice@example.com',
                    enabled: true,
                },
            ],
        },
        systemSettingsStore: {
            sortInboundList: (_serverId, inbounds) => [...inbounds].sort((left, right) => Number(left.port || 0) - Number(right.port || 0)),
        },
        collectClusterStatusSnapshot: async () => ({
            items: [
                {
                    serverId: 'server-a',
                    status: {
                        cpu: 12,
                        mem: { current: 256, total: 1024 },
                        uptime: 3600,
                    },
                },
            ],
        }),
        getServerPanelSnapshot: async () => ({
            inbounds: [
                {
                    id: 'ib-b',
                    port: 8443,
                    protocol: 'vless',
                    enable: true,
                    remark: 'Node B',
                    settings: JSON.stringify({
                        clients: [{ id: 'uuid-a', email: 'alice@example.com' }],
                    }),
                    clientStats: [{ id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 }],
                },
                {
                    id: 'ib-a',
                    port: 443,
                    protocol: 'vless',
                    enable: true,
                    remark: 'Node A',
                    settings: JSON.stringify({
                        clients: [{ id: 'uuid-x', email: 'outsider@example.com' }],
                    }),
                    clientStats: [{ id: 'uuid-x', email: 'outsider@example.com', up: 0, down: 0 }],
                },
            ],
            onlines: [
                { email: 'alice@example.com', id: 'uuid-a' },
                { email: 'alice@example.com', id: 'uuid-a' },
            ],
        }),
        ensureAuthenticated: async () => ({
            get: async (path) => {
                assert.equal(path, '/panel/api/server/cpuHistory/30');
                return {
                    data: {
                        obj: [10, 12, 9],
                    },
                };
            },
        }),
    });

    assert.equal(snapshot.status?.cpu, 12);
    assert.deepEqual(snapshot.cpuHistory, [
        { time: 0, cpu: 10 },
        { time: 1, cpu: 12 },
        { time: 2, cpu: 9 },
    ]);
    assert.deepEqual(snapshot.inbounds.map((item) => item.id), ['ib-a', 'ib-b']);
    assert.equal(snapshot.onlineCount, 1);
    assert.equal(snapshot.onlineSessionCount, 2);
    assert.equal(snapshot.singleServerTrafficTotals.totalUp, 100);
    assert.equal(snapshot.singleServerTrafficTotals.totalDown, 200);
    assert.equal(snapshot.onlineUsers[0].displayName, 'Alice');
});

test('buildSingleDashboardSnapshot throws 404 when the server does not exist', async () => {
    await assert.rejects(
        () => buildSingleDashboardSnapshot('missing', {}, {
            serverStore: {
                getById: () => null,
            },
        }),
        (error) => error?.status === 404
    );
});
