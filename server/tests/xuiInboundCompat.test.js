import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fillMissingXuiCertificates,
    postAddInboundCompat,
    postUpdateInboundCompat,
} from '../lib/panelApiCompat.js';
import {
    decodeX25519Key,
    normalizeInboundPayloadForXui,
} from '../lib/xuiInboundNormalizer.js';

const WEB_CERT = { webCertFile: '/etc/x-ui/cert.pem', webKeyFile: '/etc/x-ui/key.pem' };

function fakePanel({ certFiles = WEB_CERT, certError = null, inbound = null, panelType } = {}) {
    const calls = [];
    let stored = inbound ? structuredClone(inbound) : null;
    return {
        calls,
        get stored() { return stored; },
        nmsPanelType: panelType,
        async get(path) {
            calls.push(['GET', path]);
            if (path === '/panel/api/server/getWebCertFiles') {
                if (certError) throw certError;
                return { status: 200, data: { success: true, obj: certFiles } };
            }
            if (path.startsWith('/panel/api/inbounds/get/')) {
                return { status: 200, data: { success: true, obj: stored } };
            }
            throw new Error(`unexpected GET ${path}`);
        },
        async post(path, body) {
            const text = typeof body === 'string' ? body : JSON.stringify(body);
            calls.push(['POST', path, text]);
            if (path === '/panel/api/inbounds/add') {
                const params = new URLSearchParams(text);
                stored = {
                    id: 41,
                    protocol: params.get('protocol'),
                    enable: params.get('enable') !== 'false',
                    settings: params.get('settings'),
                    streamSettings: params.get('streamSettings'),
                };
                return { status: 200, data: { success: true, obj: { id: 41 } } };
            }
            return { status: 200, data: { success: true, obj: {} } };
        },
    };
}

function formParams(call) {
    return new URLSearchParams(call[2]);
}

test('fillMissingXuiCertificates uses the node panel certificate for TLS without one', async () => {
    const panel = fakePanel();
    const payload = {
        protocol: 'vless',
        streamSettings: JSON.stringify({ network: 'tcp', security: 'tls', tlsSettings: { serverName: 'a.example', certificates: [] } }),
    };
    const out = await fillMissingXuiCertificates(panel, payload);
    const stream = JSON.parse(out.streamSettings);
    assert.equal(stream.tlsSettings.certificates[0].certificateFile, WEB_CERT.webCertFile);
    assert.equal(stream.tlsSettings.certificates[0].keyFile, WEB_CERT.webKeyFile);
    assert.equal(stream.tlsSettings.serverName, 'a.example');
});

test('fillMissingXuiCertificates keeps certificates that were entered', async () => {
    const panel = fakePanel();
    const payload = {
        protocol: 'trojan',
        streamSettings: { security: 'tls', tlsSettings: { certificates: [{ certificateFile: '/my/cert', keyFile: '/my/key' }] } },
    };
    const out = await fillMissingXuiCertificates(panel, payload);
    assert.equal(out, payload);
    assert.equal(panel.calls.length, 0);
});

test('fillMissingXuiCertificates fills an empty TUIC server certificate', async () => {
    const panel = fakePanel();
    const payload = {
        protocol: 'tuic',
        settings: JSON.stringify({ server: { certificate: '', private_key: '', congestion_control: 'bbr' }, clients: [] }),
        streamSettings: JSON.stringify({ network: 'udp', security: 'tls', tlsSettings: { certificates: [{ certificateFile: '/my/cert', keyFile: '/my/key' }] } }),
    };
    const out = await fillMissingXuiCertificates(panel, payload);
    const settings = JSON.parse(out.settings);
    assert.equal(settings.server.certificate, WEB_CERT.webCertFile);
    assert.equal(settings.server.private_key, WEB_CERT.webKeyFile);
    assert.equal(settings.server.congestion_control, 'bbr');
});

