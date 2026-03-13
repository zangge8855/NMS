import test from 'node:test';
import assert from 'node:assert/strict';
import {
    registerUser,
    resendVerificationCode,
    requestPasswordReset,
    resetPasswordWithCode,
    verifyEmailCode,
} from '../services/emailAuthService.js';

test('registerUser rolls back the new user when email delivery fails', async () => {
    const removed = [];
    let verifyCodeSaved = false;
    const repo = {
        add() {
            return { id: 'user-1', email: 'new@example.com' };
        },
        remove(id) {
            removed.push(id);
        },
        setVerifyCode() {
            verifyCodeSaved = true;
        },
    };
    const fakeMailer = {
        generateVerifyCode() {
            return '123456';
        },
        async sendVerificationEmail() {
            throw new Error('smtp down');
        },
    };

    await assert.rejects(
        () => registerUser(
            { username: 'new-user', password: 'StrongPass123!', email: 'new@example.com' },
            {
                userRepository: repo,
                mailer: fakeMailer,
                registrationConfig: { defaultRole: 'user', verifyCodeTtlMinutes: 10 },
            }
        ),
        (error) => {
            assert.equal(error.status, 503);
            assert.equal(error.code, 'VERIFICATION_EMAIL_SEND_FAILED');
            return true;
        }
    );

    assert.deepEqual(removed, ['user-1']);
    assert.equal(verifyCodeSaved, false);
});

test('verifyEmailCode marks email as verified after a valid code', () => {
    const verifiedIds = [];
    const repo = {
        getByEmail(email) {
            assert.equal(email, 'verify@example.com');
            return {
                id: 'user-2',
                username: 'verify-user',
                emailVerified: false,
                verifyCode: '654321',
                verifyCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            };
        },
        setEmailVerified(id) {
            verifiedIds.push(id);
        },
    };

    const result = verifyEmailCode(
        { email: 'verify@example.com', code: '654321' },
        { userRepository: repo }
    );

    assert.equal(result.alreadyVerified, false);
    assert.equal(result.user.username, 'verify-user');
    assert.deepEqual(verifiedIds, ['user-2']);
});

test('resendVerificationCode does not overwrite code when email delivery fails', async () => {
    let setVerifyCodeCalls = 0;
    const repo = {
        getByEmail() {
            return {
                id: 'user-3',
                username: 'resend-user',
                emailVerified: false,
                verifyCode: '111111',
                verifyCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            };
        },
        setVerifyCode() {
            setVerifyCodeCalls += 1;
        },
    };
    const fakeMailer = {
        generateVerifyCode() {
            return '222222';
        },
        async sendVerificationEmail() {
            throw new Error('mail send failed');
        },
    };

    await assert.rejects(
        () => resendVerificationCode(
            { email: 'resend@example.com' },
            {
                userRepository: repo,
                mailer: fakeMailer,
                registrationConfig: { verifyCodeTtlMinutes: 15 },
            }
        ),
        (error) => {
            assert.equal(error.status, 503);
            assert.equal(error.code, 'VERIFICATION_EMAIL_SEND_FAILED');
            return true;
        }
    );

    assert.equal(setVerifyCodeCalls, 0);
});

test('requestPasswordReset hides unknown email addresses', async () => {
    const repo = {
        getByEmail() {
            return null;
        },
    };

    const result = await requestPasswordReset(
        { email: 'missing@example.com' },
        { userRepository: repo }
    );

    assert.equal(result.hidden, true);
    assert.equal(result.email, 'missing@example.com');
});

test('resetPasswordWithCode updates password and clears reset code', () => {
    const updates = [];
    const clears = [];
    const repo = {
        getByEmail() {
            return {
                id: 'user-4',
                username: 'reset-user',
                resetCode: '999999',
                resetCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            };
        },
        update(id, data) {
            updates.push({ id, data });
            return { id, username: 'reset-user' };
        },
        clearPasswordResetCode(id) {
            clears.push(id);
        },
    };

    const result = resetPasswordWithCode(
        {
            email: 'reset@example.com',
            code: '999999',
            newPassword: 'ResetPass123!',
        },
        { userRepository: repo }
    );

    assert.equal(result.user.username, 'reset-user');
    assert.deepEqual(updates, [{
        id: 'user-4',
        data: { password: 'ResetPass123!' },
    }]);
    assert.deepEqual(clears, ['user-4']);
});

