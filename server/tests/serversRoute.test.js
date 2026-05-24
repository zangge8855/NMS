import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedHostname, normalizeTokenRows, validateServerUrl } from '../routes/servers.js';

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
});
