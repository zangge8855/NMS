import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
    isBlockedHostname,
    normalizePanelTokenScope,
    normalizeTokenRows,
    requestPanelApiTokenRoute,
    resolvePanelTokenExpectedScope,
    validateServerUrl,
} from '../routes/servers.js';
import { pingServer } from '../lib/probe.js';

describe('servers route hostname guards', () => {
    it('blocks localhost and single-label hostnames', () => {
        assert.equal(isBlockedHostname('localhost'), true);
        assert.equal(isBlockedHostname('panel-node'), true);
    });

    it('allows public ipv4 and ipv6 literals', () => {
        assert.equal(isBlockedHostname('8.8.8.8'), false);
        assert.equal(isBlockedHostname('2001:4860:4860::8888'), false);
        assert.equal(isBlockedHostname('[2001:4860:4860::8888]'), false);
    });

    it('keeps blocking internal pseudo-tlds', () => {
        assert.equal(isBlockedHostname('demo.local'), true);
        assert.equal(isBlockedHostname('api.localhost'), true);
    });
});

describe('validateServerUrl', () => {
    it('accepts public ipv6 literal urls including short leading hextets when private addresses are disallowed', async () => {
        assert.equal(await validateServerUrl('https://[2001:4860:4860::8888]:2053', { allowPrivate: false }), null);
        assert.equal(await validateServerUrl('https://[fd0::1]:2053', { allowPrivate: false }), null);
        assert.equal(await validateServerUrl('https://[fe8::1]:2053', { allowPrivate: false }), null);
    });

    it('rejects private/loopback/mapped ipv6 literal urls when private addresses are disallowed', async () => {
        for (const blockedUrl of [
            'https://[fd00::1]:2053',
            'https://[0:0:0:0:0:0:0:1]:2053',
            'https://[::]:2053',
            'https://[febf::1]:2053',
            'https://[::ffff:7f00:1]:2053',
        ]) {
            const err = await validateServerUrl(blockedUrl, { allowPrivate: false });
            assert.equal(err, '节点面板地址不能使用私有或内部 IP');
        }
    });

    it('probes ipv6 literal server endpoints without failing on url brackets', async () => {
        const server = net.createServer();
        let port = 0;
        let ipv6Supported = true;
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '::1', resolve);
            });
            port = server.address().port;
        } catch (err) {
            if (err?.code === 'EAFNOSUPPORT' || err?.code === 'EADDRNOTAVAIL') {
                ipv6Supported = false;
            } else {
                throw err;
            }
        }

        if (ipv6Supported) {
            try {
                const probeResult = await pingServer(`http://[::1]:${port}`);
                assert.equal(probeResult.online, true);
                assert.ok(probeResult.latencyMs >= 0);
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        }
    });
});

describe('panel api token helpers', () => {
    it('redacts tokens returned by upstream list responses', () => {
        const rows = normalizeTokenRows({
            success: true,
            obj: [
                {
                    id: 1,
                    name: 'ops',
                    token: 'abcdef1234567890',
                    enabled: true,
                },
            ],
        });

        assert.equal(rows[0].token, undefined);
        assert.equal(rows[0].tokenConfigured, true);
        assert.equal(rows[0].tokenPreview, 'abcdef...7890');
    });

    it('requests v3.3.0 API token routes before legacy /panel/setting paths', async () => {
        const calls = [];
        const client = async (request) => {
            calls.push(request);
            return { data: { success: true, obj: [] } };
        };

        await requestPanelApiTokenRoute(client, 'get');

        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, 'get');
        assert.equal(calls[0].url, '/panel/api/setting/apiTokens');
    });

    it('falls back to legacy API token routes when the v3.3.0 route is unsupported', async () => {
        const calls = [];
        const client = async (request) => {
            calls.push(request.url);
            if (request.url.startsWith('/panel/api/setting/')) {
                const error = new Error('no route');
                error.response = { status: 404, data: { msg: 'no route' } };
                throw error;
            }
            return { data: { success: true, obj: { id: 1 } } };
        };

        await requestPanelApiTokenRoute(client, 'post', 'delete/1');

        assert.deepEqual(calls, [
            '/panel/api/setting/apiTokens/delete/1',
            '/panel/setting/apiTokens/delete/1',
        ]);
    });

    it('does not hide real token-not-found errors behind legacy fallback', async () => {
        const calls = [];
        const expected = new Error('token not found');
        expected.response = { status: 404, data: { msg: 'token not found' } };
        const client = async (request) => {
            calls.push(request.url);
            throw expected;
        };

        await assert.rejects(
            () => requestPanelApiTokenRoute(client, 'post', 'delete/missing'),
            (error) => error === expected,
        );
        assert.deepEqual(calls, ['/panel/api/setting/apiTokens/delete/missing']);
    });
});

describe('panel api token scopes', () => {
    it('defaults rows without a known scope to admin and keeps real scopes', () => {
        const rows = normalizeTokenRows({
            success: true,
            obj: [
                { id: 1, name: 'legacy', token: 'x' },
                { id: 2, name: 'reader', token: 'y', scope: 'Monitor' },
                { id: 3, name: 'odd', token: 'z', scope: 'root' },
            ],
        });
        assert.deepEqual(rows.map((row) => row.scope), ['admin', 'monitor', 'admin']);
        assert.equal(normalizePanelTokenScope(' node-sync '), 'node-sync');
        assert.equal(normalizePanelTokenScope('owner'), '');
    });

    it('uses the caller scope, then the panel list, then admin as the expected scope', async () => {
        let listCalls = 0;
        const client = async () => {
            listCalls += 1;
            return { data: { success: true, obj: [{ id: 7, name: 'sync', scope: 'node-sync' }] } };
        };
        assert.equal(await resolvePanelTokenExpectedScope(client, '7', 'monitor'), 'monitor');
        assert.equal(listCalls, 0, 'an explicit scope skips the lookup');
        assert.equal(await resolvePanelTokenExpectedScope(client, '7', undefined), 'node-sync');
        assert.equal(await resolvePanelTokenExpectedScope(client, '8', ''), 'admin');

        const failing = async () => { throw new Error('offline'); };
        assert.equal(await resolvePanelTokenExpectedScope(failing, '7', 'bogus'), 'admin');
    });

    it('reports the current route error when both token routes are unsupported', async () => {
        const client = async (request) => {
            const isCurrent = request.url.startsWith('/panel/api/');
            const error = new Error(isCurrent ? 'needs a session login' : 'no route');
            error.response = { status: isCurrent ? 501 : 404, data: { success: false, msg: error.message } };
            throw error;
        };
        await assert.rejects(
            () => requestPanelApiTokenRoute(client, 'get'),
            (error) => error.response.status === 501 && error.message === 'needs a session login',
        );
    });
});
