import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import app from '../index.js';
import { invokeApp } from './helpers/invokeApp.js';
import certificateStore from '../store/certificateStore.js';
import { generateSelfSignedCert, issueOrRenewCertificate, dispatchCertificateToServers } from '../services/acmeService.js';

test('generateSelfSignedCert creates valid RSA cert and key with 90-day expiry', () => {
    const res = generateSelfSignedCert('vpn.example.com', 90);
    assert.ok(res.cert);
    assert.ok(res.key);
    assert.ok(res.expiresAt);
    assert.ok(res.cert.includes('BEGIN CERTIFICATE'));
    assert.ok(res.key.includes('BEGIN PRIVATE KEY'));
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

    const auditorToken = jwt.sign(
        { userId: 'auditor-1', role: 'auditor', username: 'auditor' },
        config.jwt.secret,
        { expiresIn: '1h' }
    );

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

    certificateStore.delete(record.id);
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

    const adminToken = jwt.sign(
        { userId: 'admin-1', role: 'admin', username: 'admin' },
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
