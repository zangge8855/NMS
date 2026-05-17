import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../../lib/telegram/commandRegistry.js';
import { createPendingActionStore } from '../../lib/telegram/pendingActions.js';
import { registerOpsCommands } from '../../lib/telegram/commands/ops.js';

function makeHelpers() {
    return {
        joinHtmlMessage: (title, blocks) => `${title}\n${blocks.join('\n\n')}`,
        sectionHeader: (title) => `## ${title}`,
        formatHtmlKeyValueRow: (label, value) => `${label}: ${value}`,
        formatHtmlDetailBlock: () => '',
        escapeTelegramHtml: (value) => String(value || ''),
        formatBytesHuman: (value) => `${value}B`,
        formatDateTime: (value) => String(value || ''),
        trimLines: (lines) => lines.filter(Boolean).join('\n'),
        appendHtmlSection: () => {},
    };
}

function makeMockUserAdmin(users) {
    const calls = { setManagedUserEnabled: [], updateManagedUserExpiry: [] };
    return {
        calls,
        api: {
            listUsers: () => users,
            setManagedUserEnabled: async (id, payload, actor) => {
                calls.setManagedUserEnabled.push({ id, payload, actor });
                return { target: { id }, enabled: !!payload?.enabled };
            },
            updateManagedUserExpiry: async (id, payload, actor) => {
                calls.updateManagedUserExpiry.push({ id, payload, actor });
                return { target: { id }, expiry: payload?.expiryTime };
            },
        },
    };
}

function makeMockAuditStore() {
    const events = [];
    return {
        events,
        api: { appendEvent: (entry) => { events.push(entry); return entry; } },
    };
}

function makeCtx({ users = [], audit }) {
    return {
        helpers: makeHelpers(),
        services: {
            async userAdmin() { return makeMockUserAdmin(users).api; },
            async auditRepository() { return audit.api; },
        },
    };
}

test('/client_freeze returns a confirmation prompt with a pending.execute, not direct execution', async () => {
    const registry = createCommandRegistry();
    const audit = makeMockAuditStore();
    const usersMock = makeMockUserAdmin([{ id: 'u1', email: 'a@b.c', enabled: true }]);
    // Replace the service factory so we keep one mock instance for assertion
    const ctx = {
        helpers: makeHelpers(),
        services: {
            async userAdmin() { return usersMock.api; },
            async auditRepository() { return audit.api; },
        },
    };
    registerOpsCommands(registry, ctx);

    const result = await registry.dispatch({
        command: '/client_freeze',
        args: { positional: ['a@b.c'], raw: 'a@b.c' },
    });
    assert.equal(result.kind, 'client_freeze_confirm');
    assert.equal(typeof result.pending.execute, 'function');
    assert.equal(usersMock.calls.setManagedUserEnabled.length, 0, 'execute should not run during dispatch');

    const execResult = await result.pending.execute({ actor: 'tg-user' });
    assert.equal(usersMock.calls.setManagedUserEnabled.length, 1);
    assert.equal(usersMock.calls.setManagedUserEnabled[0].payload.enabled, false);
    assert.match(execResult.kind, /freeze_result/);
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].event, 'telegram_client_freeze');
    assert.equal(audit.events[0].outcome, 'success');
});

test('/client_freeze with missing target reports missing args without touching the service', async () => {
    const registry = createCommandRegistry();
    const audit = makeMockAuditStore();
    registerOpsCommands(registry, makeCtx({ users: [], audit }));

    const result = await registry.dispatch({
        command: '/client_freeze',
        args: { positional: [], raw: '' },
    });
    assert.equal(result.kind, 'client_freeze_missing_args');
    assert.equal(result.pending, undefined);
});

test('/client_extend computes future expiry from the existing one, not from now', async () => {
    const registry = createCommandRegistry();
    const audit = makeMockAuditStore();
    const usersMock = makeMockUserAdmin([
        { id: 'u1', email: 'a@b.c', expiryTime: '2030-01-01T00:00:00.000Z' },
    ]);
    registerOpsCommands(registry, {
        helpers: makeHelpers(),
        services: {
            async userAdmin() { return usersMock.api; },
            async auditRepository() { return audit.api; },
        },
    });

    const result = await registry.dispatch({
        command: '/client_extend',
        args: { positional: ['a@b.c', '7'], raw: 'a@b.c 7' },
    });
    assert.equal(result.kind, 'client_extend_confirm');
    await result.pending.execute({ actor: 'tg' });
    const [{ payload }] = usersMock.calls.updateManagedUserExpiry;
    // 7 days from 2030-01-01 is 2030-01-08
    assert.equal(payload.expiryTime.startsWith('2030-01-08'), true);
});

test('/client_extend rejects non-positive day counts', async () => {
    const registry = createCommandRegistry();
    const audit = makeMockAuditStore();
    registerOpsCommands(registry, makeCtx({ users: [{ id: 'u1', email: 'a@b.c' }], audit }));

    const negative = await registry.dispatch({
        command: '/client_extend',
        args: { positional: ['a@b.c', '-3'], raw: 'a@b.c -3' },
    });
    assert.equal(negative.kind, 'client_extend_missing_args');
});
