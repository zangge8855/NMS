import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonObjectLike } from '../lib/normalize.js';

describe('parseJsonObjectLike', () => {
    it('returns object inputs as-is', () => {
        const value = { clients: [{ email: 'user@example.com' }] };
        assert.equal(parseJsonObjectLike(value), value);
    });

    it('parses JSON object strings', () => {
        assert.deepEqual(
            parseJsonObjectLike('{"clients":[{"email":"user@example.com"}]}'),
            { clients: [{ email: 'user@example.com' }] }
        );
    });

    it('falls back for invalid or non-object payloads', () => {
        const fallback = { clients: [] };
        assert.deepEqual(parseJsonObjectLike('[]', fallback), fallback);
        assert.deepEqual(parseJsonObjectLike('not-json', fallback), fallback);
        assert.deepEqual(parseJsonObjectLike('', fallback), fallback);
    });
});
