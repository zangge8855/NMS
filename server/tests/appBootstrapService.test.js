import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAppBootstrapPayload } from '../lib/appBootstrapService.js';
const trafficStatsStore = (await import('../store/trafficStatsStore.js')).default;

describe('app bootstrap service', () => {
    it('returns a minimal payload for non-admin users', async () => {
        const payload = await buildAppBootstrapPayload({
            role: 'user',
            userId: 'user-1',
        });

        assert.equal(typeof payload.issuedAt, 'string');
        assert.equal(Object.prototype.hasOwnProperty.call(payload, 'serverContext'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload, 'dashboard'), false);
    });

    it('returns cached admin summaries for admin users', async () => {
        const originalCollectIfStale = trafficStatsStore.collectIfStale;
        trafficStatsStore.collectIfStale = async () => ({
            collected: false,
            lastCollectionAt: null,
            samplesAdded: 0,
            warnings: [],
        });

        let payload;
        try {
            payload = await buildAppBootstrapPayload({
                role: 'admin',
                userId: 'admin-1',
            });
        } finally {
            trafficStatsStore.collectIfStale = originalCollectIfStale;
        }

        assert.equal(typeof payload.issuedAt, 'string');
        assert.ok(payload.serverContext);
        assert.ok(Array.isArray(payload.serverContext.servers));
        assert.equal(payload.serverContext.activeServerId, 'global');
        assert.ok(payload.notifications);
        assert.equal(typeof payload.notifications.unreadCount, 'number');
        assert.ok(Array.isArray(payload.managedUsers));
        assert.ok(payload.telemetryOverview);
        assert.ok(Array.isArray(payload.telemetryOverview.items));
        assert.ok(payload.dashboard);
        assert.equal(typeof payload.dashboard.globalPresenceReady, 'boolean');
        assert.ok(Object.prototype.hasOwnProperty.call(payload.dashboard, 'throughputSummary'));
        assert.ok(payload.audit);
        assert.ok(payload.audit.events);
        assert.ok(payload.audit.traffic);
        assert.ok(payload.audit.access);
        assert.ok(payload.audit.traffic.trafficStatus);
        assert.ok(Array.isArray(payload.audit.events.eventsData.items));
        assert.equal(typeof payload.audit.access.accessSummary.total, 'number');
        assert.ok(payload.systemSettings);
        assert.ok(payload.tasks);
        assert.ok(Array.isArray(payload.systemSettings.inviteCodes));
        assert.ok(Array.isArray(payload.tasks.tasks));
    });

    it('builds audit traffic bootstrap with an explicit top-10 limit', async () => {
        const originalGetOverviewBatch = trafficStatsStore.getOverviewBatch.bind(trafficStatsStore);
        const originalCollectIfStale = trafficStatsStore.collectIfStale;
        let recordedRequests = [];
        trafficStatsStore.getOverviewBatch = (requests = [], options = {}) => {
            recordedRequests = requests;
            return originalGetOverviewBatch(requests, options);
        };
        trafficStatsStore.collectIfStale = async () => ({
            collected: false,
            lastCollectionAt: null,
            samplesAdded: 0,
            warnings: [],
        });

        try {
            await buildAppBootstrapPayload({
                role: 'admin',
                userId: 'admin-1',
            });
        } finally {
            trafficStatsStore.getOverviewBatch = originalGetOverviewBatch;
            trafficStatsStore.collectIfStale = originalCollectIfStale;
        }

        assert.ok(recordedRequests.some((options) => Number(options?.days) === 30 && Number(options?.top) === 10));
        assert.ok(recordedRequests.some((options) => Number(options?.days) === 7 && Number(options?.top) === 10));
    });

    it('waits for traffic sampling before reading admin traffic bootstrap snapshots', async () => {
        const originalCollectIfStale = trafficStatsStore.collectIfStale;
        const originalGetOverviewBatch = trafficStatsStore.getOverviewBatch.bind(trafficStatsStore);
        let collected = false;

        trafficStatsStore.collectIfStale = async () => {
            collected = true;
            return {
                collected: true,
                lastCollectionAt: '2026-03-24T00:10:00.000Z',
                samplesAdded: 1,
                warnings: [],
            };
        };
        trafficStatsStore.getOverviewBatch = (requests = [], options = {}) => {
            assert.equal(collected, true);
            return originalGetOverviewBatch(requests, options);
        };

        try {
            await buildAppBootstrapPayload({
                role: 'admin',
                userId: 'admin-1',
            });
        } finally {
            trafficStatsStore.collectIfStale = originalCollectIfStale;
            trafficStatsStore.getOverviewBatch = originalGetOverviewBatch;
        }
    });
});
