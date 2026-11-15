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
const { ensureGeneratedSecrets } = await import('../lib/runtimeEnv.ts');

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
const envFile = resolve(rootDir, '.env');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
loadRuntimeEnv(envFile, rootDir);
const { dataDir } = ensureRuntimeDirectories(process.env, { rootDir });

// Generate (once) and persist JWT_SECRET / CREDENTIALS_SECRET before the
// preflight runs, so a fresh install never starts with a guessable secret.
try {
    const generated = ensureGeneratedSecrets(dataDir);
    if (generated.persistedTo) {
        console.warn(`[Startup] Generated ${generated.generated.join(' and ')} in ${generated.persistedTo}. Back this file up with the data directory.`);
    }
} catch (error) {
    console.error(`[Startup] ${error?.message || error}`);
    process.exit(1);
}

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
