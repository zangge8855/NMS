import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = path.join(__dirname, '.test_data');
process.env.NODE_ENV = 'test';

const { shouldUseInboundTotalFallback } = await import('../store/trafficStatsStore.js');

describe('traffic stats inbound fallback', () => {
    it('uses inbound totals when client traffic is absent', () => {
        assert.equal(shouldUseInboundTotalFallback(false, false), true);
        assert.equal(shouldUseInboundTotalFallback(false, true), true);
    });

    it('uses inbound totals when client traffic fields exist but no delta was captured', () => {
        assert.equal(shouldUseInboundTotalFallback(true, false), true);
    });

    it('skips inbound totals only when client traffic is both available and captured', () => {
        assert.equal(shouldUseInboundTotalFallback(true, true), false);
    });
});
