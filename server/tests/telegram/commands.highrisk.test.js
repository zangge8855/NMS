import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../../lib/telegram/commandRegistry.js';
import { registerHighRiskCommands } from '../../lib/telegram/commands/highrisk.js';

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

function makeMockRiskTokenStore({ issuedToken = 'tok-xyz', consumeOk = true, consumeReason = 'ok' } = {}) {
    const calls = { issue: [], consume: [] };
    return {
        calls,
        store: {
            issue(payload) {
                calls.issue.push(payload);
                return {
                    token: issuedToken,
                    ttlSeconds: payload.ttlSeconds,
                    operationKey: payload.operationKey,
                };
            },
            consume(payload) {
                calls.consume.push(payload);
                return { ok: consumeOk, reason: consumeReason };
            },
        },
    };
}

function makeMockUserAdmin(users) {
    const calls = { delete: [] };
    return {
        calls,
        api: {
            listUsers: () => users,
            deleteManagedUser: async (id) => { calls.delete.push(id); return { id }; },
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

test('/client_delete issues a risk token and runs deletion only after a successful consume', async () => {
    const registry = createCommandRegistry();
    const audit = makeMockAuditStore();
    const userAdmin = makeMockUserAdmin([{ id: 'u1', email: 'a@b.c' }]);
    const risk = makeMockRiskTokenStore();

    registerHighRiskCommands(
        registry,
        {
            helpers: makeHelpers(),
            services: {
                async userAdmin() { return userAdmin.api; },
                async auditRepository() { return audit.api; },
            },
        },
        { riskTokenStore: risk.store }
    );

    const result = await registry.dispatch({
        command: '/client_delete',
        args: { positional: ['a@b.c'], raw: 'a@b.c' },
    });
    assert.equal(result.kind, 'client_delete_confirm');
    assert.equal(risk.calls.issue.length, 1);
    assert.equal(risk.calls.issue[0].operationKey, 'telegram:client_delete:u1');
    assert.equal(userAdmin.calls.delete.length, 0);

    const execResult = await result.pending.execute({ actor: 'admin1' });
    assert.equal(risk.calls.consume.length, 1);
    assert.equal(userAdmin.calls.delete.length, 1);
    assert.equal(userAdmin.calls.delete[0], 'u1');
    assert.equal(execResult.kind, 'client_delete_result');
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].event, 'telegram_client_delete');
    assert.equal(audit.events[0].outcome, 'success');
});

test('/client_delete with an expired or rejected token throws and records a denied audit event', async () => {
    const registry = createCommandRegistry();
    const audit = makeMockAuditStore();
    const userAdmin = makeMockUserAdmin([{ id: 'u1', email: 'a@b.c' }]);
    const risk = makeMockRiskTokenStore({ consumeOk: false, consumeReason: 'invalid_token' });

    registerHighRiskCommands(
        registry,
        {
            helpers: makeHelpers(),
            services: {
                async userAdmin() { return userAdmin.api; },
                async auditRepository() { return audit.api; },
            },
        },
        { riskTokenStore: risk.store }
    );

    const result = await registry.dispatch({
        command: '/client_delete',
        args: { positional: ['a@b.c'], raw: 'a@b.c' },
    });
    await assert.rejects(() => result.pending.execute({ actor: 'admin1' }), /风控令牌校验失败/);
    assert.equal(userAdmin.calls.delete.length, 0, 'must not delete when token is bad');
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].outcome, 'denied');
    assert.match(audit.events[0].details.reason, /invalid_token/);
});

test('/client_delete refuses missing target', async () => {
    const registry = createCommandRegistry();
    const audit = makeMockAuditStore();
    const userAdmin = makeMockUserAdmin([]);
    const risk = makeMockRiskTokenStore();

    registerHighRiskCommands(
        registry,
        {
            helpers: makeHelpers(),
            services: {
                async userAdmin() { return userAdmin.api; },
                async auditRepository() { return audit.api; },
            },
        },
        { riskTokenStore: risk.store }
    );

    const result = await registry.dispatch({
        command: '/client_delete',
        args: { positional: [], raw: '' },
    });
    assert.equal(result.kind, 'client_delete_missing_args');
    assert.equal(risk.calls.issue.length, 0);
});
