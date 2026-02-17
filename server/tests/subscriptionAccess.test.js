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
});