test('registerUser consumes invite code and skips email verification in invite-only mode', async () => {
    const consumed = [];
    const provisionCalls = [];
    let sentVerificationEmail = false;
    const repo = {
        add(payload) {
            assert.equal(payload.emailVerified, true);
            assert.equal(payload.enabled, true);
            assert.equal(payload.subscriptionEmail, 'invite@example.com');
            return {
                id: 'user-5',
                username: payload.username,
                email: payload.email,
                enabled: payload.enabled,
                subscriptionEmail: payload.subscriptionEmail,
            };
        },
        remove() {
            throw new Error('should not rollback');
        },
    };
    const inviteStore = {
        assertUsable(code) {
            assert.equal(code, 'ABCD-EFGH-IJKL');
            return {
                id: 'invite-1',
                preview: 'ABCD-****-IJKL',
                usageLimit: 1,
                subscriptionDays: 30,
            };
        },
        consume(code, options) {
            consumed.push({ code, options });
            return {
                id: 'invite-1',
                preview: 'ABCD-****-IJKL',
                status: 'used',
                subscriptionDays: 30,
            };
        },
    };
    const fakeMailer = {
        generateVerifyCode() {
            return '333333';
        },
        async sendVerificationEmail() {
            sentVerificationEmail = true;
        },
    };
    const fakeProvisionSubscription = async (user, payload, actor, deps) => {
        provisionCalls.push({ user, payload, actor, deps });
        return {
            subscription: {
                email: 'invite@example.com',
                token: {
                    currentTokenId: 'token-1',
                    autoIssued: true,
                    issueError: null,
                },
            },
            deployment: {
                total: 1,
                created: 1,
                updated: 0,
                skipped: 0,
                failed: 0,
                details: [],
            },
        };
    };

    const result = await registerUser(
        {
            username: 'invite-user',
            password: 'InvitePass123!',
            email: 'invite@example.com',
            inviteCode: 'ABCD-EFGH-IJKL',
        },
        {
            userRepository: repo,
            inviteCodeStore: inviteStore,
            mailer: fakeMailer,
            inviteOnlyEnabled: true,
            registrationConfig: { defaultRole: 'user', verifyCodeTtlMinutes: 10 },
            provisionSubscriptionForUser: fakeProvisionSubscription,
        }
    );

    assert.equal(result.requireEmailVerification, false);
    assert.equal(result.requireApproval, false);
    assert.equal(result.subscriptionProvisioned, true);
    assert.equal(sentVerificationEmail, false);
    assert.deepEqual(consumed, [{
        code: 'ABCD-EFGH-IJKL',
        options: {
            usedByUserId: 'user-5',
            usedByUsername: 'invite-user',
        },
    }]);
    assert.equal(provisionCalls.length, 1);
    assert.equal(provisionCalls[0].actor, 'invite_registration');
    assert.deepEqual(provisionCalls[0].payload, {
        subscriptionEmail: 'invite@example.com',
        expiryDays: 30,
        serverScopeMode: 'all',
        protocolScopeMode: 'all',
    });
});

test('registerUser still succeeds when invite auto-provisioning fails', async () => {
    const repo = {
        add(payload) {
            return {
                id: 'user-6',
                username: payload.username,
                email: payload.email,
                enabled: payload.enabled,
                subscriptionEmail: payload.subscriptionEmail,
            };
        },
        remove() {
            throw new Error('should not rollback');
        },
    };
    const inviteStore = {
        assertUsable() {
            return {
                id: 'invite-2',
                preview: 'WXYZ-****-QRST',
                usageLimit: 1,
                subscriptionDays: 0,
            };
        },
        consume() {
            return {
                id: 'invite-2',
                preview: 'WXYZ-****-QRST',
                status: 'used',
                subscriptionDays: 0,
            };
        },
    };

    const result = await registerUser(
        {
            username: 'invite-user-2',
            password: 'InvitePass123!',
            email: 'invite2@example.com',
            inviteCode: 'WXYZ-QRST-ABCD',
        },
        {
            userRepository: repo,
            inviteCodeStore: inviteStore,
            inviteOnlyEnabled: true,
            registrationConfig: { defaultRole: 'user', verifyCodeTtlMinutes: 10 },
            provisionSubscriptionForUser: async () => {
                throw new Error('panel offline');
            },
        }
    );

    assert.equal(result.requireEmailVerification, false);
    assert.equal(result.subscriptionProvisioned, false);
    assert.equal(result.provisionError, 'panel offline');
    assert.equal(result.user.enabled, true);
    assert.equal(result.user.subscriptionEmail, 'invite2@example.com');
});
