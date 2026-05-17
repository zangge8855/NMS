import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../../lib/telegram/commandRegistry.js';
import { createListSessionStore } from '../../lib/telegram/listSessions.js';
import { registerServerCommands } from '../../lib/telegram/commands/servers.js';

function makeHelpers() {
    return {
        joinHtmlMessage: (title, blocks) => `${title}\n${blocks.join('\n\n')}`,
        sectionHeader: (title) => `## ${title}`,
        escapeTelegramHtml: (value) => String(value || ''),
    };
}

test('/servers reads the live cluster item payload and renders node rows', async () => {
    const registry = createCommandRegistry();
    registerServerCommands(registry, {
        helpers: makeHelpers(),
        listSessions: createListSessionStore(),
        services: {
            async serverStatus() {
                return {
                    collectClusterStatusSnapshot: async () => ({
                        items: [{
                            serverId: 'srv-a',
                            name: 'Node A',
                            health: 'healthy',
                            onlineCount: 3,
                            status: { cpu: 22, mem: { current: 1, total: 2 } },
                        }],
                        summary: {
                            total: 1,
                            healthy: 1,
                            degraded: 0,
                            unreachable: 0,
                        },
                    }),
                };
            },
        },
    });

    const result = await registry.dispatch({
        command: '/servers',
        args: { positional: [], raw: '', page: 1 },
    });

    assert.equal(result.kind, 'servers_list');
    assert.match(result.text, /Node A/);
    assert.match(result.text, /正常/);
    assert.match(result.text, /CPU 22%/);
    assert.match(result.text, /MEM 50%/);
});
