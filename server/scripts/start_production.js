import { register } from 'node:module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

try {
    register('tsx', import.meta.url);
} catch {
    // Already registered or unsupported
}

const {
    collectStartupIssues,
    ensureRuntimeDirectories,
    formatStartupIssues,
    loadRuntimeEnv,
} = await import('../lib/startupPreflight.ts');

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
const envFile = resolve(rootDir, '.env');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
loadRuntimeEnv(envFile);
ensureRuntimeDirectories(process.env, { rootDir });

const issues = collectStartupIssues(process.env, {
    rootDir,
    envFile,
    includeClientBuildCheck: true,
    includeEnvFileNotice: true,
});

if (issues.length > 0) {
    console.error(formatStartupIssues(issues, { rootDir, envFile }));
    process.exit(1);
}

const { startServer } = await import('../index.js');

startServer().catch((error) => {
    console.error('[Startup Error]', error);
    process.exit(1);
});
