import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityHeadersMiddleware, redactRequestUrl } from '../lib/httpSecurity.js';

describe('redactRequestUrl', () => {
    it('redacts modern public subscription token secrets', () => {
        assert.equal(
            redactRequestUrl('/api/subscriptions/public/t/token-id/token-secret?format=raw'),
            '/api/subscriptions/public/t/token-id/[redacted]?format=raw'
        );
    });

    it('redacts legacy public subscription signatures and token secrets', () => {
        assert.equal(
            redactRequestUrl('/api/subscriptions/public/user@example.com/legacy-sig'),
            '/api/subscriptions/public/user@example.com/[redacted]'
        );
        assert.equal(
            redactRequestUrl('/api/subscriptions/public/user@example.com/token-id/token-secret'),
            '/api/subscriptions/public/user@example.com/token-id/[redacted]'
        );
    });

    it('redacts sensitive query values without changing normal paths', () => {
        assert.equal(
            redactRequestUrl('/api/auth/check?token=abc&next=/settings'),
            '/api/auth/check?token=%5Bredacted%5D&next=%2Fsettings'
        );
    });
});

describe('createSecurityHeadersMiddleware', () => {
    it('sets baseline browser hardening headers', () => {
        const headers = {};
        const middleware = createSecurityHeadersMiddleware({ nodeEnv: 'production' });
        middleware(
            {},
            { setHeader: (key, value) => { headers[key] = value; } },
            () => {}
        );

        assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
        assert.equal(headers['X-Frame-Options'], 'DENY');
        assert.equal(headers['X-Content-Type-Options'], 'nosniff');
        assert.equal(headers['Referrer-Policy'], 'no-referrer');
        assert.match(headers['Strict-Transport-Security'], /max-age=/);
    });

    it('allows HSTS to be disabled or tuned explicitly', () => {
        const disabledHeaders = {};
        createSecurityHeadersMiddleware({
            nodeEnv: 'production',
            hstsEnabled: false,
        })(
            {},
            { setHeader: (key, value) => { disabledHeaders[key] = value; } },
            () => {}
        );
        assert.equal(disabledHeaders['Strict-Transport-Security'], undefined);

        const tunedHeaders = {};
        createSecurityHeadersMiddleware({
            nodeEnv: 'development',
            hstsEnabled: true,
            hstsMaxAgeSeconds: 86400,
        })(
            {},
            { setHeader: (key, value) => { tunedHeaders[key] = value; } },
            () => {}
        );
        assert.equal(tunedHeaders['Strict-Transport-Security'], 'max-age=86400; includeSubDomains');
    });
});
