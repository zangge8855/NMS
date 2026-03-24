import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDashboardTrafficWindowTotals,
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
                throughput: {
                    ready: true,
                    readyServers: 2,
                    upPerSecond: 12,
                    downPerSecond: 24,
                    totalPerSecond: 36,
                },
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
    assert.equal(snapshot.globalManagedOnlineCount, 1);
    assert.equal(snapshot.globalOnlineSessionCount, 3);
    assert.equal(snapshot.globalAccountSummary.totalUsers, 2);
    assert.equal(snapshot.globalAccountSummary.pendingUsers, 1);
    assert.equal(snapshot.throughputSummary.totalPerSecond, 36);
    assert.equal(snapshot.serverStatuses['server-a'].managedOnlineCount, 1);
    assert.equal(snapshot.serverStatuses['server-a'].managedTrafficTotal, 300);
    assert.deepEqual(snapshot.serverStatuses['server-a'].nodeRemarkPreview, ['港口专线']);
    assert.equal(snapshot.trafficWindowTotals.day.totalUp, 180);
    assert.equal(snapshot.trafficWindowTotals.week.totalDown, 420);
    assert.equal(snapshot.trafficWindowTotals.month.totalUp, 220);
    assert.equal(snapshot.globalOnlineUsers[0].displayName, 'Alice');
    assert.equal(snapshot.globalOnlineUsers[0].sessions, 3);
});

test('buildGlobalDashboardSnapshot does not block core cards on slow traffic sampling', async () => {
    let resolveTrafficSampling = null;
    const snapshot = await Promise.race([
        buildGlobalDashboardSnapshot({ force: true }, {
            serverStore: {
                getAll: () => [
                    { id: 'server-a', name: 'Node A' },
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
                ],
            },
            trafficStatsStore: {
                collectIfStale: async () => new Promise((resolve) => {
                    resolveTrafficSampling = resolve;
                }),
                getOverview: () => ({ managedTotals: { upBytes: 0, downBytes: 0 } }),
            },
            collectClusterStatusSnapshot: async () => ({
                summary: {
                    total: 1,
                    onlineServers: 1,
                    totalInbounds: 1,
                    activeInbounds: 1,
                    throughput: {
                        ready: false,
                        readyServers: 0,
                        upPerSecond: 0,
                        downPerSecond: 0,
                        totalPerSecond: 0,
                    },
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
                                ],
                            }),
                            clientStats: [
                                { id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 },
                            ],
                        },
                    ],
                    onlines: [
                        { email: 'alice@example.com', id: 'uuid-a' },
                    ],
                },
            ],
        }),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('dashboard snapshot timed out')), 100);
        }),
    ]);

    resolveTrafficSampling?.({
        collected: true,
        lastCollectionAt: '2026-03-24T00:10:00.000Z',
        samplesAdded: 1,
        warnings: [],
    });

    assert.equal(snapshot.globalManagedOnlineCount, 1);
    assert.equal(snapshot.globalStats.totalOnline, 1);
    assert.equal(snapshot.globalOnlineUsers[0].displayName, 'Alice');
});

test('buildGlobalDashboardSnapshot ignores synchronous traffic sampling failures', async () => {
    const snapshot = await buildGlobalDashboardSnapshot({ force: true }, {
        serverStore: {
            getAll: () => [
                { id: 'server-a', name: 'Node A' },
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
            ],
        },
        trafficStatsStore: {
            collectIfStale: () => {
                throw new Error('collector init failed');
            },
            getOverview: () => ({ managedTotals: { upBytes: 0, downBytes: 0 } }),
        },
        collectClusterStatusSnapshot: async () => ({
            summary: {
                total: 1,
                onlineServers: 1,
                totalInbounds: 1,
                activeInbounds: 1,
                throughput: {
                    ready: false,
                    readyServers: 0,
                    upPerSecond: 0,
                    downPerSecond: 0,
                    totalPerSecond: 0,
                },
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
                            ],
                        }),
                        clientStats: [
                            { id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 },
                        ],
                    },
                ],
                onlines: [
                    { email: 'alice@example.com', id: 'uuid-a' },
                ],
            },
        ],
    });

    assert.equal(snapshot.globalManagedOnlineCount, 1);
    assert.equal(snapshot.globalStats.totalOnline, 1);
    assert.equal(snapshot.globalOnlineUsers[0].displayName, 'Alice');
});

