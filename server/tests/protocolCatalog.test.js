import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProtocolSummary, canonicalizeProtocolList, normalizeProtocolKey } from '../lib/protocolCatalog.js';

describe('protocol catalog canonicalization', () => {
    it('maps legacy protocol names to the latest 3x-ui canonical names', () => {
        assert.equal(normalizeProtocolKey('dokodemo-door'), 'tunnel');
        assert.equal(normalizeProtocolKey('socks'), 'mixed');
        assert.equal(normalizeProtocolKey('TUNNEL'), 'tunnel');
    });

    it('deduplicates canonical protocol lists', () => {
        assert.deepEqual(
            canonicalizeProtocolList(['vmess', 'dokodemo-door', 'tunnel', 'socks', 'mixed']),
            ['vmess', 'tunnel', 'mixed']
        );
    });

    it('builds protocol summaries with latest label and legacy aliases', () => {
        assert.deepEqual(
            buildProtocolSummary('dokodemo-door'),
            {
                key: 'tunnel',
                label: 'Tunnel',
                legacyKeys: ['dokodemo-door'],
            }
        );
    });
});
