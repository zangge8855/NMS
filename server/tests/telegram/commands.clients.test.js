import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../../lib/telegram/commandRegistry.js';
import { registerClientCommands } from '../../lib/telegram/commands/clients.js';

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

function makeCtx(users = []) {
    return {
        helpers: makeHelpers(),
        services: {
            async userAdmin() {
                return {
                    listUsers: () => users,
                };
            },
        },
    };
}

test('/clients lists non-admin users and surfaces total count', async () => {
    const registry = createCommandRegistry();
    registerClientCommands(registry, makeCtx([
        { id: 'a', role: 'admin', email: 'admin@x' },
        { id: 'u1', email: 'u1@example.com', enabled: true },
        { id: 'u2', email: 'u2@example.com', enabled: false, expiryTime: '2027-01-01T00:00:00.000Z' },
    ]));

    const result = await registry.dispatch({ command: '/clients', args: { positional: [], raw: '' } });
    assert.equal(result.kind, 'clients_list');
    assert.match(result.text, /u1@example.com/);
    assert.match(result.text, /u2@example.com/);
    assert.doesNotMatch(result.text, /admin@x/);
    assert.match(result.text, /共.*2/);
});

test('/clients filters by case-insensitive keyword on email / username / id', async () => {
    const registry = createCommandRegistry();
    registerClientCommands(registry, makeCtx([
        { id: 'u1', email: 'alice@example.com', enabled: true },
        { id: 'u2', username: 'bob', enabled: true },
        { id: 'u3', email: 'charlie@example.com', enabled: true },
    ]));

    const result = await registry.dispatch({
        command: '/clients',
        args: { positional: ['ALICE'], raw: 'ALICE' },
    });
    assert.match(result.text, /alice@example.com/);
    assert.doesNotMatch(result.text, /bob/);
    assert.doesNotMatch(result.text, /charlie/);
});

test('/clients returns empty result when keyword matches nothing', async () => {
    const registry = createCommandRegistry();
    registerClientCommands(registry, makeCtx([
        { id: 'u1', email: 'alice@example.com', enabled: true },
    ]));

    const result = await registry.dispatch({
        command: '/clients',
        args: { positional: ['zzz'], raw: 'zzz' },
    });
    assert.equal(result.kind, 'clients_empty');
});

test('/client requires an id or email argument', async () => {
    const registry = createCommandRegistry();
    registerClientCommands(registry, makeCtx([]));

    const result = await registry.dispatch({ command: '/client', args: { positional: [], raw: '' } });
    assert.equal(result.kind, 'client_missing_args');
});

test('/client renders details when found', async () => {
    const registry = createCommandRegistry();
    registerClientCommands(registry, makeCtx([
        {
            id: 'u1',
            email: 'alice@example.com',
            username: 'alice',
            enabled: true,
            expiryTime: '2027-01-01T00:00:00.000Z',
            trafficUsedBytes: 100,
            trafficLimitBytes: 1000,
            limitIp: 2,
        },
    ]));

    const result = await registry.dispatch({
        command: '/client',
        args: { positional: ['alice@example.com'], raw: 'alice@example.com' },
    });
    assert.equal(result.kind, 'client_detail');
    assert.match(result.text, /alice@example.com/);
    assert.match(result.text, /alice/);
    assert.match(result.text, /100B \/ 1000B/);
    assert.match(result.text, /IP 限: 2/);
});

test('/client reports not-found for unknown identifiers', async () => {
    const registry = createCommandRegistry();
    registerClientCommands(registry, makeCtx([
        { id: 'u1', email: 'alice@example.com' },
    ]));

    const result = await registry.dispatch({
        command: '/client',
        args: { positional: ['ghost@example.com'], raw: 'ghost@example.com' },
    });
    assert.equal(result.kind, 'client_not_found');
});

test('/sub surfaces existing tokens without issuing new ones', async () => {
    const registry = createCommandRegistry();
    registerClientCommands(registry, makeCtx([
        {
            id: 'u1',
            email: 'alice@example.com',
            subscriptionEmail: 'sub@example.com',
            subscriptionTokens: [{ id: 'abcdef1234', profile: 'default' }],
        },
    ]));

    const result = await registry.dispatch({
        command: '/sub',
        args: { positional: ['alice@example.com'], raw: 'alice@example.com' },
    });
    assert.equal(result.kind, 'sub_detail');
    assert.match(result.text, /token.*abcdef12/);
    assert.match(result.text, /Token 数: 1/);
});
