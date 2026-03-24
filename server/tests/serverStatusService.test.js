import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectClusterStatusSnapshot,
    collectServerStatusSnapshot,
    resetClusterStatusSnapshotCache,
} from '../lib/serverStatusService.js';

test.afterEach(() => {
    resetClusterStatusSnapshotCache();
});

test('collectServerStatusSnapshot classifies DNS failures with a dedicated reason code', async () => {
    const error = new Error('getaddrinfo ENOTFOUND panel.example.com');
    error.code = 'ENOTFOUND';

    const result = await collectServerStatusSnapshot({
        id: 'srv-dns',
        name: 'DNS Node',
        health: 'healthy',
    }, {
        ensureAuthenticated: async () => {
            throw error;
        },
    });

    assert.equal(result.health, 'unreachable');
    assert.equal(result.reasonCode, 'dns_error');
    assert.equal(result.retryable, true);
    assert.equal(typeof result.latencyMs, 'number');
});

test('collectClusterStatusSnapshot keeps healthy nodes online when detail endpoints fail', async () => {
    const snapshot = await collectClusterStatusSnapshot({
        force: true,
        includeDetails: true,
        servers: [{
            id: 'srv-partial',
            name: 'Partial Node',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async (path) => {
                if (path === '/panel/api/server/status') {
                    return {
                        data: {
                            obj: {
                                cpu: 10,
                                mem: { current: 128, total: 256 },
                                uptime: 300,
                                xray: { state: 'running', errorMsg: '' },
                                netTraffic: { sent: 10, recv: 20 },
                            },
                        },
                    };
                }
                throw new Error('detail list failed');
            },
            post: async (path) => {
                if (path === '/panel/api/inbounds/onlines') {
                    throw new Error('detail online failed');
                }
                return {
                    data: {
                        obj: {
                            xray: { state: 'running', errorMsg: '' },
                        },
                    },
                };
            },
        }),
    });

    assert.equal(snapshot.summary.healthy, 1);
    assert.equal(snapshot.summary.unreachable, 0);
    assert.equal(snapshot.items[0].online, true);
    assert.equal(snapshot.items[0].collectionIssues.length, 2);
    assert.equal(snapshot.items[0].collectionIssues[0].source, 'inbounds');
    assert.equal(snapshot.items[0].collectionIssues[1].source, 'online_users');
    assert.equal(typeof snapshot.items[0].latencyMs, 'number');
});

test('collectServerStatusSnapshot keeps inbound traffic totals at zero when counters are present', async () => {
    const result = await collectServerStatusSnapshot({
        id: 'srv-zero-traffic',
        name: 'Zero Traffic Node',
        health: 'healthy',
    }, {
        ensureAuthenticated: async () => ({
            get: async (path) => {
                if (path === '/panel/api/inbounds/list') {
                    return {
                        data: {
                            obj: [
                                { id: 1, enable: true, up: 0, down: 0 },
                            ],
                        },
                    };
                }
                throw new Error(`unexpected get ${path}`);
            },
            post: async (path) => {
                if (path === '/panel/api/server/status') {
                    return {
                        data: {
                            obj: {
                                xray: { state: 'running', errorMsg: '' },
                                netTraffic: { sent: 98765, recv: 43210 },
                            },
                        },
                    };
                }
                if (path === '/panel/api/inbounds/onlines') {
                    return {
                        data: {
                            obj: [],
                        },
                    };
                }
                throw new Error(`unexpected post ${path}`);
            },
        }),
    });

    assert.equal(result.online, true);
    assert.equal(result.up, 0);
    assert.equal(result.down, 0);
    assert.equal(typeof result.latencyMs, 'number');
});