test('buildDashboardTrafficWindowTotals overlays live deltas from fresh panel snapshots', () => {
    const nowIso = new Date().toISOString();
    const windows = buildDashboardTrafficWindowTotals({
        trafficStatsStore: {
            getOverview: ({ days, from, to } = {}) => ({
                from: from || (days === 7 ? '2026-03-17T00:00:00.000Z' : '2026-02-24T00:00:00.000Z'),
                to: to || nowIso,
                lastCollectionAt: nowIso,
                sampleCount: 1,
                baselineReady: true,
                managedTotals: {
                    upBytes: days === 7 ? 210 : 220,
                    downBytes: days === 7 ? 420 : 440,
                    totalBytes: days === 7 ? 630 : 660,
                },
                totals: {
                    upBytes: days === 7 ? 310 : 320,
                    downBytes: days === 7 ? 520 : 540,
                    totalBytes: days === 7 ? 830 : 860,
                },
                registeredTotals: {
                    totalUsers: 1,
                    activeUsers: 1,
                    upBytes: 100,
                    downBytes: 200,
                    totalBytes: 300,
                },
                serverTotals: [
                    {
                        serverId: 'server-a',
                        serverName: 'Node A',
                        upBytes: 600,
                        downBytes: 900,
                        totalBytes: 1500,
                    },
                ],
            }),
        },
        users: [
            {
                id: 'user-a',
                role: 'user',
                username: 'Alice',
                email: 'alice@example.com',
                subscriptionEmail: 'alice@example.com',
                enabled: true,
            },
        ],
        panelSnapshots: [
            {
                server: { id: 'server-a', name: 'Node A' },
                inbounds: [
                    {
                        id: 'ib-a',
                        protocol: 'vless',
                        enable: true,
                        settings: JSON.stringify({
                            clients: [
                                { id: 'uuid-a', email: 'alice@example.com', up: 130, down: 260 },
                            ],
                        }),
                    },
                ],
            },
        ],
    });

    assert.equal(windows.week.totalUp, 240);
    assert.equal(windows.week.totalDown, 480);
    assert.equal(windows.month.totalUp, 250);
    assert.equal(windows.month.totalDown, 500);
});

test('buildDashboardTrafficWindowTotals does not overlay live cumulative totals when the overview baseline is not ready', () => {
    const nowIso = new Date().toISOString();
    const windows = buildDashboardTrafficWindowTotals({
        trafficStatsStore: {
            getOverview: ({ days, from, to } = {}) => ({
                from: from || (days === 7 ? '2026-03-17T00:00:00.000Z' : '2026-02-24T00:00:00.000Z'),
                to: to || nowIso,
                lastCollectionAt: nowIso,
                sampleCount: 0,
                baselineReady: false,
                managedTotals: {
                    upBytes: 0,
                    downBytes: 0,
                    totalBytes: 0,
                },
                totals: {
                    upBytes: 0,
                    downBytes: 0,
                    totalBytes: 0,
                },
                registeredTotals: {
                    totalUsers: 1,
                    activeUsers: 0,
                    upBytes: 0,
                    downBytes: 0,
                    totalBytes: 0,
                },
                serverTotals: [],
            }),
        },
        users: [
            {
                id: 'user-a',
                role: 'user',
                username: 'Alice',
                email: 'alice@example.com',
                subscriptionEmail: 'alice@example.com',
                enabled: true,
            },
        ],
        panelSnapshots: [
            {
                server: { id: 'server-a', name: 'Node A' },
                inbounds: [
                    {
                        id: 'ib-a',
                        protocol: 'vless',
                        enable: true,
                        settings: JSON.stringify({
                            clients: [
                                { id: 'uuid-a', email: 'alice@example.com', up: 130, down: 260 },
                            ],
                        }),
                    },
                ],
            },
        ],
    });

    assert.equal(windows.day.totalUp, 0);
    assert.equal(windows.day.totalDown, 0);
    assert.equal(windows.day.ready, false);
    assert.equal(windows.week.totalUp, 0);
    assert.equal(windows.month.totalDown, 0);
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
