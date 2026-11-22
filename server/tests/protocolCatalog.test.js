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

    it('exposes the 3x-ui 3.x Hysteria defaults (version 2, auth secret, hysteria transport)', () => {
        for (const key of ['hysteria', 'hysteria2']) {
            const schema = getProtocolSchema(key);
            assert.ok(schema, `${key} schema should exist`);
            assert.equal(schema.defaultSettings.version, 2);
            assert.ok(Array.isArray(schema.defaultSettings.clients));
            assert.equal(schema.defaultSettings.clients[0].auth, '');
            assert.equal(schema.defaultSettings.obfs, undefined);
            assert.deepEqual(schema.supports.transports, ['hysteria']);
            assert.deepEqual(schema.supports.securities, ['tls']);
        }
        assert.equal(getProtocolSchema('hy2'), getProtocolSchema('hysteria2'));
    });

    it('exposes the MTProto defaults with per-client secrets', () => {
        const mtproto = getProtocolSchema('mtproto');
        assert.ok(mtproto, 'mtproto schema should exist');
        assert.equal(mtproto.label, 'MTProto');
        assert.equal(mtproto.defaultSettings.fakeTlsDomain, 'www.cloudflare.com');
        assert.equal(mtproto.defaultSettings.clients[0].secret, '');
        assert.equal(mtproto.defaultSettings.secret, undefined);
    });

    it('exposes WireGuard server defaults whose clients are filled by the panel', () => {
        const wg = getProtocolSchema('wireguard');
        assert.ok(wg, 'wireguard schema should exist');
        assert.equal(wg.label, 'WireGuard');
        assert.equal(wg.defaultSettings.mtu, 1420);
        assert.equal(wg.defaultSettings.subnetIp, '10.0.0.0');
        assert.equal(wg.defaultSettings.subnetCidr, 24);
        assert.deepEqual(wg.defaultSettings.peers, []);
        assert.ok(Array.isArray(wg.defaultSettings.clients));
        assert.equal(wg.defaultSettings.jc, undefined);
    });

    it('exposes AmneziaWG obfuscation defaults inside server', () => {
        const awg = getProtocolSchema('amneziawg');
        assert.ok(awg);
        assert.equal(awg.defaultSettings.server.jc, 5);
        assert.equal(awg.defaultSettings.server.jmin, 10);
        assert.equal(awg.defaultSettings.server.jmax, 50);
        assert.equal(awg.defaultSettings.server.s4, 5);
    });

    it('exposes the TUIC server block and clients', () => {
        const tuic = getProtocolSchema('tuic');
        assert.ok(tuic, 'tuic schema should exist');
        assert.equal(tuic.label, 'TUIC');
        assert.equal(tuic.defaultSettings.server.congestion_control, 'bbr');
        assert.deepEqual(tuic.defaultSettings.server.alpn, ['h3']);
        assert.ok(Array.isArray(tuic.defaultSettings.clients));
        assert.equal(tuic.defaultSettings.users, undefined);
    });

    it('exposes Tunnel rewrite defaults instead of the legacy address/port fields', () => {
        const tunnel = getProtocolSchema('dokodemo-door');
        assert.ok(tunnel);
        assert.equal(tunnel.key, 'tunnel');
        assert.equal(tunnel.defaultSettings.allowedNetwork, 'tcp,udp');
        assert.deepEqual(tunnel.defaultSettings.portMap, {});
        assert.equal(tunnel.defaultSettings.port, undefined);
    });

    it('exposes MASQUE with its own transport', () => {
        const masque = getProtocolSchema('masque');
        assert.ok(masque);
        assert.deepEqual(masque.supports.transports, ['masque']);
        assert.deepEqual(masque.defaultSettings.address, ['10.14.0.1/24', 'fd14::1/64']);
    });
});
