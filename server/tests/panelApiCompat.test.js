import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fetchPanelOnlineClients,
    postAddClientCompat,
    postDeleteClientFromInboundCompat,
    postUpdateClientCompat,
    resetInboundTrafficCompat,
} from '../lib/panelApiCompat.js';

function notFound(message = '404 page not found') {
    const error = new Error(message);
    error.response = { status: 404, data: { msg: message } };
    return error;
}

test('fetchPanelOnlineClients prefers latest clients endpoint and falls back to legacy inbounds endpoint', async () => {
    const calls = [];
    const client = {
        async post(path) {
            calls.push(path);
            if (path === '/panel/api/clients/onlines') throw notFound();
            return { data: { obj: ['alice@example.com'] } };
        },
    };

    const response = await fetchPanelOnlineClients(client);

    assert.deepEqual(calls, [
        '/panel/api/clients/onlines',
        '/panel/api/inbounds/onlines',
    ]);
    assert.deepEqual(response.data.obj, ['alice@example.com']);
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
