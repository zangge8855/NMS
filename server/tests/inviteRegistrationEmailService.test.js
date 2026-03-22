import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join(__dirname, '.test_data');
process.env.NODE_ENV = 'test';

const {
    buildInviteRegistrationUrl,
    normalizeInviteRegistrationRecipients,
    sendInviteRegistrationCampaign,
} = await import('../services/inviteRegistrationEmailService.js');

describe('inviteRegistrationEmailService', () => {
    it('normalizes recipient emails with dedupe and validation', () => {
        const output = normalizeInviteRegistrationRecipients(' Alice@example.com \ninvalid-email\nalice@example.com;bob@example.com ');

        assert.deepEqual(output.recipients, ['alice@example.com', 'bob@example.com']);
        assert.equal(output.skipped.length, 2);
        assert.equal(output.skipped[0].reason, 'invalid_email');
        assert.equal(output.skipped[1].reason, 'duplicate_email');
    });

    it('builds a registration url with invite and email query parameters', () => {
        const output = buildInviteRegistrationUrl('https://nms.example.com/portal', {
            inviteCode: 'ABCD-EFGH-IJKL',
            email: 'Alice@example.com',
        });

        assert.equal(
            output,
            'https://nms.example.com/portal?mode=register&invite=ABCD-EFGH-IJKL&email=alice%40example.com'
        );
    });

    it('sends invite emails, skips invalid entries, and revokes invites on failure', async () => {
        let nextInvite = 0;
        const created = [];
        const revoked = [];
        const delivered = [];

        const result = await sendInviteRegistrationCampaign({
            emails: 'alice@example.com\ninvalid\nbob@example.com\nalice@example.com',
            usageLimit: 2,
            subscriptionDays: 45,
            entryUrl: 'https://nms.example.com/portal',
            message: '请尽快完成注册。',
            createdBy: 'admin',
        }, {
            createInvite: async (options) => {
                nextInvite += 1;
                const invite = {
                    id: `invite-${nextInvite}`,
                    preview: `INV-${nextInvite}`,
                };
                created.push({ invite, options });
                return {
                    code: `CODE-${nextInvite}`,
                    invite,
                };
            },
            revokeInvite: async (id, options) => {
                revoked.push({ id, options });
            },
            sendEmail: async (toEmail, payload) => {
                delivered.push({ toEmail, payload });
                if (toEmail === 'bob@example.com') {
                    throw new Error('mailbox unavailable');
                }
            },
        });

        assert.equal(result.total, 2);
        assert.equal(result.success, 1);
        assert.equal(result.failed, 1);
        assert.equal(result.skipped, 2);
        assert.equal(result.successes.length, 1);
        assert.equal(result.failures.length, 1);
        assert.equal(result.failures[0].email, 'bob@example.com');
        assert.equal(delivered.length, 2);
        assert.equal(delivered[0].payload.inviteCode, 'CODE-1');
        assert.equal(delivered[0].payload.registrationUrl, 'https://nms.example.com/portal?mode=register&invite=CODE-1&email=alice%40example.com');
        assert.equal(revoked.length, 1);
        assert.equal(revoked[0].id, 'invite-2');
        assert.equal(created[0].options.createdBy, 'admin');
        assert.equal(created[0].options.usageLimit, 2);
        assert.equal(created[0].options.subscriptionDays, 45);
    });

    it('rejects an empty recipient set', async () => {
        await assert.rejects(
            () => sendInviteRegistrationCampaign({ emails: 'invalid-email' }, {
                sendEmail: async () => {},
                createInvite: async () => ({ code: 'CODE-1', invite: { id: 'invite-1', preview: 'INV-1' } }),
            }),
            /没有可用的邀请邮箱/
        );
    });
});
