import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import config from './config.js';
import { initWebSocket } from './wsServer.js';
import { authMiddleware, adminOnly } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import serverRoutes from './routes/servers.js';
import proxyRoutes from './routes/proxy.js';
import subscriptionRoutes from './routes/subscriptions.js';
import batchRoutes from './routes/batch.js';
import capabilitiesRoutes from './routes/capabilities.js';
import protocolSchemasRoutes from './routes/protocolSchemas.js';
import auditRoutes from './routes/audit.js';
import trafficRoutes from './routes/traffic.js';
import userPolicyRoutes from './routes/userPolicy.js';
import wsAuthRoutes from './routes/wsAuth.js';
import systemRoutes from './routes/system.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import { bootstrapDatabase } from './db/bootstrap.js';
import { getStoreModes } from './db/runtimeModes.js';
import { backfillStoresToDatabase, hydrateStoresFromDatabase } from './store/storeRegistry.js';
import systemSettingsStore from './store/systemSettingsStore.js';
import { registerClientBuildRoutes } from './lib/clientBuild.js';
import { createCamouflageAssetMiddleware } from './lib/siteCamouflage.js';
import { createCamouflageNotFoundMiddleware } from './middleware/siteCamouflage.js';
import { createSearchBotProtectionMiddleware } from './middleware/searchBotProtection.js';
import serverHealthMonitor from './lib/serverHealthMonitor.js';
import telegramAlertService from './lib/telegramAlertService.js';
import subscriptionExpiryNotifier from './lib/subscriptionExpiryNotifier.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

function shouldServeClientBuild() {
    return config.nodeEnv === 'production' || process.env.SERVE_CLIENT === 'true';
}

