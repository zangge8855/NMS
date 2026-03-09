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
