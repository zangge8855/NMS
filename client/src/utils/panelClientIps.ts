function looksLikeIp(value: any): boolean {
    const text = String(value || '').trim();
    if (!text) return false;
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(text) || text.includes(':');
}

function normalizeDateTime(value: any): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
}

function normalizeCount(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.max(0, Math.floor(parsed));
}

export interface PanelClientIpRow {
    ip: string;
    count: number;
    lastSeen: string;
    source: string;
    note: string;
    ipLocation: string;
    ipCarrier: string;
}

function extractDirectIpRow(value: any): PanelClientIpRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const ip = [
        value.ip,
        value.clientIp,
        value.address,
        value.host,
        value.value,
        value.remoteAddr,
    ]
        .map((item) => String(item || '').trim())
        .find(Boolean);

    if (!ip) return null;

    return {
        ip,
        count: normalizeCount(value.count ?? value.total ?? value.hits ?? value.uses),
        lastSeen: normalizeDateTime(value.lastSeen ?? value.updatedAt ?? value.ts ?? value.time ?? value.date),
        source: String(value.source ?? value.ipSource ?? '').trim(),
        note: String(value.note ?? value.reason ?? value.label ?? '').trim(),
        ipLocation: String(value.ipLocation ?? value.location ?? value.geo ?? '').trim(),
        ipCarrier: String(value.ipCarrier ?? value.carrier ?? value.isp ?? '').trim(),
    };
}

function mergeRow(existing: PanelClientIpRow, next: PanelClientIpRow): PanelClientIpRow {
    const existingTime = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
    const nextTime = next.lastSeen ? new Date(next.lastSeen).getTime() : 0;
    const latestLastSeen = nextTime > existingTime ? next.lastSeen : existing.lastSeen;

    return {
        ip: existing.ip,
        count: (existing.count || 0) + (next.count || 0),
        lastSeen: latestLastSeen || '',
        source: existing.source || next.source || '',
        note: existing.note || next.note || '',
        ipLocation: existing.ipLocation || next.ipLocation || '',
        ipCarrier: existing.ipCarrier || next.ipCarrier || '',
    };
}

const UNSUPPORTED_HINTS = [
    'not found',
    'unsupported',
    'not support',
    'no such api',
    'unknown route',
    '未实现',
    '没有此功能',
    '不支持',
    '无此接口',
];

export function normalizePanelClientIps(raw: any): PanelClientIpRow[] {
    const deduped = new Map<string, PanelClientIpRow>();

    const pushRow = (row: Partial<PanelClientIpRow> & { ip: string }) => {
        const ip = String(row?.ip || '').trim();
        if (!looksLikeIp(ip)) return;

        const normalized: PanelClientIpRow = {
            ip,
            count: normalizeCount(row?.count),
            lastSeen: normalizeDateTime(row?.lastSeen),
            source: String(row?.source || '').trim(),
            note: String(row?.note || '').trim(),
            ipLocation: String(row?.ipLocation || '').trim(),
            ipCarrier: String(row?.ipCarrier || '').trim(),
        };

        if (deduped.has(ip)) {
            deduped.set(ip, mergeRow(deduped.get(ip)!, normalized));
            return;
        }

        deduped.set(ip, normalized);
    };

    const visit = (value: any) => {
        if (!value) return;

        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }

        if (typeof value === 'string') {
            pushRow({ ip: value });
            return;
        }

        if (typeof value !== 'object') return;

        if (Array.isArray(value.items)) {
            visit(value.items);
            return;
        }

        if (Array.isArray(value.ips)) {
            visit(value.ips);
            return;
        }

        const directRow = extractDirectIpRow(value);
        if (directRow) {
            pushRow(directRow);
            return;
        }

        Object.entries(value).forEach(([key, nested]) => {
            if (!looksLikeIp(key)) return;

            if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
                const next = extractDirectIpRow({ ip: key, ...nested }) || { ip: key };
                pushRow(next);
                return;
            }

            pushRow({
                ip: key,
                count: normalizeCount(nested),
            });
        });
    };

    visit(raw);

    return Array.from(deduped.values());
}

export function isUnsupportedPanelClientIpsError(error: any): boolean {
    const status = Number(error?.response?.status || 0);
    if (status === 404 || status === 405) return true;

    const message = [
        error?.response?.data?.msg,
        error?.message,
    ]
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');

    if (!message) return false;
    return UNSUPPORTED_HINTS.some((hint) => message.includes(hint));
}
