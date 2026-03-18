import test from 'node:test';
import assert from 'node:assert/strict';
import {
    changeOwnPassword,
    createLoginSession,
    requestOwnProfileUpdateVerification,
    updateOwnProfile,
    validateSession,
} from '../services/authSessionService.js';

test('createLoginSession supports legacy admin password login', () => {
    const repo = {
        authenticate() {
            return null;
        },
        getByUsername(username) {
            if (username === 'admin') {
                return { id: 'admin-1', username: 'admin', role: 'admin', email: 'admin@example.com', subscriptionEmail: '' };
            }
            return null;
        },
        list() {
            return [{ id: 'admin-1', username: 'admin', role: 'admin', email: 'admin@example.com', subscriptionEmail: '' }];
        },
    };

    const result = createLoginSession(
        { username: '', password: 'secret' },
        {
            userRepository: repo,
            authConfig: { allowLegacyPasswordLogin: true, adminPassword: 'secret' },
            jwtSign(payload) {
                return `token-for:${payload.username}`;
            },
            jwtConfig: { secret: 'ignored', expiresIn: '1d' },
        }
    );

    assert.equal(result.success, true);
    assert.equal(result.token, 'token-for:admin');
    assert.equal(result.audit.legacyMode, true);
    assert.equal(result.user.role, 'admin');
    assert.equal(result.audit.email, 'admin@example.com');
});

test('createLoginSession returns verify state for unverified users', () => {
    const repo = {
        authenticate() {
            return { id: 'user-1', username: 'alice', role: 'user' };
        },
        getByUsername() {
            return {
                id: 'user-1',
                username: 'alice',
                role: 'user',
                email: 'alice@example.com',
                subscriptionEmail: 'alice@example.com',
                emailVerified: false,
                enabled: true,
            };
        },
    };

    const result = createLoginSession(
        { username: 'alice', password: 'pass' },
        { userRepository: repo }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'email_not_verified');
    assert.equal(result.email, 'alice@example.com');
    assert.equal(result.audit.email, 'alice@example.com');
});

test('createLoginSession returns disabled users with audit metadata', () => {
    const repo = {
        authenticate() {
            return { id: 'user-4', username: 'dave', role: 'user' };
        },
        getByUsername() {
            return {
                id: 'user-4',
                username: 'dave',
                role: 'user',
                email: 'dave@example.com',
                subscriptionEmail: 'sub-dave@example.com',
                emailVerified: true,
                enabled: false,
            };
        },
    };

    const result = createLoginSession(
        { username: 'dave', password: 'pass' },
        { userRepository: repo }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'user_disabled');
    assert.equal(result.audit.subscriptionEmail, 'sub-dave@example.com');
});

test('createLoginSession returns audit metadata for invalid password of known user', () => {
    const repo = {
        authenticate() {
            return null;
        },
        getByUsername(username) {
            if (username !== 'eve') return null;
            return {
                id: 'user-5',
                username: 'eve',
                role: 'user',
                email: 'eve@example.com',
                subscriptionEmail: 'eve@example.com',
            };
        },
        list() {
            return [];
        },
    };

    const result = createLoginSession(
        { username: 'eve', password: 'wrong' },
        { userRepository: repo, authConfig: { allowLegacyPasswordLogin: false, adminPassword: 'ignored' } }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'invalid_credentials');
    assert.equal(result.audit.username, 'eve');
});

test('validateSession returns normalized session user', () => {
    const repo = {
        getById(id) {
            assert.equal(id, 'user-2');
            return {
                id,
                username: 'bob',
                role: 'user',
                email: 'bob@example.com',
                subscriptionEmail: 'sub@example.com',
            };
        },
    };

    const result = validateSession('Bearer abc', {
        userRepository: repo,
        jwtVerify() {
            return { userId: 'user-2', username: 'bob', role: 'user' };
        },
        jwtConfig: { secret: 'ignored' },
    });

    assert.equal(result.user.username, 'bob');
    assert.equal(result.user.subscriptionEmail, 'sub@example.com');
});

test('changeOwnPassword rejects incorrect old password', () => {
    const repo = {
        getById() {
            return { id: 'user-3', username: 'carol' };
        },
        authenticate() {
            return null;
        },
    };

    assert.throws(
        () => changeOwnPassword(
            { oldPassword: 'wrong', newPassword: 'NewPass123!' },
            { userId: 'user-3' },
            { userRepository: repo }
        ),
        (error) => {
            assert.equal(error.status, 401);
            assert.equal(error.message, '旧密码错误');
            return true;
        }
    );
});

test('changeOwnPassword updates password when old password is correct', () => {
    let updatedPayload = null;
    const repo = {
        getById(id) {
            assert.equal(id, 'user-6');
            return { id: 'user-6', username: 'frank', role: 'user' };
        },
        authenticate(username, password) {
            assert.equal(username, 'frank');
            assert.equal(password, 'OldPass123!');
            return { id: 'user-6', username: 'frank', role: 'user' };
        },
        update(id, payload) {
            updatedPayload = { id, payload };
        },
    };

    const result = changeOwnPassword(
        { oldPassword: 'OldPass123!', newPassword: 'NewPass123!' },
        { userId: 'user-6' },
        { userRepository: repo }
    );

    assert.equal(result.user.username, 'frank');
    assert.deepEqual(updatedPayload, {
        id: 'user-6',
        payload: { password: 'NewPass123!' },
    });
});

