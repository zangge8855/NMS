import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isReservedSubscriptionAliasPath,
    normalizeSubscriptionAliasPath,
    validateSubscriptionAliasPath,
} from '../lib/subscriptionAlias.js';

test('normalizeSubscriptionAliasPath extracts and normalizes a pasted URL path', () => {
    assert.equal(
        normalizeSubscriptionAliasPath('https://legacy.example.com/Sub/Client-A/?format=clash'),
        '/sub/client-a'
    );
});

test('validateSubscriptionAliasPath rejects reserved and invalid paths', () => {
    assert.equal(validateSubscriptionAliasPath('/api/subscriptions/demo').ok, false);
    assert.equal(validateSubscriptionAliasPath('/with space').ok, false);
    assert.equal(isReservedSubscriptionAliasPath('/clients/demo'), true);
});

test('validateSubscriptionAliasPath enforces uniqueness through the supplied lookup', () => {
    const result = validateSubscriptionAliasPath('/sub/client-a', {
        findByPath(path) {
            if (path === '/sub/client-a') {
                return { id: 'existing-user' };
            }
            return null;
        },
        excludeUserId: 'other-user',
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /已被其他用户占用/);
});
