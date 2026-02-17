/**
 * Backend API Tests — userStore + auth middleware + role access
 *
 * Run: node --test server/tests/userStore.test.js
 * Requires Node.js >= 18 (built-in test runner)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Override data dir to use temp location for tests
const TEST_DATA_DIR = path.join(__dirname, '.test_data');
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests';
process.env.ADMIN_USERNAME = 'cluster-admin-test';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.NODE_ENV = 'test';

// Clean test data before tests
function cleanTestData() {
    if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
}

describe('UserStore', { concurrency: false }, () => {
    let userStore;
    let ROLES;
    let runtimeConfig;

    before(async () => {
        cleanTestData();
        const module = await import('../store/userStore.js');
        userStore = module.default;
        ROLES = module.ROLES;
        runtimeConfig = (await import('../config.js')).default;
        // Force a clean baseline in case shared module cache preloaded a different DATA_DIR.
        userStore.users = [];
        userStore._save();
        userStore._ensureDefaultAdmin();
    });

    after(() => {
        cleanTestData();
    });

    it('should have created a default admin user', () => {
        const users = userStore.getAll();
        assert.ok(users.length >= 1, 'Should have at least 1 user');
        const admin = users.find(u => u.role === ROLES.admin);
        assert.ok(admin, 'Should have an admin user');
    });

    it('should authenticate with the default admin password', () => {
        const users = userStore.getAll();
        const admin = users.find(u => u.role === ROLES.admin);
        assert.ok(admin, 'Should have an admin user');
        const result = userStore.authenticate(admin.username, runtimeConfig.auth.adminPassword);
        assert.ok(result, 'Should authenticate successfully');
        assert.equal(result.role, ROLES.admin);
        assert.equal(result.username, admin.username);
    });

    it('should reject wrong password', () => {
        const result = userStore.authenticate('cluster-admin-test', 'wrong-password');
        assert.equal(result, null, 'Should fail authentication');
    });

    it('should reject auth when password is missing', () => {
        assert.equal(userStore.authenticate('cluster-admin-test'), null);
        assert.equal(userStore.authenticate('cluster-admin-test', null), null);
    });

    it('should create a new user', () => {
        const user = userStore.add({ username: 'user1', password: 'Pass1234!', role: ROLES.user });
        assert.ok(user.id, 'Should have an ID');
        assert.equal(user.username, 'user1');
        assert.equal(user.role, ROLES.user);
    });

    it('should preserve explicit empty subscription binding', () => {
        const user = userStore.add({
            username: 'user_bind_empty',
            password: 'Pass1234!',
            role: ROLES.user,
            email: 'bind-empty@example.com',
            subscriptionEmail: '',
        });
        assert.equal(user.subscriptionEmail, '');
        const stored = userStore.getByUsername('user_bind_empty');
        assert.equal(stored.subscriptionEmail, '');
        assert.equal(userStore.getBySubscriptionEmail('bind-empty@example.com'), null);
    });

    it('should authenticate the new user', () => {
        const result = userStore.authenticate('user1', 'Pass1234!');
        assert.ok(result, 'Should authenticate');
        assert.equal(result.role, ROLES.user);
    });

    it('should reject duplicate username', () => {
        assert.throws(
            () => userStore.add({ username: 'user1', password: 'another123', role: ROLES.user }),
            /已存在/
        );
    });

    it('should reject duplicate username with surrounding spaces on create', () => {
        assert.throws(
            () => userStore.add({ username: ' user1 ', password: 'Pass1234!', role: ROLES.user }),
            /已存在/
        );
    });

    it('should reject short password', () => {
        assert.throws(
            () => userStore.add({ username: 'shortpass', password: '123', role: ROLES.user }),
            /至少 8 位/
        );
    });

    it('should reject password with insufficient character types', () => {
        assert.throws(
            () => userStore.add({ username: 'weaktype', password: 'abcdefgh12', role: ROLES.user }),
            /3 类/
        );
    });

    it('should update user role', () => {
        const users = userStore.getAll();
        const usr = users.find(u => u.username === 'user1');
        const upgraded = userStore.update(usr.id, { role: ROLES.admin });
        assert.equal(upgraded.role, ROLES.admin);
        const downgraded = userStore.update(usr.id, { role: ROLES.user });
        assert.equal(downgraded.role, ROLES.user);
    });

    it('should reject duplicate username with surrounding spaces on update', () => {
        const other = userStore.add({ username: 'user2', password: 'Pass1234!', role: ROLES.user });
        assert.throws(
            () => userStore.update(other.id, { username: ' user1 ' }),
            /已存在/
        );
        const removed = userStore.remove(other.id);
        assert.equal(removed, true);
    });

    it('should update user password', () => {
        const users = userStore.getAll();
        const usr = users.find(u => u.username === 'user1');
        userStore.update(usr.id, { password: 'NewPass789!' });
        const result = userStore.authenticate('user1', 'NewPass789!');
        assert.ok(result, 'Should auth with new password');
    });

    it('should set and clear password reset code', () => {
        const users = userStore.getAll();
        const admin = users.find(u => u.role === ROLES.admin);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const setOk = userStore.setPasswordResetCode(admin.id, '123456', expiresAt);
        assert.equal(setOk, true);

        const withCode = userStore.getById(admin.id);
        assert.equal(withCode.resetCode, '123456');
        assert.equal(withCode.resetCodeExpiresAt, expiresAt);

        const clearOk = userStore.clearPasswordResetCode(admin.id);
        assert.equal(clearOk, true);
        const cleared = userStore.getById(admin.id);
        assert.equal(cleared.resetCode, null);
        assert.equal(cleared.resetCodeExpiresAt, null);
    });

    it('should clear password reset code after password update', () => {
        const users = userStore.getAll();
        const admin = users.find(u => u.role === ROLES.admin);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        userStore.setPasswordResetCode(admin.id, '654321', expiresAt);

        userStore.update(admin.id, { password: 'admin-new-pass-2026' });
        const updated = userStore.getById(admin.id);
        assert.equal(updated.resetCode, null);
        assert.equal(updated.resetCodeExpiresAt, null);
    });

    it('should not delete the last admin', () => {
        const users = userStore.getAll();
        const admin = users.find(u => u.role === ROLES.admin);
        assert.throws(
            () => userStore.remove(admin.id),
            /不能删除最后一个管理员/
        );
    });

    it('should delete a non-admin user', () => {
        const users = userStore.getAll();
        const usr = users.find(u => u.username === 'user1');
        const ok = userStore.remove(usr.id);
        assert.equal(ok, true);
        assert.equal(userStore.getByUsername('user1'), null);
    });

    it('should support backward-compatible password-only auth', () => {
        const result = userStore.authenticate('', runtimeConfig.auth.adminPassword);
        assert.ok(result, 'Should authenticate with password-only');
        assert.equal(result.role, ROLES.admin);
    });
});

describe('Role Definitions', () => {
    let ROLES;

    before(async () => {
        const module = await import('../store/userStore.js');
        ROLES = module.ROLES;
    });

    it('should have 2 roles', () => {
        const roles = Object.values(ROLES);
        assert.equal(roles.length, 2);
        assert.ok(roles.includes('admin'));
        assert.ok(roles.includes('user'));
    });
});

describe('requireRole middleware', () => {
    let requireRole;

    before(async () => {
        const module = await import('../middleware/auth.js');
        requireRole = module.requireRole;
    });

    it('should allow matching role', () => {
        const middleware = requireRole('admin', 'user');
        const req = { user: { role: 'user' } };
        let nextCalled = false;
        const res = {
            status: () => ({ json: () => { } }),
        };
        middleware(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('should deny non-matching role', () => {
        const middleware = requireRole('admin');
        const req = { user: { role: 'user' } };
        let statusCode = null;
        const res = {
            status: (code) => { statusCode = code; return { json: () => { } }; },
        };
        middleware(req, res, () => { assert.fail('Should not have called next'); });
        assert.equal(statusCode, 403);
    });

    it('should deny when no user', () => {
        const middleware = requireRole('admin');
        const req = {};
        let statusCode = null;
        const res = {
            status: (code) => { statusCode = code; return { json: () => { } }; },
        };
        middleware(req, res, () => { assert.fail('Should not have called next'); });
        assert.equal(statusCode, 401);
    });
});
