import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    KNOWN_PUBLIC_SECRETS,
    ensureGeneratedSecrets,
    isKnownPublicSecret,
    loadLayeredEnv,
    readEnvFile,
    runtimeEnvFilePath,
} from '../lib/runtimeEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runtime secrets', () => {
    it('generates missing secrets once, persists them, and reuses them on the next start', () => {
        const dataDir = makeTempDir('nms-runtime-secrets-');
        try {
            const env = { NODE_ENV: 'production' };
            const first = ensureGeneratedSecrets(dataDir, env);
            assert.deepEqual(first.generated, ['JWT_SECRET', 'CREDENTIALS_SECRET']);
            assert.equal(first.persistedTo, runtimeEnvFilePath(dataDir));
            assert.ok(env.JWT_SECRET.length >= 32);
            assert.ok(env.CREDENTIALS_SECRET.length >= 32);
            assert.notEqual(env.JWT_SECRET, env.CREDENTIALS_SECRET);
            assert.equal(isKnownPublicSecret(env.JWT_SECRET), false);

            const persisted = readEnvFile(runtimeEnvFilePath(dataDir));
            assert.equal(persisted.JWT_SECRET, env.JWT_SECRET);
            assert.equal(persisted.CREDENTIALS_SECRET, env.CREDENTIALS_SECRET);

            // A restart loads the persisted values instead of generating new ones.
            const restartEnv = { NODE_ENV: 'production', DATA_DIR: dataDir };
            loadLayeredEnv({ env: restartEnv, rootDir: dataDir, envFile: path.join(dataDir, 'missing.env') });
            const second = ensureGeneratedSecrets(dataDir, restartEnv);
            assert.deepEqual(second.generated, []);
            assert.equal(restartEnv.JWT_SECRET, env.JWT_SECRET);
            assert.equal(restartEnv.CREDENTIALS_SECRET, env.CREDENTIALS_SECRET);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it('keeps operator-provided secrets and does not write them to disk', () => {
        const dataDir = makeTempDir('nms-runtime-secrets-explicit-');
        try {
            const env = {
                NODE_ENV: 'production',
                JWT_SECRET: 'operator-jwt-secret-0123456789abcdefghij',
                CREDENTIALS_SECRET: 'operator-cred-secret-0123456789abcdefghij',
            };
            const result = ensureGeneratedSecrets(dataDir, env);
            assert.deepEqual(result.generated, []);
            assert.equal(fs.existsSync(runtimeEnvFilePath(dataDir)), false);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it('applies process env > runtime.env > repo .env precedence', () => {
        const rootDir = makeTempDir('nms-layered-env-');
        try {
            const dataDir = path.join(rootDir, 'data');
            fs.mkdirSync(dataDir);
            fs.writeFileSync(path.join(rootDir, '.env'), 'ADMIN_PASSWORD=from-repo\nPORT=4000\nDATA_DIR=data\n');
            fs.writeFileSync(runtimeEnvFilePath(dataDir), 'ADMIN_PASSWORD=from-runtime\nJWT_SECRET=from-runtime-jwt\n');
            const env = { NODE_ENV: 'production', JWT_SECRET: 'from-process' };
            const result = loadLayeredEnv({ env, rootDir });
            assert.equal(result.dataDir, dataDir);
            assert.equal(env.JWT_SECRET, 'from-process');
            assert.equal(env.ADMIN_PASSWORD, 'from-runtime');
            assert.equal(env.PORT, '4000');
        } finally {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    it('ignores the repo .env under NODE_ENV=test', () => {
        const rootDir = makeTempDir('nms-layered-env-test-');
        try {
            fs.writeFileSync(path.join(rootDir, '.env'), 'DB_URL=postgres://real-db\n');
            const env = { NODE_ENV: 'test', DATA_DIR: path.join(rootDir, 'data') };
            loadLayeredEnv({ env, rootDir });
            assert.equal(env.DB_URL, undefined);
        } finally {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    it('refuses to load config against the repository data directory under the test runner', () => {
        const env = { ...process.env, NODE_ENV: 'test' };
        delete env.DATA_DIR;
        const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./config.ts')"], {
            cwd: SERVER_DIR,
            env,
            encoding: 'utf8',
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Refusing to run tests against the repository data directory/);
    });

    it('refuses a publicly known JWT_SECRET in production even with strict mode off', () => {
        const dataDir = makeTempDir('nms-public-secret-');
        try {
            const env = {
                ...process.env,
                NODE_ENV: 'production',
                NODE_TEST_CONTEXT: '',
                ENFORCE_STRICT_SECURITY: 'false',
                DATA_DIR: dataDir,
                JWT_SECRET: KNOWN_PUBLIC_SECRETS[1],
            };
            const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./config.ts')"], {
                cwd: SERVER_DIR,
                env,
                encoding: 'utf8',
            });
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /published in the NMS source code/);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});

describe('legacy subscription signatures', () => {
    it('never accepts a signature computed with a publicly known secret', async () => {
        const { default: config } = await import('../config.js');
        const {
            resolveLegacySignatureSecrets,
            resolveSubscriptionTokenSecrets,
            verifyLegacyEmailSignature,
        } = await import('../store/subscriptionTokenStore.js');

        const email = 'victim@example.com';
        for (const publicSecret of KNOWN_PUBLIC_SECRETS) {
            for (const key of [publicSecret, `${publicSecret}-credentials`]) {
                const forged = crypto.createHmac('sha256', key).update(email).digest('hex');
                assert.equal(verifyLegacyEmailSignature(email, forged), false, `accepted signature keyed by ${key}`);
            }
        }

        // The public keys remain usable for token-hash matching (not forgeable) only.
        assert.ok(resolveSubscriptionTokenSecrets().includes(KNOWN_PUBLIC_SECRETS[1]));
        assert.equal(resolveLegacySignatureSecrets().some((item) => isKnownPublicSecret(item)), false);

        const genuine = crypto.createHmac('sha256', config.subscription.tokenSecret).update(email).digest('hex');
        assert.equal(verifyLegacyEmailSignature(email, genuine), true);
    });

    it('serves 410 on the legacy signature route unless SUB_LEGACY_SIGNATURE_ENABLED is set', async () => {
        const { default: config } = await import('../config.js');
        const { createApp } = await import('../index.js');
        assert.equal(config.subscription.legacySignatureEnabled, false);

        const app = createApp();
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        try {
            const { port } = server.address();
            const sig = crypto.createHmac('sha256', config.subscription.tokenSecret).update('someone@example.com').digest('hex');
            const response = await fetch(`http://127.0.0.1:${port}/api/subscriptions/public/someone%40example.com/${sig}`);
            assert.equal(response.status, 410);
            assert.match(await response.text(), /legacy subscription links are disabled/);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
});

describe('database TLS options', () => {
    it('maps DB_SSL_MODE with libpq semantics and fails closed on unknown values', async () => {
        const { toSslOption } = await import('../db/client.js');
        assert.equal(toSslOption('disable', ''), false);
        assert.equal(toSslOption('', ''), false);
        assert.deepEqual(toSslOption('require', ''), { rejectUnauthorized: false });
        assert.deepEqual(toSslOption('verify-full', ''), { rejectUnauthorized: true });
        assert.equal(toSslOption('typo-mode', '').rejectUnauthorized, true);
        const verifyCa = toSslOption('verify-ca', '');
        assert.equal(verifyCa.rejectUnauthorized, true);
        assert.equal(typeof verifyCa.checkServerIdentity, 'function');
    });

    it('loads a private CA bundle from DB_SSL_CA_FILE', async () => {
        const { toSslOption } = await import('../db/client.js');
        const dir = makeTempDir('nms-db-ca-');
        try {
            const caFile = path.join(dir, 'ca.pem');
            fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
            const option = toSslOption('verify-full', caFile);
            assert.match(option.ca, /BEGIN CERTIFICATE/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
