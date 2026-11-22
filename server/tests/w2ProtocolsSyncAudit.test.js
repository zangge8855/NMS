import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';

import config from '../config.js';
import { createApp } from '../index.js';
import {
    buildManagedClientData,
    postAddClient,
    postUpdateClient,
    resolveClientIdentifier,
    resolveShadowsocksPassword,
} from '../lib/clientEntitlements.js';
import {
    clientUpdateMatches,
    normalizeHysteriaInboundForXui,
    parseInboundClients,
    postAddClientCompat,
    postUpdateClientCompat,
} from '../lib/panelApiCompat.js';
import {
    ensureAuthenticated,
    fetchPanelServerStatus,
} from '../lib/panelClient.js';
import { getProtocolSchema } from '../lib/protocolCatalog.js';
import { invalidateServerPanelSnapshotCache } from '../lib/serverPanelSnapshotService.js';
import {
    applyXuiCredentials,
    createSuiTransport,
    suiInboundToXuiInbound,
    xuiInboundPayloadToSui,
} from '../lib/suiPanelAdapter.js';
import { normalizeClientData } from '../routes/batch.js';
import {
    buildClientLink,
    buildMihomoConfigFromLinks,
    buildSingboxConfigFromLinks,
    buildSurgeConfigFromLinks,
    collectByServer,
    invalidatePublicSubCache,
    mergeInboundClientEntries,
    summarizeSubscriptionUsage,
} from '../routes/subscriptions.js';
import { updateClientEntitlement } from '../services/clientEntitlementService.js';
import { listPanelInbounds } from '../services/panelGateway.js';
import {
    createSharedCredentials,
    provisionSubscriptionForUser,
    rotateManagedSubscriptionCredentials,
} from '../services/subscriptionSyncService.js';
import {
    fetchPanelSettings,
    isUnsupportedPanelRouteError,
} from '../services/xrayConfigService.js';
import jobStore from '../store/jobStore.js';
import serverStore from '../store/serverStore.js';
import subscriptionTokenStore, {
    signLegacySubscriptionEmail,
} from '../store/subscriptionTokenStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import userGroupStore from '../store/userGroupStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import userStore from '../store/userStore.js';
import { startFakeSuiPanel } from '../scripts/fakeSuiPanel.js';

