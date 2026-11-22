import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DATA_DIR = path.join(os.tmpdir(), `nms-sui-editor-test-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = TEST_DATA_DIR;

const { ensureAuthenticated } = await import('../lib/panelClient.js');
const { default: serverStore } = await import('../store/serverStore.js');
const compat = await import('../lib/panelApiCompat.js');
const { xuiInboundPayloadToSui, suiTlsProfileMatches, readWantedSuiTls } = await import('../lib/suiPanelAdapter.js');
const { decodeX25519Key, encodeRealityKey, x25519PublicKeyFromPrivate } = await import('../lib/xuiInboundNormalizer.js');
const { startFakeSuiPanel } = await import('../scripts/fakeSuiPanel.js');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const PANEL_CERT = { webCertFile: '/etc/s-ui/cert.pem', webKeyFile: '/etc/s-ui/key.pem' };

function baseClient(id, name, config, inbounds) {
    return {
        id, enable: true, name, config, inbounds, links: [], volume: 0, expiry: 0, up: 0, down: 0,
        desc: '', group: '', remark: '', createdAt: 1700000000, onlineAt: 0, delayStart: false,
        autoReset: false, resetDays: 0, nextReset: 0, totalUp: 0, totalDown: 0,
    };
}

function seedState(extra = {}) {
    return {
        username: 'admin',
        password: 'secret',
        tls: [
            {
                id: 1,
                name: 'reality',
                server: { enabled: true, server_name: 'www.example.com', reality: { enabled: true, handshake: { server: 'www.example.com', server_port: 443 }, private_key: 'priv', short_id: ['ab12'] } },
                client: { utls: { enabled: true, fingerprint: 'chrome' }, reality: { enabled: true, public_key: 'pub', short_id: 'ab12' } },
            },
            // A TLS profile without a certificate cannot serve an inbound.
            { id: 2, name: 'bare', server: { enabled: true, server_name: 'node.example.com' }, client: {} },
        ],
        inbounds: [
            { id: 1, type: 'vless', tag: 'vless-reality', enable: true, tls_id: 1, listen: '::', listen_port: 443, addrs: [], out_json: {} },
        ],
        clients: [
            baseClient(1, 'alice', {
                vless: { name: 'alice', uuid: UUID_A, flow: 'xtls-rprx-vision' },
                naive: { username: 'alice', password: 'pw-alice' },
                trojan: { name: 'alice', password: 'pw-alice' },
            }, [1]),
            baseClient(2, 'bob', { vless: { name: 'bob', uuid: UUID_B, flow: '' } }, [1]),
        ],
        ...extra,
    };
}

let panel;

async function connect(extra) {
    if (panel) await panel.close();
    panel = await startFakeSuiPanel(seedState(extra));
    const server = serverStore.add({
        name: `sui-${Math.random().toString(16).slice(2, 8)}`,
        url: panel.url,
        basePath: panel.basePath,
        panelType: 's-ui',
        username: 'admin',
        password: 'secret',
    });
    return ensureAuthenticated(server.id);
}

function inboundByTag(tag) {
    return panel.state.inbounds.find((item) => item.tag === tag);
}

function tlsStream(extra = {}) {
    return JSON.stringify({ network: 'tcp', security: 'tls', tlsSettings: { serverName: 'node.example.com', certificates: [{ certificateFile: '', keyFile: '' }], ...extra } });
}

before(async () => {
    panel = await startFakeSuiPanel(seedState());
});

after(async () => {
    if (panel) await panel.close();
    if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test('TLS without a certificate explains what to do when the node has none to offer', async () => {
    const client = await connect();
    await assert.rejects(
        () => compat.postAddInboundCompat(client, { protocol: 'trojan', remark: 'tj', port: 2053, settings: JSON.stringify({ clients: [] }), streamSettings: tlsStream() }),
        (error) => /certificate/i.test(String(error?.response?.data?.msg || error?.message))
    );
    assert.equal(inboundByTag('tj'), undefined);
    assert.equal(panel.state.tls.length, 2, 'no half-made profile is left behind');
});

test('TLS profiles are created from the panel certificate, reused, kept on unchanged edits and dropped with security none', async () => {
    const client = await connect({ settings: PANEL_CERT });
    await compat.postAddInboundCompat(client, { protocol: 'trojan', remark: 'tj-a', port: 2053, settings: JSON.stringify({ clients: [] }), streamSettings: tlsStream() });
    const first = inboundByTag('tj-a');
    const profile = panel.state.tls.find((item) => item.id === first.tls_id);
    assert.ok(profile, 'a profile was created');
    assert.equal(profile.name, 'nms-tls-node.example.com');
    assert.equal(profile.server.certificate_path, PANEL_CERT.webCertFile);
    assert.equal(profile.server.key_path, PANEL_CERT.webKeyFile);
    assert.equal(profile.server.server_name, 'node.example.com');
    assert.deepEqual(profile.server.alpn, ['h2', 'http/1.1']);

    await compat.postAddInboundCompat(client, { protocol: 'vmess', remark: 'vm-b', port: 2083, settings: JSON.stringify({ clients: [] }), streamSettings: tlsStream() });
    assert.equal(inboundByTag('vm-b').tls_id, first.tls_id, 'a second inbound with the same SNI reuses the profile');

    // QUIC needs h3, so Hysteria2 gets its own profile.
    await compat.postAddInboundCompat(client, { protocol: 'hysteria2', remark: 'hy2', port: 8443, settings: JSON.stringify({ clients: [] }), streamSettings: JSON.stringify({ network: 'udp', security: 'tls', tlsSettings: { serverName: 'node.example.com' } }) });
    const hy2Profile = panel.state.tls.find((item) => item.id === inboundByTag('hy2').tls_id);
    assert.notEqual(hy2Profile.id, first.tls_id);
    assert.deepEqual(hy2Profile.server.alpn, ['h3']);
    assert.equal(hy2Profile.name, 'nms-tls-node.example.com-2');

    const profilesBefore = panel.state.tls.length;
    const shown = await compat.fetchPanelInboundByIdCompat(client, first.id);
    assert.equal(JSON.parse(shown.streamSettings).tlsSettings.certificates[0].certificateFile, PANEL_CERT.webCertFile);
    await compat.postUpdateInboundCompat(client, first.id, { ...shown, port: 2054 });
    assert.equal(inboundByTag('tj-a').listen_port, 2054);
    assert.equal(inboundByTag('tj-a').tls_id, first.tls_id, 'an unchanged security section keeps the profile');
    assert.equal(panel.state.tls.length, profilesBefore);

    await compat.postUpdateInboundCompat(client, first.id, { ...shown, streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }) });
    assert.equal(inboundByTag('tj-a').tls_id, 0);
});

test('an entered certificate path and an explicit profile choice win over the defaults', async () => {
    const client = await connect({ settings: PANEL_CERT });
    await compat.postAddInboundCompat(client, {
        protocol: 'vless', remark: 'own-cert', port: 4443, settings: JSON.stringify({ clients: [] }),
        streamSettings: tlsStream({ certificates: [{ certificateFile: '/my/fullchain.pem', keyFile: '/my/privkey.pem' }] }),
    });
    const profile = panel.state.tls.find((item) => item.id === inboundByTag('own-cert').tls_id);
    assert.equal(profile.server.certificate_path, '/my/fullchain.pem');
    assert.equal(profile.server.key_path, '/my/privkey.pem');

    await assert.rejects(
        () => compat.postAddInboundCompat(client, { protocol: 'vless', remark: 'half', port: 4444, streamSettings: tlsStream({ certificates: [{ certificateFile: '/only/cert.pem', keyFile: '' }] }) }),
        (error) => /both/i.test(String(error?.response?.data?.msg || error?.message))
    );

    await compat.postAddInboundCompat(client, { protocol: 'vless', remark: 'picked', port: 4445, suiTlsId: 1, streamSettings: tlsStream() });
    assert.equal(inboundByTag('picked').tls_id, 1);
});

test('Reality profiles get a generated key pair and short id', async () => {
    const client = await connect();
    await compat.postAddInboundCompat(client, {
        protocol: 'vless',
        remark: 'vless-reality-2',
        port: 8444,
        settings: JSON.stringify({ clients: [], decryption: 'none' }),
        streamSettings: JSON.stringify({
            network: 'tcp',
            security: 'reality',
            realitySettings: { target: 'www.microsoft.com:443', serverNames: ['www.microsoft.com'], privateKey: '', shortIds: [], settings: { publicKey: '', fingerprint: 'firefox' } },
        }),
    });
    const inbound = inboundByTag('vless-reality-2');
    assert.notEqual(inbound.tls_id, 1, 'the seeded profile has another SNI');
    const profile = panel.state.tls.find((item) => item.id === inbound.tls_id);
    const reality = profile.server.reality;
    assert.equal(reality.enabled, true);
    assert.deepEqual(reality.handshake, { server: 'www.microsoft.com', server_port: 443 });
    const privateKey = decodeX25519Key(reality.private_key);
    assert.ok(privateKey, 'private key is a valid X25519 key');
    assert.equal(profile.client.reality.public_key, encodeRealityKey(x25519PublicKeyFromPrivate(privateKey)));
    assert.match(reality.short_id[0], /^[0-9a-f]{8}$/);
    assert.equal(profile.client.reality.short_id, reality.short_id[0]);
    assert.equal(profile.client.utls.fingerprint, 'firefox');

    const shown = await compat.fetchPanelInboundByIdCompat(client, inbound.id);
    const realitySettings = JSON.parse(shown.streamSettings).realitySettings;
    assert.equal(realitySettings.target, 'www.microsoft.com:443');
    assert.equal(realitySettings.settings.publicKey, profile.client.reality.public_key);
    const count = panel.state.tls.length;
    await compat.postUpdateInboundCompat(client, inbound.id, shown);
    assert.equal(inboundByTag('vless-reality-2').tls_id, inbound.tls_id);
    assert.equal(panel.state.tls.length, count);

    await assert.rejects(
        () => compat.postAddInboundCompat(client, { protocol: 'hysteria2', remark: 'hy-reality', port: 8445, streamSettings: JSON.stringify({ security: 'reality', realitySettings: { target: 'a.example:443' } }) }),
        (error) => /certificate/i.test(String(error?.response?.data?.msg || error?.message)),
        'QUIC types fall back to TLS, which needs a certificate here'
    );
});

test('naive inbounds start with the clients listed in the editor', async () => {
    const client = await connect({ settings: PANEL_CERT });
    await assert.rejects(
        () => compat.postAddInboundCompat(client, { protocol: 'naive', remark: 'nv-empty', port: 9443, settings: JSON.stringify({ clients: [] }), streamSettings: tlsStream() }),
        (error) => /at least one client/i.test(String(error?.response?.data?.msg || error?.message))
    );
    const profileCount = panel.state.tls.length;

    await compat.postAddInboundCompat(client, {
        protocol: 'naive',
        remark: 'nv',
        port: 9443,
        settings: JSON.stringify({ clients: [{ email: 'nv-user', password: 'nv-pass', enable: true }, { email: 'alice', password: 'ignored' }] }),
        streamSettings: tlsStream(),
    });
    const inbound = inboundByTag('nv');
    assert.ok(inbound.tls_id > 0);
    const created = panel.state.clients.find((item) => item.name === 'nv-user');
    assert.deepEqual(created.inbounds, [inbound.id]);
    assert.equal(created.config.naive.password, 'nv-pass');
    assert.equal(created.config.naive.username, 'nv-user');
    const alice = panel.state.clients.find((item) => item.name === 'alice');
    assert.ok(alice.inbounds.includes(inbound.id), 'an existing client is attached');
    assert.equal(alice.config.naive.password, 'pw-alice', 'and keeps its own credentials');
    assert.ok(panel.state.tls.length >= profileCount);
});

test('a failed inbound save removes the clients it created', async () => {
    const client = await connect({ settings: PANEL_CERT });
    await assert.rejects(() => compat.postAddInboundCompat(client, {
        protocol: 'vless',
        remark: 'vless-reality', // tag taken
        port: 9444,
        settings: JSON.stringify({ clients: [{ email: 'temp-user', id: UUID_C }] }),
    }), (error) => /already exists/i.test(String(error?.response?.data?.msg || error?.message)));
    assert.equal(panel.state.clients.some((item) => item.name === 'temp-user'), false);

    panel.state.running = true;
    // ShadowTLS v3 with a client whose save succeeds but the inbound fails in sing-box (no handshake server).
    await assert.rejects(() => compat.postAddInboundCompat(client, {
        protocol: 'shadowtls', remark: 'stls', port: 9445,
        settings: JSON.stringify({ version: 3, handshake: { server: '' }, clients: [{ email: 'stls-user' }] }),
    }), (error) => /handshake server/i.test(String(error?.response?.data?.msg || error?.message)));
    assert.equal(panel.state.clients.some((item) => item.name === 'stls-user'), false);
});

test('editing an inbound attaches new clients, detaches removed ones and applies changed fields', async () => {
    const client = await connect();
    const shown = await compat.fetchPanelInboundByIdCompat(client, 1);
    const settings = JSON.parse(shown.settings);
    assert.deepEqual(shown.suiTls, { id: 1, name: 'reality' });
    const alice = settings.clients.find((item) => item.email === 'alice');
    const nextClients = [
        { ...alice, totalGB: 5 * 1024 ** 3, comment: 'gold' },
        { email: 'carol', id: UUID_C, flow: 'xtls-rprx-vision', enable: true },
    ];
    await compat.postUpdateInboundCompat(client, 1, { ...shown, settings: JSON.stringify({ ...settings, clients: nextClients }) });

    const state = Object.fromEntries(panel.state.clients.map((item) => [item.name, item]));
    assert.equal(state.bob.inbounds.includes(1), false, 'bob was removed');
    assert.deepEqual(state.carol.inbounds, [1]);
    assert.equal(state.carol.config.vless.uuid, UUID_C);
    assert.equal(state.alice.volume, 5 * 1024 ** 3);
    assert.equal(state.alice.desc, 'gold');
    assert.equal(state.alice.config.vless.uuid, UUID_A, 'unchanged credentials stay');
    assert.equal(inboundByTag('vless-reality').tls_id, 1, 'the Reality profile is kept');

    await compat.postUpdateInboundCompat(client, 1, { ...shown, settings: JSON.stringify({ ...settings, clients: [{ ...alice, id: UUID_B }] }) });
    const rotated = panel.state.clients.find((item) => item.name === 'alice');
    assert.equal(rotated.config.vless.uuid, UUID_B, 'an edited UUID is applied');
    assert.equal(panel.state.clients.find((item) => item.name === 'carol').inbounds.includes(1), false);
});

test('an update that changes nothing about clients leaves them alone', async () => {
    const client = await connect();
    const before = JSON.stringify(panel.state.clients);
    const shown = await compat.fetchPanelInboundByIdCompat(client, 1);
    await compat.postUpdateInboundCompat(client, 1, { ...shown, remark: 'vless-main' });
    assert.equal(inboundByTag('vless-main').id, 1);
    const after = JSON.parse(JSON.stringify(panel.state.clients));
    assert.deepEqual(after.map((item) => [item.name, item.inbounds, item.config]), JSON.parse(before).map((item) => [item.name, item.inbounds, item.config]));
});

test('3x-ui shaped Hysteria, TUIC and Tunnel settings become sing-box options', () => {
    const hy = xuiInboundPayloadToSui({
        protocol: 'hysteria',
        remark: 'hy',
        port: 1,
        settings: JSON.stringify({ version: 2, clients: [] }),
        streamSettings: JSON.stringify({
            network: 'hysteria',
            security: 'tls',
            finalmask: { udp: [{ type: 'salamander', settings: { password: 'mask' } }] },
            hysteriaSettings: { version: 2, masquerade: { type: 'proxy', url: 'https://www.bing.com', rewriteHost: true } },
        }),
    });
    assert.equal(hy.type, 'hysteria2');
    assert.deepEqual(hy.obfs, { type: 'salamander', password: 'mask' });
    assert.deepEqual(hy.masquerade, { type: 'proxy', url: 'https://www.bing.com', rewrite_host: true });
    assert.equal(hy.transport, undefined);

    const hyString = xuiInboundPayloadToSui({ protocol: 'hysteria2', remark: 'h', port: 1, settings: { obfs: 'secret', masquerade: 'https://example.com', up_mbps: 0 } });
    assert.deepEqual(hyString.obfs, { type: 'salamander', password: 'secret' });
    assert.equal(hyString.masquerade, 'https://example.com');
    assert.equal('up_mbps' in hyString, false);

    const v1 = xuiInboundPayloadToSui({ protocol: 'hysteria', remark: 'v1', port: 1, settings: { obfs: 'xplus' } });
    assert.equal(v1.type, 'hysteria');
    assert.equal(v1.obfs, 'xplus');
    assert.equal(v1.up_mbps, 100);
    assert.equal(v1.down_mbps, 100);

    const tuic = xuiInboundPayloadToSui({
        protocol: 'tuic',
        remark: 't',
        port: 1,
        settings: JSON.stringify({ server: { congestion_control: 'bbr', zero_rtt_handshake: true, authentication_timeout: 3 }, udp_relay_mode: 'quic', clients: [] }),
    });
    assert.equal(tuic.congestion_control, 'bbr');
    assert.equal(tuic.zero_rtt_handshake, true);
    assert.equal(tuic.auth_timeout, '3s');
    assert.equal('udp_relay_mode' in tuic, false);
    const legacyTuic = xuiInboundPayloadToSui({ port: 2 }, { id: 9, type: 'tuic', tag: 't', udp_relay_mode: 'native', congestion_control: 'cubic' });
    assert.equal('udp_relay_mode' in legacyTuic, false, 'a stored client-side option is dropped');

    const tunnel = xuiInboundPayloadToSui({ protocol: 'tunnel', remark: 'dns', port: 53, settings: { rewriteAddress: '1.1.1.1', rewritePort: 53, allowedNetwork: 'udp' } });
    assert.equal(tunnel.type, 'direct');
    assert.equal(tunnel.override_address, '1.1.1.1');
    assert.equal(tunnel.override_port, 53);
    assert.equal(tunnel.network, 'udp');
    const both = xuiInboundPayloadToSui({ protocol: 'direct', remark: 'd', port: 1, settings: { network: 'tcp,udp' } });
    assert.equal('network' in both, false);
});

test('sing-box only protocols get working defaults, and impossible choices are explained', () => {
    const stls = xuiInboundPayloadToSui({ protocol: 'shadowtls', remark: 's', port: 1, settings: { handshake: 'www.microsoft.com' } });
    assert.equal(stls.version, 3);
    assert.deepEqual(stls.handshake, { server: 'www.microsoft.com', server_port: 443 });
    assert.equal('password' in stls, false);
    const stls2 = xuiInboundPayloadToSui({ protocol: 'shadowtls', remark: 's', port: 1, settings: { version: 2, handshake: { server: 'a.example', server_port: 8443 } } });
    assert.ok(stls2.password.length >= 16);
    assert.equal(stls2.handshake.server_port, 8443);

    const snell = xuiInboundPayloadToSui({ protocol: 'snell', remark: 'sn', port: 1, settings: { psk: 'short', obfs_mode: 'http' } });
    assert.equal(snell.version, 6);
    assert.ok(snell.psk.length >= 12);
    assert.equal('obfs_mode' in snell, false, 'v6 has no obfs');

    const anytls = xuiInboundPayloadToSui({ protocol: 'anytls', remark: 'a', port: 1, settings: {} });
    assert.equal(anytls.padding_scheme[0], 'stop=8');

    const ss = xuiInboundPayloadToSui({ protocol: 'shadowsocks', remark: 'ss', port: 1, settings: { method: '2022-blake3-aes-128-gcm', network: 'tcp,udp' } });
    assert.equal(Buffer.from(ss.password, 'base64').length, 16);
    assert.equal('network' in ss, false);

    const typeChange = xuiInboundPayloadToSui({ protocol: 'trojan', streamSettings: JSON.stringify({ network: 'ws', wsSettings: { path: '/t' } }) }, { id: 3, type: 'shadowsocks', tag: 'x', listen: '::', listen_port: 5, method: 'aes-128-gcm', password: 'p', tls_id: 0 });
    assert.equal(typeChange.type, 'trojan');
    assert.equal('method' in typeChange, false, 'options of the old type are dropped');
    assert.equal(typeChange.listen_port, 5);

    assert.throws(
        () => xuiInboundPayloadToSui({ protocol: 'vless', remark: 'x', port: 1, streamSettings: JSON.stringify({ network: 'xhttp' }) }),
        (error) => error.status === 400 && /xhttp/.test(error.message)
    );
    const ignored = xuiInboundPayloadToSui({ protocol: 'hysteria2', remark: 'h', port: 1, streamSettings: JSON.stringify({ network: 'kcp' }) });
    assert.equal(ignored.transport, undefined, 'types without a transport ignore the network');
    assert.throws(() => xuiInboundPayloadToSui({ protocol: 'cloudflared', remark: 'cf', port: 1, settings: {} }), /token/);
    assert.throws(() => xuiInboundPayloadToSui({ protocol: 'wireguard', remark: 'wg', port: 1 }), /does not support/);
});

test('profile matching follows what sing-box needs', () => {
    const certProfile = { server: { enabled: true, server_name: 'a.example', certificate_path: '/c', key_path: '/k', alpn: ['h2', 'http/1.1'] } };
    assert.equal(suiTlsProfileMatches(certProfile, readWantedSuiTls('trojan', 'tls', { tlsSettings: { serverName: 'a.example' } })), true);
    assert.equal(suiTlsProfileMatches(certProfile, readWantedSuiTls('trojan', 'tls', { tlsSettings: { serverName: 'b.example' } })), false);
    assert.equal(suiTlsProfileMatches(certProfile, readWantedSuiTls('tuic', 'tls', { tlsSettings: { serverName: 'a.example' } })), false, 'QUIC needs h3');
    const noAlpn = { server: { enabled: true, server_name: 'a.example', certificate_path: '/c', key_path: '/k' } };
    assert.equal(suiTlsProfileMatches(noAlpn, readWantedSuiTls('tuic', 'tls', {})), true, 'sing-box adds h3 itself');
    assert.equal(suiTlsProfileMatches({ server: { enabled: true, server_name: 'a.example' } }, readWantedSuiTls('trojan', 'tls', {})), false, 'no certificate');
    assert.equal(suiTlsProfileMatches(certProfile, readWantedSuiTls('trojan', 'tls', { tlsSettings: { certificates: [{ certificateFile: '/other', keyFile: '/k' }] } })), false);
    const reality = { server: { enabled: true, server_name: 'r.example', reality: { enabled: true, private_key: 'pk', handshake: { server: 'r.example', server_port: 443 }, short_id: ['aa'] } } };
    assert.equal(suiTlsProfileMatches(reality, readWantedSuiTls('vless', 'reality', { realitySettings: { serverNames: ['r.example'], target: 'r.example:443', shortIds: ['aa'] } })), true);
    assert.equal(suiTlsProfileMatches(reality, readWantedSuiTls('vless', 'reality', { realitySettings: { serverNames: ['r.example'], shortIds: ['bb'] } })), false);
    assert.equal(suiTlsProfileMatches(reality, readWantedSuiTls('vless', 'tls', { tlsSettings: { serverName: 'r.example' } })), false);
});
