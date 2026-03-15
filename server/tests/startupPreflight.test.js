import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import { join } from 'path';
import {
    collectStartupIssues,
    collectRuntimeDataIssues,
    ensureRuntimeDirectories,
    formatStartupIssues,
} from '../lib/startupPreflight.js';

const tempDirs = [];

function makeTempDir() {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'nms-startup-preflight-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('collectStartupIssues', () => {
    it('reports aggregated production readiness issues when env and client build are missing', () => {
        const rootDir = makeTempDir();

        const issues = collectStartupIssues({
            NODE_ENV: 'production',
        }, {
            rootDir,
        });

        assert.deepEqual(issues.map((issue) => issue.code), [
            'missing_env_file',
            'unsafe_jwt_secret',
            'unsafe_admin_username',
            'unsafe_admin_password',
            'missing_credentials_secret',
            'missing_client_build',
        ]);
    });

    it('accepts externally injected production env when secrets and client build are present', () => {
        const rootDir = makeTempDir();
        const clientDistDir = join(rootDir, 'client', 'dist');
        fs.mkdirSync(clientDistDir, { recursive: true });
        fs.writeFileSync(join(clientDistDir, 'index.html'), '<html></html>');

        const issues = collectStartupIssues({
            NODE_ENV: 'production',
            JWT_SECRET: 'A'.repeat(40),
            CREDENTIALS_SECRET: 'B'.repeat(40),
            ADMIN_USERNAME: 'cluster-admin',
            ADMIN_PASSWORD: 'Sup3r-Strong!',
        }, {
            rootDir,
        });

        assert.deepEqual(issues, []);
    });

    it('skips the missing .env notice when security requirements are already satisfied', () => {
        const rootDir = makeTempDir();
        const clientDistDir = join(rootDir, 'client', 'dist');
        fs.mkdirSync(clientDistDir, { recursive: true });
        fs.writeFileSync(join(clientDistDir, 'index.html'), '<html></html>');

        const issues = collectStartupIssues({
            NODE_ENV: 'production',
            JWT_SECRET: 'jwt-secret-1234567890-ABCDEFGHIJKLMN',
            CREDENTIALS_SECRET: 'cred-secret-1234567890-ABCDEFGHIJKL',
            ADMIN_USERNAME: 'ops-admin',
            ADMIN_PASSWORD: 'Str0ng!Pass',
        }, {
            rootDir,
        });

        assert.equal(issues.some((issue) => issue.code === 'missing_env_file'), false);
    });

    it('reports corrupted runtime JSON stores before startup continues', () => {
        const rootDir = makeTempDir();
        const dataDir = join(rootDir, 'data');
        const clientDistDir = join(rootDir, 'client', 'dist');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.mkdirSync(clientDistDir, { recursive: true });
        fs.writeFileSync(join(clientDistDir, 'index.html'), '<html></html>');
        fs.writeFileSync(join(dataDir, 'users.json'), '{not-json');
        fs.writeFileSync(join(dataDir, 'servers.json'), '[{"id":"ok"}]');
        fs.writeFileSync(join(dataDir, 'notifications.json'), '{"broken":');

        const issues = collectStartupIssues({
            NODE_ENV: 'production',
            JWT_SECRET: 'jwt-secret-1234567890-ABCDEFGHIJKLMN',
            CREDENTIALS_SECRET: 'cred-secret-1234567890-ABCDEFGHIJKL',
            ADMIN_USERNAME: 'ops-admin',
            ADMIN_PASSWORD: 'Str0ng!Pass',
        }, {
            rootDir,
        });

        assert.deepEqual(issues.map((issue) => issue.code), [
            'invalid_users_store',
            'invalid_notifications_store',
        ]);
    });
});

describe('collectRuntimeDataIssues', () => {
    it('returns an empty list when runtime files are absent or readable', () => {
        const rootDir = makeTempDir();
        const dataDir = join(rootDir, 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(join(dataDir, 'users.json'), '[]');

        const issues = collectRuntimeDataIssues(dataDir);

        assert.deepEqual(issues, []);
    });
});

describe('ensureRuntimeDirectories', () => {
    it('creates the runtime logs and data directories', () => {
        const rootDir = makeTempDir();

        const paths = ensureRuntimeDirectories({
            DATA_DIR: 'runtime-data',
        }, {
            rootDir,
        });

        assert.equal(fs.existsSync(paths.logsDir), true);
        assert.equal(fs.existsSync(paths.dataDir), true);
        assert.equal(paths.dataDir.endsWith('/runtime-data'), true);
    });
});

describe('formatStartupIssues', () => {
    it('formats a readable troubleshooting report', () => {
        const message = formatStartupIssues([
            { code: 'unsafe_jwt_secret', message: 'JWT_SECRET is weak.' },
            { code: 'missing_client_build', message: 'Frontend build is missing.' },
        ], {
            rootDir: '/tmp/nms',
        });

        assert.match(message, /Startup preflight failed\./);
        assert.match(message, /1\. JWT_SECRET is weak\./);
        assert.match(message, /2\. Frontend build is missing\./);
        assert.match(message, /pm2 logs nms --lines 100/);
    });
});
