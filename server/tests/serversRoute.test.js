import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedHostname, normalizeTokenRows, requestPanelApiTokenRoute, validateServerUrl } from '../routes/servers.js';

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
    it('accepts public ipv6 literal urls when private addresses are disallowed', async () => {
        const err = await validateServerUrl('https://[2001:4860:4860::8888]:2053', { allowPrivate: false });
        assert.equal(err, null);
    });

    it('rejects private ipv6 literal urls when private addresses are disallowed', async () => {
        const err = await validateServerUrl('https://[fd00::1]:2053', { allowPrivate: false });
        assert.equal(err, '节点面板地址不能使用私有或内部 IP');
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
