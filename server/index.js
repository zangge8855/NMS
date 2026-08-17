import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Register tsx loader if not already present
try {
    register('tsx', import.meta.url);
} catch {
    // Already registered or unsupported
}

const mod = await import('./index.ts');

export const createApp = mod.createApp;
export const createHttpServer = mod.createHttpServer;
export const startServer = mod.startServer;
export default mod.default;

const entryHref = process.argv[1]
    ? pathToFileURL(resolve(process.argv[1])).href
    : '';

if (entryHref === import.meta.url) {
    mod.startServer().catch((error) => {
        console.error('[Startup Error]', error);
        process.exit(1);
    });
}
