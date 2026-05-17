import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingActionStore } from '../../lib/telegram/pendingActions.js';

function withFakeClock() {
    let now = 1_700_000_000_000;
    return {
        nowFn: () => now,
        advance(ms) { now += ms; },
    };
}

test('pendingActions.create stores payload and returns a short id', () => {
    const clock = withFakeClock();
    const store = createPendingActionStore({
        now: clock.nowFn,
        startInterval: () => null, // no real timers in tests
    });

    const record = store.create({ command: '/freeze', target: 'foo@bar.com' });
    assert.match(record.id, /^[0-9a-f]{8}$/);
    assert.equal(record.payload.command, '/freeze');
    assert.equal(store.size(), 1);
});

test('pendingActions.take removes the entry on first read', () => {
    const clock = withFakeClock();
    const store = createPendingActionStore({ now: clock.nowFn, startInterval: () => null });

    const created = store.create({ command: '/x' });
    const first = store.take(created.id);
    assert.equal(first?.payload.command, '/x');
    const second = store.take(created.id);
    assert.equal(second, null);
    assert.equal(store.size(), 0);
});

test('pendingActions auto-expires entries after ttlMs', () => {
    const clock = withFakeClock();
    const store = createPendingActionStore({
        ttlMs: 60_000,
        now: clock.nowFn,
        startInterval: () => null,
    });

    const created = store.create({ command: '/x' });
    clock.advance(59_999);
    assert.equal(store.peek(created.id)?.payload.command, '/x');
    clock.advance(2);
    assert.equal(store.peek(created.id), null);
    assert.equal(store.size(), 0);
});

test('pendingActions.sweepNow proactively clears expired entries', () => {
    const clock = withFakeClock();
    const store = createPendingActionStore({
        ttlMs: 60_000,
        now: clock.nowFn,
        startInterval: () => null,
    });

    store.create({ command: '/a' });
    store.create({ command: '/b' });
    clock.advance(70_000);
    assert.equal(store.size(), 2);
    store.sweepNow();
    assert.equal(store.size(), 0);
});

test('pendingActions allows per-create ttl override', () => {
    const clock = withFakeClock();
    const store = createPendingActionStore({
        ttlMs: 60_000,
        now: clock.nowFn,
        startInterval: () => null,
    });

    const long = store.create({ command: '/long' }, { ttlMs: 120_000 });
    clock.advance(70_000);
    assert.equal(store.peek(long.id)?.payload.command, '/long');
});

test('pendingActions.clear removes a specific entry', () => {
    const clock = withFakeClock();
    const store = createPendingActionStore({ now: clock.nowFn, startInterval: () => null });

    const record = store.create({ command: '/x' });
    assert.equal(store.clear(record.id), true);
    assert.equal(store.clear(record.id), false);
    assert.equal(store.peek(record.id), null);
});

test('pendingActions.reset wipes everything', () => {
    const clock = withFakeClock();
    const store = createPendingActionStore({ now: clock.nowFn, startInterval: () => null });

    store.create({ command: '/a' });
    store.create({ command: '/b' });
    assert.equal(store.size(), 2);
    store.reset();
    assert.equal(store.size(), 0);
});
