import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import trafficStatsStore, { buildCalendarTrafficWindowRange } from '../store/trafficStatsStore.js';
import serverStore from '../store/serverStore.js';

const router = Router();
const CALENDAR_WINDOW_KEYS = new Set(['today', 'this_week', 'this_month']);

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function normalizeCalendarWindowKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return CALENDAR_WINDOW_KEYS.has(normalized) ? normalized : '';
}

function applyCalendarWindowToOptions(options = {}, windowKey = '') {
    const normalizedWindowKey = normalizeCalendarWindowKey(windowKey);
    if (!normalizedWindowKey) return {
        ...options,
    };

    const range = buildCalendarTrafficWindowRange(normalizedWindowKey);
    return {
        ...options,
        from: range?.from,
        to: range?.to,
        days: undefined,
    };
}

function parseWindowKeys(value) {
    return Array.from(new Set(
        String(value || '')
            .split(',')
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => (
                CALENDAR_WINDOW_KEYS.has(item)
                || (
                    Number.isInteger(Number.parseInt(item, 10))
                    && Number.parseInt(item, 10) > 0
                    && Number.parseInt(item, 10) <= 365
                )
            ))
    )).slice(0, 6);
}

export async function ensureTrafficSamples({ forceRefresh = false } = {}) {
    return trafficStatsStore.collectIfStale(forceRefresh);
}

export function readTrafficCollectionStatus() {
    return trafficStatsStore.getCollectionStatus();
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
    const collection = await ensureTrafficSamples({ forceRefresh });
    const baseOptions = {
        from: req.query.from,
        to: req.query.to,
        days: req.query.days,
        top: req.query.top,
    };
    const options = applyCalendarWindowToOptions(baseOptions, req.query.window || req.query.range);
    const windowKeys = parseWindowKeys(req.query.windows);
    const batchRequests = [
        {
            key: 'overview',
            ...options,
        },
        ...windowKeys.map((key) => {
            if (CALENDAR_WINDOW_KEYS.has(key)) {
                return {
                    key,
                    ...applyCalendarWindowToOptions(options, key),
                };
            }
            return {
                key,
                ...options,
                from: undefined,
                to: undefined,
                days: Number.parseInt(key, 10),
            };
        }),
    ];
    const batch = typeof trafficStatsStore.getOverviewBatch === 'function'
        ? trafficStatsStore.getOverviewBatch(batchRequests, options)
        : Object.fromEntries(batchRequests.map((request) => [request.key, trafficStatsStore.getOverview(request)]));
    const overview = batch.overview || trafficStatsStore.getOverview(options);
    const windows = Object.fromEntries(windowKeys.map((key) => [key, batch[key] || null]));
    return res.json({
        success: true,
        obj: {
            ...overview,
            windows,
            collection,
            status: readTrafficCollectionStatus(),
        },
    });
});

router.get('/status', (_req, res) => {
    return res.json({
        success: true,
        obj: readTrafficCollectionStatus(),
    });
});

router.get('/users/:email/trend', async (req, res) => {
    const forceRefresh = normalizeBoolean(req.query.refresh, false);
    await ensureTrafficSamples({ forceRefresh });
    const trend = trafficStatsStore.getUserTrend(req.params.email, applyCalendarWindowToOptions({
        from: req.query.from,
        to: req.query.to,
        days: req.query.days,
        granularity: req.query.granularity,
    }, req.query.window || req.query.range));
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
    await ensureTrafficSamples({ forceRefresh });
    const trend = trafficStatsStore.getServerTrend(serverId, applyCalendarWindowToOptions({
        from: req.query.from,
        to: req.query.to,
        days: req.query.days,
        granularity: req.query.granularity,
    }, req.query.window || req.query.range));
    return res.json({
        success: true,
        obj: trend,
    });
});

export default router;