test('requestOwnProfileUpdateVerification sends a code to the current login email', async () => {
    const sent = [];
    const saved = [];
    const repo = {
        getById(id) {
            assert.equal(id, 'user-7');
            return {
                id: 'user-7',
                username: 'gina',
                role: 'user',
                email: 'gina@example.com',
                subscriptionEmail: 'gina@example.com',
                emailVerified: true,
            };
        },
        setProfileUpdateVerification(id, payload) {
            saved.push({ id, payload });
        },
    };
    const fakeMailer = {
        generateVerifyCode() {
            return '654321';
        },
        async sendVerificationEmail(email, code, username) {
            sent.push({ email, code, username });
        },
    };

    const result = await requestOwnProfileUpdateVerification(
        { username: 'gina-new', email: 'gina.new@example.com' },
        { userId: 'user-7' },
        {
            userRepository: repo,
            mailer: fakeMailer,
            registrationConfig: { verifyCodeTtlMinutes: 10 },
        }
    );

    assert.equal(result.verificationEmail, 'gina@example.com');
    assert.deepEqual(sent, [{
        email: 'gina@example.com',
        code: '654321',
        username: 'gina',
    }]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, 'user-7');
    assert.equal(saved[0].payload.code, '654321');
    assert.equal(saved[0].payload.targetEmail, 'gina@example.com');
    assert.equal(saved[0].payload.username, 'gina-new');
    assert.equal(saved[0].payload.email, 'gina.new@example.com');
});

test('updateOwnProfile updates username and login email only after code verification', () => {
    let updatedPayload = null;
    const cleared = [];
    const repo = {
        getById(id) {
            assert.equal(id, 'user-7');
            return {
                id: 'user-7',
                username: 'gina',
                role: 'user',
                email: 'gina@example.com',
                subscriptionEmail: 'gina@example.com',
                emailVerified: true,
                profileVerifyCode: '654321',
                profileVerifyCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                profileVerifyTargetEmail: 'gina@example.com',
                profileVerifyUsername: 'gina-new',
                profileVerifyEmail: 'gina.new@example.com',
            };
        },
        update(id, payload) {
            updatedPayload = { id, payload };
            return {
                id,
                username: 'gina',
                role: 'user',
                email: payload.email,
                subscriptionEmail: payload.subscriptionEmail,
                emailVerified: true,
            };
        },
        clearProfileUpdateVerification(id) {
            cleared.push(id);
        },
    };

    const result = updateOwnProfile(
        { username: 'gina-new', email: 'gina.new@example.com', code: '654321' },
        { userId: 'user-7' },
        { userRepository: repo }
    );

    assert.equal(result.subscriptionEmailSynced, false);
    assert.equal(result.previousUsername, 'gina');
    assert.deepEqual(updatedPayload, {
        id: 'user-7',
        payload: {
            username: 'gina-new',
            email: 'gina.new@example.com',
            emailVerified: true,
        },
    });
    assert.deepEqual(cleared, ['user-7']);
});

test('updateOwnProfile preserves an explicitly bound subscription email', () => {
    let updatedPayload = null;
    const cleared = [];
    const repo = {
        getById(id) {
            assert.equal(id, 'user-8');
            return {
                id: 'user-8',
                username: 'harry',
                role: 'user',
                email: 'harry@example.com',
                subscriptionEmail: 'harry-sub@example.com',
                emailVerified: true,
                profileVerifyCode: '112233',
                profileVerifyCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                profileVerifyTargetEmail: 'harry@example.com',
                profileVerifyUsername: 'harry-next',
                profileVerifyEmail: 'harry.new@example.com',
            };
        },
        update(id, payload) {
            updatedPayload = { id, payload };
            return {
                id,
                username: 'harry',
                role: 'user',
                email: payload.email,
                subscriptionEmail: 'harry-sub@example.com',
                emailVerified: true,
            };
        },
        clearProfileUpdateVerification(id) {
            cleared.push(id);
        },
    };

    const result = updateOwnProfile(
        { username: 'harry-next', email: 'harry.new@example.com', code: '112233' },
        { userId: 'user-8' },
        { userRepository: repo }
    );

    assert.equal(result.subscriptionEmailSynced, false);
    assert.deepEqual(updatedPayload, {
        id: 'user-8',
        payload: {
            username: 'harry-next',
            email: 'harry.new@example.com',
            emailVerified: true,
        },
    });
    assert.deepEqual(cleared, ['user-8']);
});

test('updateOwnProfile requires a username', () => {
    const repo = {
        getById() {
            return {
                id: 'user-9',
                username: 'ivy',
                role: 'user',
                email: 'ivy@example.com',
                subscriptionEmail: 'ivy@example.com',
                emailVerified: true,
            };
        },
    };

    assert.throws(
        () => updateOwnProfile(
            { username: '   ', email: 'ivy.new@example.com', code: '123456' },
            { userId: 'user-9' },
            { userRepository: repo }
        ),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, '请提供用户名');
            return true;
        }
    );
});

test('updateOwnProfile rejects updates without a verified current-email code', () => {
    const repo = {
        getById() {
            return {
                id: 'user-10',
                username: 'jane',
                role: 'user',
                email: 'jane@example.com',
                subscriptionEmail: 'jane@example.com',
                emailVerified: true,
                profileVerifyCode: '333333',
                profileVerifyCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                profileVerifyTargetEmail: 'jane@example.com',
                profileVerifyUsername: 'jane-next',
                profileVerifyEmail: 'jane.new@example.com',
            };
        },
    };

    assert.throws(
        () => updateOwnProfile(
            { username: 'jane-next', email: 'jane.new@example.com', code: '000000' },
            { userId: 'user-10' },
            { userRepository: repo }
        ),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, '验证码错误');
            return true;
        }
    );
});