test('collectClusterStatusSnapshot computes throughput deltas from the cached previous snapshot', async () => {
    let statusCall = 0;
    const readStatus = async () => {
        statusCall += 1;
        return {
            data: {
                obj: {
                    cpu: 10,
                    mem: { current: 128, total: 256 },
                    uptime: 300,
                    xray: { state: 'running', errorMsg: '' },
                    netTraffic: {
                        sent: statusCall === 1 ? 1000 : 1600,
                        recv: statusCall === 1 ? 2000 : 3200,
                    },
                },
            },
        };
    };

    const first = await collectClusterStatusSnapshot({
        force: true,
        includeDetails: false,
        servers: [{
            id: 'srv-throughput',
            name: 'Throughput Node',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async () => {
                throw new Error('unexpected get');
            },
            post: async (path) => {
                if (path === '/panel/api/server/status') return readStatus();
                throw new Error(`unexpected post ${path}`);
            },
        }),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await collectClusterStatusSnapshot({
        force: true,
        includeDetails: false,
        servers: [{
            id: 'srv-throughput',
            name: 'Throughput Node',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async () => {
                throw new Error('unexpected get');
            },
            post: async (path) => {
                if (path === '/panel/api/server/status') return readStatus();
                throw new Error(`unexpected post ${path}`);
            },
        }),
    });

    assert.equal(first.summary.throughput.ready, false);
    assert.equal(second.summary.throughput.ready, true);
    assert.ok(second.summary.throughput.totalPerSecond > 0);
});

test('collectClusterStatusSnapshot prefers netTraffic counters over inbound totals for throughput', async () => {
    let statusCall = 0;
    const readStatus = async () => {
        statusCall += 1;
        return {
            data: {
                obj: {
                    cpu: 10,
                    mem: { current: 128, total: 256 },
                    uptime: 300,
                    xray: { state: 'running', errorMsg: '' },
                    netTraffic: {
                        sent: statusCall === 1 ? 1000 : 1300,
                        recv: statusCall === 1 ? 2000 : 2600,
                    },
                },
            },
        };
    };
    const readInbounds = async () => ({
        data: {
            obj: [
                {
                    id: 1,
                    enable: true,
                    // Deliberately much larger than the network delta so the test
                    // fails if throughput still follows inbound cumulative totals.
                    up: statusCall === 1 ? 50_000 : 80_000,
                    down: statusCall === 1 ? 100_000 : 160_000,
                },
            ],
        },
    });

    await collectClusterStatusSnapshot({
        force: true,
        includeDetails: true,
        servers: [{
            id: 'srv-net-priority',
            name: 'Net Priority Node',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async (path) => {
                if (path === '/panel/api/inbounds/list') return readInbounds();
                throw new Error(`unexpected get ${path}`);
            },
            post: async (path) => {
                if (path === '/panel/api/server/status') return readStatus();
                if (path === '/panel/api/inbounds/onlines') {
                    return { data: { obj: [] } };
                }
                throw new Error(`unexpected post ${path}`);
            },
        }),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await collectClusterStatusSnapshot({
        force: true,
        includeDetails: true,
        servers: [{
            id: 'srv-net-priority',
            name: 'Net Priority Node',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async (path) => {
                if (path === '/panel/api/inbounds/list') return readInbounds();
                throw new Error(`unexpected get ${path}`);
            },
            post: async (path) => {
                if (path === '/panel/api/server/status') return readStatus();
                if (path === '/panel/api/inbounds/onlines') {
                    return { data: { obj: [] } };
                }
                throw new Error(`unexpected post ${path}`);
            },
        }),
    });

    assert.equal(second.summary.throughput.ready, true);
    assert.ok(second.summary.throughput.upPerSecond > 0);
    assert.ok(second.summary.throughput.downPerSecond > 0);
    assert.ok(second.summary.throughput.totalPerSecond < 10_000);
});

test('collectClusterStatusSnapshot exposes fresh panel snapshots for managed realtime summaries', async () => {
    const snapshot = await collectClusterStatusSnapshot({
        force: true,
        includeDetails: true,
        servers: [{
            id: 'srv-live-panel',
            name: 'Live Panel Node',
            health: 'healthy',
        }],
        ensureAuthenticated: async () => ({
            get: async (path) => {
                if (path === '/panel/api/inbounds/list') {
                    return {
                        data: {
                            obj: [
                                {
                                    id: 1,
                                    protocol: 'vmess',
                                    enable: true,
                                    up: 1024,
                                    down: 2048,
                                    settings: JSON.stringify({
                                        clients: [{
                                            id: 'client-1',
                                            email: 'alice@example.com',
                                            up: 1024,
                                            down: 2048,
                                        }],
                                    }),
                                },
                            ],
                        },
                    };
                }
                throw new Error(`unexpected get ${path}`);
            },
            post: async (path) => {
                if (path === '/panel/api/server/status') {
                    return {
                        data: {
                            obj: {
                                cpu: 10,
                                mem: { current: 128, total: 256 },
                                uptime: 300,
                                xray: { state: 'running', errorMsg: '' },
                                netTraffic: { sent: 1024, recv: 2048 },
                            },
                        },
                    };
                }
                if (path === '/panel/api/inbounds/onlines') {
                    return {
                        data: {
                            obj: [
                                { email: 'alice@example.com' },
                            ],
                        },
                    };
                }
                throw new Error(`unexpected post ${path}`);
            },
        }),
    });

    assert.equal(Array.isArray(snapshot.panelSnapshots), true);
    assert.equal(snapshot.panelSnapshots.length, 1);
    assert.equal(snapshot.panelSnapshots[0]?.server?.id, 'srv-live-panel');
    assert.equal(snapshot.panelSnapshots[0]?.inbounds?.length, 1);
    assert.equal(snapshot.panelSnapshots[0]?.onlines?.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot.items[0], 'panelSnapshot'), false);
});
