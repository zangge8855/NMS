import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProtocolSummary, canonicalizeProtocolList, getProtocolSchema, normalizeProtocolKey } from '../lib/protocolCatalog.js';

describe('protocol catalog canonicalization', () => {
    it('maps legacy protocol names to the latest 3x-ui canonical names', () => {
        assert.equal(normalizeProtocolKey('dokodemo-door'), 'tunnel');
        assert.equal(normalizeProtocolKey('socks'), 'mixed');
        assert.equal(normalizeProtocolKey('TUNNEL'), 'tunnel');
        assert.equal(normalizeProtocolKey('hy2'), 'hysteria2');
        assert.equal(normalizeProtocolKey('HYSTERIA2'), 'hysteria2');
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
        assert.deepEqual(
            buildProtocolSummary('hy2'),
            {
                key: 'hysteria2',
                label: 'Hysteria2',
                legacyKeys: ['hy2'],
            }
        );
    });

    it('exposes hysteria and hysteria2 default settings', () => {
        const hysteria = getProtocolSchema('hysteria');
        assert.ok(hysteria, 'hysteria schema should exist');
        assert.equal(hysteria.defaultSettings.up_mbps, 100);
        assert.ok(Array.isArray(hysteria.defaultSettings.clients));

        const hysteria2 = getProtocolSchema('hysteria2');
        assert.ok(hysteria2, 'hysteria2 schema should exist');
        assert.equal(hysteria2.defaultSettings.up_mbps, 100);
        assert.equal(hysteria2.defaultSettings.ignore_client_bandwidth, false);
        assert.ok(hysteria2.defaultSettings.obfs);
        assert.ok(Array.isArray(hysteria2.defaultSettings.clients));
        assert.equal(getProtocolSchema('hy2'), hysteria2);
    });
});
