import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fetchClientRecordCompat,
    fetchPanelLastOnlineClients,
    fetchPanelOnlineClients,
    postAttachClientToInboundsCompat,
    postAddClientCompat,
    postDeleteClientFromInboundCompat,
    postDetachClientFromInboundsCompat,
    postUpdateClientCompat,
    resetInboundTrafficCompat,
    postRestartXrayCompat,
    postStopXrayCompat,
    postImportDBCompat,
    postUpdateGeofileCompat,
    postTelegramBackupCompat,
    getExportDBCompat,
    getTlsCertPathsCompat,
} from '../lib/panelApiCompat.js';

function notFound(message = '404 page not found') {
    const error = new Error(message);
    error.response = { status: 404, data: { msg: message } };
    return error;
}

test('fetchPanelOnlineClients prefers current 3x-ui onlinesByGuid endpoint', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            return { data: { success: true, obj: { 'guid-a': ['alice@example.com'] } } };
        },
    };

    const response = await fetchPanelOnlineClients(client);

    assert.deepEqual(calls, ['/panel/api/clients/onlinesByGuid']);
    assert.deepEqual(response.data.obj, { 'guid-a': ['alice@example.com'] });
});

test('fetchPanelOnlineClients falls back through older node and legacy endpoints', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            if (path !== '/panel/api/inbounds/onlines') throw notFound();
            return { data: { obj: ['alice@example.com'] } };
        },
    };

    const response = await fetchPanelOnlineClients(client);

    assert.deepEqual(calls, [
        '/panel/api/clients/onlinesByGuid',
        '/panel/api/clients/onlinesByNode',
        '/panel/api/clients/onlines',
        '/panel/api/inbounds/onlines',
    ]);
    assert.deepEqual(response.data.obj, ['alice@example.com']);
});

test('fetchPanelLastOnlineClients returns an empty map on panels without the latest endpoint', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            throw notFound();
        },
    };

    const response = await fetchPanelLastOnlineClients(client);

    assert.deepEqual(calls, ['/panel/api/clients/lastOnline']);
    assert.deepEqual(response.data.obj, {});
});

test('postAddClientCompat sends latest v3 JSON payload before legacy form fallback', async () => {
    const calls = [];
    const client = {
        async post(path, data, config) {
            calls.push({ path, data, contentType: config?.headers?.['Content-Type'] });
            return { data: { success: true } };
        },
    };

    await postAddClientCompat(client, '7', { email: 'alice@example.com', id: 'uuid-a' });

    assert.deepEqual(calls, [{
        path: '/panel/api/clients/add',
        data: {
            client: { email: 'alice@example.com', id: 'uuid-a' },
            inboundIds: [7],
        },
        contentType: 'application/json',
    }]);
});

test('fetchClientRecordCompat scans legacy inbound lists when latest client record endpoint is absent', async () => {
    const calls = [];
    const client = {
        async get(path) {
            calls.push(path);
            if (path.startsWith('/panel/api/clients/get/')) throw notFound();
            return {
                data: {
                    obj: [
                        {
                            id: 7,
                            settings: JSON.stringify({
                                clients: [{ email: 'alice@example.com', id: 'uuid-a' }],
                            }),
                        },
                        {
                            id: 8,
                            settings: JSON.stringify({
                                clients: [{ email: 'bob@example.com', id: 'uuid-b' }],
                            }),
                        },
                    ],
                },
            };
        },
    };

    const record = await fetchClientRecordCompat(client, 'alice@example.com');

    assert.deepEqual(calls, [
        '/panel/api/clients/get/alice%40example.com',
        '/panel/api/inbounds/list',
    ]);
    assert.equal(record.client.id, 'uuid-a');
    assert.deepEqual(record.inboundIds, [7]);
});

