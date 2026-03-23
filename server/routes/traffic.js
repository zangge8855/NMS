import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import trafficStatsStore from '../store/trafficStatsStore.js';
import serverStore from '../store/serverStore.js';

const router = Router();

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function buildTodayRange() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
        from: start.toISOString(),
        to: now.toISOString(),
    };
}

function parseWindowKeys(value) {
    return Array.from(new Set(
        String(value || '')
            .split(',')
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => (
                item === 'today'
                || (
                    Number.isInteger(Number.parseInt(item, 10))
                    && Number.parseInt(item, 10) > 0
                    && Number.parseInt(item, 10) <= 365
                )
            ))
    )).slice(0, 6);
}

router.use(authMiddleware);

router.post('/refresh', async (req, res) => {
    const collected = await trafficStatsStore.collectIfStale(true);
    return res.json({
        success: true,
        obj: collected,
    });
});

router.get('/overview', async (req, res) => {
    const forceRefresh = normalizeBoolean(req.query.refresh, false);
    const collection = await trafficStatsStore.collectIfStale(forceRefresh);
    const options = {
        from: req.query.from,
        to: req.query.to,
        days: req.query.days,
        top: req.query.top,
    };
    const overview = trafficStatsStore.getOverview(options);
    const windows = parseWindowKeys(req.query.windows).reduce((acc, key) => {
        acc[key] = key === 'today'
            ? trafficStatsStore.getOverview({
                ...options,
                ...buildTodayRange(),
                days: undefined,
            })
            : trafficStatsStore.getOverview({
                ...options,
                from: undefined,
                to: undefined,
                days: Number.parseInt(key, 10),
            });
        return acc;
    }, {});
    return res.json({
        success: true,
        obj: {
            ...overview,
            windows,
            collection,
        },
    });
});

router.get('/users/:email/trend', async (req, res) => {
    const forceRefresh = normalizeBoolean(req.query.refresh, false);
    await trafficStatsStore.collectIfStale(forceRefresh);
    const trend = trafficStatsStore.getUserTrend(req.params.email, {
        from: req.query.from,
        to: req.query.to,
        days: req.query.days,
        granularity: req.query.granularity,
    });
    return res.json({
        success: true,
        obj: trend,
    });
});

router.get('/servers/:serverId/trend', async (req, res) => {
    const serverId = String(req.params.serverId || '').trim();
    if (!serverStore.getAll().some((item) => item.id === serverId)) {
        return res.status(404).json({
            success: false,
            msg: 'Server not found',
        });
    }
    const forceRefresh = normalizeBoolean(req.query.refresh, false);
    await trafficStatsStore.collectIfStale(forceRefresh);
    const trend = trafficStatsStore.getServerTrend(serverId, {
        from: req.query.from,
        to: req.query.to,
        days: req.query.days,
        granularity: req.query.granularity,
    });
    return res.json({
        success: true,
        obj: trend,
    });
});

export default router;
