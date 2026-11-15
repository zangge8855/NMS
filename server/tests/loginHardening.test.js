import test from 'node:test';
import assert from 'node:assert/strict';

import { LoginThrottle } from '../lib/loginThrottle.js';
import { timingSafeStringEqual } from '../lib/safeCompare.js';
import { findTotpCounter, generateTotp, generateTotpSecret } from '../lib/totp.js';

test('LoginThrottle blocks after maxFailures and releases after the window', () => {
    const throttle = new LoginThrottle({ windowMs: 1000, maxFailures: 3, maxEntries: 10 });
    const t0 = 10_000;
    assert.equal(throttle.recordFailure('k', t0), false);
    assert.equal(throttle.recordFailure('k', t0 + 1), false);
    assert.equal(throttle.state('k', t0 + 2).blocked, false);
    assert.equal(throttle.recordFailure('k', t0 + 2), true, 'third failure triggers the block');
    const blocked = throttle.state('k', t0 + 3);
    assert.equal(blocked.blocked, true);
    assert.ok(blocked.retryAfterMs > 0);
    assert.equal(throttle.state('k', t0 + 2 + 1001).blocked, false, 'block expires');
});

test('LoginThrottle keeps tracking when the map is full and never evicts an active block first', () => {
    const throttle = new LoginThrottle({ windowMs: 60_000, maxFailures: 2, maxEntries: 3 });
    const now = 1_000_000;
    throttle.recordFailure('victim', now);
    throttle.recordFailure('victim', now);
    assert.equal(throttle.state('victim', now).blocked, true);

    // Flood with fresh keys: the old implementation stopped recording new keys here.
    for (let i = 0; i < 20; i += 1) {
        throttle.recordFailure(`noise-${i}`, now + i);
    }
    assert.ok(throttle.size <= 3);
    assert.equal(throttle.state('victim', now + 30).blocked, true, 'active block survives the flood');

    throttle.recordFailure('late', now + 40);
    throttle.recordFailure('late', now + 41);
    assert.equal(throttle.state('late', now + 42).blocked, true, 'new keys are still tracked when full');
});

test('timingSafeStringEqual matches equal strings and never matches empty or non-strings', () => {
    assert.equal(timingSafeStringEqual('s3cret-value', 's3cret-value'), true);
    assert.equal(timingSafeStringEqual('s3cret-value', 's3cret-valuf'), false);
    assert.equal(timingSafeStringEqual('short', 'a-much-longer-value'), false);
    assert.equal(timingSafeStringEqual('', ''), false);
    assert.equal(timingSafeStringEqual('x', ''), false);
    assert.equal(timingSafeStringEqual(undefined, undefined), false);
    assert.equal(timingSafeStringEqual(Buffer.from('a'), 'a'), false);
});

test('findTotpCounter returns the matched time step inside the drift window', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    assert.equal(findTotpCounter(generateTotp(secret, now), secret, now), step);
    assert.equal(findTotpCounter(generateTotp(secret, now - 30_000), secret, now), step - 1);
    assert.equal(findTotpCounter(generateTotp(secret, now - 5 * 30_000), secret, now), null);
    assert.equal(findTotpCounter('abc', secret, now), null);
});

test('userStore persists the last accepted TOTP step and only moves it forward', async () => {
    const { default: userStore, ROLES } = await import('../store/userStore.js');
    const user = userStore.add({ username: `totp_step_${Date.now()}`, password: 'TotpStep#123', role: ROLES.operator });
    const secret = generateTotpSecret();
    assert.equal(userStore.setTwoFactor(user.id, { secret, backupCodeHashes: [], lastUsedStep: 100 }), true);
    assert.equal(userStore.getTwoFactor(user.id).lastUsedStep, 100);
    assert.equal(userStore.recordTwoFactorStep(user.id, 99), false);
    assert.equal(userStore.recordTwoFactorStep(user.id, 101), true);
    assert.equal(userStore.getTwoFactor(user.id).lastUsedStep, 101);
});

test('userStore.authenticate is asynchronous and rejects unknown users after hashing', async () => {
    const { default: userStore, ROLES } = await import('../store/userStore.js');
    const username = `async_auth_${Date.now()}`;
    userStore.add({ username, password: 'AsyncAuth#123', role: ROLES.operator });
    const pending = userStore.authenticate(username, 'AsyncAuth#123');
    assert.equal(typeof pending.then, 'function');
    assert.equal((await pending)?.username, username);
    assert.equal(await userStore.authenticate(username, 'wrong-password'), null);
    assert.equal(await userStore.authenticate(`missing_${username}`, 'AsyncAuth#123'), null);
});
