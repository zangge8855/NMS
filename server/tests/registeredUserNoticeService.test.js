import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join(__dirname, '.test_data');
process.env.NODE_ENV = 'test';

const userStore = (await import('../store/userStore.js')).default;
const {
    buildRegisteredUserNoticePreview,
    normalizeNoticeScope,
    resolveRegisteredUserNoticeRecipients,
    sendRegisteredUserNoticeCampaign,
} = await import('../services/registeredUserNoticeService.js');

describe('registeredUserNoticeService', () => {
    it('normalizes recipient scope', () => {
        assert.equal(normalizeNoticeScope('verified'), 'verified');
        assert.equal(normalizeNoticeScope('VERIFIED'), 'verified');
        assert.equal(normalizeNoticeScope('anything-else'), 'all');
    });

    it('resolves registered recipients with dedupe and verification filtering', () => {
        const output = resolveRegisteredUserNoticeRecipients([
            { id: 'admin-1', role: 'admin', username: 'admin', email: 'admin@example.com', emailVerified: true, enabled: true },
            { id: 'u-1', role: 'user', username: 'alice', email: 'alice@example.com', subscriptionEmail: 'alice-sub@example.com', emailVerified: true, enabled: true },
            { id: 'u-2', role: 'user', username: 'bob', email: '', subscriptionEmail: 'bob@example.com', emailVerified: false, enabled: true },
            { id: 'u-3', role: 'user', username: 'carol', email: 'alice@example.com', subscriptionEmail: 'carol@example.com', emailVerified: true, enabled: true },
            { id: 'u-4', role: 'user', username: 'dave', email: 'disabled@example.com', subscriptionEmail: '', emailVerified: true, enabled: false },
        ], {
            scope: 'all',
            includeDisabled: false,
        });

        assert.equal(output.recipients.length, 2);
        assert.deepEqual(output.recipients.map((item) => item.email), ['alice@example.com', 'bob@example.com']);
        assert.equal(output.skipped.length, 2);

        const verifiedOnly = resolveRegisteredUserNoticeRecipients([
            { id: 'u-1', role: 'user', username: 'alice', email: 'alice@example.com', subscriptionEmail: '', emailVerified: true, enabled: true },
            { id: 'u-2', role: 'user', username: 'bob', email: '', subscriptionEmail: 'bob@example.com', emailVerified: false, enabled: true },
        ], {
            scope: 'verified',
            includeDisabled: true,
        });

        assert.equal(verifiedOnly.recipients.length, 1);
        assert.equal(verifiedOnly.recipients[0].email, 'alice@example.com');
    });

    it('sends notice campaign and reports failures without stopping the batch', async () => {
        const sent = [];
        const result = await sendRegisteredUserNoticeCampaign({
            subject: '域名变更通知',
            message: '请更新最新地址',
            actionUrl: 'https://example.com/new',
            actionLabel: '查看最新地址',
            scope: 'all',
            includeDisabled: true,
        }, {
            users: [
                { id: 'u-1', role: 'user', username: 'alice', email: 'alice@example.com', subscriptionEmail: '', emailVerified: true, enabled: true },
                { id: 'u-2', role: 'user', username: 'bob', email: 'bob@example.com', subscriptionEmail: '', emailVerified: true, enabled: true },
            ],
            sendEmail: async (toEmail, payload) => {
                sent.push({ toEmail, payload });
                if (toEmail === 'bob@example.com') {
                    throw new Error('mailbox unavailable');
                }
            },
        });

        assert.equal(result.total, 2);
        assert.equal(result.success, 1);
        assert.equal(result.failed, 1);
        assert.equal(result.skipped, 0);
        assert.equal(result.failures.length, 1);
        assert.equal(result.failures[0].email, 'bob@example.com');
        assert.equal(sent.length, 2);
        assert.equal(sent[0].payload.subject, '域名变更通知');
    });

    it('builds notice preview with rendered html and recipient stats', () => {
        const preview = buildRegisteredUserNoticePreview({
            subject: '域名切换通知',
            message: '请更新最新地址。\n\n旧地址即将停用。',
            actionUrl: 'https://example.com/new',
            actionLabel: '查看最新地址',
            scope: 'all',
            includeDisabled: false,
        }, {
            users: [
                { id: 'u-1', role: 'user', username: 'alice', email: 'alice@example.com', subscriptionEmail: '', emailVerified: true, enabled: true },
                { id: 'u-2', role: 'user', username: 'bob', email: '', subscriptionEmail: '', emailVerified: false, enabled: true },
            ],
        });

        assert.equal(preview.recipientCount, 1);
        assert.equal(preview.skippedCount, 1);
        assert.equal(preview.singleRecipientMode, true);
        assert.equal(preview.sampleRecipient.username, 'alice');
        assert.equal(preview.subject, '域名切换通知');
        assert.match(preview.html, /域名切换通知/);
        assert.match(preview.html, /alice/);
        assert.match(preview.html, /https:\/\/example\.com\/new/);
    });

    it('uses live user store data when deps.users is omitted', async () => {
        const originalState = userStore.exportState();
        try {
            userStore.importState({
                users: [
                    {
                        id: 'u-1',
                        username: 'alice',
                        email: 'alice@example.com',
                        subscriptionEmail: '',
                        emailVerified: true,
                        role: 'user',
                        enabled: true,
                        passwordHash: 'hash',
                        passwordSalt: 'salt',
                        createdAt: '2026-03-01T00:00:00.000Z',
                    },
                ],
            });

            const result = await sendRegisteredUserNoticeCampaign({
                subject: '入口切换',
                message: '最新地址已生效',
            }, {
                sendEmail: async () => {},
            });

            assert.equal(result.total, 1);
            assert.equal(result.success, 1);
            assert.equal(result.failed, 0);
        } finally {
            userStore.importState(originalState);
        }
    });
});
