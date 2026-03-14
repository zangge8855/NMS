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
    calculateTrafficDelta,
    shouldUseInboundTotalFallback,
    summarizeRegisteredTrafficTotals,
} = await import('../store/trafficStatsStore.js');
const userStore = (await import('../store/userStore.js')).default;

function maskEmail(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `${hash}@masked.local`;
}

describe('traffic stats inbound fallback', () => {
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
        assert.deepEqual(overview.registeredTotals, totals);
    });
});
