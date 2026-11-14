import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    canAccessSubscriptionEmail,
    collectViewerIdentities,
    normalizeSubscriptionIdentity,
} from '../lib/subscriptionAccess.js';

describe('subscription access identity helpers', () => {
    it('normalizes identifiers for comparison', () => {
        assert.equal(normalizeSubscriptionIdentity('  User@Example.COM '), 'user@example.com');
        assert.equal(normalizeSubscriptionIdentity(''), '');
    });

    it('grants admin global access', () => {
        assert.equal(canAccessSubscriptionEmail({ role: 'admin' }, 'any@example.com'), true);
    });

    it('does not grant non-admin global access', () => {
        assert.equal(canAccessSubscriptionEmail({ role: 'user' }, 'any@example.com'), false);
    });

    it('collects user identities from token and stored profile', () => {
        const identities = collectViewerIdentities(
            { role: 'user', userId: 'u1', username: 'plainname' },
            {
                findUserById: () => ({
                    username: 'plainname',
                    email: 'user@example.com',
                    subscriptionEmail: 'bound@example.com',
                }),
            }
        );

        assert.deepEqual(
            identities.sort(),
            ['bound@example.com'].sort()
        );
    });

    it('denies user access by login email when explicit binding exists', () => {
        const allowed = canAccessSubscriptionEmail(
            { role: 'user', userId: 'u1', username: 'plainname' },
            'User@Example.com',
            {
                findUserById: () => ({
                    username: 'plainname',
                    email: 'user@example.com',
                    subscriptionEmail: 'bound@example.com',
                }),
            }
        );
        assert.equal(allowed, false);
    });

    it('allows user access when requested email matches bound subscription email', () => {
        const allowed = canAccessSubscriptionEmail(
            { role: 'user', userId: 'u1', username: 'plainname' },
            'bound@example.com',
            {
                findUserById: () => ({
                    username: 'plainname',
                    email: 'user@example.com',
                    subscriptionEmail: 'bound@example.com',
                }),
            }
        );
        assert.equal(allowed, true);
    });

    it('allows user access by email for legacy profile without binding field', () => {
        const allowed = canAccessSubscriptionEmail(
            { role: 'user', userId: 'u1', username: 'plainname' },
            'User@Example.com',
            {
                findUserById: () => ({
                    username: 'plainname',
                    email: 'user@example.com',
                }),
            }
        );
        assert.equal(allowed, true);
    });

    it('allows user access by email when subscriptionEmail is empty string', () => {
        const allowed = canAccessSubscriptionEmail(
            { role: 'user', userId: 'u1', username: 'plainname' },
            'User@Example.com',
            {
                findUserById: () => ({
                    username: 'plainname',
                    email: 'user@example.com',
                    subscriptionEmail: '',
                }),
            }
        );
        assert.equal(allowed, true);
    });

    it('denies user access when requested value only matches username', () => {
        const allowed = canAccessSubscriptionEmail(
            { role: 'user', userId: 'u1', username: 'plainname' },
            'plainname',
            {
                findUserById: () => ({
                    username: 'plainname',
                    email: 'user@example.com',
                }),
            }
        );
        assert.equal(allowed, false);
    });

    it('denies user access to unrelated email', () => {
        const allowed = canAccessSubscriptionEmail(
            { role: 'user', userId: 'u1', username: 'plainname' },
            'another@example.com',
            {
                findUserById: () => ({
                    username: 'plainname',
                    email: 'user@example.com',
                }),
            }
        );
        assert.equal(allowed, false);
    });

    it('keeps subscription tokens verifiable after JWT_SECRET rotation and rejects forged legacy signatures', async () => {
        const config = (await import('../config.js')).default;
        const {
            default: subscriptionTokenStore,
            signLegacySubscriptionEmail,
        } = await import('../store/subscriptionTokenStore.js');

        const prevJwt = config.jwt.secret;
        const prevSub = config.subscription.tokenSecret;
        const prevLegacy = [...(config.subscription.legacySecrets || [])];
        const origTokens = subscriptionTokenStore.exportState();
        const origSave = subscriptionTokenStore._save;
        subscriptionTokenStore._save = () => {};

        try {
            config.subscription.tokenSecret = 'dedicated-sub-secret-0123456789abcdef';
            const issued = subscriptionTokenStore.issue('rot@example.com', { name: 'rot-test' });
            assert.equal(subscriptionTokenStore.verify('rot@example.com', issued.tokenId, issued.tokenSecret).ok, true);

            // Rotating JWT_SECRET does not break tokens signed/encrypted with subscription token secret
            config.jwt.secret = 'brand-new-jwt-secret-should-not-invalidate-sub-tokens';
            assert.equal(subscriptionTokenStore.verify('rot@example.com', issued.tokenId, issued.tokenSecret).ok, true);

            // Rotating subscription secret preserves verification via legacySecrets fallback
            config.subscription.legacySecrets = ['dedicated-sub-secret-0123456789abcdef'];
            config.subscription.tokenSecret = 'newer-sub-secret-0123456789abcdef0123';
            assert.equal(subscriptionTokenStore.verify('rot@example.com', issued.tokenId, issued.tokenSecret).ok, true);

            // migrateLegacySigToken rejects forged signature and accepts valid HMAC signature
            assert.equal(subscriptionTokenStore.migrateLegacySigToken('rot@example.com', 'forged-signature'), null);
            const validSig = signLegacySubscriptionEmail('rot@example.com');
            const migrated = subscriptionTokenStore.migrateLegacySigToken('rot@example.com', validSig);
            assert.ok(migrated);
            assert.equal(migrated.tokenSecret, validSig);
        } finally {
            subscriptionTokenStore._save = origSave;
            subscriptionTokenStore.importState(origTokens);
            config.jwt.secret = prevJwt;
            config.subscription.tokenSecret = prevSub;
            config.subscription.legacySecrets = prevLegacy;
        }
    });
});
