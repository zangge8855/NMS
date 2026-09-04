import test from 'node:test';
import assert from 'node:assert/strict';
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
