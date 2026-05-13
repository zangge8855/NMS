import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
    DEFAULT_REVIEW_DATA_DIR,
    REVIEW_CREDENTIALS,
} from './reviewHarnessFixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, '..');

const env = {
    ...process.env,
    PORT: process.env.PORT || '3101',
    DATA_DIR: process.env.DATA_DIR || DEFAULT_REVIEW_DATA_DIR,
    ALLOW_PRIVATE_SERVER_URL: process.env.ALLOW_PRIVATE_SERVER_URL || 'true',
    SERVE_CLIENT: process.env.SERVE_CLIENT || 'true',
    JWT_SECRET: process.env.JWT_SECRET || 'review-jwt-secret-1234567890-abcdef',
    CREDENTIALS_SECRET: process.env.CREDENTIALS_SECRET || 'review-credentials-secret-1234567890-abcdef',
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || REVIEW_CREDENTIALS.admin.username,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || REVIEW_CREDENTIALS.admin.password,
};

const child = spawn(process.execPath, ['index.js'], {
    cwd: serverDir,
    env,
    stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        child.kill(signal);
    });
}

child.on('exit', (code, signal) => {
    if (signal) {
        process.exit(1);
    }
    process.exit(code ?? 0);
});
