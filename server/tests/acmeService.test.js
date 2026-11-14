import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import app from '../index.js';
import { invokeApp } from './helpers/invokeApp.js';
import certificateStore from '../store/certificateStore.js';
import serverStore from '../store/serverStore.js';
import userStore from '../store/userStore.js';
import {
    generateSelfSignedCert,
    issueOrRenewCertificate,
    dispatchCertificateToServers,
} from '../services/acmeService.js';

test('generateSelfSignedCert creates verifiable X.509 v3 RSA cert with DNS and IPv6 SANs', () => {
    const res = generateSelfSignedCert('vpn.example.com', 90, {
        sans: ['2001:0db8::1', '198.51.100.7'],
    });
    assert.ok(res.cert);
    assert.ok(res.key);
    assert.ok(res.expiresAt);
    assert.ok(res.cert.includes('BEGIN CERTIFICATE'));
    assert.ok(res.key.includes('BEGIN PRIVATE KEY'));

    const x509 = new crypto.X509Certificate(res.cert);
    assert.equal(x509.checkPrivateKey(crypto.createPrivateKey(res.key)), true);
    assert.equal(x509.checkHost('vpn.example.com'), 'vpn.example.com');
    assert.match(x509.subjectAltName || '', /DNS:vpn\.example\.com/);
    assert.match(x509.subjectAltName || '', /IP Address:198\.51\.100\.7/);
    assert.match(x509.subjectAltName || '', /IP Address:2001:db8:/i);
});

test('certificateStore CRUD works accurately', () => {
    const record = certificateStore.create({
        domain: 'test.example.com',
        provider: 'letsencrypt',
        challengeType: 'manual',
    });

    assert.ok(record.id);
    assert.equal(record.domain, 'test.example.com');
    assert.equal(record.status, 'pending');

    const fetched = certificateStore.getById(record.id);
    assert.ok(fetched);
    assert.equal(fetched.id, record.id);

    const updated = certificateStore.update(record.id, { status: 'valid' });
    assert.equal(updated?.status, 'valid');

    const deleted = certificateStore.delete(record.id);
    assert.equal(deleted, true);
    assert.equal(certificateStore.getById(record.id), null);
});

test('issueOrRenewCertificate generates certificate for pending record', async () => {
    const record = certificateStore.create({
        domain: 'auto.example.com',
        provider: 'letsencrypt',
        challengeType: 'manual',
    });

    const issued = await issueOrRenewCertificate(record.id);
    assert.equal(issued.status, 'valid');
    assert.ok(issued.certificate);
    assert.ok(issued.privateKey);
    assert.ok(issued.expiresAt);

    // Clean up
    certificateStore.delete(record.id);
});

