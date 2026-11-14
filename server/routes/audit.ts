import dns from 'node:dns/promises';
import net from 'node:net';
import { Router, type Request, type Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import auditStore from '../store/auditStore.js';
import { enrichAuditEvent, enrichAuditEvents } from '../lib/auditEventEnrichment.js';
import { buildCsvCell } from '../lib/csv.js';
import ipGeoResolver, { isReservedOrPrivateIp, normalizeIpAddress, stripIpv6Brackets } from '../lib/ipGeoResolver.js';
import ipIspResolver from '../lib/ipIspResolver.js';
import systemSettingsStore from '../store/systemSettingsStore.js';

function extractLookupCandidate(rawInput: unknown): string {
    const raw = String(rawInput || '').trim();
    if (!raw) return '';
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)) {
        try {
            return stripIpv6Brackets(new URL(raw).hostname);
        } catch {
            return '';
        }
    }
    const directIp = normalizeIpAddress(raw);
    if (directIp) return directIp;

    if (/^\[[^\]]+\](?::\d{1,5})?$/.test(raw)) {
        return stripIpv6Brackets(raw.replace(/:\d{1,5}$/, ''));
    }

    // Strip host:port for hostnames without touching raw IPv6 literals.
    const hostPortMatch = raw.match(/^([^:\s]+):(\d{1,5})$/);
    if (hostPortMatch) {
        return hostPortMatch[1].trim();
    }

    return stripIpv6Brackets(raw);
}

function isInternalLookupHostname(hostname: string): boolean {
    const host = stripIpv6Brackets(hostname).toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local') || host.endsWith('.localdomain')) return true;
    if (host.endsWith('.internal') || host.endsWith('.arpa')) return true;
    if (!host.includes('.')) return true;
    return false;
}

export async function resolveIpLookupTarget(
    rawInput: unknown,
    dnsLookup: (hostname: string) => Promise<Array<{ address: string; family: number }>> = async (h) => {
        const res = await dns.lookup(h, { all: true });
        return Array.isArray(res) ? res : [res];
    }
): Promise<{ ip: string; host: string; resolvedIps: string[] }> {
    const candidate = extractLookupCandidate(rawInput);
    if (!candidate) {
        throw new Error('Missing IP or hostname');
    }

    const literalIp = normalizeIpAddress(candidate);
    if (literalIp) {
        return {
            ip: literalIp,
            host: '',
            resolvedIps: [literalIp],
        };
    }

    if (/\s/.test(candidate) || candidate.includes('/') || candidate.length > 253) {
        throw new Error('Invalid IP address or hostname');
    }

    if (isInternalLookupHostname(candidate)) {
        throw new Error(`Refusing to resolve internal hostname: ${candidate}`);
    }

    const records = await dnsLookup(candidate).catch(() => []);
    const resolvedIps = Array.from(new Set(
        (Array.isArray(records) ? records : [])
            .map((entry) => normalizeIpAddress(entry?.address))
            .filter((ip) => Boolean(ip) && net.isIP(ip) !== 0)
    ));

    if (resolvedIps.length === 0) {
        throw new Error(`Unable to resolve hostname: ${candidate}`);
    }

    if (resolvedIps.some((ip) => isReservedOrPrivateIp(ip))) {
        throw new Error(`Refusing to expose private or internal DNS resolution for: ${candidate}`);
    }

    return {
        ip: resolvedIps[0],
        host: candidate,
        resolvedIps,
    };
}

const router = Router();

function toPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

router.use(authMiddleware);

router.get('/events', async (req: Request, res: Response) => {
    const result = auditStore.queryEvents({
        page: toPositiveInt(req.query.page, 1),
        pageSize: toPositiveInt(req.query.pageSize, 20),
        from: req.query.from as string,
        to: req.query.to as string,
        eventType: req.query.eventType as string,
        actor: req.query.actor as string,
        serverId: req.query.serverId as string,
        targetEmail: req.query.targetEmail as string,
        outcome: req.query.outcome as string,
        q: req.query.q as string,
    });

    return res.json({
        success: true,
        obj: {
            ...result,
            items: await enrichAuditEvents(result.items),
        },
    });
});

