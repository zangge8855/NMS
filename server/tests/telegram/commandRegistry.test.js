import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../../lib/telegram/commandRegistry.js';

test('commandRegistry registers and resolves commands by name and alias', async () => {
    const registry = createCommandRegistry();
    const handler = async () => ({ text: 'ok', kind: 'noop' });
    registry.register({
        name: '/noop',
        aliases: ['/no_op'],
        level: 'query',
        summary: 'noop',
        handler,
    });

    assert.equal(registry.get('/noop')?.name, '/noop');
    assert.equal(registry.get('/no_op')?.name, '/noop');
    assert.equal(registry.get('/missing'), null);

    const result = await registry.dispatch({ command: '/noop' });
    assert.equal(result.kind, 'noop');
    assert.equal(result.text, 'ok');
});

test('commandRegistry rejects duplicate names and bad levels', () => {
    const registry = createCommandRegistry();
    registry.register({ name: '/a', level: 'query', handler: async () => ({}) });
    assert.throws(() => registry.register({ name: '/a', level: 'query', handler: async () => ({}) }), /already registered/);
    assert.throws(() => registry.register({ name: '/b', level: 'wat', handler: async () => ({}) }), /unsupported level/);
    assert.throws(() => registry.register({ name: '', level: 'query', handler: async () => ({}) }), /entry.name/);
    assert.throws(() => registry.register({ name: '/c', level: 'query' }), /handler/);
});

test('commandRegistry dispatch returns unknown_command for missing commands', async () => {
    const registry = createCommandRegistry();
    const result = await registry.dispatch({ command: '/does_not_exist' });
    assert.equal(result.kind, 'unknown_command');
    assert.equal(result.text, null);
});

test('commandRegistry dispatches write commands through their handler so the caller can manage pendingActions', async () => {
    const registry = createCommandRegistry();
    registry.register({
        name: '/write_thing',
        level: 'write',
        handler: async () => ({ text: 'pending text', kind: 'write_thing', pending: { execute: async () => ({ text: 'done' }) } }),
    });
    const result = await registry.dispatch({ command: '/write_thing' });
    assert.equal(result.kind, 'write_thing');
    assert.equal(result.text, 'pending text');
    assert.equal(typeof result.pending.execute, 'function');
    assert.equal(result.entry.level, 'write');
});

test('commandRegistry list filters by level', () => {
    const registry = createCommandRegistry();
    registry.register({ name: '/q1', level: 'query', handler: async () => ({}) });
    registry.register({ name: '/q2', level: 'query', handler: async () => ({}) });
    registry.register({ name: '/w1', level: 'write', handler: async () => ({}) });
    assert.equal(registry.list().length, 3);
    assert.equal(registry.list({ level: 'query' }).length, 2);
    assert.equal(registry.list({ level: 'write' }).length, 1);
});

test('commandRegistry normalizes command names: trims, lowercases, adds leading slash', () => {
    const registry = createCommandRegistry();
    registry.register({ name: 'STATUS', level: 'query', handler: async () => ({ text: 't', kind: 'status' }) });
    assert.equal(registry.get('status')?.name, '/status');
    assert.equal(registry.get('/STATUS')?.name, '/status');
});
