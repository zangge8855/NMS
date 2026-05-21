import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isInboundAllowedByPolicy,
    isServerAllowedByPolicy,
    resolveEffectivePolicy,
} from '../lib/userPolicyResolver.js';

test('resolveEffectivePolicy inherits group policy when the user has no explicit policy', () => {
    const policy = resolveEffectivePolicy(
        { id: 'u-1', groupId: 'g-1' },
        { updatedAt: null },
        {
            id: 'g-1',
            name: 'Premium',
            serverScopeMode: 'selected',
            allowedServerIds: ['srv-1', 'srv-2'],
            blockedServerIds: ['srv-2'],
            allowedInboundKeys: ['srv-1:101'],
        }
    );

    assert.equal(policy.source, 'group');
    assert.equal(policy.inheritGroup, true);
    assert.deepEqual(policy.allowedServerIds, ['srv-1']);
    assert.deepEqual(policy.blockedServerIds, ['srv-2']);
    assert.equal(isServerAllowedByPolicy(policy, 'srv-1'), true);
    assert.equal(isServerAllowedByPolicy(policy, 'srv-2'), false);
    assert.equal(isInboundAllowedByPolicy(policy, 'srv-1', '101'), true);
    assert.equal(isInboundAllowedByPolicy(policy, 'srv-1', '102'), false);
});

test('resolveEffectivePolicy applies only declared user overrides on inherited groups', () => {
    const policy = resolveEffectivePolicy(
        { id: 'u-1', groupId: 'g-1' },
        {
            inheritGroup: true,
            overrideFields: ['limitIp'],
            limitIp: 2,
            trafficLimitBytes: 999,
            updatedAt: '2026-05-21T00:00:00.000Z',
        },
        {
            id: 'g-1',
            name: 'Premium',
            limitIp: 5,
            trafficLimitBytes: 1024,
        }
    );

    assert.equal(policy.limitIp, 2);
    assert.equal(policy.trafficLimitBytes, 1024);
});

test('resolveEffectivePolicy keeps explicit user policy when inheritance is disabled', () => {
    const policy = resolveEffectivePolicy(
        { id: 'u-1', groupId: 'g-1' },
        {
            inheritGroup: false,
            serverScopeMode: 'selected',
            allowedServerIds: ['srv-user'],
            updatedAt: '2026-05-21T00:00:00.000Z',
        },
        {
            id: 'g-1',
            name: 'Premium',
            allowedServerIds: ['srv-group'],
        }
    );

    assert.equal(policy.source, 'user');
    assert.deepEqual(policy.allowedServerIds, ['srv-user']);
});
