import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_MISSING_CLIENT_BUILD_MESSAGE = 'Client build not found. Run `cd client && npm run build` before starting NMS in production.';

export function resolveClientBuildPaths(rootDir = resolve(__dirname, '..', '..')) {
    const clientBuild = resolve(rootDir, 'client', 'dist');
    const clientIndexFile = resolve(clientBuild, 'index.html');
    return { clientBuild, clientIndexFile };
}

export function createClientBuildFallbackHandler({
    clientIndexFile,
    hasClientIndex,
    missingBuildMessage = DEFAULT_MISSING_CLIENT_BUILD_MESSAGE,
}) {
    return (req, res, next) => {
        if (!hasClientIndex) {
            return res.status(503).type('text/plain').send(missingBuildMessage);
        }
        return res.sendFile(clientIndexFile, (err) => {
            if (err) return next(err);
            return undefined;
        });
    };
}

export function registerClientBuildRoutes(app, options = {}) {
    const { rootDir, missingBuildMessage = DEFAULT_MISSING_CLIENT_BUILD_MESSAGE } = options;
    const { clientBuild, clientIndexFile } = resolveClientBuildPaths(rootDir);
    const hasClientIndex = fs.existsSync(clientIndexFile);

    if (!hasClientIndex) {
        console.warn(`[Client] Build file not found: ${clientIndexFile}`);
    }

    app.use(express.static(clientBuild));
    app.get('*', createClientBuildFallbackHandler({
        clientIndexFile,
        hasClientIndex,
        missingBuildMessage,
    }));

    return { clientBuild, clientIndexFile, hasClientIndex };
}