test('postAttachClientToInboundsCompat falls back to legacy addClient using resolved source client', async () => {
    const calls = [];
    const client = {
        async post(path, data, config) {
            calls.push({ method: 'post', path, data, contentType: config?.headers?.['Content-Type'] });
            if (path.includes('/attach')) throw notFound();
            return { data: { success: true } };
        },
        async get(path) {
            calls.push({ method: 'get', path });
            if (path.startsWith('/panel/api/clients/get/')) throw notFound();
            return {
                data: {
                    obj: [{
                        id: 7,
                        settings: JSON.stringify({
                            clients: [{ email: 'alice@example.com', id: 'uuid-a' }],
                        }),
                    }],
                },
            };
        },
    };

    await postAttachClientToInboundsCompat(client, 'alice@example.com', [8]);

    assert.equal(calls.at(-1).path, '/panel/api/clients/add');
    assert.deepEqual(calls.at(-1).data.inboundIds, [8]);
    assert.equal(calls.at(-1).data.client.email, 'alice@example.com');
});

test('postDetachClientFromInboundsCompat falls back to legacy per-inbound delete', async () => {
    const calls = [];
    const client = {
        async post(path, data, config) {
            calls.push({ method: 'post', path, data, contentType: config?.headers?.['Content-Type'] });
            if (path.includes('/detach')) throw notFound();
            return { data: { success: true } };
        },
    };

    await postDetachClientFromInboundsCompat(client, 'alice@example.com', [8, 9]);

    assert.equal(calls[1].path, '/panel/api/inbounds/8/delClient/alice%40example.com');
    assert.equal(calls[2].path, '/panel/api/inbounds/9/delClient/alice%40example.com');
});

test('postUpdateClientCompat resolves old email and uses latest email-scoped update when legacy route is absent', async () => {
    const calls = [];
    const client = {
        async post(path, data, config) {
            calls.push({ method: 'post', path, data, contentType: config?.headers?.['Content-Type'] });
            if (path.startsWith('/panel/api/inbounds/updateClient/')) throw notFound();
            return { data: { success: true } };
        },
        async get(path) {
            calls.push({ method: 'get', path });
            return {
                data: {
                    obj: {
                        id: 7,
                        protocol: 'vless',
                        settings: JSON.stringify({
                            clients: [{ id: 'uuid-a', email: 'old@example.com' }],
                        }),
                    },
                },
            };
        },
    };

    await postUpdateClientCompat(client, 7, 'uuid-a', {
        id: 'uuid-a',
        email: 'new@example.com',
    });

    assert.equal(calls.at(-1).path, '/panel/api/clients/update/old%40example.com');
    assert.equal(calls.at(-1).contentType, 'application/json');
});

test('postUpdateClientCompat falls back when legacy update does not change entitlement fields', async () => {
    const calls = [];
    const client = {
        async post(path, data, config) {
            calls.push({ method: 'post', path, data, contentType: config?.headers?.['Content-Type'] });
            return { data: { success: true } };
        },
        async get(path) {
            calls.push({ method: 'get', path });
            return {
                data: {
                    obj: {
                        id: 7,
                        protocol: 'vless',
                        settings: JSON.stringify({
                            clients: [{ id: 'uuid-a', email: 'old@example.com', expiryTime: 1700000000000 }],
                        }),
                    },
                },
            };
        },
    };

    await postUpdateClientCompat(client, 7, 'uuid-a', {
        id: 'uuid-a',
        email: 'old@example.com',
        expiryTime: 1800000000000,
    });

    assert.equal(calls.at(-1).path, '/panel/api/clients/update/old%40example.com');
    assert.equal(calls.at(-1).contentType, 'application/json');
    assert.equal(calls.at(-1).data.expiryTime, 1800000000000);
});

test('postDeleteClientFromInboundCompat detaches by resolved email on latest v3 panels', async () => {
    const calls = [];
    const client = {
        async post(path, data, config) {
            calls.push({ method: 'post', path, data, contentType: config?.headers?.['Content-Type'] });
            if (path.includes('/delClient')) throw notFound();
            return { data: { success: true } };
        },
        async get(path) {
            calls.push({ method: 'get', path });
            if (path === '/panel/api/clients/get/bob%40example.com') {
                return {
                    data: {
                        obj: {
                            client: { email: 'bob@example.com' },
                            inboundIds: [9, 10],
                        },
                    },
                };
            }
            return {
                data: {
                    obj: {
                        id: 9,
                        protocol: 'trojan',
                        settings: JSON.stringify({
                            clients: [{ password: 'pass-a', email: 'bob@example.com' }],
                        }),
                    },
                },
            };
        },
    };

    await postDeleteClientFromInboundCompat(client, 9, 'pass-a');

    assert.equal(calls.at(-1).path, '/panel/api/clients/bob%40example.com/detach');
    assert.deepEqual(calls.at(-1).data, { inboundIds: [9] });
});