test('fillMissingXuiCertificates explains what to do when the panel has no certificate', async () => {
    const panel = fakePanel({ certFiles: { webCertFile: '', webKeyFile: '' } });
    const payload = { protocol: 'vless', streamSettings: { security: 'tls', tlsSettings: {} } };
    await assert.rejects(
        () => fillMissingXuiCertificates(panel, payload),
        (error) => error.response?.status === 400 && /certificate/i.test(error.message)
    );
});

test('fillMissingXuiCertificates leaves the payload alone when the panel cannot answer', async () => {
    const error = new Error('404 page not found');
    error.response = { status: 404, data: { msg: '404 page not found' } };
    const panel = fakePanel({ certError: error });
    const payload = { protocol: 'vless', streamSettings: { security: 'tls', tlsSettings: {} } };
    assert.equal(await fillMissingXuiCertificates(panel, payload), payload);
});

test('fillMissingXuiCertificates never touches s-ui payloads', async () => {
    const panel = fakePanel({ panelType: 's-ui' });
    const payload = { protocol: 'vless', streamSettings: { security: 'tls', tlsSettings: {} } };
    assert.equal(await fillMissingXuiCertificates(panel, payload), payload);
    assert.equal(panel.calls.length, 0);
});

test('postAddInboundCompat creates WireGuard first, then adds clients through the client endpoint', async () => {
    const panel = fakePanel();
    await postAddInboundCompat(panel, {
        protocol: 'wireguard',
        port: 51820,
        enable: true,
        settings: JSON.stringify({ secretKey: '', clients: [{ email: 'wg-user', enable: true }] }),
    });
    const add = panel.calls.find((call) => call[1] === '/panel/api/inbounds/add');
    const sentSettings = JSON.parse(formParams(add).get('settings'));
    assert.deepEqual(sentSettings.clients, []);
    assert.ok(decodeX25519Key(sentSettings.secretKey), 'a server key is generated');

    const clientAdd = panel.calls.find((call) => call[1] === '/panel/api/clients/add');
    assert.ok(clientAdd, 'client added after the inbound exists');
    const body = JSON.parse(clientAdd[2]);
    assert.equal(body.client.email, 'wg-user');
    assert.deepEqual(body.inboundIds, [41]);
});

test('postUpdateInboundCompat keeps stored clients in the inbound update and applies client changes separately', async () => {
    const panel = fakePanel({
        inbound: {
            id: 7,
            protocol: 'vless',
            enable: true,
            settings: JSON.stringify({
                decryption: 'none',
                clients: [
                    { id: '11111111-1111-4111-8111-111111111111', email: 'keep', enable: true },
                    { id: '22222222-2222-4222-8222-222222222222', email: 'gone', enable: true },
                ],
            }),
        },
    });
    await postUpdateInboundCompat(panel, 7, {
        protocol: 'vless',
        port: 443,
        enable: false,
        settings: JSON.stringify({
            decryption: 'none',
            clients: [
                { id: '11111111-1111-4111-8111-111111111111', email: 'keep', enable: true },
                { id: '33333333-3333-4333-8333-333333333333', email: 'new', enable: true },
            ],
        }),
        streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
    });

    const update = panel.calls.find((call) => call[1] === '/panel/api/inbounds/update/7');
    const sentClients = JSON.parse(formParams(update).get('settings')).clients.map((client) => client.email);
    assert.deepEqual(sentClients, ['keep', 'gone'], 'the inbound update carries the stored clients unchanged');

    const paths = panel.calls.filter((call) => call[0] === 'POST').map((call) => call[1]);
    assert.ok(paths.includes('/panel/api/inbounds/setEnable/7'), 'enable change goes through setEnable');
    const added = panel.calls.find((call) => call[1] === '/panel/api/clients/add');
    assert.equal(JSON.parse(added[2]).client.email, 'new');
    assert.ok(paths.includes('/panel/api/inbounds/7/delClient/22222222-2222-4222-8222-222222222222'), 'the removed client is deleted');
    assert.equal(paths.filter((path) => path.includes('delClient')).length, 1, 'the kept client is not deleted');
});