// ── CSV export audit events ──
router.get('/events/export', (req: Request, res: Response) => {
    const requestedMaxRows = Number(req.query.maxRows || 50000);
    const pageSize = Number.isFinite(requestedMaxRows) && requestedMaxRows > 0
        ? Math.min(Math.floor(requestedMaxRows), 50000)
        : 50000;
    const result = auditStore.queryEvents({
        page: 1,
        pageSize,
        forExport: true,
        from: req.query.from as string,
        to: req.query.to as string,
        eventType: req.query.eventType as string,
        actor: req.query.actor as string,
        serverId: req.query.serverId as string,
        targetEmail: req.query.targetEmail as string,
        outcome: req.query.outcome as string,
        q: req.query.q as string,
    });
    const header = '时间,事件类型,操作者,IP,方法,路径,结果,目标邮箱,服务器 ID';
    const rows = result.items.map(e => [
        buildCsvCell(e.ts || ''),
        buildCsvCell(e.eventType || ''),
        buildCsvCell(e.actor || ''),
        buildCsvCell(e.ip || ''),
        buildCsvCell(e.method || ''),
        buildCsvCell(e.path || ''),
        buildCsvCell(e.outcome || ''),
        buildCsvCell(e.targetEmail || ''),
        buildCsvCell(e.serverId || ''),
    ].join(','));
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit_${new Date().toISOString().slice(0,10)}.csv"`);
    res.setHeader('X-Total-Count', String(result.total ?? result.items.length));
    res.setHeader('X-Export-Truncated', String((result.total ?? result.items.length) > result.items.length));
    return res.send(csv);
});

router.get('/events/:id', async (req: Request, res: Response) => {
    const item = auditStore.getEventById(req.params.id);
    if (!item) {
        return res.status(404).json({
            success: false,
            msg: 'Audit event not found',
        });
    }
    return res.json({
        success: true,
        obj: await enrichAuditEvent(item),
    });
});

router.post('/ip-lookup', async (req: Request, res: Response) => {
    const rawTarget = String(req.body?.ip || req.query?.ip || '').trim();
    if (!rawTarget) {
        return res.status(400).json({ success: false, msg: 'Missing IP' });
    }

    let resolved: { ip: string; host: string; resolvedIps: string[] };
    try {
        resolved = await resolveIpLookupTarget(rawTarget);
    } catch (error: any) {
        return res.status(400).json({
            success: false,
            msg: error?.message || '无效的 IP 地址或无法解析的主机名',
        });
    }

    ipGeoResolver.configure(systemSettingsStore.getAuditIpGeo());
    if (typeof ipIspResolver.configure === 'function') {
        ipIspResolver.configure(systemSettingsStore.getAuditIpGeo());
    }
    const [ipLocation, ipCarrier] = await Promise.all([
        ipGeoResolver.lookup(resolved.ip).catch(() => ''),
        ipIspResolver.lookup(resolved.ip).catch(() => ''),
    ]);
    return res.json({
        success: true,
        obj: {
            ip: resolved.ip,
            host: resolved.host || undefined,
            resolvedIps: resolved.resolvedIps,
            ipLocation: ipLocation || '',
            ipCarrier: ipCarrier || '',
        },
    });
});

router.delete('/events', adminOnly, (_req: Request, res: Response) => {
    auditStore.clearEvents();
    return res.json({ success: true, msg: '操作审计日志已清空' });
});

router.delete('/subscription-access', adminOnly, (_req: Request, res: Response) => {
    auditStore.clearSubscriptionAccess();
    return res.json({ success: true, msg: '订阅访问日志已清空' });
});

export default router;
