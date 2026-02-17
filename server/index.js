import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
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
import { bootstrapDatabase } from './db/bootstrap.js';
import { getStoreModes } from './db/runtimeModes.js';
import { backfillStoresToDatabase, hydrateStoresFromDatabase } from './store/storeRegistry.js';


const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);

// ── WebSocket Server ───────────────────────────────────────
initWebSocket(httpServer);

// Middleware
// Trust reverse proxies on loopback/private networks so req.ip reflects real client IP.
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
app.use(cors({
    origin: config.nodeEnv === 'development' ? 'http://localhost:5173' : false,
    credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Rate Limiting ──────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.nodeEnv === 'development' ? 5000 : 1200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, msg: '请求过于频繁，请稍后再试' },
    skip: (req) => {
        const path = String(req.path || '');
        return path.startsWith('/subscriptions/sub/')
            || path.startsWith('/subscriptions/public/')
            || path.startsWith('/ws/ticket')
            || path.startsWith('/auth/check');
    },
});
app.use('/api', apiLimiter);

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
app.use('/api/system', authMiddleware, adminOnly, systemRoutes);

// Subscriptions: public /sub/ endpoint has its own token auth, management is admin-only
app.use('/api/subscriptions', subscriptionRoutes);

// Keep API behavior consistent: unknown API routes should return JSON 404
// instead of falling through to the SPA index.html handler.
app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        msg: 'API route not found',
    });
});


// Serve React build in production (or when explicitly enabled)
const shouldServeClientBuild = config.nodeEnv === 'production' || process.env.SERVE_CLIENT === 'true';
if (shouldServeClientBuild) {
    const clientBuild = resolve(__dirname, '..', 'client', 'dist');
    const clientIndexFile = resolve(clientBuild, 'index.html');
    const hasClientIndex = fs.existsSync(clientIndexFile);
    if (!hasClientIndex) {
        console.warn(`[Client] Build file not found: ${clientIndexFile}`);
    }
    app.use(express.static(clientBuild));
    app.get('*', (req, res, next) => {
        res.sendFile(clientIndexFile, (err) => {
            if (err) return next(err);
            return undefined;
        });
    });
}

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

process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err);
    setTimeout(() => process.exit(1), 1000);
});

// ── Start ──────────────────────────────────────────────────
async function startServer() {
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

    httpServer.listen(config.port, () => {
        console.log(`\n  🚀 Node Management System (NMS) running on http://localhost:${config.port}`);
        console.log(`  📦 Environment: ${config.nodeEnv}`);
        console.log(`  🔗 API: http://localhost:${config.port}/api\n`);
    });
}

startServer().catch((error) => {
    console.error('[Startup Error]', error);
    process.exit(1);
});

export default app;
