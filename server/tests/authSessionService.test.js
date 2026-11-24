import test from 'node:test';
import assert from 'node:assert/strict';
import {
    changeOwnPassword,
    createLoginSession,
    requestOwnProfileUpdateVerification,
    updateOwnProfile,
    validateSession,
    completeTwoFactorLogin,
    beginTwoFactorEnrollment,
    enableTwoFactor,
    disableTwoFactor,
    getTwoFactorStatus,
} from '../services/authSessionService.js';
import { generateTotp, generateTotpSecret } from '../lib/totp.js';

test('createLoginSession supports legacy admin password login', async () => {
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

    const result = await createLoginSession(
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

test('createLoginSession returns verify state for unverified users', async () => {
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

    const result = await createLoginSession(
        { username: 'alice', password: 'pass' },
        { userRepository: repo }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'email_not_verified');
    assert.equal(result.email, 'alice@example.com');
    assert.equal(result.audit.email, 'alice@example.com');
});

test('createLoginSession accepts a registered email as the login identifier', async () => {
    const repo = {
        authenticate(identifier, password) {
            assert.equal(identifier, 'alice@example.com');
            assert.equal(password, 'pass');
            return { id: 'user-1', username: 'alice', role: 'user' };
        },
        getByUsername(username) {
            assert.equal(username, 'alice');
            return {
                id: 'user-1',
                username: 'alice',
                role: 'user',
                email: 'alice@example.com',
                subscriptionEmail: 'alice@example.com',
                emailVerified: true,
                enabled: true,
            };
        },
    };

    const result = await createLoginSession(
        { identifier: 'alice@example.com', password: 'pass' },
        {
            userRepository: repo,
            jwtSign(payload) {
                return `token-for:${payload.username}`;
            },
            jwtConfig: { secret: 'ignored', expiresIn: '1d' },
        }
    );

    assert.equal(result.success, true);
    assert.equal(result.token, 'token-for:alice');
    assert.equal(result.user.username, 'alice');
    assert.equal(result.user.email, 'alice@example.com');
});

test('createLoginSession returns disabled users with audit metadata', async () => {
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

    const result = await createLoginSession(
        { username: 'dave', password: 'pass' },
        { userRepository: repo }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'user_disabled');
    assert.equal(result.audit.subscriptionEmail, 'sub-dave@example.com');
});

test('createLoginSession returns audit metadata for invalid password of known user', async () => {
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

    const result = await createLoginSession(
        { username: 'eve', password: 'wrong' },
        { userRepository: repo, authConfig: { allowLegacyPasswordLogin: false, adminPassword: 'ignored' } }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'invalid_credentials');
    assert.equal(result.audit.username, 'eve');
});

test('createLoginSession returns audit metadata for invalid password of known email login', async () => {
    const repo = {
        authenticate() {
            return null;
        },
        getByEmail(email) {
            if (email !== 'eve@example.com') return null;
            return {
                id: 'user-5',
                username: 'eve',
                role: 'user',
                email: 'eve@example.com',
                subscriptionEmail: 'eve@example.com',
            };
        },
        getByUsername(username) {
            if (username === 'admin') return null;
            return null;
        },
        list() {
            return [];
        },
    };

    const result = await createLoginSession(
        { identifier: 'eve@example.com', password: 'wrong' },
        { userRepository: repo, authConfig: { allowLegacyPasswordLogin: false, adminPassword: 'ignored' } }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'invalid_credentials');
    assert.equal(result.audit.username, 'eve');
    assert.equal(result.audit.email, 'eve@example.com');
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

test('changeOwnPassword rejects incorrect old password', async () => {
    const repo = {
        getById() {
            return { id: 'user-3', username: 'carol' };
        },
        authenticate() {
            return null;
        },
    };

    await assert.rejects(
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

test('changeOwnPassword updates password when old password is correct', async () => {
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

    const result = await changeOwnPassword(
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

test('requestOwnProfileUpdateVerification sends code to new email when current account has no email', async () => {
    const sent = [];
    const repo = {
        getById(id) {
            return {
                id: 'admin-initial',
                username: 'admin',
                role: 'admin',
                email: '',
                subscriptionEmail: '',
                emailVerified: false,
            };
        },
        setProfileUpdateVerification() {},
    };
    const fakeMailer = {
        generateVerifyCode() {
            return '123456';
        },
        async sendVerificationEmail(email, code, username) {
            sent.push({ email, code, username });
        },
    };

    const result = await requestOwnProfileUpdateVerification(
        { username: 'admin', email: 'admin.new@example.com' },
        { userId: 'admin-initial' },
        {
            userRepository: repo,
            mailer: fakeMailer,
            registrationConfig: { verifyCodeTtlMinutes: 10 },
        }
    );

    assert.equal(result.verificationEmail, 'admin.new@example.com');
    assert.deepEqual(sent, [{
        email: 'admin.new@example.com',
        code: '123456',
        username: 'admin',
    }]);
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

test('createLoginSession returns a 2FA challenge when the user has 2FA enabled', async () => {
    const totpSecret = generateTotpSecret();
    const repo = {
        authenticate() {
            return { id: 'admin-2fa', username: 'root', role: 'admin' };
        },
        getByUsername(username) {
            if (username === 'root') {
                return {
                    id: 'admin-2fa',
                    username: 'root',
                    role: 'admin',
                    email: 'root@example.com',
                    subscriptionEmail: 'root@example.com',
                    emailVerified: true,
                    enabled: true,
                };
            }
            return null;
        },
        getTwoFactor() {
            return { enabled: true, secret: totpSecret, backupCodeHashes: [] };
        },
        list() {
            return [];
        },
    };

    const result = await createLoginSession(
        { username: 'root', password: 'irrelevant' },
        {
            userRepository: repo,
            authConfig: { allowLegacyPasswordLogin: false, adminPassword: '' },
            jwtSign(payload, _secret, options = {}) {
                return options.audience === 'nms-2fa-challenge'
                    ? `challenge:${payload.userId}`
                    : `session:${payload.userId}`;
            },
            jwtConfig: { secret: 'ignored', expiresIn: '1d' },
        }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'two_factor_required');
    assert.equal(result.challengeToken, 'challenge:admin-2fa');
});

test('completeTwoFactorLogin succeeds with a valid TOTP code', () => {
    const totpSecret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotp(totpSecret, now);
    const repo = {
        getById(id) {
            if (id === 'admin-2fa') {
                return { id: 'admin-2fa', username: 'root', role: 'admin', email: 'root@example.com', subscriptionEmail: 'root@example.com' };
            }
            return null;
        },
        getTwoFactor() {
            return { enabled: true, secret: totpSecret, backupCodeHashes: [] };
        },
        consumeTwoFactorBackupCode() {
            return true;
        },
    };

    const result = completeTwoFactorLogin(
        { challengeToken: 'fake-challenge', code },
        {
            userRepository: repo,
            jwtSign(payload) {
                return `session:${payload.userId}`;
            },
            jwtVerify() {
                return { type: '2fa_challenge', userId: 'admin-2fa', username: 'root', role: 'admin' };
            },
            jwtConfig: { secret: 'ignored', expiresIn: '1d' },
        }
    );

    assert.equal(result.success, true);
    assert.equal(result.token, 'session:admin-2fa');
    assert.equal(result.audit.twoFactor, true);
});

test('completeTwoFactorLogin accepts each TOTP time step only once', () => {
    const totpSecret = generateTotpSecret();
    const code = generateTotp(totpSecret, Date.now());
    let lastUsedStep = 0;
    const recorded = [];
    const repo = {
        getById() {
            return { id: 'admin-2fa-replay', username: 'root', role: 'admin', email: 'root@example.com' };
        },
        getTwoFactor() {
            return { enabled: true, secret: totpSecret, backupCodeHashes: [], lastUsedStep };
        },
        recordTwoFactorStep(_id, step) {
            recorded.push(step);
            lastUsedStep = step;
            return true;
        },
        consumeTwoFactorBackupCode() {
            return true;
        },
    };
    const deps = {
        userRepository: repo,
        jwtSign(payload) {
            return `session:${payload.userId}`;
        },
        jwtVerify() {
            return { type: '2fa_challenge', userId: 'admin-2fa-replay', username: 'root', role: 'admin' };
        },
        jwtConfig: { secret: 'ignored', expiresIn: '1d' },
    };

    const first = completeTwoFactorLogin({ challengeToken: 'fake', code }, deps);
    assert.equal(first.success, true);
    assert.equal(recorded.length, 1);

    const replay = completeTwoFactorLogin({ challengeToken: 'fake', code }, deps);
    assert.equal(replay.success, false);
    assert.equal(replay.reason, 'invalid_code');
    assert.equal(replay.replayed, true);
    assert.equal(recorded.length, 1);
});

test('enableTwoFactor marks the enrollment code as used', () => {
    const totpSecret = generateTotpSecret();
    const code = generateTotp(totpSecret, Date.now());
    let saved = null;
    const repo = {
        getById: () => ({ id: 'admin-2fa-enroll', username: 'root', role: 'admin' }),
        getByUsername: () => ({ id: 'admin-2fa-enroll', username: 'root', role: 'admin' }),
        getTwoFactor: () => null,
        setTwoFactor(_id, payload) {
            saved = payload;
            return true;
        },
    };
    enableTwoFactor({ secret: totpSecret, code }, { userId: 'admin-2fa-enroll', username: 'root' }, { userRepository: repo });
    assert.ok(Number(saved.lastUsedStep) > 0);
});

test('completeTwoFactorLogin rejects wrong codes without throwing', () => {
    const totpSecret = generateTotpSecret();
    const repo = {
        getById() {
            return { id: 'admin-2fa', username: 'root', role: 'admin', email: 'root@example.com' };
        },
        getTwoFactor() {
            return { enabled: true, secret: totpSecret, backupCodeHashes: [] };
        },
        consumeTwoFactorBackupCode() {
            return true;
        },
    };

    const result = completeTwoFactorLogin(
        { challengeToken: 'fake-challenge', code: '000000' },
        {
            userRepository: repo,
            jwtVerify() {
                return { type: '2fa_challenge', userId: 'admin-2fa', username: 'root', role: 'admin' };
            },
            jwtConfig: { secret: 'ignored', expiresIn: '1d' },
        }
    );

    assert.equal(result.success, false);
    assert.equal(result.reason, 'invalid_code');
});

test('enableTwoFactor stores hashed backup codes after verifying the first TOTP', () => {
    const totpSecret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotp(totpSecret, now);
    let saved = null;
    const repo = {
        getById() {
            return { id: 'admin-2fa', username: 'root', role: 'admin' };
        },
        getByUsername() {
            return { id: 'admin-2fa', username: 'root', role: 'admin' };
        },
        getTwoFactor() {
            return saved ? { ...saved, enabled: true } : null;
        },
        setTwoFactor(_id, payload) {
            saved = payload;
            return true;
        },
    };

    const result = enableTwoFactor(
        { secret: totpSecret, code },
        { userId: 'admin-2fa', username: 'root' },
        { userRepository: repo }
    );
    assert.equal(result.enabled, true);
    assert.equal(result.backupCodes.length, 10);
    assert.ok(saved && saved.backupCodeHashes.length === 10);
});

test('disableTwoFactor requires the current password', async () => {
    const repo = {
        getById() {
            return { id: 'admin-2fa', username: 'root', role: 'admin' };
        },
        getByUsername() {
            return { id: 'admin-2fa', username: 'root', role: 'admin' };
        },
        authenticate(_id, password) {
            return password === 'goodpass' ? { id: 'admin-2fa', username: 'root', role: 'admin' } : null;
        },
        clearTwoFactor() {
            return true;
        },
    };

    await assert.rejects(
        () => disableTwoFactor({ password: 'badpass' }, { userId: 'admin-2fa', username: 'root' }, { userRepository: repo }),
        (error) => {
            assert.equal(error.status, 401);
            return true;
        }
    );

    const ok = await disableTwoFactor({ password: 'goodpass' }, { userId: 'admin-2fa', username: 'root' }, { userRepository: repo });
    assert.equal(ok.enabled, false);
});

test('beginTwoFactorEnrollment refuses when 2FA already enabled', () => {
    const repo = {
        getById() {
            return { id: 'admin-2fa', username: 'root', role: 'admin', email: 'root@example.com' };
        },
        getByUsername() {
            return { id: 'admin-2fa', username: 'root', role: 'admin', email: 'root@example.com' };
        },
        getTwoFactor() {
            return { enabled: true, secret: 'KQXG', backupCodeHashes: [] };
        },
    };
    assert.throws(
        () => beginTwoFactorEnrollment({ userId: 'admin-2fa', username: 'root' }, { userRepository: repo }),
        (err) => {
            assert.equal(err.status, 409);
            return true;
        }
    );
});

test('getTwoFactorStatus reports backupCodesRemaining', () => {
    const repo = {
        getById() {
            return { id: 'admin-2fa', username: 'root' };
        },
        getByUsername() {
            return { id: 'admin-2fa', username: 'root' };
        },
        getTwoFactor() {
            return { enabled: true, secret: 'KQXG', backupCodeHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] };
        },
    };
    const status = getTwoFactorStatus({ userId: 'admin-2fa', username: 'root' }, { userRepository: repo });
    assert.equal(status.enabled, true);
    assert.equal(status.backupCodesRemaining, 3);
});

test('validateSession rejects deleted users, stale tokenVersion, and role changes', () => {
    assert.throws(
        () => validateSession('Bearer abc', {
            userRepository: { getById: () => null, getByUsername: () => null },
            jwtVerify: () => ({ userId: 'missing', username: 'ghost', role: 'user' }),
            jwtConfig: { secret: 'ignored' },
        }),
        (err) => err.status === 401
    );

    assert.throws(
        () => validateSession('Bearer abc', {
            userRepository: {
                getById: () => ({ id: 'u1', username: 'alice', role: 'user', tokenVersion: 2 }),
            },
            jwtVerify: () => ({ userId: 'u1', username: 'alice', role: 'user', tokenVersion: 1 }),
            jwtConfig: { secret: 'ignored' },
        }),
        (err) => err.status === 401
    );

    assert.throws(
        () => validateSession('Bearer abc', {
            userRepository: {
                getById: () => ({ id: 'u1', username: 'alice', role: 'user', tokenVersion: 1 }),
            },
            jwtVerify: () => ({ userId: 'u1', username: 'alice', role: 'admin', tokenVersion: 1 }),
            jwtConfig: { secret: 'ignored' },
        }),
        (err) => err.status === 401
    );
});

test('completeTwoFactorLogin locks out repeated wrong TOTP attempts per user', () => {
    const totpSecret = generateTotpSecret();
    const repo = {
        getById() {
            return { id: 'admin-2fa-lockout', username: 'root', role: 'admin', email: 'root@example.com' };
        },
        getTwoFactor() {
            return { enabled: true, secret: totpSecret, backupCodeHashes: [] };
        },
        consumeTwoFactorBackupCode() {
            return true;
        },
    };
    const deps = {
        userRepository: repo,
        jwtVerify() {
            return { type: '2fa_challenge', userId: 'admin-2fa-lockout', username: 'root', role: 'admin' };
        },
        jwtConfig: { secret: 'ignored' },
    };

    for (let i = 0; i < 4; i += 1) {
        const res = completeTwoFactorLogin({ challengeToken: 'fake', code: '000000' }, deps);
        assert.equal(res.success, false);
    }

    assert.throws(
        () => completeTwoFactorLogin({ challengeToken: 'fake', code: '000000' }, deps),
        (err) => err.status === 429
    );
});

test('authSessionService localizes errors for en-US while keeping zh-CN defaults', async () => {
    const baseUser = {
        id: 'u-locale',
        username: 'alice',
        email: 'alice@example.com',
        profileVerifyCode: '123456',
        profileVerifyCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        profileVerifyTargetEmail: 'alice@example.com',
        profileVerifyUsername: 'alice2',
        profileVerifyEmail: 'alice2@example.com',
    };
    const missingUpdateRepo = {
        getById: () => baseUser,
        getByUsername: () => null,
        getByEmail: () => null,
        update: () => null,
        clearProfileUpdateVerification: () => {},
    };

    assert.throws(
        () => updateOwnProfile(
            { username: 'alice2', email: 'alice2@example.com', code: '123456' },
            { userId: 'u-locale' },
            { userRepository: missingUpdateRepo }
        ),
        (err) => err.status === 404 && err.message === '用户不存在'
    );

    assert.throws(
        () => updateOwnProfile(
            { username: 'alice2', email: 'alice2@example.com', code: '123456' },
            { userId: 'u-locale' },
            { userRepository: missingUpdateRepo, locale: 'en-US' }
        ),
        (err) => err.status === 404 && err.message === 'User not found'
    );

    await assert.rejects(
        () => changeOwnPassword(
            { oldPassword: 'wrong', newPassword: 'NewPassword#123' },
            { userId: 'u-locale' },
            {
                userRepository: {
                    getById: () => ({ id: 'u-locale', username: 'alice' }),
                    authenticate: () => null,
                },
                locale: 'en-US',
            }
        ),
        (err) => err.status === 401 && err.message === 'Current password is incorrect'
    );
});

test('createLoginSession issues persistent JWT when rememberMe=true and supports non-expiring TTL', async () => {
    const repo = {
        authenticate: async () => ({ id: 'u-persist', username: 'alice', role: 'admin' }),
        getByUsername: () => ({
            id: 'u-persist',
            username: 'alice',
            role: 'admin',
            email: 'alice@example.com',
            emailVerified: true,
            enabled: true,
            tokenVersion: 1,
        }),
    };

    const signCalls = [];
    const jwtSign = (payload, _secret, options) => {
        signCalls.push({ payload, options });
        return 'signed-jwt';
    };

    // rememberMe: true uses persistentExpiresIn and sets persistent: true
    const persistentResult = await createLoginSession(
        { username: 'alice', password: 'secret', rememberMe: true },
        {
            userRepository: repo,
            jwtSign,
            jwtConfig: { secret: 'sec', expiresIn: '24h', persistentExpiresIn: '365d' },
        }
    );
    assert.equal(persistentResult.success, true);
    assert.equal(persistentResult.persistent, true);
    assert.equal(signCalls[0].payload.persistent, true);
    assert.deepEqual(signCalls[0].options, { expiresIn: '365d' });

    // Non-expiring persistent JWT ('never') omits expiresIn
    await createLoginSession(
        { username: 'alice', password: 'secret', rememberMe: true },
        {
            userRepository: repo,
            jwtSign,
            jwtConfig: { secret: 'sec', expiresIn: '24h', persistentExpiresIn: 'never' },
        }
    );
    assert.equal(signCalls[1].payload.persistent, true);
    assert.equal(signCalls[1].options, undefined);

    // Explicit rememberMe: false uses regular session expiresIn without persistent claim
    const tempResult = await createLoginSession(
        { username: 'alice', password: 'secret', rememberMe: false },
        {
            userRepository: repo,
            jwtSign,
            jwtConfig: { secret: 'sec', expiresIn: '24h', persistentExpiresIn: '365d' },
        }
    );
    assert.equal(tempResult.persistent, false);
    assert.equal(signCalls[2].payload.persistent, undefined);
    assert.deepEqual(signCalls[2].options, { expiresIn: '24h' });
});

test('validateSession returns a sliding refreshedToken for aged persistent tokens and skips fresh or non-expiring ones', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const repo = {
        getById: () => ({
            id: 'u-persist',
            username: 'alice',
            role: 'admin',
            email: 'alice@example.com',
            enabled: true,
            tokenVersion: 1,
        }),
    };

    // Aged >= 24h: issued 2 days ago, expires in 363 days -> triggers sliding refresh
    const slidingResult = validateSession('Bearer old-persistent-jwt', {
        userRepository: repo,
        jwtVerify: () => ({
            userId: 'u-persist',
            username: 'alice',
            role: 'admin',
            tokenVersion: 1,
            persistent: true,
            iat: nowSec - 2 * 86400,
            exp: nowSec + 363 * 86400,
        }),
        jwtSign: (payload, _secret, options) => `refreshed:${payload.username}:${options?.expiresIn}`,
        jwtConfig: { secret: 'sec', expiresIn: '24h', persistentExpiresIn: '365d' },
    });
    assert.equal(slidingResult.persistent, true);
    assert.equal(slidingResult.refreshedToken, 'refreshed:alice:365d');

    // Fresh persistent token: issued 1 hour ago, expires in ~365 days -> no unnecessary refresh
    const freshResult = validateSession('Bearer fresh-persistent-jwt', {
        userRepository: repo,
        jwtVerify: () => ({
            userId: 'u-persist',
            username: 'alice',
            role: 'admin',
            tokenVersion: 1,
            persistent: true,
            iat: nowSec - 3600,
            exp: nowSec + 365 * 86400 - 3600,
        }),
        jwtSign: () => 'should-not-sign',
        jwtConfig: { secret: 'sec', expiresIn: '24h', persistentExpiresIn: '365d' },
    });
    assert.equal(freshResult.persistent, true);
    assert.equal(freshResult.refreshedToken, undefined);

    // Non-expiring persistent token (no exp) -> no refresh needed
    const neverExpireResult = validateSession('Bearer never-expire-jwt', {
        userRepository: repo,
        jwtVerify: () => ({
            userId: 'u-persist',
            username: 'alice',
            role: 'admin',
            tokenVersion: 1,
            persistent: true,
            iat: nowSec - 500 * 86400,
        }),
        jwtSign: () => 'should-not-sign',
        jwtConfig: { secret: 'sec', expiresIn: '24h', persistentExpiresIn: 'never' },
    });
    assert.equal(neverExpireResult.persistent, true);
    assert.equal(neverExpireResult.refreshedToken, undefined);
});
