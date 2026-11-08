import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sendWebhookAlert, validateWebhookTargetUrl } from '../lib/alertWebhookService.js';

describe('alertWebhookService SSRF protection and delivery', () => {
    it('blocks localhost, loopback, ULA, link-local metadata, credentials, and non-http protocols', async () => {
        const blockedUrls = [
            'http://127.0.0.1:8080/hook',
            'http://[::1]:8080/hook',
            'http://[0:0:0:0:0:0:0:1]/hook',
            'http://[fd00::1]/hook',
            'http://[fe80::1]/hook',
            'http://[::ffff:7f00:1]/hook',
            'http://169.254.169.254/latest/meta-data',
            'http://localhost:3000/api/internal',
            'http://metadata.internal/hook',
            'https://user:pass@hooks.example.com/webhook',
            'file:///etc/passwd',
            'ftp://hooks.example.com/file',
        ];

        for (const target of blockedUrls) {
            await assert.rejects(() => validateWebhookTargetUrl(target));
            await assert.rejects(() => sendWebhookAlert({ channel: 'custom', url: target }, { title: 't', message: 'm' }));
        }
    });

    it('blocks hostnames resolving to private IPv4 or IPv6 addresses via DNS', async () => {
        await assert.rejects(
            () => validateWebhookTargetUrl('https://rebind.example.com/hook', {
                lookup: async () => [{ address: '::1', family: 6 }],
            }),
            /private or internal IP/
        );
        await assert.rejects(
            () => validateWebhookTargetUrl('https://rebind.example.com/hook', {
                lookup: async () => [{ address: '127.0.0.1', family: 4 }],
            }),
            /private or internal IP/
        );
    });

    it('blocks Bark key injection and scheme smuggling', async () => {
        await assert.rejects(
            () => sendWebhookAlert({ channel: 'bark', barkKey: '../admin/secret' }, { title: 't', message: 'm' })
        );
        await assert.rejects(
            () => sendWebhookAlert({ channel: 'bark', barkKey: 'file:///etc/passwd' }, { title: 't', message: 'm' })
        );
    });

    it('rejects HTTP redirects to avoid open-redirect SSRF', async () => {
        await assert.rejects(
            () => sendWebhookAlert(
                { channel: 'custom', url: 'https://hooks.example.com/webhook' },
                { title: 't', message: 'm' },
                {
                    lookup: async () => [{ address: '2001:4860:4860::8888', family: 6 }],
                    fetchImpl: async () => ({ type: 'opaqueredirect', status: 302, ok: false }),
                }
            ),
            /redirects are not allowed/
        );
    });

    it('delivers alerts to public IPv6 literals and validated hostnames', async () => {
        const calls = [];
        const deps = {
            lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            fetchImpl: async (targetUrl, init) => {
                calls.push({ targetUrl, init });
                return { ok: true, status: 200 };
            },
        };

        const customRes = await sendWebhookAlert(
            { channel: 'custom', url: 'https://[2001:4860:4860::8888]:8443/hook' },
            { event: 'node_down', title: 'Alert', message: 'Down' },
            deps
        );
        assert.equal(customRes.success, true);
        assert.equal(calls[0].targetUrl, 'https://[2001:4860:4860::8888]:8443/hook');

        const barkRes = await sendWebhookAlert(
            { channel: 'bark', barkKey: 'BarkKey12345' },
            { title: 'Title', message: 'Body' },
            deps
        );
        assert.equal(barkRes.success, true);
        assert.equal(calls[1].targetUrl, 'https://api.day.app/BarkKey12345/Title/Body');
    });
});
