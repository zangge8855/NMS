import test from 'node:test';
import assert from 'node:assert/strict';
import { createListSessionStore } from '../../lib/telegram/listSessions.js';

function withClock() {
    let now = 1_700_000_000_000;
    return {
        now: () => now,
        advance(ms) {
            now += ms;
        },
    };
}

test('listSessions stores and refreshes paginated callback context', () => {
    const clock = withClock();
    const store = createListSessionStore({ ttlMs: 60_000, now: clock.now });
    const session = store.create({ command: '/clients', positional: ['alice'] });

    assert.match(session.id, /^[0-9a-f]{8}$/);
    assert.equal(store.get(session.id)?.payload.command, '/clients');

    clock.advance(59_000);
    assert.equal(store.get(session.id)?.payload.positional[0], 'alice');
    clock.advance(59_000);
    assert.equal(store.get(session.id)?.payload.command, '/clients');
});

test('listSessions expires stale entries', () => {
    const clock = withClock();
    const store = createListSessionStore({ ttlMs: 60_000, now: clock.now });
    const session = store.create({ command: '/servers' });

    clock.advance(60_001);
    assert.equal(store.get(session.id), null);
    assert.equal(store.size(), 0);
});
