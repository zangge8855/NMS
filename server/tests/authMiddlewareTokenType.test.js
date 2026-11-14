import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-auth-middleware-token-type';

const { default: config } = await import('../config.js');
const { authMiddleware } = await import('../middleware/auth.js');
const { default: userStore } = await import('../store/userStore.js');

function runMiddleware(token) {
    const req = { headers: { authorization: `Bearer ${token}` } };
    let statusCode = null;
    let body = null;
    let nextCalled = false;
    const res = {
        status(code) { statusCode = code; return { json(payload) { body = payload; } }; },
    };
    authMiddleware(req, res, () => { nextCalled = true; });
    return { req, statusCode, body, nextCalled };
}

describe('authMiddleware token-type enforcement', () => {
    let secret;
    let testAdmin;
    before(() => {
        secret = config.jwt.secret;
        testAdmin = userStore.add({
            username: `mw_admin_${Date.now()}`,
            email: `mw_admin_${Date.now()}@example.com`,
            password: 'StrongPass123!',
            role: 'admin',
            enabled: true,
            emailVerified: true,
        });
    });

    after(() => {
        if (testAdmin?.id && userStore.getById(testAdmin.id)) {
            userStore.remove(testAdmin.id);
        }
    });

    it('accepts a normal session token (no type claim) for existing active user', () => {
        const token = jwt.sign(
            { userId: testAdmin.id, role: 'admin', username: testAdmin.username, tokenVersion: 1 },
            secret,
            { expiresIn: '5m' }
        );
        const { statusCode, nextCalled, req } = runMiddleware(token);
        assert.equal(nextCalled, true);
        assert.equal(statusCode, null);
        assert.equal(req.user.role, 'admin');
    });

    it('rejects tokens for deleted or non-existent users', () => {
        const token = jwt.sign(
            { userId: 'deleted-user-id', role: 'admin', username: 'ghost', tokenVersion: 1 },
            secret,
            { expiresIn: '5m' }
        );
        const { statusCode, nextCalled } = runMiddleware(token);
        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
    });

    it('rejects old tokens after password change or user disable', () => {
        const tempUser = userStore.add({
            username: `mw_user_${Date.now()}`,
            email: `mw_user_${Date.now()}@example.com`,
            password: 'StrongPass123!',
            role: 'user',
            enabled: true,
            emailVerified: true,
        });
        try {
            const oldToken = jwt.sign(
                { userId: tempUser.id, role: 'user', username: tempUser.username, tokenVersion: 1 },
                secret,
                { expiresIn: '5m' }
            );
            assert.equal(runMiddleware(oldToken).nextCalled, true);

            userStore.update(tempUser.id, { password: 'NewStrongPass456!' });
            const afterPwd = runMiddleware(oldToken);
            assert.equal(afterPwd.nextCalled, false);
            assert.equal(afterPwd.statusCode, 401);

            const current = userStore.getById(tempUser.id);
            const newToken = jwt.sign(
                { userId: tempUser.id, role: 'user', username: tempUser.username, tokenVersion: current.tokenVersion },
                secret,
                { expiresIn: '5m' }
            );
            assert.equal(runMiddleware(newToken).nextCalled, true);

            userStore.setEnabled(tempUser.id, false);
            const afterDisable = runMiddleware(newToken);
            assert.equal(afterDisable.nextCalled, false);
            assert.equal(afterDisable.statusCode, 403);
        } finally {
            userStore.remove(tempUser.id);
        }
    });

    it('rejects a 2FA challenge token used as a session bearer', () => {
        // Same secret, carries role — exactly the pre-second-factor bypass vector.
        const challenge = jwt.sign(
            { type: '2fa_challenge', userId: testAdmin.id, role: 'admin', username: testAdmin.username },
            secret,
            { audience: 'nms-2fa-challenge', expiresIn: '5m' }
        );
        const { statusCode, nextCalled } = runMiddleware(challenge);
        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
    });

    it('rejects a WebSocket ticket used as a session bearer', () => {
        const ticket = jwt.sign(
            { type: 'ws_ticket', userId: testAdmin.id, role: 'admin' },
            secret,
            { issuer: 'nms', audience: 'nms-ws', expiresIn: '30s' }
        );
        const { statusCode, nextCalled } = runMiddleware(ticket);
        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
    });

    it('rejects a token signed with a different secret', () => {
        const forged = jwt.sign({ userId: testAdmin.id, role: 'admin' }, 'some-other-secret', { expiresIn: '5m' });
        const { statusCode, nextCalled } = runMiddleware(forged);
        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
    });
});