test('postDeleteClientFromInboundCompat deletes orphan clients on latest v3 panels', async () => {
    const calls = [];
    const client = {
        async post(path, data, config) {
            calls.push({ method: 'post', path, data, contentType: config?.headers?.['Content-Type'] });
            if (path.includes('/delClient')) throw notFound();
            return { data: { success: true } };
        },
        async get(path) {
            calls.push({ method: 'get', path });
            if (path === '/panel/api/clients/get/carl%40example.com') {
                return {
                    data: {
                        obj: {
                            client: { email: 'carl@example.com' },
                            inboundIds: [12],
                        },
                    },
                };
            }
            return {
                data: {
                    obj: {
                        id: 12,
                        protocol: 'vless',
                        settings: JSON.stringify({
                            clients: [{ id: 'uuid-c', email: 'carl@example.com' }],
                        }),
                    },
                },
            };
        },
    };

    await postDeleteClientFromInboundCompat(client, 12, 'uuid-c');

    assert.equal(calls.at(-1).path, '/panel/api/clients/del/carl%40example.com');
});

test('resetInboundTrafficCompat uses latest inbound reset and resets each inbound client by email', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(['post', path]);
            return { data: { success: true } };
        },
        async get(path) {
            calls.push(['get', path]);
            return {
                data: {
                    obj: {
                        id: 7,
                        settings: JSON.stringify({
                            clients: [
                                { email: 'alice@example.com' },
                                { email: 'bob@example.com' },
                            ],
                        }),
                    },
                },
            };
        },
    };

    await resetInboundTrafficCompat(client, 7);

    assert.deepEqual(calls, [
        ['post', '/panel/api/inbounds/7/resetTraffic'],
        ['get', '/panel/api/inbounds/get/7'],
        ['post', '/panel/api/clients/resetTraffic/alice%40example.com'],
        ['post', '/panel/api/clients/resetTraffic/bob%40example.com'],
    ]);
});

test('postRestartXrayCompat prefers xrayService restart then falls back to legacy restart', async () => {
    let calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/server/restartXrayService') {
                return { status: 200, data: { success: true } };
            }
            throw notFound();
        },
    };

    let res = await postRestartXrayCompat(client);
    assert.deepEqual(calls, ['/panel/api/server/restartXrayService']);
    assert.equal(res.status, 200);

    calls = [];
    const legacyClient = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/server/restartXrayService') {
                throw notFound();
            }
            return { status: 200, data: { success: true } };
        },
    };
    res = await postRestartXrayCompat(legacyClient);
    assert.deepEqual(calls, ['/panel/api/server/restartXrayService', '/panel/api/server/restartXray']);
    assert.equal(res.status, 200);
});

test('postStopXrayCompat prefers xrayService stop then falls back to legacy stop', async () => {
    let calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/server/stopXrayService') {
                return { status: 200, data: { success: true } };
            }
            throw notFound();
        },
    };

    let res = await postStopXrayCompat(client);
    assert.deepEqual(calls, ['/panel/api/server/stopXrayService']);
    assert.equal(res.status, 200);

    calls = [];
    const legacyClient = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/server/stopXrayService') {
                throw notFound();
            }
            return { status: 200, data: { success: true } };
        },
    };
    res = await postStopXrayCompat(legacyClient);
    assert.deepEqual(calls, ['/panel/api/server/stopXrayService', '/panel/api/server/stopXray']);
    assert.equal(res.status, 200);
});