export function createApp(options = {}) {
    const app = express();
    const serveClientBuild = options.serveClientBuild ?? shouldServeClientBuild();

    // Middleware
    // Trust reverse proxies on loopback/private networks so req.ip reflects real client IP.
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.disable('x-powered-by');
    app.use(createSearchBotProtectionMiddleware());
    app.use(cors({
        origin: config.nodeEnv === 'development' ? 'http://localhost:5173' : false,
        credentials: true,
    }));
    app.use(cookieParser());
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // ── Request ID ───────────────────────────────────────────
    const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    app.use((req, res, _next) => {
        const external = String(req.headers['x-request-id'] || '').trim();
        req.id = (external && REQUEST_ID_PATTERN.test(external)) ? external : randomUUID();
        res.setHeader('X-Request-Id', req.id);
        _next();
    });

    // ── Request Logging ──────────────────────────────────────
    app.use((req, res, _next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            // Skip noisy health/check/static asset polling
            if (req.path === '/api/health' || req.path === '/api/auth/check') return;
            const level = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'log');
            console[level](
                `[${req.id?.slice(0, 8)}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
            );
        });
        _next();
    });

    // ── Health Check ─────────────────────────────────────────
    app.get('/api/health', (_req, res) => {
        res.json({
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            env: config.nodeEnv,
        });
    });

    // ── Rate Limiting ──────────────────────────────────────────
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: config.nodeEnv === 'development' ? 5000 : 1200,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { success: false, msg: '请求过于频繁，请稍后再试' },
        skip: (req) => {
            const path = String(req.path || '');
            return path.startsWith('/subscriptions/public/')
                || path.startsWith('/ws/ticket')
                || path.startsWith('/auth/check');
        },
    });
    app.use('/api', apiLimiter);

    // ── Public subscription rate limiter ────────────────────────
    // The global apiLimiter skips /subscriptions/public/ so clients can fetch
    // subscriptions freely; add a dedicated, more lenient limiter to prevent
    // unlimited probing of public subscription endpoints.
    const publicSubLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { success: false, msg: 'Too many requests' },
    });
    app.use('/api/subscriptions/public', publicSubLimiter);

    // ── API Routes ─────────────────────────────────────────────
    // Auth routes (login/register — no auth required on most)
    app.use('/api/auth', authRoutes);
    app.use('/api/ws', authMiddleware, adminOnly, wsAuthRoutes);

    // Admin routes
    app.use('/api/capabilities', authMiddleware, adminOnly, capabilitiesRoutes);
    app.use('/api/protocol-schemas', authMiddleware, adminOnly, protocolSchemasRoutes);
    app.use('/api/audit', authMiddleware, adminOnly, auditRoutes);
    app.use('/api/traffic', authMiddleware, adminOnly, trafficRoutes);

    app.use('/api/servers', authMiddleware, adminOnly, serverRoutes);
    app.use('/api/panel', authMiddleware, adminOnly, proxyRoutes);
    app.use('/api/batch', authMiddleware, adminOnly, batchRoutes);
    app.use('/api/jobs', authMiddleware, adminOnly, batchRoutes);
    app.use('/api/user-policy', authMiddleware, adminOnly, userPolicyRoutes);
    app.use('/api/users', authMiddleware, adminOnly, usersRoutes);
    app.use('/api/clients', authMiddleware, adminOnly, clientsRoutes);
    app.use('/api/system', authMiddleware, adminOnly, systemRoutes);

    // Subscriptions: public /sub/ endpoint has its own token auth, management is admin-only
    app.use('/api/subscriptions', subscriptionRoutes);

    // Serve React build in production (or when explicitly enabled)
    if (serveClientBuild) {
        registerClientBuildRoutes(app, {
            getSiteConfig: () => systemSettingsStore.getSite(),
        });
    }

    app.use(createCamouflageAssetMiddleware({
        getSiteConfig: () => systemSettingsStore.getSite(),
    }));

    app.use(createCamouflageNotFoundMiddleware({
        getSiteConfig: () => systemSettingsStore.getSite(),
    }));

    // Keep API behavior consistent for non-document probes and programmatic callers.
    app.use('/api', (req, res) => {
        res.status(404).json({
            success: false,
            msg: 'API route not found',
        });
    });

    app.use((req, res) => {
        res.status(404).type('text/plain').send('Not Found');
    });

    // ── Global Error Handler ───────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        const status = err.status || err.statusCode || 500;
        const message = config.nodeEnv === 'production'
            ? '服务器内部错误'
            : (err.message || '服务器内部错误');
        console.error(`[Error] ${req.method} ${req.originalUrl} →`, err.stack || err);
        res.status(status).json({ success: false, msg: message });
    });

    return app;
}

process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err);
    setTimeout(() => process.exit(1), 1000);
});

let activeHttpServer = null;

function setupGracefulShutdown(httpServer) {
    activeHttpServer = httpServer;
    let shutdownInProgress = false;

    function shutdown(signal) {
        if (shutdownInProgress) return;
        shutdownInProgress = true;
        console.log(`\n  ⏳ Received ${signal}, shutting down gracefully...`);

        serverHealthMonitor.stop();
        telegramAlertService.stop();
        subscriptionExpiryNotifier.stop();

        if (activeHttpServer) {
            activeHttpServer.close(() => {
                console.log('  ✅ HTTP server closed');
                process.exit(0);
            });
            // Force exit after 10 seconds if connections don't close
            setTimeout(() => {
                console.warn('  ⚠️  Forcing shutdown after timeout');
                process.exit(1);
            }, 10_000).unref();
        } else {
            process.exit(0);
        }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

const app = createApp();

export function createHttpServer(options = {}) {
    const serverApp = options.app || app;
    const httpServer = createServer(serverApp);
    if (options.enableWebSocket !== false) {
        initWebSocket(httpServer);
    }
    return { app: serverApp, httpServer };
}

async function bootstrapRuntime() {
    const dbBoot = await bootstrapDatabase();
    if (dbBoot.enabled) {
        if (dbBoot.ready) {
            const modes = getStoreModes();
            console.log(`  🗄️  Database ready (schema: ${dbBoot.schema || 'n/a'})`);
            console.log(`  🧭 Store modes: read=${modes.readMode}, write=${modes.writeMode}`);
            if (dbBoot.error) {
                console.warn(`  ⚠️  Database bootstrap warning: ${dbBoot.error}`);
            }

            if (modes.readMode === 'db') {
                const hydration = await hydrateStoresFromDatabase();
                console.log(`  ♻️  Store hydration from DB: ${hydration.loaded}/${hydration.total} loaded`);
            }

            if (modes.writeMode === 'dual' || modes.writeMode === 'db') {
                const baseline = await backfillStoresToDatabase({
                    dryRun: false,
                    redact: config.db?.backfillRedact !== false,
                });
                console.log(`  💾 DB baseline sync: ${baseline.success}/${baseline.total} stores synced`);
            }
        } else {
            console.warn(`  ⚠️  Database init failed: ${dbBoot.error || 'unknown error'}`);
            console.warn('  ⚠️  Falling back to file-backed stores');
        }
    }
}

// ── Start ──────────────────────────────────────────────────
export async function startServer(options = {}) {
    await bootstrapRuntime();
    const port = Number(options.port || config.port);
    const { app: serverApp, httpServer } = createHttpServer({
        app: options.app || app,
        enableWebSocket: options.enableWebSocket,
    });
    serverHealthMonitor.start();
    telegramAlertService.start();
    subscriptionExpiryNotifier.start();

    await new Promise((resolvePromise, rejectPromise) => {
        httpServer.once('error', rejectPromise);
        httpServer.listen(port, () => {
            httpServer.off('error', rejectPromise);
            resolvePromise();
        });
    });

    setupGracefulShutdown(httpServer);

    console.log(`\n  🚀 Node Management System (NMS) running on http://localhost:${port}`);
    console.log(`  📦 Environment: ${config.nodeEnv}`);
    console.log(`  🔗 API: http://localhost:${port}/api\n`);

    return { app: serverApp, httpServer };
}

const entryHref = process.argv[1]
    ? pathToFileURL(resolve(process.argv[1])).href
    : '';

if (entryHref === import.meta.url) {
    startServer().catch((error) => {
        console.error('[Startup Error]', error);
        process.exit(1);
    });
}

export default app;
