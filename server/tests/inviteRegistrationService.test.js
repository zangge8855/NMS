import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndSendInviteRegistrationEmail } from '../services/inviteRegistrationService.js';

test('createAndSendInviteRegistrationEmail creates a bound invite and sends it to the requested email', async () => {
    const createCalls = [];
    const sent = [];
    const result = await createAndSendInviteRegistrationEmail({
        email: ' Invitee@Example.com ',
        subscriptionDays: 30,
        actor: 'admin',
        registrationUrl: 'https://nms.example.com/portal/',
    }, {
        inviteCodeStore: {
            create(payload) {
                createCalls.push(payload);
                return {
                    code: 'ABCD-EFGH-IJKL',
                    usageLimit: 1,
                    subscriptionDays: 30,
                    invite: {
                        id: 'invite-1',
                        preview: 'ABCD-****-IJKL',
                        targetEmail: payload.targetEmail,
                    },
                };
            },
        },
        mailer: {
            async sendInviteRegistrationEmail(toEmail, payload) {
                sent.push({ toEmail, payload });
            },
        },
    });

    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].targetEmail, 'invitee@example.com');
    assert.equal(createCalls[0].count, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].toEmail, 'invitee@example.com');
    assert.equal(sent[0].payload.inviteCode, 'ABCD-EFGH-IJKL');
    assert.equal(result.recipientEmail, 'invitee@example.com');
    assert.equal(result.invite.targetEmail, 'invitee@example.com');
});

test('createAndSendInviteRegistrationEmail revokes the new invite when email delivery fails', async () => {
    const revoked = [];

    await assert.rejects(
        () => createAndSendInviteRegistrationEmail({
            email: 'broken@example.com',
            subscriptionDays: 15,
            actor: 'admin',
        }, {
            inviteCodeStore: {
                create() {
                    return {
                        code: 'WXYZ-QRST-ABCD',
                        usageLimit: 1,
                        subscriptionDays: 15,
                        invite: {
                            id: 'invite-2',
                            preview: 'WXYZ-****-ABCD',
                        },
                    };
                },
                revoke(id, options) {
                    revoked.push({ id, options });
                },
            },
            mailer: {
                async sendInviteRegistrationEmail() {
                    throw new Error('smtp down');
                },
            },
        }),
        (error) => {
            assert.equal(error.status, 503);
            assert.equal(error.code, 'INVITE_EMAIL_SEND_FAILED');
            assert.equal(error.message, '邀请码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置');
            return true;
        }
    );

    assert.deepEqual(revoked, [{
        id: 'invite-2',
        options: {
            revokedBy: 'admin:delivery_failed',
        },
    }]);
});