test('normalizeInboundPayloadForXui migrates legacy Tunnel fields', () => {
    const out = normalizeInboundPayloadForXui({
        protocol: 'dokodemo-door',
        settings: { address: '1.1.1.1', port: '53', network: 'udp', portMap: [], followRedirect: 'false' },
    });
    assert.equal(out.protocol, 'tunnel');
    assert.deepEqual(out.settings, { rewriteAddress: '1.1.1.1', rewritePort: 53, allowedNetwork: 'udp', portMap: {}, followRedirect: false });

    const empty = normalizeInboundPayloadForXui({ protocol: 'tunnel', settings: { rewriteAddress: '', rewritePort: '' } });
    assert.equal('rewriteAddress' in empty.settings, false);
    assert.equal('rewritePort' in empty.settings, false);
    assert.equal(empty.settings.allowedNetwork, 'tcp,udp');
});

test('normalizeInboundPayloadForXui moves MTProto and TUIC legacy shapes', () => {
    const mt = normalizeInboundPayloadForXui({ protocol: 'mtproto', settings: { secret: 'ee00', fakeTlsDomain: '' } });
    assert.equal(mt.settings.fakeTlsDomain, 'www.cloudflare.com');
    assert.equal(mt.settings.secret, undefined);
    assert.equal(mt.settings.clients.length, 1);
    assert.match(mt.settings.clients[0].secret, /^ee[0-9a-f]{32}/);

    const tuic = normalizeInboundPayloadForXui({
        protocol: 'tuic',
        settings: { congestion_control: 'cubic', users: [{ uuid: 'u-1', password: 'p', email: 't' }] },
        streamSettings: { network: 'udp', security: 'tls', tlsSettings: { serverName: 't.example', certificates: [{ certificateFile: '/c', keyFile: '/k' }] } },
    });
    assert.equal(tuic.settings.server.congestion_control, 'cubic');
    assert.equal(tuic.settings.server.certificate, '/c');
    assert.equal(tuic.settings.server.private_key, '/k');
    assert.equal(tuic.settings.users, undefined);
    assert.equal(tuic.settings.clients[0].id, 'u-1');
});

test('normalizeInboundPayloadForXui gives MASQUE its transport and address pool', () => {
    const out = normalizeInboundPayloadForXui({ protocol: 'masque', settings: { address: '', clients: [{ email: 'm' }] } });
    assert.deepEqual(out.settings.address, ['10.14.0.1/24', 'fd14::1/64']);
    assert.ok(out.settings.clients[0].password, 'client password generated');
    assert.equal(out.streamSettings.network, 'masque');
    assert.equal(out.streamSettings.security, 'tls');
    assert.deepEqual(out.streamSettings.tlsSettings.alpn, ['h3']);
});

test('normalizeInboundPayloadForXui keeps a salamander password set in finalmask', () => {
    const out = normalizeInboundPayloadForXui({
        protocol: 'hysteria2',
        settings: { version: 2, clients: [{ auth: 'a', email: 'h' }] },
        streamSettings: {
            network: 'hysteria',
            security: 'tls',
            finalmask: { udp: [{ type: 'salamander', settings: { password: 'mask' } }], tcp: [] },
            hysteriaSettings: { version: 2, udpIdleTimeout: 120, masquerade: { type: 'proxy', url: 'https://www.bing.com', rewriteHost: true } },
        },
    });
    assert.equal(out.protocol, 'hysteria');
    assert.deepEqual(out.streamSettings.finalmask.udp, [{ type: 'salamander', settings: { password: 'mask' } }]);
    assert.equal(out.streamSettings.hysteriaSettings.udpIdleTimeout, 120);
    assert.equal(out.streamSettings.hysteriaSettings.masquerade.url, 'https://www.bing.com');
});