test('postImportDBCompat appends db field first then falls back to legacy fieldname', async () => {
    let calls = [];
    const mockFiles = [{ fieldname: 'legacyDbFile', originalname: 'x-ui.db', mimetype: 'application/octet-stream', buffer: Buffer.from('db') }];
    const client = {
        async post(path, form) {
            calls.push({ path, headers: form.getHeaders() });
            if (path === '/panel/api/server/importDB') {
                return { status: 200, data: { success: true } };
            }
            throw notFound();
        },
    };

    let res = await postImportDBCompat(client, mockFiles);
    assert.deepEqual(calls.map(c => c.path), ['/panel/api/server/importDB']);
    assert.equal(res.status, 200);

    calls = [];
    const legacyClient = {
        async post(path, form) {
            calls.push({ path, headers: form.getHeaders() });
            if (path === '/panel/api/server/importDB') {
                throw notFound();
            }
            return { status: 200, data: { success: true } };
        },
    };
    res = await postImportDBCompat(legacyClient, mockFiles);
    assert.deepEqual(calls.map(c => c.path), ['/panel/api/server/importDB', '/panel/api/server/database/import']);
    assert.equal(res.status, 200);
});

test('postUpdateGeofileCompat prefers updateGeofile then falls back to legacy update geofile', async () => {
    let calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/server/updateGeofile') {
                return { status: 200, data: { success: true } };
            }
            throw notFound();
        },
    };

    let res = await postUpdateGeofileCompat(client);
    assert.deepEqual(calls, ['/panel/api/server/updateGeofile']);
    assert.equal(res.status, 200);

    calls = [];
    const legacyClient = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/server/updateGeofile') {
                throw notFound();
            }
            return { status: 200, data: { success: true } };
        },
    };
    res = await postUpdateGeofileCompat(legacyClient);
    assert.deepEqual(calls, ['/panel/api/server/updateGeofile', '/panel/api/server/geofile/update']);
    assert.equal(res.status, 200);
});

test('postTelegramBackupCompat prefers backuptotgbot then falls back to legacy backup', async () => {
    let calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/backuptotgbot') {
                return { status: 200, data: { success: true } };
            }
            throw notFound();
        },
    };

    let res = await postTelegramBackupCompat(client);
    assert.deepEqual(calls, ['/panel/api/backuptotgbot']);
    assert.equal(res.status, 200);

    calls = [];
    const legacyClient = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/backuptotgbot') {
                throw notFound();
            }
            return { status: 200, data: { success: true } };
        },
    };
    res = await postTelegramBackupCompat(legacyClient);
    assert.deepEqual(calls, ['/panel/api/backuptotgbot', '/panel/api/server/telegram/backup']);
    assert.equal(res.status, 200);
});

test('getExportDBCompat prefers getDb then falls back to legacy export', async () => {
    let calls = [];
    const client = {
        async get(path) {
            calls.push(path);
            if (path === '/panel/api/server/getDb') {
                return { status: 200, data: Buffer.from('sqlite-db'), headers: {} };
            }
            throw notFound();
        },
    };

    let res = await getExportDBCompat(client);
    assert.deepEqual(calls, ['/panel/api/server/getDb']);
    assert.equal(res.status, 200);
    assert.equal(res.isBinary, true);

    calls = [];
    const legacyClient = {
        async get(path) {
            calls.push(path);
            if (path === '/panel/api/server/getDb') {
                throw notFound();
            }
            return { status: 200, data: Buffer.from('sqlite-db'), headers: {} };
        },
    };
    res = await getExportDBCompat(legacyClient);
    assert.deepEqual(calls, ['/panel/api/server/getDb', '/panel/api/server/database/export']);
    assert.equal(res.status, 200);
    assert.equal(res.isBinary, true);
});

test('getTlsCertPathsCompat prefers getWebCertFiles then falls back to legacy tlsCertPaths', async () => {
    let calls = [];
    const client = {
        async get(path) {
            calls.push(path);
            if (path === '/panel/api/server/getWebCertFiles') {
                return { status: 200, data: { cert: 'cert-path' } };
            }
            throw notFound();
        },
    };

    let res = await getTlsCertPathsCompat(client);
    assert.deepEqual(calls, ['/panel/api/server/getWebCertFiles']);
    assert.equal(res.status, 200);

    calls = [];
    const legacyClient = {
        async get(path) {
            calls.push(path);
            if (path === '/panel/api/server/getWebCertFiles') {
                throw notFound();
            }
            return { status: 200, data: { cert: 'cert-path' } };
        },
    };
    res = await getTlsCertPathsCompat(legacyClient);
    assert.deepEqual(calls, ['/panel/api/server/getWebCertFiles', '/panel/api/server/tlsCertPaths']);
    assert.equal(res.status, 200);
});
