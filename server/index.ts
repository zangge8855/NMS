import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer, type Server as HttpServer } from 'http';
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
import userGroupRoutes from './routes/userGroups.js';
import wsAuthRoutes from './routes/wsAuth.js';
import systemRoutes from './routes/system.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import xrayConfigRoutes from './routes/xrayConfig.js';
import { bootstrapDatabase } from './db/bootstrap.js';
import { flushSnapshotQueue } from './db/snapshots.js';
import { getStoreModes } from './db/runtimeModes.js';
import { closeDb } from './db/client.js';
import { backfillStoresToDatabase, hydrateStoresFromDatabase } from './store/storeRegistry.js';
import systemSettingsStore from './store/systemSettingsStore.js';
import { registerClientBuildRoutes } from './lib/clientBuild.js';
import { createCamouflageAssetMiddleware } from './lib/siteCamouflage.js';
import { createCamouflageNotFoundMiddleware } from './middleware/siteCamouflage.js';
import { createSearchBotProtectionMiddleware } from './middleware/searchBotProtection.js';
import { createSecurityHeadersMiddleware, redactRequestUrl } from './lib/httpSecurity.js';
import serverHealthMonitor from './lib/serverHealthMonitor.js';
import { startServerPanelSnapshotWarmLoop, stopServerPanelSnapshotWarmLoop } from './lib/serverPanelSnapshotService.js';
import { startClusterStatusWarmLoop, stopClusterStatusWarmLoop } from './lib/serverStatusService.js';
import telegramAlertService from './lib/telegramAlertService.js';
import subscriptionExpiryNotifier from './lib/subscriptionExpiryNotifier.js';
import { startTrafficStatsWarmLoop, stopTrafficStatsWarmLoop } from './store/trafficStatsStore.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

function shouldServeClientBuild(): boolean {
    return process.env.SERVE_CLIENT !== 'false';
}

export function createApp(options: { serveClientBuild?: boolean } = {}): Express {
    const app = express();
    const serveClientBuild = options.serveClientBuild ?? shouldServeClientBuild();

    // Middleware
    app.set('trust proxy', config.security.trustProxy);
    app.disable('x-powered-by');
    app.use(createSecurityHeadersMiddleware({
        nodeEnv: config.nodeEnv,
        hstsEnabled: config.security.hstsEnabled,
        hstsMaxAgeSeconds: config.security.hstsMaxAgeSeconds,
    }));
    app.use(createSearchBotProtectionMiddleware());
    app.use(cors({
        origin: true,
        credentials: true,
    }));
    app.use(cookieParser());
    app.use(express.json({ limit: '1mb', strict: false }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // ── Request ID ───────────────────────────────────────────
    const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    app.use((req: Request, res: Response, _next: NextFunction) => {
        const external = String(req.headers['x-request-id'] || '').trim();
        (req as any).id = (external && REQUEST_ID_PATTERN.test(external)) ? external : randomUUID();
        res.setHeader('X-Request-Id', (req as any).id);
        _next();
    });

    // ── Request Logging ──────────────────────────────────────
    app.use((req: Request, res: Response, _next: NextFunction) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            if (req.path === '/api/health' || req.path === '/api/auth/check') return;
            const level = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'log');
            const safeUrl = redactRequestUrl(req.originalUrl);
            console[level](
                `[${(req as any).id?.slice(0, 8)}] ${req.method} ${safeUrl} ${res.statusCode} ${duration}ms`,
            );
        });
        _next();
    });

    // ── Health Check ─────────────────────────────────────────
    app.get('/api/health', (_req: Request, res: Response) => {
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
        skip: (req: Request) => {
            const path = String(req.path || '');
            return path.startsWith('/subscriptions/public/')
                || path.startsWith('/ws/ticket')
                || path.startsWith('/auth/check');
        },
    });
    app.use('/api', apiLimiter);

    // ── Public subscription rate limiter ────────────────────────
    const publicSubLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: 'draft-7',
        legacyHeaders: true,
        message: { success: false, msg: 'Too many requests' },
    });
    app.use('/api/subscriptions/public', publicSubLimiter);

    // ── API Routes ─────────────────────────────────────────────
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
    app.use('/api/user-groups', authMiddleware, adminOnly, userGroupRoutes);
    app.use('/api/users', authMiddleware, adminOnly, usersRoutes);
    app.use('/api/clients', authMiddleware, adminOnly, clientsRoutes);
    app.use('/api/system', authMiddleware, adminOnly, systemRoutes);
    app.use('/api/xray', authMiddleware, adminOnly, xrayConfigRoutes);

    // Subscriptions
    app.use('/api/subscriptions', subscriptionRoutes);

    // Serve React build in production
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

    app.use('/api', (_req: Request, res: Response) => {
        res.status(404).json({
            success: false,
            msg: 'API route not found',
        });
    });

    app.use((_req: Request, res: Response) => {
        res.status(404).type('text/plain').send('Not Found');
    });

    // ── Global Error Handler ───────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
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

let activeHttpServer: HttpServer | null = null;

function setupGracefulShutdown(httpServer: HttpServer) {
    activeHttpServer = httpServer;
    let shutdownInProgress = false;

    function shutdown(signal: string) {
        if (shutdownInProgress) return;
        shutdownInProgress = true;
        console.log(`\n  ⏳ Received ${signal}, shutting down gracefully...`);

        serverHealthMonitor.stop();
        stopClusterStatusWarmLoop();
        stopServerPanelSnapshotWarmLoop();
        stopTrafficStatsWarmLoop();
        telegramAlertService.stop();
        subscriptionExpiryNotifier.stop();

        const flushAndExit = (code: number) => {
            flushSnapshotQueue()
                .catch(() => {})
                .then(() => closeDb())
                .catch(() => {})
                .finally(() => process.exit(code));
        };

        if (activeHttpServer) {
            activeHttpServer.close(() => {
                console.log('  ✅ HTTP server closed');
                flushAndExit(0);
            });
            setTimeout(() => {
                console.warn('  ⚠️  Forcing shutdown after timeout');
                flushAndExit(1);
            }, 10_000).unref();
        } else {
            flushAndExit(0);
        }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

const app = createApp();

export function createHttpServer(options: { app?: Express; enableWebSocket?: boolean } = {}) {
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
export async function startServer(options: { port?: number | string; app?: Express; enableWebSocket?: boolean } = {}) {
    await bootstrapRuntime();
    const port = Number(options.port || config.port);
    const { app: serverApp, httpServer } = createHttpServer({
        app: options.app || app,
        enableWebSocket: options.enableWebSocket,
    });
    serverHealthMonitor.start();
    startClusterStatusWarmLoop({
        intervalMs: config.performance?.clusterStatusIntervalMs,
    });
    startServerPanelSnapshotWarmLoop({
        intervalMs: config.performance?.panelSnapshotIntervalMs,
    });
    startTrafficStatsWarmLoop();
    telegramAlertService.start();
    subscriptionExpiryNotifier.start();

    await new Promise<void>((resolvePromise, rejectPromise) => {
        httpServer.once('error', rejectPromise);
        httpServer.listen(port, '0.0.0.0', () => {
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
