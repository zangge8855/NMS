import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import trafficStatsStore, { buildCalendarTrafficWindowRange } from '../store/trafficStatsStore.js';
import serverStore from '../store/serverStore.js';

const router = Router();
const CALENDAR_WINDOW_KEYS = new Set(['today', 'this_week', 'this_month']);

function normalizeBoolean(value: unknown, fallback: boolean = false): boolean {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function normalizeCalendarWindowKey(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase();
    return CALENDAR_WINDOW_KEYS.has(normalized) ? normalized : '';
}

function applyCalendarWindowToOptions(options: any = {}, windowKey: string = '') {
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

function parseWindowKeys(value: unknown): string[] {
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

router.post('/refresh', async (_req: Request, res: Response) => {
    const collected = await trafficStatsStore.collectIfStale(true);
    return res.json({
        success: true,
        obj: collected,
    });
});

router.get('/overview', async (req: Request, res: Response) => {
    const forceRefresh = normalizeBoolean(req.query.refresh, false);
    const collection = await ensureTrafficSamples({ forceRefresh });
    const baseOptions = {
        from: req.query.from as string,
        to: req.query.to as string,
        days: req.query.days ? Number(req.query.days) : undefined,
        top: req.query.top ? Number(req.query.top) : undefined,
    };
    const options = applyCalendarWindowToOptions(baseOptions, (req.query.window || req.query.range) as string);
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
    const batch = typeof (trafficStatsStore as any).getOverviewBatch === 'function'
        ? (trafficStatsStore as any).getOverviewBatch(batchRequests, options)
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

router.get('/status', (_req: Request, res: Response) => {
    return res.json({
        success: true,
        obj: readTrafficCollectionStatus(),
    });
});

router.get('/users/:email/trend', async (req: Request, res: Response) => {
    const forceRefresh = normalizeBoolean(req.query.refresh, false);
    await ensureTrafficSamples({ forceRefresh });
    const trend = trafficStatsStore.getUserTrend(req.params.email, applyCalendarWindowToOptions({
        from: req.query.from as string,
        to: req.query.to as string,
        days: req.query.days ? Number(req.query.days) : undefined,
        granularity: req.query.granularity as string,
        includeBreakdown: normalizeBoolean(req.query.includeBreakdown, false),
    }, (req.query.window || req.query.range) as string));
    return res.json({
        success: true,
        obj: trend,
    });
});

router.get('/servers/:serverId/trend', async (req: Request, res: Response) => {
    const serverId = String(req.params.serverId || '').trim();
    if (!serverStore.getAll().some((item: any) => item.id === serverId)) {
        return res.status(404).json({
            success: false,
            msg: '节点不存在，请刷新节点列表后重试',
        });
    }
    const forceRefresh = normalizeBoolean(req.query.refresh, false);
    await ensureTrafficSamples({ forceRefresh });
    const trend = trafficStatsStore.getServerTrend(serverId, applyCalendarWindowToOptions({
        from: req.query.from as string,
        to: req.query.to as string,
        days: req.query.days ? Number(req.query.days) : undefined,
        granularity: req.query.granularity as string,
    }, (req.query.window || req.query.range) as string));
    return res.json({
        success: true,
        obj: trend,
    });
});

export default router;
