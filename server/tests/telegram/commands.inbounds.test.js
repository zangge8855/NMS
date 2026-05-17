import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../../lib/telegram/commandRegistry.js';
import { createListSessionStore } from '../../lib/telegram/listSessions.js';
import { registerInboundCommands } from '../../lib/telegram/commands/inbounds.js';

function makeHelpers() {
    return {
        joinHtmlMessage: (title, blocks) => `${title}\n${blocks.join('\n\n')}`,
        sectionHeader: (title) => `## ${title}`,
        escapeTelegramHtml: (value) => String(value || ''),
    };
}

test('/inbounds renders cluster inbound summaries and pagination', async () => {
    const registry = createCommandRegistry();
    const inbounds = Array.from({ length: 9 }, (_, index) => ({
        id: index + 1,
        remark: `Inbound ${index + 1}`,
        protocol: 'vless',
        port: 20_000 + index,
        enable: index % 2 === 0,
    }));
    registerInboundCommands(registry, {
        helpers: makeHelpers(),
        listSessions: createListSessionStore(),
        services: {
            async serverStatus() {
                return {
                    collectClusterStatusSnapshot: async () => ({
                        panelSnapshots: [{
                            server: { id: 'srv-a', name: 'Node A' },
                            inbounds,
                        }],
                    }),
                };
            },
        },
    });

    const result = await registry.dispatch({
        command: '/inbounds',
        args: { positional: [], raw: '', page: 1 },
    });

    assert.equal(result.kind, 'inbounds_list');
    assert.match(result.text, /Inbound 1/);
    assert.match(result.text, /节点：Node A/);
    assert.match(result.text, /共.*9.*已启用.*5/);
    assert.ok(result.extras?.replyMarkup);
});