test('GET /api/certificates/:id redacts secrets for auditor role even if requested', async () => {
    const record = certificateStore.create({
        domain: 'secret.example.com',
        provider: 'cloudflare',
        challengeType: 'dns',
        cfApiToken: 'real-cf-token-12345',
    });
    certificateStore.update(record.id, {
        privateKey: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
    });

    const auditor = userStore.add({
        username: `acme_auditor_${Date.now()}`,
        email: `acme_auditor_${Date.now()}@example.com`,
        password: 'AuditorPass123!',
        role: 'auditor',
        enabled: true,
        emailVerified: true,
    });
    const auditorToken = jwt.sign(
        { userId: auditor.id, role: auditor.role, username: auditor.username, tokenVersion: 1 },
        config.jwt.secret,
        { expiresIn: '1h' }
    );

    try {
        const res = await invokeApp(app, {
            method: 'GET',
            url: `/api/certificates/${record.id}?includeSecrets=true`,
            headers: {
                Authorization: `Bearer ${auditorToken}`,
            },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.obj.cfApiToken, '********');
        assert.equal(res.json.obj.privateKey, undefined);
        assert.equal(res.json.obj.hasPrivateKey, true);
    } finally {
        userStore.remove(auditor.id);
        certificateStore.delete(record.id);
    }
});

test('GET /api/certificates/:id exposes secrets for admin role when requested', async () => {
    const record = certificateStore.create({
        domain: 'secret.example.com',
        provider: 'cloudflare',
        challengeType: 'dns',
        cfApiToken: 'real-cf-token-12345',
    });
    certificateStore.update(record.id, {
        privateKey: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
    });

    const admin = userStore.getAll().find((item) => item.role === 'admin') || userStore.getByUsername('admin');
    const storedAdmin = admin ? userStore.getById(admin.id) : null;
    const adminToken = jwt.sign(
        {
            userId: storedAdmin.id,
            role: storedAdmin.role,
            username: storedAdmin.username,
            tokenVersion: storedAdmin.tokenVersion || 1,
        },
        config.jwt.secret,
        { expiresIn: '1h' }
    );

    const res = await invokeApp(app, {
        method: 'GET',
        url: `/api/certificates/${record.id}?includeSecrets=true`,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.obj.cfApiToken, 'real-cf-token-12345');
    assert.ok(res.json.obj.privateKey.includes('BEGIN PRIVATE KEY'));

    certificateStore.delete(record.id);
});

test('issueOrRenewCertificate requires cfApiToken for dns-cloudflare challenge', async () => {
    const record = certificateStore.create({
        domain: 'no-token.example.com',
        provider: 'letsencrypt',
        challengeType: 'dns-cloudflare',
        cfApiToken: '',
    });

    try {
        await assert.rejects(
            () => issueOrRenewCertificate(record.id, { allowLoopbackDirectory: true }),
            /Cloudflare API Token is required/
        );
        const failed = certificateStore.getById(record.id);
        assert.equal(failed?.status, 'error');
    } finally {
        certificateStore.delete(record.id);
    }
});

test('ACME directory resolver and POST /api/certificates reject private/loopback SSRF URLs', async () => {
    const { resolveAcmeDirectoryUrl } = await import('../services/acmeService.js');
    assert.throws(
        () => resolveAcmeDirectoryUrl('custom', 'http://127.0.0.1:8080/directory'),
        /private|local|internal/i
    );
    assert.throws(
        () => resolveAcmeDirectoryUrl('custom', 'http://169.254.169.254/latest/meta-data'),
        /private|local/i
    );

    const storedAdmin = userStore.getByUsername(config.auth.adminUsername);
    const adminToken = jwt.sign(
        {
            userId: storedAdmin.id,
            role: storedAdmin.role,
            username: storedAdmin.username,
            tokenVersion: storedAdmin.tokenVersion || 1,
        },
        config.jwt.secret,
        { expiresIn: '1h' }
    );

    const res = await invokeApp(app, {
        method: 'POST',
        url: '/api/certificates',
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
        body: {
            domain: 'ssrf-acme.example.com',
            provider: 'custom',
            acmeDirectoryUrl: 'http://127.0.0.1:8080/directory',
            challengeType: 'http',
            issueImmediately: false,
        },
    });
    assert.equal(res.statusCode, 400);
});

test('issueOrRenewCertificate executes full RFC 8555 ACME v2 HTTP-01 flow and serves challenge route', async (t) => {
    let nonceCounter = 0;
    let challengeValidated = false;
    let observedHttpChallengeBody = '';
    let baseUrl = '';
    const sampleIssuedCert = generateSelfSignedCert('acme-test.example.com', 90);

    const acmeServer = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', async () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            const parsedJws = rawBody ? JSON.parse(rawBody) : null;
            nonceCounter += 1;
            res.setHeader('Replay-Nonce', `nonce-${nonceCounter}`);

            if (req.url === '/directory' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    newNonce: `${baseUrl}/new-nonce`,
                    newAccount: `${baseUrl}/new-account`,
                    newOrder: `${baseUrl}/new-order`,
                }));
                return;
            }
            if (req.url === '/new-nonce' && req.method === 'HEAD') {
                res.writeHead(200);
                res.end();
                return;
            }
            if (req.url === '/new-account' && req.method === 'POST') {
                assert.ok(parsedJws?.protected && parsedJws?.signature);
                res.writeHead(201, {
                    'Content-Type': 'application/json',
                    Location: `${baseUrl}/acct/1`,
                });
                res.end(JSON.stringify({ status: 'valid' }));
                return;
            }
            if (req.url === '/new-order' && req.method === 'POST') {
                const payload = JSON.parse(Buffer.from(parsedJws.payload, 'base64url').toString('utf8'));
                assert.equal(payload.identifiers[0].value, 'acme-test.example.com');
                res.writeHead(201, {
                    'Content-Type': 'application/json',
                    Location: `${baseUrl}/order/1`,
                });
                res.end(JSON.stringify({
                    status: 'pending',
                    authorizations: [`${baseUrl}/authz/1`],
                    finalize: `${baseUrl}/order/1/finalize`,
                }));
                return;
            }
            if (req.url === '/authz/1' && req.method === 'POST') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: challengeValidated ? 'valid' : 'pending',
                    identifier: { type: 'dns', value: 'acme-test.example.com' },
                    challenges: [
                        {
                            type: 'http-01',
                            url: `${baseUrl}/chall/http-1`,
                            token: 'testChallengeToken123456',
                            status: challengeValidated ? 'valid' : 'pending',
                        },
                    ],
                }));
                return;
            }
            if (req.url === '/chall/http-1' && req.method === 'POST') {
                // Simulate ACME CA fetching /.well-known/acme-challenge/:token from our Express app
                const challengeRes = await invokeApp(app, {
                    method: 'GET',
                    url: '/.well-known/acme-challenge/testChallengeToken123456',
                });
                assert.equal(challengeRes.statusCode, 200);
                observedHttpChallengeBody = challengeRes.text;
                assert.match(observedHttpChallengeBody, /^testChallengeToken123456\.[A-Za-z0-9_-]+$/);
                challengeValidated = true;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'valid', type: 'http-01' }));
                return;
            }
            if (req.url === '/order/1/finalize' && req.method === 'POST') {
                const payload = JSON.parse(Buffer.from(parsedJws.payload, 'base64url').toString('utf8'));
                assert.ok(payload.csr);
                const csrDer = Buffer.from(payload.csr, 'base64url');
                assert.ok(csrDer.toString('ascii').includes('acme-test.example.com'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'valid',
                    certificate: `${baseUrl}/cert/1`,
                }));
                return;
            }
            if (req.url === '/cert/1' && req.method === 'POST') {
                res.writeHead(200, { 'Content-Type': 'application/pem-certificate-chain' });
                res.end(sampleIssuedCert.cert);
                return;
            }
            res.writeHead(404);
            res.end();
        });
    });

    await new Promise((resolve) => acmeServer.listen(0, '127.0.0.1', resolve));
    const port = acmeServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    t.after(() => new Promise((resolve) => acmeServer.close(resolve)));

    const record = certificateStore.create({
        domain: 'acme-test.example.com',
        provider: 'custom',
        acmeDirectoryUrl: `${baseUrl}/directory`,
        challengeType: 'http',
        email: 'admin@example.com',
    });

    try {
        const issued = await issueOrRenewCertificate(record.id, {
            pollIntervalMs: 10,
            dnsPropagationWaitMs: 0,
            allowLoopbackDirectory: true,
        });
        assert.equal(issued.status, 'valid');
        assert.equal(challengeValidated, true);
        assert.ok(observedHttpChallengeBody.startsWith('testChallengeToken123456.'));
        assert.ok(issued.certificate.includes('BEGIN CERTIFICATE'));
        assert.ok(issued.privateKey.includes('BEGIN PRIVATE KEY'));

        // Challenge token must be cleaned up after completion
        const afterRes = await invokeApp(app, {
            method: 'GET',
            url: '/.well-known/acme-challenge/testChallengeToken123456',
        });
        assert.equal(afterRes.statusCode, 404);
    } finally {
        certificateStore.delete(record.id);
    }
});

