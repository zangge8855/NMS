/**
 * Command registry for the Telegram bot.
 *
 * Each entry is a uniform descriptor:
 *   {
 *     name: '/client_delete',        // required, includes leading slash
 *     aliases: ['/del_client'],      // optional
 *     level: 'query'|'write'|'high-risk', // required, drives confirmation flow
 *     summary: '删除客户',            // shown in /help
 *     args: [{ name, required }],    // optional, declarative arg schema
 *     handler: async ({ args, ctx }) => ({ text, kind, extras? }),
 *   }
 *
 * Step 1 only wires the 'query' level — handlers run immediately. The
 * 'write' and 'high-risk' branches added in later steps will go through
 * pendingActions + inline keyboards instead of executing inline.
 */

function normalizeCommandName(raw = '') {
    const text = String(raw || '').trim();
    if (!text) return '';
    const lower = text.toLowerCase();
    return lower.startsWith('/') ? lower : `/${lower}`;
}

export function createCommandRegistry() {
    const entriesByName = new Map();
    const orderedEntries = [];

    function register(entry) {
        if (!entry || typeof entry !== 'object') {
            throw new Error('registry.register requires an entry object');
        }
        const name = normalizeCommandName(entry.name);
        if (!name) throw new Error('registry.register requires entry.name');
        if (entriesByName.has(name)) {
            throw new Error(`Telegram command already registered: ${name}`);
        }
        const level = String(entry.level || 'query').toLowerCase();
        if (!['query', 'write', 'high-risk'].includes(level)) {
            throw new Error(`Telegram command ${name} has unsupported level: ${entry.level}`);
        }
        if (typeof entry.handler !== 'function') {
            throw new Error(`Telegram command ${name} requires a handler function`);
        }
        const normalized = {
            ...entry,
            name,
            level,
            aliases: Array.from(new Set((entry.aliases || []).map(normalizeCommandName).filter(Boolean))),
            summary: String(entry.summary || '').trim(),
            args: Array.isArray(entry.args) ? entry.args : [],
        };
        entriesByName.set(name, normalized);
        for (const alias of normalized.aliases) {
            if (entriesByName.has(alias)) {
                throw new Error(`Telegram alias collides: ${alias}`);
            }
            entriesByName.set(alias, normalized);
        }
        orderedEntries.push(normalized);
    }

    function get(name) {
        return entriesByName.get(normalizeCommandName(name)) || null;
    }

    function list({ level } = {}) {
        if (!level) return [...orderedEntries];
        return orderedEntries.filter((entry) => entry.level === level);
    }

    async function dispatch({ command, args = {}, ctx = {} }) {
        const entry = get(command);
        if (!entry) {
            return { kind: 'unknown_command', text: null, entry: null };
        }
        const result = await entry.handler({ args, ctx, entry });
        return {
            kind: result?.kind || 'command',
            text: result?.text || '',
            extras: result?.extras,
            pending: result?.pending,
            entry,
        };
    }

    return { register, get, list, dispatch };
}

export const __testing = { normalizeCommandName };