function decodeBase64UrlText(input) {
    const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function extractCompatPostedClient(body) {
    if (typeof body === 'string') {
        const form = new URLSearchParams(body);
        const settingsRaw = form.get('settings');
        if (settingsRaw) return JSON.parse(settingsRaw).clients?.[0] || null;
        return JSON.parse(body);
    }
    if (body?.client && typeof body.client === 'object') return body.client;
    if (body?.settings) {
        const parsed = typeof body.settings === 'string' ? JSON.parse(body.settings) : body.settings;
        return parsed?.clients?.[0] || null;
    }
    return body || null;
}

function makeAuthHeader(user) {
    const token = jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
    return `Bearer ${token}`;
}

async function startHttpAppServer() {
    const app = createApp({ serveClientBuild: false });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    return {
        baseUrl,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

async function startMockHttpServer(handler) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    return {
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

function createFakeServer({ name = 'audit-node', url, panelType = '3x-ui' }) {
    return serverStore.add({
        name,
        url,
        username: 'admin',
        password: 'password',
        panelType,
    });
}

describe('Wave 2 Proxy Protocols, Subscription Converters, Adapters & Sync Fixes', () => {
    const createdServerIds = [];
    const createdGroupIds = [];
    const createdUserIds = [];
    const createdPolicyEmails = [];
    const closeables = [];

    afterEach(async () => {
        invalidatePublicSubCache();
        invalidateServerPanelSnapshotCache();
        while (closeables.length > 0) {
            const close = closeables.pop();
            await close().catch(() => {});
        }
        while (createdPolicyEmails.length > 0) {
            const email = createdPolicyEmails.pop();
            try { subscriptionTokenStore.revokeAllByEmail(email, 'test-cleanup'); } catch {}
            try { userPolicyStore.remove(email); } catch {}
        }
        while (createdUserIds.length > 0) {
            const id = createdUserIds.pop();
            try { userStore.remove(id); } catch {}
        }
        while (createdGroupIds.length > 0) {
            const id = createdGroupIds.pop();
            try { userGroupStore.remove(id); } catch {}
        }
        while (createdServerIds.length > 0) {
            const id = createdServerIds.pop();
            try { serverStore.remove(id); } catch {}
        }
    });

    it('Group 1: builds base64url Shadowsocks links and prepends EIH serverPassword even when equal to client password', () => {
        const ss2022 = buildClientLink({
            server: { url: 'https://ss.example.com:443', name: 'SS' },
            inbound: { protocol: 'shadowsocks', port: 8388, remark: 'SS2022' },
            client: { email: 'alice@example.com', password: 'shared-psk+plus/slash' },
            settings: { method: '2022-blake3-aes-256-gcm', password: 'shared-psk+plus/slash' },
            stream: {},
            diagnostics: [],
        });
        assert.ok(ss2022);
        const userInfo = ss2022.slice('ss://'.length, ss2022.indexOf('@'));
        assert.equal(userInfo.includes('/'), false);
        assert.equal(userInfo.includes('+'), false);
        assert.equal(userInfo.includes('='), false);
        assert.equal(
            decodeBase64UrlText(userInfo),
            '2022-blake3-aes-256-gcm:shared-psk+plus/slash:shared-psk+plus/slash'
        );

        const ssAlreadyCombined = buildClientLink({
            server: { url: 'https://ss.example.com:443', name: 'SS' },
            inbound: { protocol: 'shadowsocks', port: 8388, remark: 'SS128' },
            client: { email: 'alice@example.com', password: 'srv-key:client-key' },
            settings: { method: '2022-blake3-aes-128-gcm', password: 'srv-key' },
            stream: {},
            diagnostics: [],
        });
        const combinedUserInfo = ssAlreadyCombined.slice('ss://'.length, ssAlreadyCombined.indexOf('@'));
        assert.equal(decodeBase64UrlText(combinedUserInfo), '2022-blake3-aes-128-gcm:srv-key:client-key');
    });

    it('Group 1: parseShadowsocksUserInfo decodes percent-encoded userinfo before parsing colon or base64url', () => {
        const encodedPlain = `ss://${encodeURIComponent('2022-blake3-aes-256-gcm:psk:ukey')}@ss.example.com:8388#SS-PCT`;
        const b64u = Buffer.from('2022-blake3-aes-128-gcm:psk+1:ukey/2').toString('base64url');
        const encodedB64u = `ss://${b64u}%3D@ss.example.com:8389#SS-B64U`;

        const sb = JSON.parse(buildSingboxConfigFromLinks([encodedPlain, encodedB64u]));
        const out1 = sb.outbounds.find((o) => o.tag === 'SS-PCT');
        const out2 = sb.outbounds.find((o) => o.tag === 'SS-B64U');
        assert.equal(out1?.method, '2022-blake3-aes-256-gcm');
        assert.equal(out1?.password, 'psk:ukey');
        assert.equal(out2?.method, '2022-blake3-aes-128-gcm');
        assert.equal(out2?.password, 'psk+1:ukey/2');

        const clashYaml = buildMihomoConfigFromLinks([encodedPlain]);
        assert.match(clashYaml, /cipher: "2022-blake3-aes-256-gcm"/);
        assert.match(clashYaml, /password: "psk:ukey"/);
    });

    it('Group 1: createSharedCredentials & SS-2022 key selection rotate 16B/32B keys for both 3x-ui and s-ui', async () => {
        const creds = createSharedCredentials();
        assert.equal(Buffer.from(creds.ss2022Key16, 'base64').length, 16);
        assert.equal(Buffer.from(creds.ss2022Key32, 'base64').length, 32);

        const xui128 = buildManagedClientData({
            email: 'alice@example.com',
            protocol: 'shadowsocks',
            inbound: {
                protocol: 'shadowsocks',
                settings: JSON.stringify({ method: '2022-blake3-aes-128-gcm' }),
            },
            sharedCredentials: creds,
        });
        assert.equal(xui128.password, creds.ss2022Key16);

        const xui256 = buildManagedClientData({
            email: 'alice@example.com',
            protocol: 'shadowsocks',
            inbound: {
                protocol: 'shadowsocks',
                settings: JSON.stringify({ method: '2022-blake3-aes-256-gcm' }),
            },
            sharedCredentials: creds,
        });
        assert.equal(xui256.password, creds.ss2022Key32);
        assert.equal(
            resolveShadowsocksPassword({ method: 'aes-256-gcm' }, creds),
            creds.password
        );

        const suiPayload = buildManagedClientData({
            email: 'alice@example.com',
            protocol: 'vless',
            inbound: { protocol: 'vless', panelType: 's-ui', nmsPanelType: 's-ui' },
            sharedCredentials: creds,
        });
        assert.equal(suiPayload.password, creds.password);
        assert.equal(suiPayload.ss2022Key16, creds.ss2022Key16);
        assert.equal(suiPayload.ss2022Key32, creds.ss2022Key32);

        const suiConfig = {
            trojan: { password: 'old-plain-password' },
            shadowsocks: { password: Buffer.alloc(32, 1).toString('base64') },
            shadowsocks16: { password: Buffer.alloc(16, 2).toString('base64') },
            shadowtls: { password: Buffer.alloc(32, 3).toString('base64') },
        };
        applyXuiCredentials(suiConfig, {
            password: 'old-plain-password',
            ss2022Key16: creds.ss2022Key16,
            ss2022Key32: creds.ss2022Key32,
        });
        assert.equal(suiConfig.shadowsocks16.password, creds.ss2022Key16);
        assert.equal(suiConfig.shadowsocks.password, creds.ss2022Key32);
        assert.equal(suiConfig.shadowtls.password, creds.ss2022Key32);

        const oldKey16 = Buffer.alloc(16, 7).toString('base64');
        const oldKey32 = Buffer.alloc(32, 8).toString('base64');
        const fakeSui = await startFakeSuiPanel({
            username: 'admin',
            password: 'password',
            inbounds: [
                { id: 1, type: 'shadowsocks', tag: 'ss16', listen: '0.0.0.0', port: 8388, method: '2022-blake3-aes-128-gcm' },
                { id: 2, type: 'shadowsocks', tag: 'ss32', listen: '0.0.0.0', port: 8389, method: '2022-blake3-aes-256-gcm' },
                { id: 3, type: 'shadowtls', tag: 'stls', listen: '0.0.0.0', port: 8443, version: 3 },
            ],
            clients: [{
                id: 1,
                name: 'ssrot@example.com',
                enable: true,
                inbounds: [1, 2, 3],
                config: {
                    shadowsocks16: { password: oldKey16 },
                    shadowsocks: { password: oldKey32 },
                    shadowtls: { password: oldKey32 },
                },
            }],
        });
        closeables.push(fakeSui.close);
        const suiRotSrv = createFakeServer({ name: 'sui-ss-rot', url: `${fakeSui.url}${fakeSui.basePath}`, panelType: 's-ui' });
        createdServerIds.push(suiRotSrv.id);

        const rotResult = await rotateManagedSubscriptionCredentials('ssrot@example.com', { allowedServerIds: [suiRotSrv.id] }, {
            allServers: [suiRotSrv],
            serverId: suiRotSrv.id,
        });
        assert.equal(rotResult.failed, 0);
        assert.ok(rotResult.updated >= 1);
        const rotatedSuiClient = fakeSui.state.clients[0];
        assert.notEqual(rotatedSuiClient.config.shadowsocks16.password, oldKey16);
        assert.equal(Buffer.from(rotatedSuiClient.config.shadowsocks16.password, 'base64').length, 16);
        assert.notEqual(rotatedSuiClient.config.shadowsocks.password, oldKey32);
        assert.equal(Buffer.from(rotatedSuiClient.config.shadowsocks.password, 'base64').length, 32);
        assert.equal(rotatedSuiClient.config.shadowtls.password, rotatedSuiClient.config.shadowsocks.password);
    });

    it('Group 2: buildVlessLink omits flow when empty and preserves flow on tcp/raw while skipping H2 deploy flow', async () => {
        const noFlowReality = buildClientLink({
            server: { url: 'https://v.example.com:443', name: 'V' },
            inbound: { protocol: 'vless', port: 443, remark: 'VL-NoFlow' },
            client: { id: '11111111-1111-1111-1111-111111111111', email: 'u@example.com', flow: '' },
            settings: {},
            stream: {
                network: 'tcp',
                security: 'reality',
                realitySettings: {
                    serverNames: ['example.com'],
                    settings: { publicKey: 'pbk-val', fingerprint: 'chrome' },
                    shortIds: ['00123456'],
                },
            },
            diagnostics: [],
        });
        assert.equal(new URL(noFlowReality).searchParams.get('flow'), null);

        const rawFlowLink = buildClientLink({
            server: { url: 'https://v.example.com:443', name: 'V' },
            inbound: { protocol: 'vless', port: 443, remark: 'VL-RawFlow' },
            client: { id: '11111111-1111-1111-1111-111111111111', email: 'u@example.com', flow: 'xtls-rprx-vision' },
            settings: {},
            stream: { network: 'raw', security: 'tls', tlsSettings: { serverName: 'v.example.com' } },
            diagnostics: [],
        });
        assert.equal(new URL(rawFlowLink).searchParams.get('flow'), 'xtls-rprx-vision');

        // Verify resolveDeployFlow in autoDeployClients emits vision for raw/tcp and omits for http (H2)
        const { autoDeployClients } = await import('../services/subscriptionSyncService.js');
        const created = [];
        await autoDeployClients('u@example.com', { allowedServerIds: ['s1'] }, {
            allServers: [{ id: 's1', name: 'S1' }],
        }, {
            serverRepository: { list: () => [{ id: 's1', name: 'S1' }] },
            overrideRepository: { get: () => null },
            listPanelInbounds: async () => ({
                client: {},
                inbounds: [
                    {
                        id: 1,
                        protocol: 'vless',
                        enable: true,
                        settings: JSON.stringify({ clients: [] }),
                        streamSettings: JSON.stringify({ network: 'raw', security: 'reality' }),
                    },
                    {
                        id: 2,
                        protocol: 'vless',
                        enable: true,
                        settings: JSON.stringify({ clients: [] }),
                        streamSettings: JSON.stringify({ network: 'http', security: 'tls' }),
                    },
                ],
            }),
            postAddClient: async (_c, inboundId, data) => { created.push({ inboundId, data }); },
            postUpdateClient: async () => {},
        });
        assert.equal(created.find((c) => c.inboundId === 1)?.data?.flow, 'xtls-rprx-vision');
        assert.equal(created.find((c) => c.inboundId === 2)?.data?.flow, '');
    });

    it('Group 2: toYaml quotes numeric/scientific short-id, YAML bool keywords, and leading symbol passwords', () => {
        const reality0 = 'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?security=reality&pbk=pbk123&sid=00123456&fp=chrome#N1';
        const realitySci = 'vless://22222222-2222-2222-2222-222222222222@v.example.com:443?security=reality&pbk=pbk123&sid=1234e567&fp=chrome#N2';
        const trojanBool = 'trojan://on@t.example.com:443?sni=n#N3';
        const trojanAt = 'trojan://%40secret%25-pass@t.example.com:443?sni=y#N4';

        const yaml = buildMihomoConfigFromLinks([reality0, realitySci, trojanBool, trojanAt]);
        assert.match(yaml, /short-id: "00123456"/);
        assert.match(yaml, /short-id: "1234e567"/);
        assert.match(yaml, /password: "on"/);
        assert.match(yaml, /password: "@secret%-pass"/);
        assert.match(yaml, /sni: "n"/);
        assert.match(yaml, /sni: "y"/);
    });

    it('Group 2: Surge builder quotes params, deduplicates names, skips unsupported configs, and fixes socks5/http credentials', () => {
        const vmessWsMultiAlpn = `vmess://${Buffer.from(JSON.stringify({
            v: '2',
            ps: 'Node,One',
            add: 'ws.example.com',
            port: '443',
            id: '11111111-1111-1111-1111-111111111111',
            aid: '0',
            net: 'ws',
            path: '/ws?ed=2048,test',
            host: 'cdn.example.com,alt.example.com',
            tls: 'tls',
            sni: 'ws.example.com',
            alpn: 'h2,http/1.1',
        })).toString('base64')}`;
        const vmessDupName = `vmess://${Buffer.from(JSON.stringify({
            v: '2',
            ps: 'Node=One',
            add: 'ws2.example.com',
            port: '443',
            id: '22222222-2222-2222-2222-222222222222',
            aid: '0',
            net: 'tcp',
            tls: 'tls',
        })).toString('base64')}`;
        const trojanReality = 'trojan://pass@r.example.com:443?security=reality&pbk=pubkey&sid=01#SkipReality';
        const trojanXhttp = 'trojan://pass@x.example.com:443?type=xhttp&path=/x#SkipXhttp';
        const trojanH2 = 'trojan://pass@h2.example.com:443?type=h2&path=/h2#SkipH2';
        const hy2Obfs = 'hy2://pass@hy2.example.com:443?obfs=salamander&obfs-password=obfspw#SkipHy2Obfs';
        const ssV2rayPlugin = 'ss://YWVzLTEyOC1nY206cGFzcw@ss.example.com:8388/?plugin=v2ray-plugin%3Btls#SkipSSPlugin';
        const socksPassOnly = 'socks5://:only-secret@socks.example.com:1080#SocksPassOnly';
        const httpUserOnly = 'http://only-user:@http.example.com:8080#HttpUserOnly';

        const profile = buildSurgeConfigFromLinks([
            vmessWsMultiAlpn,
            vmessDupName,
            trojanReality,
            trojanXhttp,
            trojanH2,
            hy2Obfs,
            ssV2rayPlugin,
            socksPassOnly,
            httpUserOnly,
        ]);

        assert.match(profile, /Node One = vmess, ws\.example\.com, 443/);
        assert.match(profile, /alpn="h2,http\/1\.1"/);
        assert.match(profile, /ws-path="\/ws\?ed=2048,test"/);
        assert.match(profile, /ws-headers="Host:cdn\.example\.com,alt\.example\.com"/);
        assert.match(profile, /Node One-2 = vmess, ws2\.example\.com, 443/);
        assert.doesNotMatch(profile, /SkipReality|SkipXhttp|SkipH2|SkipHy2Obfs|SkipSSPlugin/);
        assert.match(profile, /SocksPassOnly = socks5, socks\.example\.com, 1080, "", only-secret/);
        assert.match(profile, /HttpUserOnly = http, http\.example\.com, 8080, only-user, ""/);
    });

    it('Group 2: insecure flag aliases, VMess host/authority/fp/allowInsecure, Trojan headerType, VLESS PQ, http2://, and Clash link gating', async () => {
        for (const flag of ['allow_insecure=1', 'insecure=1', 'allowInsecure=1', 'skip-cert-verify=true']) {
            const links = [
                `vless://11111111-1111-1111-1111-111111111111@v.example.com:443?security=tls&${flag}#VL`,
                `trojan://pw@t.example.com:443?security=tls&${flag}#TR`,
                `hy2://pw@h.example.com:443?${flag}#HY2`,
                `tuic://11111111-1111-1111-1111-111111111111:pw@u.example.com:443?${flag}#TU`,
            ];
            const sb = JSON.parse(buildSingboxConfigFromLinks(links));
            assert.equal(sb.outbounds.find((o) => o.tag === 'VL')?.tls?.insecure, true, `singbox VLESS ${flag}`);
            assert.equal(sb.outbounds.find((o) => o.tag === 'TR')?.tls?.insecure, true, `singbox Trojan ${flag}`);
            assert.equal(sb.outbounds.find((o) => o.tag === 'HY2')?.tls?.insecure, true, `singbox HY2 ${flag}`);
            assert.equal(sb.outbounds.find((o) => o.tag === 'TU')?.tls?.insecure, true, `singbox TUIC ${flag}`);
            const yaml = buildMihomoConfigFromLinks(links);
            assert.equal((yaml.match(/skip-cert-verify: true/g) || []).length, 4, `mihomo ${flag}`);
        }

        const vmessWsHost = buildClientLink({
            server: { url: 'https://vm.example.com:443', name: 'VM' },
            inbound: { protocol: 'vmess', port: 443, remark: 'VM-WS' },
            client: { id: '11111111-1111-1111-1111-111111111111', email: 'u@example.com' },
            settings: {},
            stream: {
                network: 'ws',
                security: 'tls',
                wsSettings: { host: 'direct-ws.example.com', headers: { host: 'header-ws.example.com' }, path: '/ws' },
                tlsSettings: { allowInsecure: true, settings: { fingerprint: 'firefox' } },
            },
            diagnostics: [],
        });
        const vmJson = JSON.parse(decodeBase64UrlText(vmessWsHost.slice('vmess://'.length)));
        assert.equal(vmJson.host, 'direct-ws.example.com');
        assert.equal(vmJson.fp, 'firefox');
        assert.equal(vmJson.allowInsecure, 1);

        const vmessCaseHeaderGrpc = buildClientLink({
            server: { url: 'https://vm2.example.com:443', name: 'VM2' },
            inbound: { protocol: 'vmess', port: 443, remark: 'VM-GRPC' },
            client: { id: '22222222-2222-2222-2222-222222222222', email: 'u@example.com' },
            settings: {},
            stream: {
                network: 'grpc',
                security: 'tls',
                grpcSettings: { serviceName: 'svc', authority: 'grpc-auth.example.com' },
            },
            diagnostics: [],
        });
        const vmGrpcJson = JSON.parse(decodeBase64UrlText(vmessCaseHeaderGrpc.slice('vmess://'.length)));
        assert.equal(vmGrpcJson.host, 'grpc-auth.example.com');

        const sbVmess = JSON.parse(buildSingboxConfigFromLinks([vmessWsHost]));
        assert.equal(sbVmess.outbounds[2].tls.insecure, true);
        assert.equal(sbVmess.outbounds[2].tls.utls.fingerprint, 'firefox');

        // Reject tcp + headerType=http on Trojan (both Mihomo & sing-box) and non-none VLESS PQ encryption in sing-box
        const badTrojan = 'trojan://pw@t.example.com:443?type=tcp&headerType=http#BadTrojan';
        const pqVless = 'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?encryption=mlkem768x25519plus#PqVless';
        const http2Proxy = 'http2://user:pass@h2proxy.example.com:443#H2Proxy';
        assert.equal(buildMihomoConfigFromLinks([badTrojan]), '');
        const sbFiltered = JSON.parse(buildSingboxConfigFromLinks([badTrojan, pqVless, http2Proxy]));
        assert.equal(sbFiltered.outbounds.some((o) => o.tag === 'BadTrojan'), false);
        assert.equal(sbFiltered.outbounds.some((o) => o.tag === 'PqVless'), false);
        const h2Out = sbFiltered.outbounds.find((o) => o.tag === 'H2Proxy');
        assert.equal(h2Out?.type, 'http');
        assert.equal(h2Out?.tls?.enabled, true);

        // GET /api/subscriptions/:email gates subscriptionUrlClash/Mihomo when only Clash-incompatible links exist
        const kcpMock = await startMockHttpServer((req, res) => {
            if (req.url === '/login') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': '3x-ui=sess-1; Path=/' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.url === '/panel/api/inbounds/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    obj: [{
                        id: 1,
                        enable: true,
                        protocol: 'vless',
                        port: 9001,
                        remark: 'KCP-Only',
                        settings: JSON.stringify({
                            clients: [{ id: '11111111-1111-1111-1111-111111111111', email: 'kcpuser@example.com', enable: true }],
                        }),
                        streamSettings: JSON.stringify({ network: 'kcp', security: 'none', kcpSettings: { seed: 'abc' } }),
                    }],
                }));
                return;
            }
            res.writeHead(404).end();
        });
        closeables.push(kcpMock.close);
        const srv = createFakeServer({ name: 'kcp-srv', url: kcpMock.url });
        createdServerIds.push(srv.id);
        createdPolicyEmails.push('kcpuser@example.com');
        const admin = userStore.add({ username: 'w2-admin-gate', email: 'w2-admin-gate@example.com', password: 'Password123!', role: 'admin' });
        createdUserIds.push(admin.id);
        const appSrv = await startHttpAppServer();
        closeables.push(appSrv.close);

        const resp = await fetch(`${appSrv.baseUrl}/api/subscriptions/${encodeURIComponent('kcpuser@example.com')}`, {
            headers: { Authorization: makeAuthHeader(admin) },
        });
        assert.equal(resp.status, 200);
        const json = await resp.json();
        assert.equal(json.obj.links.length, 1);
        assert.equal(json.obj.subscriptionUrlClash, '');
        assert.equal(json.obj.subscriptionUrlMihomo, '');
        assert.equal(json.obj.subscriptionUrlSingbox, '');
    });

    it('Group 3: deduplicates s-ui traffic by serverId:suiClientId and isolates native/reconstructed links from policy bypasses', async () => {
        const usage = summarizeSubscriptionUsage([
            { serverId: 's1', entry: { suiClientId: 7, up: 100, down: 200, totalGB: 1000, expiryTime: 5000 } },
            { serverId: 's1', entry: { suiClientId: 7, up: 100, down: 200, totalGB: 1000, expiryTime: 5000 } },
            { serverId: 's2', entry: { suiClientId: 7, up: 50, down: 80, totalGB: 500, expiryTime: 4000 } },
        ]);
        assert.equal(usage.uploadTrafficBytes, 150);
        assert.equal(usage.downloadTrafficBytes, 280);
        assert.equal(usage.trafficLimitBytes, 1500);
        assert.equal(usage.expiryTime, 4000);

        // Non-s-ui server with excluded inbound & /sub route: fallbackSubIds must NOT bypass policy
        let subFetchedCount = 0;
        const xuiMock = await startMockHttpServer((req, res) => {
            if (req.url === '/login') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': '3x-ui=sess; Path=/' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.url === '/panel/api/inbounds/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    obj: [
                        {
                            id: 1,
                            enable: true,
                            protocol: 'vless',
                            port: 443,
                            remark: 'Allowed-VLESS',
                            settings: JSON.stringify({
                                clients: [{ id: '11111111-1111-1111-1111-111111111111', email: 'iso@example.com', subId: 'sub-iso', enable: true }],
                            }),
                            streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
                        },
                        {
                            id: 2,
                            enable: true,
                            excludeFromSub: true,
                            protocol: 'trojan',
                            port: 8443,
                            remark: 'Excluded-Trojan',
                            settings: JSON.stringify({
                                clients: [{ password: 'secret', email: 'iso@example.com', subId: 'sub-iso', enable: true }],
                            }),
                            streamSettings: JSON.stringify({ network: 'tcp', security: 'tls' }),
                        },
                        {
                            id: 3,
                            enable: true,
                            protocol: 'socks',
                            port: 1080,
                            remark: 'Unreconstructable-Socks',
                            settings: JSON.stringify({
                                accounts: [{ user: 'u', pass: 'p', email: 'iso@example.com', subId: 'sub-iso', enable: true }],
                            }),
                            streamSettings: JSON.stringify({}),
                        },
                    ],
                }));
                return;
            }
            if (req.url.startsWith('/sub/')) {
                subFetchedCount += 1;
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end([
                    'vless://11111111-1111-1111-1111-111111111111@h.example.com:443#N-VL',
                    'trojan://secret@h.example.com:8443#N-TR',
                    'vmess://eyJ2IjoiMiIsImFkZCI6ImguZXhhbXBsZS5jb20iLCJwb3J0IjoiNDQzIiwiaWQiOiIyMjIyMjIyMi0yMjIyLTIyMjItMjIyMi0yMjIyMjIyMjIyMjIifQ==',
                ].join('\n'));
                return;
            }
            res.writeHead(404).end();
        });
        closeables.push(xuiMock.close);
        const xuiSrv = createFakeServer({ name: 'xui-iso', url: xuiMock.url });
        createdServerIds.push(xuiSrv.id);

        // auto mode with excludeFromSub present must NOT fetch /sub/:subId for fallback
        const autoRes = await collectByServer(xuiSrv, 'iso@example.com', 'auto', { policy: {} });
        assert.equal(subFetchedCount, 0);
        assert.equal(autoRes.links.length, 1);
        assert.ok(autoRes.links[0].startsWith('vless://'));

        // Hiding the remaining VLESS inbound via NMS hiddenInbounds excludes it immediately and keeps /sub blocked
        systemSettingsStore.setInboundHidden(xuiSrv.id, 1, true);
        try {
            const hiddenRes = await collectByServer(xuiSrv, 'iso@example.com', 'auto', { policy: {} });
            assert.equal(subFetchedCount, 0);
            assert.equal(hiddenRes.links.length, 0);
        } finally {
            systemSettingsStore.setInboundHidden(xuiSrv.id, 1, false);
        }
        const restoredRes = await collectByServer(xuiSrv, 'iso@example.com', 'auto', { policy: {} });
        assert.equal(restoredRes.links.length, 1);
        assert.ok(restoredRes.links[0].startsWith('vless://'));

        // Native mode without excludeFromSub, with protocolScopeMode='selected', filters /sub links by allowedProtocols
        const protocolOnlyMock = await startMockHttpServer((req, res) => {
            if (req.url === '/login') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': '3x-ui=sess2; Path=/' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.url === '/panel/api/inbounds/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    obj: [{
                        id: 1,
                        enable: true,
                        protocol: 'vless',
                        port: 443,
                        settings: JSON.stringify({
                            clients: [{ id: '11111111-1111-1111-1111-111111111111', email: 'sel@example.com', subId: 'sub-sel', enable: true }],
                        }),
                        streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
                    }],
                }));
                return;
            }
            if (req.url === '/sub/sub-sel') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end([
                    'vless://11111111-1111-1111-1111-111111111111@h.example.com:443#N-VL',
                    'trojan://secret@h.example.com:8443#N-TR',
                    'ss://YWVzLTEyOC1nY206cGFzcw@h.example.com:8388#N-SS',
                ].join('\n'));
                return;
            }
            res.writeHead(404).end();
        });
        closeables.push(protocolOnlyMock.close);
        const selSrv = createFakeServer({ name: 'xui-sel', url: protocolOnlyMock.url });
        createdServerIds.push(selSrv.id);

        const nativeFiltered = await collectByServer(selSrv, 'sel@example.com', 'native', {
            policy: { protocolScopeMode: 'selected', allowedProtocols: ['vless'] },
        });
        assert.equal(nativeFiltered.links.length, 1);
        assert.ok(nativeFiltered.links[0].startsWith('vless://'));

        // s-ui reconstructed mode skips native shareLinks and reconstructs link from inbound/client
        const fakeSui = await startFakeSuiPanel({
            username: 'admin',
            password: 'password',
            linkHost: 'sui.example.com',
            inbounds: [{ id: 1, type: 'vless', tag: 'vl', listen: '0.0.0.0', port: 443 }],
            clients: [{
                id: 1,
                name: 'suirecon@example.com',
                enable: true,
                inbounds: [1],
                config: { vless: { uuid: '44444444-4444-4444-4444-444444444444', flow: '' } },
            }],
        });
        closeables.push(fakeSui.close);
        const suiSrv = createFakeServer({ name: 'sui-recon', url: `${fakeSui.url}${fakeSui.basePath}`, panelType: 's-ui' });
        createdServerIds.push(suiSrv.id);

        const suiAuto = await collectByServer(suiSrv, 'suirecon@example.com', 'auto', { policy: {} });
        const suiRecon = await collectByServer(suiSrv, 'suirecon@example.com', 'reconstructed', { policy: {} });
        assert.ok(suiAuto.perServer.nativeLinks > 0);
        assert.equal(suiRecon.perServer.nativeLinks, 0);
        assert.equal(suiRecon.perServer.reconstructedLinks, 1);
        assert.ok(suiRecon.links[0].startsWith('vless://44444444-4444-4444-4444-444444444444@'));
    });

    it('Group 3: PUBLIC_SUB_CACHE separates sing-box 1.11 vs 1.12 and blocked-by-policy returns valid empty Clash YAML & sing-box JSON', async () => {
        const subEmail = 'cache-policy@example.com';
        createdPolicyEmails.push(subEmail);

        const mockNode = await startMockHttpServer((req, res) => {
            if (req.url === '/login') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': '3x-ui=s1; Path=/' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.url === '/panel/api/inbounds/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    obj: [{
                        id: 1,
                        enable: true,
                        protocol: 'vless',
                        port: 443,
                        remark: 'V1',
                        settings: JSON.stringify({
                            clients: [{ id: '11111111-1111-1111-1111-111111111111', email: subEmail, enable: true }],
                        }),
                        streamSettings: JSON.stringify({ network: 'tcp', security: 'tls', tlsSettings: { serverName: 'v.example.com' } }),
                    }],
                }));
                return;
            }
            res.writeHead(404).end();
        });
        closeables.push(mockNode.close);
        const srv = createFakeServer({ name: 'cache-srv', url: mockNode.url });
        createdServerIds.push(srv.id);

        const issued = subscriptionTokenStore.issue(subEmail, { name: 'cache-test', ttlDays: 7, createdBy: 'admin' });
        const { tokenId, tokenSecret } = subscriptionTokenStore.parseToken(issued.token);
        const appSrv = await startHttpAppServer();
        closeables.push(appSrv.close);

        // Request 1.12 first, then 1.11 with identical User-Agent: must NOT collide in PUBLIC_SUB_CACHE
        const r12 = await fetch(`${appSrv.baseUrl}/api/subscriptions/public/t/${tokenId}/${tokenSecret}?format=singbox&singbox_version=1.12`, {
            headers: { 'User-Agent': 'GenericClient/1.0' },
        });
        const j12 = await r12.json();
        const r11 = await fetch(`${appSrv.baseUrl}/api/subscriptions/public/t/${tokenId}/${tokenSecret}?format=singbox&singbox_version=1.11`, {
            headers: { 'User-Agent': 'GenericClient/1.0' },
        });
        const j11 = await r11.json();
        assert.notEqual(j11.dns?.final, undefined);
        assert.ok(Array.isArray(j11.dns.rules));
        assert.notDeepEqual(j11.dns, j12.dns);

        // Policy blocked-by-policy returns valid empty Clash YAML and sing-box JSON on both token and legacy routes
        userPolicyStore.upsert(subEmail, { serverScopeMode: 'none' }, 'admin');
        invalidatePublicSubCache(subEmail);

        const blockedClash = await fetch(`${appSrv.baseUrl}/api/subscriptions/public/t/${tokenId}/${tokenSecret}?format=clash`);
        assert.equal(blockedClash.status, 200);
        assert.match(blockedClash.headers.get('content-type') || '', /text\/yaml/);
        assert.equal(await blockedClash.text(), 'proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n');

        const blockedSb = await fetch(`${appSrv.baseUrl}/api/subscriptions/public/t/${tokenId}/${tokenSecret}?format=singbox`);
        assert.equal(blockedSb.status, 200);
        assert.match(blockedSb.headers.get('content-type') || '', /application\/json/);
        assert.deepEqual(await blockedSb.json(), { outbounds: [{ type: 'direct', tag: 'DIRECT' }] });

        const prevLegacyEnabled = config.subscription.legacySignatureEnabled;
        config.subscription.legacySignatureEnabled = true;
        try {
            const legacySig = signLegacySubscriptionEmail(subEmail);
            const legacyBlockedClash = await fetch(`${appSrv.baseUrl}/api/subscriptions/public/${encodeURIComponent(subEmail)}/${encodeURIComponent(legacySig)}?format=clash`);
            assert.equal(legacyBlockedClash.status, 200);
            assert.equal(await legacyBlockedClash.text(), 'proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n');
            const legacyBlockedSb = await fetch(`${appSrv.baseUrl}/api/subscriptions/public/${encodeURIComponent(subEmail)}/${encodeURIComponent(legacySig)}?format=singbox`);
            assert.equal(legacyBlockedSb.status, 200);
            assert.deepEqual(await legacyBlockedSb.json(), { outbounds: [{ type: 'direct', tag: 'DIRECT' }] });
        } finally {
            config.subscription.legacySignatureEnabled = prevLegacyEnabled;
        }
    });

    it('Group 3: enforces subscription RBAC (auditor readonly/no auto-issue, operator user-only) and resolveEffectivePolicy', async () => {
        const group = userGroupStore.add({
            name: 'VIP-Group',
            enabled: true,
            allowedProtocols: ['vless'],
            protocolScopeMode: 'selected',
            trafficLimitBytes: 5000,
            limitIp: 3,
        }, 'admin');
        createdGroupIds.push(group.id);

        const regularUser = userStore.add({
            username: 'w2-reg-user',
            email: 'w2-reg-user@example.com',
            subscriptionEmail: 'sub-reg@example.com',
            password: 'Password123!',
            role: 'user',
            groupId: group.id,
        });
        createdUserIds.push(regularUser.id);
        createdPolicyEmails.push('sub-reg@example.com');

        const auditorUser = userStore.add({
            username: 'w2-auditor',
            email: 'w2-auditor@example.com',
            subscriptionEmail: 'sub-auditor@example.com',
            password: 'Password123!',
            role: 'auditor',
        });
        createdUserIds.push(auditorUser.id);
        createdPolicyEmails.push('sub-auditor@example.com');

        const operatorUser = userStore.add({
            username: 'w2-operator',
            email: 'w2-operator@example.com',
            password: 'Password123!',
            role: 'operator',
        });
        createdUserIds.push(operatorUser.id);

        const fakeNode = await startMockHttpServer((req, res) => {
            if (req.url === '/login') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': '3x-ui=rb; Path=/' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.url === '/panel/api/inbounds/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    obj: [{
                        id: 1,
                        enable: true,
                        protocol: 'vless',
                        port: 443,
                        settings: JSON.stringify({
                            clients: [{ id: '11111111-1111-1111-1111-111111111111', email: 'sub-reg@example.com', enable: true, expiryTime: 0, limitIp: 0, totalGB: 0 }],
                        }),
                        streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
                    }],
                }));
                return;
            }
            if (req.url.includes('/updateClient/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            res.writeHead(404).end();
        });
        closeables.push(fakeNode.close);
        const srv = createFakeServer({ name: 'rbac-srv', url: fakeNode.url });
        createdServerIds.push(srv.id);

        const appSrv = await startHttpAppServer();
        closeables.push(appSrv.close);

        // Auditor reads GET /:email and /:email/raw without auto-issuing tokens
        const auditGet = await fetch(`${appSrv.baseUrl}/api/subscriptions/${encodeURIComponent('sub-reg@example.com')}`, {
            headers: { Authorization: makeAuthHeader(auditorUser) },
        });
        assert.equal(auditGet.status, 200);
        const auditJson = await auditGet.json();
        assert.equal(auditJson.obj.token.autoIssued, false);
        assert.equal(subscriptionTokenStore.listByEmail('sub-reg@example.com').length, 0);

        const auditRaw = await fetch(`${appSrv.baseUrl}/api/subscriptions/${encodeURIComponent('sub-reg@example.com')}/raw`, {
            headers: { Authorization: makeAuthHeader(auditorUser) },
        });
        assert.equal(auditRaw.status, 200);

        // Auditor is blocked from issue / revoke / reset-link with 403
        for (const action of ['issue', 'revoke', 'reset-link']) {
            const res = await fetch(`${appSrv.baseUrl}/api/subscriptions/${encodeURIComponent('sub-reg@example.com')}/${action}`, {
                method: 'POST',
                headers: { Authorization: makeAuthHeader(auditorUser), 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(res.status, 403, `auditor ${action}`);
        }

        // Operator cannot mutate non-user targets (auditorUser) via issue/revoke/reset-link, but CAN manage regularUser
        for (const action of ['issue', 'revoke', 'reset-link']) {
            const denied = await fetch(`${appSrv.baseUrl}/api/subscriptions/${encodeURIComponent('sub-auditor@example.com')}/${action}`, {
                method: 'POST',
                headers: { Authorization: makeAuthHeader(operatorUser), 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(denied.status, 403, `operator targeting auditor ${action}`);
        }

        // reset-link & clientEntitlementService resolveEffectivePolicy with userStore + userGroupStore
        const opReset = await fetch(`${appSrv.baseUrl}/api/subscriptions/${encodeURIComponent('sub-reg@example.com')}/reset-link`, {
            method: 'POST',
            headers: { Authorization: makeAuthHeader(operatorUser), 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.equal(opReset.status, 200);

        let sentEntitlementClient = null;
        await updateClientEntitlement({
            serverId: srv.id,
            inboundId: '1',
            clientIdentifier: '11111111-1111-1111-1111-111111111111',
            email: 'sub-reg@example.com',
            mode: 'follow_policy',
        }, 'admin', {
            listPanelInbounds: async () => ({
                client: {
                    post: async (_url, data) => {
                        sentEntitlementClient = extractCompatPostedClient(data);
                        return { data: { success: true } };
                    },
                },
                inbounds: [{
                    id: 1,
                    protocol: 'vless',
                    settings: JSON.stringify({
                        clients: [{ id: '11111111-1111-1111-1111-111111111111', email: 'sub-reg@example.com', limitIp: 0, totalGB: 0 }],
                    }),
                }],
            }),
        });
        assert.equal(sentEntitlementClient.totalGB, 5000);
        assert.equal(sentEntitlementClient.limitIp, 3);

        // provisionSubscriptionForUser preserves/applies effective group policy when user has groupId
        let deployedToNode = null;
        const provResult = await provisionSubscriptionForUser(regularUser, {
            subscriptionEmail: 'sub-reg@example.com',
        }, 'admin', {
            userRepository: userStore,
            userGroupRepository: userGroupStore,
            userPolicyRepository: userPolicyStore,
            serverRepository: { list: () => [srv] },
            subscriptionTokenRepository: subscriptionTokenStore,
            listPanelInbounds: async () => ({
                client: {},
                inbounds: [{
                    id: 1,
                    protocol: 'vless',
                    enable: true,
                    settings: JSON.stringify({ clients: [] }),
                    streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
                }],
            }),
            postAddClient: async (_c, _ib, data) => { deployedToNode = data; },
            postUpdateClient: async () => {},
        });
        assert.equal(provResult.policy.trafficLimitBytes, 5000);
        assert.equal(provResult.policy.limitIp, 3);
        assert.equal(deployedToNode.totalGB, 5000);
        assert.equal(deployedToNode.limitIp, 3);
    });

    it('Group 4: supports settings.users, TUIC uuid, Hysteria v1/v2 normalization, s-ui Set-Cookie merge & obfs string', async () => {
        // settings.users parsing + tuic uuid resolution
        const tuicInbound = {
            id: 5,
            protocol: 'tuic',
            settings: JSON.stringify({
                users: [{ uuid: 'tuic-uuid-1', password: 'pw1', email: 'tuic@example.com' }],
            }),
        };
        assert.equal(parseInboundClients(tuicInbound).length, 1);
        assert.equal(mergeInboundClientEntries(tuicInbound).length, 1);
        assert.equal(resolveClientIdentifier(parseInboundClients(tuicInbound)[0], 'tuic'), 'tuic-uuid-1');

        const tuicBatch = normalizeClientData({ uuid: 'tuic-uuid-2', password: 'pw2', email: 'tuic@example.com' }, '', { protocol: 'tuic' });
        assert.equal(tuicBatch.id, 'tuic-uuid-2');
        assert.equal(tuicBatch.uuid, 'tuic-uuid-2');

        // Hysteria v1 vs v2 normalization & updated password preference
        const v1Normalized = normalizeHysteriaInboundForXui({
            protocol: 'hysteria',
            settings: JSON.stringify({
                obfs: 'v1-obfs-key',
                clients: [{ auth_str: 'old-v1', email: 'h1@example.com' }],
            }),
        });
        // Converted to v2: auth_str -> auth, string obfs -> salamander finalmask.
        const v1Settings = JSON.parse(v1Normalized.settings);
        assert.equal(v1Settings.version, 2);
        assert.equal(v1Settings.obfs, undefined);
        assert.equal(v1Settings.clients[0].auth, 'old-v1');
        const v1Stream = JSON.parse(v1Normalized.streamSettings);
        assert.deepEqual(v1Stream.finalmask.udp, [{ type: 'salamander', settings: { password: 'v1-obfs-key' } }]);

        const v2Normalized = normalizeHysteriaInboundForXui({
            protocol: 'hysteria2',
            settings: JSON.stringify({
                version: 2,
                clients: [{ auth: 'stale-auth', password: 'new-password', email: 'h2@example.com' }],
            }),
        });
        assert.equal(JSON.parse(v2Normalized.settings).clients[0].auth, 'new-password');

        assert.equal(
            clientUpdateMatches({ auth: 'next-pw', email: 'h2@example.com' }, { password: 'next-pw', email: 'h2@example.com' }),
            true
        );

        let sentCompatPayload = null;
        await postAddClientCompat({
            post: async (_url, body) => {
                sentCompatPayload = extractCompatPostedClient(body);
                return { data: { success: true } };
            },
        }, 9, { id: 'tuic-u3', password: 'p3', email: 't3@example.com' }, { protocol: 'tuic' });
        assert.equal(sentCompatPayload.uuid, 'tuic-u3');
        assert.equal(sentCompatPayload.id, 'tuic-u3');

        await postUpdateClient({
            post: async (_url, body) => {
                sentCompatPayload = extractCompatPostedClient(body);
                return { data: { success: true } };
            },
        }, 9, 'old-pw', { password: 'new-hy2-pw', email: 'h2@example.com' }, { protocol: 'hysteria2' });
        assert.equal(sentCompatPayload.auth, 'new-hy2-pw');

        // s-ui Hysteria v1 string obfs roundtrip + captureCookie merging by cookie name
        const xuiHy1 = suiInboundToXuiInbound({ id: 1, type: 'hysteria', tag: 'hy1', listen: '0.0.0.0', port: 9000, obfs: 'xplus-secret' }, [], []);
        assert.equal(JSON.parse(xuiHy1.settings).obfs, 'xplus-secret');
        const roundtripSuiHy1 = xuiInboundPayloadToSui({ protocol: 'hysteria', port: 9000, settings: xuiHy1.settings }, null);
        assert.equal(roundtripSuiHy1.obfs, 'xplus-secret');

        const seenCookies = [];
        let reqCount = 0;
        const transport = createSuiTransport({ url: 'https://sui.example.com:2095', username: 'u', password: 'p' }, {
            httpClient: {
                request: async (cfg) => {
                    seenCookies.push(cfg.headers?.Cookie || '');
                    reqCount += 1;
                    if (reqCount === 1) {
                        return { status: 200, headers: { 'set-cookie': ['s-ui=token-1; Path=/', 'cf_clearance=cf-1; Path=/'] }, data: { success: true } };
                    }
                    if (reqCount === 2) {
                        return { status: 200, headers: { 'set-cookie': ['s-ui=token-2; Path=/'] }, data: { success: true, obj: [] } };
                    }
                    return { status: 200, headers: {}, data: { success: true, obj: [] } };
                },
            },
        });
        await transport.request('GET', 'load');
        await transport.request('GET', 'load');
        assert.equal(seenCookies.length, 3);
        assert.match(seenCookies[1], /s-ui=token-1/);
        assert.match(seenCookies[1], /cf_clearance=cf-1/);
        assert.match(seenCookies[2], /s-ui=token-2/);
        assert.match(seenCookies[2], /cf_clearance=cf-1/);

        // protocolCatalog hysteria / hysteria2 supports.transports
        assert.deepEqual(getProtocolSchema('hysteria')?.supports?.transports, ['hysteria']);
        assert.deepEqual(getProtocolSchema('hysteria2')?.supports?.transports, ['hysteria']);
    });

    it('Group 4 & Board #29: fails explicitly on upstream HTML/success:false, keeps probing fallback xray routes, and retries delete_user_cleanup', async () => {
        const htmlListMock = await startMockHttpServer((req, res) => {
            if (req.url === '/login') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': '3x-ui=hl; Path=/' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Login</body></html>');
        });
        closeables.push(htmlListMock.close);
        const htmlListSrv = createFakeServer({ name: 'html-list', url: htmlListMock.url });
        createdServerIds.push(htmlListSrv.id);
        await assert.rejects(
            () => listPanelInbounds(htmlListSrv.id),
            /JSON|list/i
        );

        await assert.rejects(
            () => fetchPanelServerStatus({
                nmsServer: { id: 'mock-srv', name: 'Mock', panelType: '3x-ui' },
                get: async () => ({ status: 200, data: { success: false, msg: 'expired session' } }),
                post: async () => ({ status: 200, data: { success: false, msg: 'expired session' } }),
            }),
            /expired session|invalid JSON|status/i
        );

        const htmlAuthMock = await startMockHttpServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html>error</html>');
        });
        closeables.push(htmlAuthMock.close);
        const htmlAuthSrv = createFakeServer({ name: 'html-auth', url: htmlAuthMock.url });
        createdServerIds.push(htmlAuthSrv.id);
        await assert.rejects(
            () => ensureAuthenticated(htmlAuthSrv.id, { apiToken: 'tok' }),
            (err) => err?.code === 'PANEL_INVALID_RESPONSE'
        );

        assert.equal(isUnsupportedPanelRouteError({ response: { status: 410 } }), true);
        assert.equal(isUnsupportedPanelRouteError({ response: { status: 501 } }), true);

        let routeCalls = 0;
        const xrayRes = await fetchPanelSettings(async ({ url }) => {
            routeCalls += 1;
            if (routeCalls === 1) return { status: 200, data: '<html>not-json</html>' };
            if (routeCalls === 2) return { status: 200, data: { success: false, msg: 'bad route' } };
            return { status: 200, data: { success: true, obj: { xraySetting: JSON.stringify({ log: { loglevel: 'warning' } }) } } };
        });
        assert.ok(routeCalls >= 3);
        assert.ok(xrayRes);

        // batch user_sync retry for operation === 'delete_user_cleanup'
        let deletedOnServer = false;
        const cleanupMock = await startMockHttpServer((req, res) => {
            if (req.url === '/login') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': '3x-ui=c1; Path=/' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.url === '/panel/api/inbounds/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    obj: [{
                        id: 11,
                        enable: true,
                        protocol: 'vless',
                        port: 443,
                        remark: 'CleanupNode',
                        settings: JSON.stringify({
                            clients: [{ id: 'del-uuid-1', email: 'deleted-user@example.com', enable: true }],
                        }),
                    }],
                }));
                return;
            }
            if (req.url === '/panel/api/inbounds/11/delClient/del-uuid-1') {
                deletedOnServer = true;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            res.writeHead(404).end();
        });
        closeables.push(cleanupMock.close);
        const cleanupSrv = createFakeServer({ name: 'cleanup-srv', url: cleanupMock.url });
        createdServerIds.push(cleanupSrv.id);

        const admin = userStore.add({ username: 'w2-admin-cleanup', email: 'w2-admin-cleanup@example.com', password: 'Password123!', role: 'admin' });
        createdUserIds.push(admin.id);

        const job = jobStore.appendBatch({
            type: 'user_sync',
            action: 'delete_user_cleanup',
            actor: 'admin',
            total: 1,
            successCount: 0,
            failedCount: 1,
            failedServerIds: [cleanupSrv.id],
            results: [{
                email: 'deleted-user@example.com',
                serverId: cleanupSrv.id,
                serverName: cleanupSrv.name,
                status: 'failed',
                reason: 'panel-unreachable',
            }],
            requestSnapshot: {
                operation: 'delete_user_cleanup',
                emails: ['deleted-user@example.com'],
                serverIds: [cleanupSrv.id],
            },
        });

        const appSrv = await startHttpAppServer();
        closeables.push(appSrv.close);

        const retryRes = await fetch(`${appSrv.baseUrl}/api/jobs/${job.id}/retry`, {
            method: 'POST',
            headers: { Authorization: makeAuthHeader(admin), 'Content-Type': 'application/json' },
            body: JSON.stringify({ failedOnly: true }),
        });
        assert.equal(retryRes.status, 200);
        const retryJson = await retryRes.json();
        assert.equal(deletedOnServer, true);
        assert.equal(retryJson.obj.operation, 'delete_user_cleanup');
        assert.equal(retryJson.obj.summary.success, 1);
        assert.equal(retryJson.obj.summary.failed, 0);
    });
});
