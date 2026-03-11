import { moveUserToPosition, normalizeUserOrder, sortUsersByOrder } from './userOrder.js';

describe('user order helpers', () => {
    it('normalizes and de-duplicates user order arrays', () => {
        expect(normalizeUserOrder([' user-a ', 'user-b', 'user-a', '', null])).toEqual([
            'user-a',
            'user-b',
        ]);
    });

    it('sorts users by persisted order before fallback sort', () => {
        const users = [
            { id: 'user-b', username: 'B' },
            { id: 'user-a', username: 'A' },
            { id: 'user-c', username: 'C' },
        ];

        expect(sortUsersByOrder(users, ['user-c', 'user-a'], (left, right) => (
            String(left?.username || '').localeCompare(String(right?.username || ''))
        )).map((item) => item.id)).toEqual(['user-c', 'user-a', 'user-b']);
    });

    it('moves a user to the requested zero-based position', () => {
        const result = moveUserToPosition([
            { id: 'user-a' },
            { id: 'user-b' },
            { id: 'user-c' },
        ], 'user-c', 0);

        expect(result.changed).toBe(true);
        expect(result.userIds).toEqual(['user-c', 'user-a', 'user-b']);
    });
});
