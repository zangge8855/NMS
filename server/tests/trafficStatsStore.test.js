import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join(__dirname, '.test_data');
process.env.NODE_ENV = 'test';

const {
    TrafficStatsStore,
    buildCalendarTrafficWindowRange,
    calculateTrafficDelta,
    shouldUseInboundTotalFallback,
    summarizeRegisteredTrafficTotals,
    summarizeServerTrafficTotals,
} = await import('../store/trafficStatsStore.js');
const userStore = (await import('../store/userStore.js')).default;
const serverStore = (await import('../store/serverStore.js')).default;

function maskEmail(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `${hash}@masked.local`;
}

describe('traffic stats inbound fallback', () => {
    it('builds calendar ranges for today, this week, and this month in local time', () => {
        const reference = new Date('2026-03-25T15:30:00.000Z');
        const today = buildCalendarTrafficWindowRange('today', reference);
        const week = buildCalendarTrafficWindowRange('this_week', reference);
        const month = buildCalendarTrafficWindowRange('this_month', reference);

        assert.equal(new Date(today.from).getHours(), 0);
        assert.equal(new Date(today.from).getMinutes(), 0);
        assert.equal(today.to, reference.toISOString());
        assert.equal(new Date(week.from).getDay(), 1);
        assert.equal(new Date(week.from).getHours(), 0);
        assert.equal(new Date(month.from).getDate(), 1);
        assert.equal(new Date(month.from).getHours(), 0);
    });

    it('uses inbound totals when client traffic is absent', () => {
        assert.equal(shouldUseInboundTotalFallback(false, false), true);
        assert.equal(shouldUseInboundTotalFallback(false, true), true);
    });

    it('uses inbound totals when client traffic fields exist but no delta was captured', () => {
        assert.equal(shouldUseInboundTotalFallback(true, false), true);
    });

    it('skips inbound totals only when client traffic is both available and captured', () => {
        assert.equal(shouldUseInboundTotalFallback(true, true), false);
    });

    it('treats the first observed counter value as a baseline instead of historical traffic', () => {
        assert.equal(calculateTrafficDelta(1024, undefined), 0);
        assert.equal(calculateTrafficDelta(2048, null), 0);
        assert.equal(calculateTrafficDelta(4096, 1024), 3072);
        assert.equal(calculateTrafficDelta(512, 2048), 512);
    });

    it('maps masked traffic samples back to registered users for overview and trend queries', () => {
        const originalUsers = userStore.exportState();
        try {
            userStore.importState({
                users: [
                    {
                        id: 'user-1',
                        username: 'alice',
                        email: 'alice@example.com',
                        subscriptionEmail: 'alice@example.com',
                        role: 'user',
                        enabled: true,
                        passwordHash: 'hash',
                        passwordSalt: 'salt',
                        createdAt: '2026-03-01T00:00:00.000Z',
                    },
                ],
            });

            const store = new TrafficStatsStore();
            store.importState({
                samples: [
                    {
                        id: 'sample-1',
                        ts: '2026-03-13T00:00:00.000Z',
                        serverId: 'server-a',
                        serverName: 'Node A',
                        inboundId: '1',
                        inboundRemark: 'Main',
                        email: maskEmail('alice@example.com'),
                        clientIdentifier: 'user-1',
                        upBytes: 100,
                        downBytes: 200,
                        totalBytes: 300,
                    },
                    {
                        id: 'sample-2',
                        ts: '2026-03-13T01:00:00.000Z',
                        serverId: 'server-a',
                        serverName: 'Node A',
                        inboundId: '1',
                        inboundRemark: 'Main',
                        email: 'ghost@masked.local',
                        clientIdentifier: 'ghost',
                        upBytes: 500,
                        downBytes: 500,
                        totalBytes: 1000,
                    },
                ],
                counters: {},
                meta: { lastCollectionAt: '2026-03-13T01:00:00.000Z' },
            });

            const overview = store.getOverview({ days: 30, top: 10 });
            assert.equal(overview.activeUsers, 1);
            assert.deepEqual(overview.managedTotals, {
                upBytes: 100,
                downBytes: 200,
                totalBytes: 300,
            });
            assert.deepEqual(overview.totals, {
                upBytes: 600,
                downBytes: 700,
                totalBytes: 1300,
            });
            assert.equal(overview.topUsers.length, 1);
            assert.equal(overview.topUsers[0].email, 'alice@example.com');
            assert.equal(overview.topUsers[0].username, 'alice');
            assert.equal(overview.topUsers[0].displayLabel, 'alice · alice@example.com');
            assert.equal(overview.topUsers[0].totalBytes, 300);

            const trend = store.getUserTrend('alice@example.com', { days: 30, granularity: 'hour' });
            assert.equal(trend.email, 'alice@example.com');
            assert.equal(trend.username, 'alice');
            assert.equal(trend.displayLabel, 'alice · alice@example.com');
            assert.equal(trend.totals.totalBytes, 300);
            assert.equal(trend.points.length, 1);
        } finally {
            userStore.importState(originalUsers);
        }
    });

    it('reports current cumulative traffic for registered users separately from sampled overview totals', () => {
        const originalUsers = userStore.exportState();
        try {
            userStore.importState({
                users: [
                    {
                        id: 'user-1',
                        username: 'alice',
                        email: 'alice@example.com',
                        subscriptionEmail: 'alice@example.com',
                        role: 'user',
                        enabled: true,
                        passwordHash: 'hash',
                        passwordSalt: 'salt',
                        createdAt: '2026-03-01T00:00:00.000Z',
                    },
                    {
                        id: 'user-2',
                        username: 'bob',
                        email: 'bob@example.com',
                        subscriptionEmail: '',
                        role: 'user',
                        enabled: true,
                        passwordHash: 'hash',
                        passwordSalt: 'salt',
                        createdAt: '2026-03-01T00:00:00.000Z',
                    },
                ],
            });

            const totals = summarizeRegisteredTrafficTotals([
                {
                    id: 'user-1',
                    username: 'alice',
                    email: 'alice@example.com',
                    subscriptionEmail: 'alice@example.com',
                    role: 'user',
                    enabled: true,
                },
                {
                    id: 'user-2',
                    username: 'bob',
                    email: 'bob@example.com',
                    subscriptionEmail: '',
                    role: 'user',
                    enabled: true,
                },
            ], [
                {
                    inbounds: [
                        {
                            id: 1,
                            protocol: 'vless',
                            enable: true,
                            settings: JSON.stringify({
                                clients: [
                                    { email: 'alice@example.com', up: 100, down: 200 },
                                    { email: 'anonymous@example.com', up: 500, down: 600 },
                                ],
                            }),
                        },
                        {
                            id: 2,
                            protocol: 'vmess',
                            enable: true,
                            settings: JSON.stringify({
                                clients: [
                                    { email: 'bob@example.com', up: 50, down: 25 },
                                ],
                            }),
                        },
                    ],
                },
            ]);

            assert.deepEqual(totals, {
                totalUsers: 2,
                activeUsers: 2,
                upBytes: 150,
                downBytes: 225,
                totalBytes: 375,
            });

            const store = new TrafficStatsStore();
            store.importState({
                samples: [
                    {
                        id: 'sample-1',
                        ts: '2026-03-13T00:00:00.000Z',
                        serverId: 'server-a',
                        serverName: 'Node A',
                        inboundId: '1',
                        inboundRemark: 'Main',
                        email: 'alice@example.com',
                        clientIdentifier: 'alice',
                        upBytes: 10,
                        downBytes: 20,
                        totalBytes: 30,
                    },
                ],
                counters: {},
                meta: {
                    lastCollectionAt: '2026-03-13T01:00:00.000Z',
                    registeredTotals: totals,
                },
            });

            const overview = store.getOverview({ days: 30, top: 10 });
            assert.equal(overview.totals.totalBytes, 30);
            assert.equal(overview.managedTotals.totalBytes, 30);
            assert.deepEqual(overview.registeredTotals, totals);
        } finally {
            userStore.importState(originalUsers);
        }
    });

    it('returns an empty top node ranking when no windowed server snapshot history exists', () => {
        const serverTotals = summarizeServerTrafficTotals([
            {
                serverId: 'server-a',
                serverName: 'Node A',
                inbounds: [
                    {
                        id: 1,
                        protocol: 'vless',
                        enable: true,
                        settings: JSON.stringify({
                            clients: [
                                { email: 'alice@example.com', up: 100, down: 50 },
                                { email: 'bob@example.com', up: 20, down: 30 },
                            ],
                        }),
                    },
                ],
            },
            {
                serverId: 'server-b',
                serverName: 'Node B',
                inbounds: [
                    {
                        id: 2,
                        protocol: 'hysteria2',
                        enable: true,
                        up: 400,
                        down: 600,
                        settings: JSON.stringify({ clients: [] }),
                    },
                ],
            },
        ]);

        const store = new TrafficStatsStore();
        store.importState({
            samples: [
                {
                    id: 'sample-delta',
                    ts: '2026-03-13T00:00:00.000Z',
                    serverId: 'server-a',
                    serverName: 'Node A',
                    inboundId: '1',
                    inboundRemark: 'Main',
                    email: 'alice@example.com',
                    clientIdentifier: 'alice',
                    upBytes: 10,
                    downBytes: 20,
                    totalBytes: 30,
                },
            ],
            counters: {},
            meta: {
                lastCollectionAt: '2026-03-13T01:00:00.000Z',
                registeredTotals: {
                    totalUsers: 0,
                    activeUsers: 0,
                    upBytes: 0,
                    downBytes: 0,
                    totalBytes: 0,
                },
                serverTotals,
            },
        });

        const overview = store.getOverview({ days: 30, top: 10 });
        assert.equal(overview.topServers.length, 0);
        assert.equal(overview.topServersReady, false);
        assert.equal(overview.serverTotals.length, 2);
        assert.equal(overview.serverTotals[0].serverId, 'server-a');
        assert.equal(overview.serverTotals[1].serverId, 'server-b');
        assert.equal(overview.totals.totalBytes, 30);
    });

    it('uses range-based server snapshot deltas for top node ranking when snapshot history exists', () => {
        const store = new TrafficStatsStore();
        store.importState({
            samples: [
                {
                    id: 'snapshot-a-1',
                    kind: 'server_snapshot',
                    ts: '2026-03-13T00:05:00.000Z',
                    serverId: 'server-a',
                    serverName: 'Node A',
                    upBytes: 100,
                    downBytes: 50,
                    totalBytes: 150,
                },
                {
                    id: 'snapshot-a-2',
                    kind: 'server_snapshot',
                    ts: '2026-03-13T01:05:00.000Z',
                    serverId: 'server-a',
                    serverName: 'Node A',
                    upBytes: 220,
                    downBytes: 90,
                    totalBytes: 310,
                },
                {
                    id: 'snapshot-b-1',
                    kind: 'server_snapshot',
                    ts: '2026-03-13T00:10:00.000Z',
                    serverId: 'server-b',
                    serverName: 'Node B',
                    upBytes: 80,
                    downBytes: 40,
                    totalBytes: 120,
                },
                {
                    id: 'snapshot-b-2',
                    kind: 'server_snapshot',
                    ts: '2026-03-13T01:10:00.000Z',
                    serverId: 'server-b',
                    serverName: 'Node B',
                    upBytes: 120,
                    downBytes: 60,
                    totalBytes: 180,
                },
            ],
            counters: {},
            meta: {
                lastCollectionAt: '2026-03-13T01:10:00.000Z',
                registeredTotals: {
                    totalUsers: 0,
                    activeUsers: 0,
                    upBytes: 0,
                    downBytes: 0,
                    totalBytes: 0,
                },
                serverTotals: [
                    { serverId: 'server-a', serverName: 'Node A', upBytes: 999, downBytes: 999, totalBytes: 1998 },
                    { serverId: 'server-b', serverName: 'Node B', upBytes: 888, downBytes: 888, totalBytes: 1776 },
                ],
            },
        });

        const overview = store.getOverview({
            from: '2026-03-13T00:00:00.000Z',
            to: '2026-03-13T02:00:00.000Z',
            top: 10,
        });

        assert.equal(overview.topServers.length, 2);
        assert.equal(overview.topServers[0].serverId, 'server-a');
        assert.equal(overview.topServers[0].totalBytes, 160);
        assert.equal(overview.topServers[1].serverId, 'server-b');
        assert.equal(overview.topServers[1].totalBytes, 60);
    });

    it('clamps top node ranking responses to the top 10 entries', () => {
        const store = new TrafficStatsStore();
        const samples = Array.from({ length: 12 }, (_, index) => {
            const serverIndex = index + 1;
            return [
                {
                    id: `snapshot-${serverIndex}-1`,
                    kind: 'server_snapshot',
                    ts: '2026-03-13T00:05:00.000Z',
                    serverId: `server-${serverIndex}`,
                    serverName: `Node ${serverIndex}`,
                    upBytes: 100,
                    downBytes: 50,
                    totalBytes: 150,
                },
                {
                    id: `snapshot-${serverIndex}-2`,
                    kind: 'server_snapshot',
                    ts: '2026-03-13T01:05:00.000Z',
                    serverId: `server-${serverIndex}`,
                    serverName: `Node ${serverIndex}`,
                    upBytes: 100 + (serverIndex * 10),
                    downBytes: 50 + (serverIndex * 20),
                    totalBytes: 150 + (serverIndex * 30),
                },
            ];
        }).flat();

        store.importState({
            samples,
            counters: {},
            meta: {
                lastCollectionAt: '2026-03-13T01:05:00.000Z',
                currentTotalsAt: '2026-03-13T01:05:00.000Z',
                registeredTotals: {
                    totalUsers: 0,
                    activeUsers: 0,
                    upBytes: 0,
                    downBytes: 0,
                    totalBytes: 0,
                },
                serverTotals: [],
            },
        });

        const overview = store.getOverview({
            from: '2026-03-13T00:00:00.000Z',
            to: '2026-03-13T02:00:00.000Z',
            top: 99,
        });

        assert.equal(overview.topServersReady, true);
        assert.equal(overview.topServers.length, 10);
        assert.equal(overview.topServers[0].serverId, 'server-12');
        assert.equal(overview.topServers[9].serverId, 'server-3');
    });

    it('preserves the previous baseline totals when a collection cannot fetch any live server payloads', async () => {
        const originalUsers = userStore.exportState();
        const originalGetAll = serverStore.getAll;
        const store = new TrafficStatsStore();

        userStore.importState({
            users: [
                {
                    id: 'user-1',
                    username: 'alice',
                    email: 'alice@example.com',
                    subscriptionEmail: 'alice@example.com',
                    role: 'user',
                    enabled: true,
                    passwordHash: 'hash',
                    passwordSalt: 'salt',
                    createdAt: '2026-03-01T00:00:00.000Z',
                },
            ],
        });
        serverStore.getAll = () => [
            { id: 'server-a', name: 'Node A' },
        ];

        store.importState({
            samples: [],
            counters: {},
            meta: {
                lastCollectionAt: '2026-03-13T00:00:00.000Z',
                currentTotalsAt: '2026-03-13T00:00:00.000Z',
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
                        upBytes: 400,
                        downBytes: 500,
                        totalBytes: 900,
                    },
                ],
            },
        });

        const originalCollectFromServer = store._collectFromServer.bind(store);
        store._collectFromServer = async () => ({
            samples: [],
            warning: {
                serverId: 'server-a',
                server: 'Node A',
                reason: 'panel unavailable',
            },
            inbounds: null,
        });

        try {
            const result = await store.collectIfStale(true);
            const overview = store.getOverview({ days: 30, top: 10 });
            const status = store.getCollectionStatus();

            assert.equal(result.collected, true);
            assert.equal(overview.baselineReady, true);
            assert.equal(overview.registeredTotals.totalBytes, 300);
            assert.equal(overview.serverTotals[0].totalBytes, 900);
            assert.equal(status.currentTotalsAt, '2026-03-13T00:00:00.000Z');
            assert.notEqual(status.lastCollectionAt, '2026-03-13T00:00:00.000Z');
        } finally {
            store._collectFromServer = originalCollectFromServer;
            serverStore.getAll = originalGetAll;
            userStore.importState(originalUsers);
        }
    });

    it('builds server trend from snapshot deltas aggregated into each bucket', () => {
        const store = new TrafficStatsStore();
        store.importState({
            samples: [
                {
                    id: 'snapshot-1',
                    kind: 'server_snapshot',
                    ts: '2026-03-13T00:05:00.000Z',
                    serverId: 'server-a',
                    serverName: 'Node A',
                    upBytes: 100,
                    downBytes: 50,
                    totalBytes: 150,
                },
                {
                    id: 'snapshot-2',
                    kind: 'server_snapshot',
                    ts: '2026-03-13T00:45:00.000Z',
                    serverId: 'server-a',
                    serverName: 'Node A',
                    upBytes: 180,
                    downBytes: 70,
                    totalBytes: 250,
                },
                {
                    id: 'snapshot-3',
                    kind: 'server_snapshot',
                    ts: '2026-03-13T01:10:00.000Z',
                    serverId: 'server-a',
                    serverName: 'Node A',
                    upBytes: 220,
                    downBytes: 90,
                    totalBytes: 310,
                },
            ],
            counters: {},
            meta: {
                lastCollectionAt: '2026-03-13T01:10:00.000Z',
                registeredTotals: {
                    totalUsers: 0,
                    activeUsers: 0,
                    upBytes: 0,
                    downBytes: 0,
                    totalBytes: 0,
                },
                serverTotals: [
                    { serverId: 'server-a', serverName: 'Node A', upBytes: 220, downBytes: 90, totalBytes: 310 },
                ],
            },
        });

        const trend = store.getServerTrend('server-a', {
            from: '2026-03-13T00:00:00.000Z',
            to: '2026-03-13T02:00:00.000Z',
            granularity: 'hour',
        });

        assert.equal(trend.points.length, 2);
        assert.deepEqual(trend.points[0], {
            ts: '2026-03-13T00:00:00.000Z',
            upBytes: 80,
            downBytes: 20,
            totalBytes: 100,
        });
        assert.deepEqual(trend.points[1], {
            ts: '2026-03-13T01:00:00.000Z',
            upBytes: 40,
            downBytes: 20,
            totalBytes: 60,
        });
        assert.deepEqual(trend.totals, {
            upBytes: 120,
            downBytes: 40,
            totalBytes: 160,
        });
    });

    it('marks user-level traffic as limited when the window includes unattributed node-level samples', () => {
        const originalUsers = userStore.exportState();
        try {
            userStore.importState({
                users: [
                    {
                        id: 'user-1',
                        username: 'alice',
                        email: 'alice@example.com',
                        subscriptionEmail: 'alice@example.com',
                        role: 'user',
                        enabled: true,
                        passwordHash: 'hash',
                        passwordSalt: 'salt',
                        createdAt: '2026-03-01T00:00:00.000Z',
                    },
                ],
            });

            const store = new TrafficStatsStore();
            store.importState({
                samples: [
                    {
                        id: 'sample-managed',
                        ts: '2026-03-13T00:00:00.000Z',
                        serverId: 'server-a',
                        serverName: 'Node A',
                        inboundId: '1',
                        inboundRemark: 'Main',
                        email: 'alice@example.com',
                        clientIdentifier: 'alice',
                        upBytes: 100,
                        downBytes: 200,
                        totalBytes: 300,
                    },
                    {
                        id: 'sample-unattributed',
                        ts: '2026-03-13T01:00:00.000Z',
                        serverId: 'server-b',
                        serverName: 'Node B',
                        inboundId: '2',
                        inboundRemark: 'Fallback',
                        email: '',
                        clientIdentifier: '__inbound_total__',
                        upBytes: 400,
                        downBytes: 500,
                        totalBytes: 900,
                    },
                ],
                counters: {},
                meta: {
                    lastCollectionAt: '2026-03-13T01:00:00.000Z',
                    registeredTotals: {
                        totalUsers: 1,
                        activeUsers: 1,
                        upBytes: 100,
                        downBytes: 200,
                        totalBytes: 300,
                    },
                    serverTotals: [],
                },
            });

            const overview = store.getOverview({ days: 30, top: 10 });
            assert.equal(overview.userLevelSupported, false);
            assert.deepEqual(overview.managedTotals, {
                upBytes: 100,
                downBytes: 200,
                totalBytes: 300,
            });
            assert.deepEqual(overview.unattributedTotals, {
                upBytes: 400,
                downBytes: 500,
                totalBytes: 900,
            });
            assert.deepEqual(overview.totals, {
                upBytes: 500,
                downBytes: 700,
                totalBytes: 1200,
            });
        } finally {
            userStore.importState(originalUsers);
        }
    });
});
