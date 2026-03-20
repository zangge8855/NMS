import { buildClientOnlineKeys, buildOnlineMatchMap, countClientOnlineSessions, normalizeOnlineKeys } from './clientPresence.js';

describe('clientPresence', () => {
    it('normalizes mixed online identifiers into unique lookup keys', () => {
        expect(normalizeOnlineKeys({
            email: 'Alice@Example.com',
            user: 'alice@example.com',
            id: 'UUID-A',
            password: 'Secret-Key',
        })).toEqual([
            'alice@example.com',
            'uuid-a',
            'secret-key',
        ]);
    });

    it('counts each matched online session once even when multiple identifiers overlap', () => {
        const client = {
            email: 'alice@example.com',
            id: '11111111-1111-1111-1111-111111111111',
        };
        const onlineMatchMap = buildOnlineMatchMap([
            {
                email: 'alice@example.com',
                id: '11111111-1111-1111-1111-111111111111',
            },
            {
                user: 'alice@example.com',
            },
        ]);

        expect(buildClientOnlineKeys(client, 'vless')).toContain('alice@example.com');
        expect(countClientOnlineSessions(client, 'vless', onlineMatchMap)).toBe(2);
    });
});
