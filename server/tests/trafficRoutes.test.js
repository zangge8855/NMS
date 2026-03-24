import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTrafficSamples, readTrafficCollectionStatus } from '../routes/traffic.js';
import trafficStatsStore from '../store/trafficStatsStore.js';

test('ensureTrafficSamples waits for stale collection before returning', async (t) => {
    const originalCollectIfStale = trafficStatsStore.collectIfStale;

    let collectionResolved = false;
    trafficStatsStore.collectIfStale = async (force) => {
        assert.equal(force, false);
        await new Promise((resolve) => setTimeout(resolve, 20));
        collectionResolved = true;
        return {
            collected: true,
            lastCollectionAt: '2026-03-24T00:10:00.000Z',
            samplesAdded: 1,
            warnings: [],
        };
    };

    t.after(() => {
        trafficStatsStore.collectIfStale = originalCollectIfStale;
    });

    const result = await ensureTrafficSamples();

    assert.equal(collectionResolved, true);
    assert.equal(result.collected, true);
    assert.equal(result.pending, undefined);
});

test('ensureTrafficSamples forwards explicit refresh requests to the collector', async (t) => {
    const originalCollectIfStale = trafficStatsStore.collectIfStale;

    let receivedForce = null;
    trafficStatsStore.collectIfStale = async (force) => {
        receivedForce = force;
        return {
            collected: true,
            lastCollectionAt: '2026-03-24T00:10:00.000Z',
            samplesAdded: 2,
            warnings: [],
        };
    };

    t.after(() => {
        trafficStatsStore.collectIfStale = originalCollectIfStale;
    });

    const result = await ensureTrafficSamples({ forceRefresh: true });

    assert.equal(receivedForce, true);
    assert.equal(result.samplesAdded, 2);
});

test('readTrafficCollectionStatus exposes the latest sampling metadata', async (t) => {
    const originalGetCollectionStatus = trafficStatsStore.getCollectionStatus;

    trafficStatsStore.getCollectionStatus = () => ({
        lastCollectionAt: '2026-03-24T00:10:00.000Z',
        sampleCount: 12,
        collecting: true,
    });

    t.after(() => {
        trafficStatsStore.getCollectionStatus = originalGetCollectionStatus;
    });

    const result = readTrafficCollectionStatus();

    assert.deepEqual(result, {
        lastCollectionAt: '2026-03-24T00:10:00.000Z',
        sampleCount: 12,
        collecting: true,
    });
});
