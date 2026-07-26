import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-auth-middleware-token-type';

const { default: config } = await import('../config.js');
const { authMiddleware } = await import('../middleware/auth.js');

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
    before(() => { secret = config.jwt.secret; });

    it('accepts a normal session token (no type claim)', () => {
        const token = jwt.sign({ userId: 'u1', role: 'admin', username: 'root' }, secret, { expiresIn: '5m' });
        const { statusCode, nextCalled, req } = runMiddleware(token);
        assert.equal(nextCalled, true);
        assert.equal(statusCode, null);
        assert.equal(req.user.role, 'admin');
    });

    it('rejects a 2FA challenge token used as a session bearer', () => {
        // Same secret, carries role — exactly the pre-second-factor bypass vector.
        const challenge = jwt.sign(
            { type: '2fa_challenge', userId: 'u1', role: 'admin', username: 'root' },
            secret,
            { audience: 'nms-2fa-challenge', expiresIn: '5m' }
        );
        const { statusCode, nextCalled } = runMiddleware(challenge);
        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
    });

    it('rejects a WebSocket ticket used as a session bearer', () => {
        const ticket = jwt.sign(
            { type: 'ws_ticket', userId: 'u1', role: 'admin' },
            secret,
            { issuer: 'nms', audience: 'nms-ws', expiresIn: '30s' }
        );
        const { statusCode, nextCalled } = runMiddleware(ticket);
        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
    });

    it('rejects a token signed with a different secret', () => {
        const forged = jwt.sign({ userId: 'u1', role: 'admin' }, 'some-other-secret', { expiresIn: '5m' });
        const { statusCode, nextCalled } = runMiddleware(forged);
        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
    });
});
