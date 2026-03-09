import test from 'node:test';
import assert from 'node:assert/strict';
import {
    changeOwnPassword,
    createLoginSession,
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