test('dispatchCertificateToServers verifies keypair match and pushes inline PEM to matching 3x-ui TLS inbound', async (t) => {
    const validPair = generateSelfSignedCert('edge.example.com', 90, { sans: ['2001:db8::9'] });
    const otherPair = generateSelfSignedCert('other.example.com', 90);
    const mismatchedRecord = certificateStore.create({
        domain: 'mismatch.example.com',
        provider: 'selfsigned',
        challengeType: 'manual',
        certificate: validPair.cert,
        privateKey: otherPair.key,
    });

    try {
        await assert.rejects(
            () => dispatchCertificateToServers(mismatchedRecord.id, ['missing']),
            /does not match private key/
        );
    } finally {
        certificateStore.delete(mismatchedRecord.id);
    }

    let updatedInboundPayload = null;
    const panelInbounds = [
        {
            id: 10,
            remark: 'vless-tls',
            port: 443,
            protocol: 'vless',
            enable: true,
            settings: JSON.stringify({ clients: [] }),
            streamSettings: JSON.stringify({
                network: 'ws',
                security: 'tls',
                tlsSettings: {
                    serverName: 'edge.example.com',
                    certificates: [{ certificateFile: '/old.crt', keyFile: '/old.key' }],
                },
            }),
        },
        {
            id: 11,
            remark: 'other-domain-tls',
            port: 8443,
            protocol: 'trojan',
            enable: true,
            settings: JSON.stringify({ clients: [] }),
            streamSettings: JSON.stringify({
                network: 'tcp',
                security: 'tls',
                tlsSettings: {
                    serverName: 'unrelated.example.com',
                    certificates: [{ certificateFile: '/keep.crt', keyFile: '/keep.key' }],
                },
            }),
        },
    ];

    const panelServer = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            if (req.url === '/login' && req.method === 'POST') {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': '3x-ui=mock-session; Path=/',
                });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.url === '/panel/api/server/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, obj: { xray: { state: 'running' } } }));
                return;
            }
            if (req.url === '/panel/api/inbounds/list' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, obj: panelInbounds }));
                return;
            }
            if (req.url === '/panel/api/server/getWebCertFiles' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    obj: { certFile: '/root/cert/fullchain.pem', keyFile: '/root/cert/privkey.pem' },
                }));
                return;
            }
            if (req.url === '/panel/api/inbounds/update/10' && req.method === 'POST') {
                const params = new URLSearchParams(rawBody);
                updatedInboundPayload = Object.fromEntries(params.entries());
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, msg: 'not found' }));
        });
    });

    await new Promise((resolve) => panelServer.listen(0, '127.0.0.1', resolve));
    const port = panelServer.address().port;
    t.after(() => new Promise((resolve) => panelServer.close(resolve)));

    const serverNode = serverStore.add({
        name: 'Mock 3x-ui TLS Node',
        url: `http://127.0.0.1:${port}`,
        username: 'admin',
        password: 'password123',
    });
    const certRecord = certificateStore.create({
        domain: 'edge.example.com',
        sans: ['2001:db8::9'],
        provider: 'selfsigned',
        challengeType: 'manual',
        certificate: validPair.cert,
        privateKey: validPair.key,
        expiresAt: validPair.expiresAt,
        status: 'valid',
        assignedServerIds: [serverNode.id],
    });

    try {
        const result = await dispatchCertificateToServers(certRecord.id);
        assert.equal(result.success, true);
        assert.deepEqual(result.dispatchedServers, ['Mock 3x-ui TLS Node']);
        assert.deepEqual(result.failedServers, []);
        assert.equal(result.updatedInboundCount, 1);
        assert.equal(result.details[0].mode, 'inline_tls_updated');
        assert.equal(result.details[0].updatedInbounds, 1);
        assert.equal(result.details[0].panelCertPaths.certFile, '/root/cert/fullchain.pem');

        assert.ok(updatedInboundPayload?.streamSettings);
        const nextStream = JSON.parse(updatedInboundPayload.streamSettings);
        assert.equal(nextStream.tlsSettings.certificates.length, 1);
        assert.equal(nextStream.tlsSettings.certificates[0].usage, 'encipherment');
        assert.ok(nextStream.tlsSettings.certificates[0].certificate[0].includes('BEGIN CERTIFICATE'));
        assert.ok(nextStream.tlsSettings.certificates[0].key[0].includes('BEGIN PRIVATE KEY'));
    } finally {
        certificateStore.delete(certRecord.id);
        serverStore.remove(serverNode.id);
    }
});
