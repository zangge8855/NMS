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

    it('verifies public token IDs created with pre-upgrade jwt.secret or derived -credentials secret and decrypts legacy server credentials', async () => {
        const { default: config } = await import('../config.js');
        const { default: subscriptionTokenStore } = await import('../store/subscriptionTokenStore.js');
        const { default: serverStore } = await import('../store/serverStore.js');

        const prevJwt = config.jwt.secret;
        const prevCred = config.credentials.secret;
        const prevCredLegacy = config.credentials.legacySecrets;
        const prevSub = config.subscription.tokenSecret;
        const prevLegacy = config.subscription.legacySecrets;
        const origSave = subscriptionTokenStore._save;
        const origTokens = subscriptionTokenStore.exportState();

        subscriptionTokenStore._save = () => {};
        try {
            const legacyJwtSecret = 'legacy-jwt-secret-upgrade-check-123456';
            config.jwt.secret = legacyJwtSecret;
            config.credentials.secret = '';
            config.credentials.legacySecrets = [];
            config.subscription.tokenSecret = '';
            config.subscription.legacySecrets = [];

            // Pre-upgrade token hashed with config.jwt.secret
            const legacyJwtIssued = subscriptionTokenStore.issue('upgrade-jwt@example.com', {
                name: 'pre-93ad836-jwt',
                noExpiry: true,
                ignoreActiveLimit: true,
                createdBy: 'test',
            });

            // Legacy token / credential hashed or encrypted with `${jwtSecret}-credentials`
            config.credentials.secret = `${legacyJwtSecret}-credentials`;
            config.subscription.tokenSecret = `${legacyJwtSecret}-credentials`;
            const legacyDerivedIssued = subscriptionTokenStore.issue('upgrade-derived@example.com', {
                name: 'pre-93ad836-derived',
                noExpiry: true,
                ignoreActiveLimit: true,
                createdBy: 'test',
            });
            const legacyEncryptedPassword = serverStore._encryptPassword('panel-secret-pass');

            // Simulate post-upgrade dedicated CREDENTIALS_SECRET
            const upgradedSecret = 'new-prod-credentials-secret-upgrade-check-987654';
            config.credentials.secret = upgradedSecret;
            config.subscription.tokenSecret = upgradedSecret;

            const verifyJwt = subscriptionTokenStore.verifyByTokenId(
                legacyJwtIssued.publicTokenId,
                legacyJwtIssued.tokenSecret
            );
            assert.equal(verifyJwt.ok, true);
            assert.equal(verifyJwt.reason, 'ok');
            assert.equal(verifyJwt.email, 'upgrade-jwt@example.com');

            const verifyInternalId = subscriptionTokenStore.verifyByTokenId(
                legacyJwtIssued.tokenId,
                legacyJwtIssued.tokenSecret
            );
            assert.equal(verifyInternalId.ok, true);

            const verifyDerived = subscriptionTokenStore.verifyByTokenId(
                legacyDerivedIssued.publicTokenId,
                legacyDerivedIssued.tokenSecret
            );
            assert.equal(verifyDerived.ok, true);
            assert.equal(verifyDerived.email, 'upgrade-derived@example.com');

            assert.equal(
                subscriptionTokenStore.verifyByTokenId(legacyJwtIssued.publicTokenId, 'wrong-secret').reason,
                'invalid-secret'
            );
            assert.equal(
                subscriptionTokenStore.verifyByTokenId('nonexistent-public-id', legacyJwtIssued.tokenSecret).reason,
                'not-found'
            );

            // Decrypt legacy panel password encrypted with `${jwtSecret}-credentials`
            const decryptedLegacy = serverStore._decryptPasswordDetailed(legacyEncryptedPassword);
            assert.equal(decryptedLegacy.status, 'ok');
            assert.equal(decryptedLegacy.value, 'panel-secret-pass');

            subscriptionTokenStore.revoke('upgrade-jwt@example.com', legacyJwtIssued.metadata.id);
            assert.equal(
                subscriptionTokenStore.verifyByTokenId(legacyJwtIssued.publicTokenId, legacyJwtIssued.tokenSecret).reason,
                'revoked'
            );

            const expiringIssued = subscriptionTokenStore.issue('upgrade-exp@example.com', {
                name: 'expiring-token',
                ttlDays: 1,
                ignoreActiveLimit: true,
                createdBy: 'test',
            });
            const rawRecord = subscriptionTokenStore.getTokenByPublicId(expiringIssued.publicTokenId);
            rawRecord.expiresAt = new Date(Date.now() - 60_000).toISOString();
            assert.equal(
                subscriptionTokenStore.verifyByTokenId(expiringIssued.publicTokenId, expiringIssued.tokenSecret).reason,
                'expired'
            );
        } finally {
            subscriptionTokenStore._save = origSave;
            subscriptionTokenStore.importState(origTokens);
            config.jwt.secret = prevJwt;
            config.credentials.secret = prevCred;
            config.credentials.legacySecrets = prevCredLegacy;
            config.subscription.tokenSecret = prevSub;
            config.subscription.legacySecrets = prevLegacy;
        }
    });
});
