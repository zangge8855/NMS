function parseIpv4Octets(text: string): [number, number, number, number] | null {
    const parts = text.split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map((item) => {
        if (!/^(?:0|[1-9]\d{0,2})$/.test(item)) return -1;
        return Number(item);
    });
    if (nums.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
    return nums as [number, number, number, number];
}

function parseIpv6Hextets(rawText: string): number[] | null {
    let text = rawText.trim().toLowerCase();
    if (!text || !text.includes(':')) return null;

    if (text.includes('.')) {
        const lastColon = text.lastIndexOf(':');
        if (lastColon < 0) return null;
        const ipv4Part = text.slice(lastColon + 1);
        const octets = parseIpv4Octets(ipv4Part);
        if (!octets) return null;
        const high = ((octets[0] << 8) | octets[1]).toString(16);
        const low = ((octets[2] << 8) | octets[3]).toString(16);
        text = `${text.slice(0, lastColon)}:${high}:${low}`;
    }

    const compressionParts = text.split('::');
    if (compressionParts.length > 2) return null;

    if (compressionParts.length === 2) {
        const head = compressionParts[0] ? compressionParts[0].split(':') : [];
        const tail = compressionParts[1] ? compressionParts[1].split(':') : [];
        if (head.some((item) => !item) || tail.some((item) => !item)) return null;
        const missing = 8 - head.length - tail.length;
        if (missing < 1) return null;
        const groups = [
            ...head,
            ...Array.from({ length: missing }, () => '0'),
            ...tail,
        ];
        if (groups.length !== 8) return null;
        const parsed = groups.map((item) => (/^[0-9a-f]{1,4}$/.test(item) ? Number.parseInt(item, 16) : -1));
        return parsed.some((item) => item < 0 || item > 0xffff) ? null : parsed;
    }

    const groups = text.split(':');
    if (groups.length !== 8) return null;
    const parsed = groups.map((item) => (/^[0-9a-f]{1,4}$/.test(item) ? Number.parseInt(item, 16) : -1));
    return parsed.some((item) => item < 0 || item > 0xffff) ? null : parsed;
}

function formatCanonicalIpv6(hextets: number[]): string {
    if (hextets.length !== 8) return '';

    if (
        hextets[0] === 0
        && hextets[1] === 0
        && hextets[2] === 0
        && hextets[3] === 0
        && hextets[4] === 0
        && hextets[5] === 0xffff
    ) {
        const a = (hextets[6] >> 8) & 0xff;
        const b = hextets[6] & 0xff;
        const c = (hextets[7] >> 8) & 0xff;
        const d = hextets[7] & 0xff;
        return `${a}.${b}.${c}.${d}`;
    }

    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;

    for (let i = 0; i < 8; i += 1) {
        if (hextets[i] === 0) {
            if (curStart === -1) {
                curStart = i;
                curLen = 1;
            } else {
                curLen += 1;
            }
            if (curLen > bestLen) {
                bestStart = curStart;
                bestLen = curLen;
            }
        } else {
            curStart = -1;
            curLen = 0;
        }
    }

    if (bestLen < 2) {
        return hextets.map((value) => value.toString(16)).join(':');
    }

    const head = hextets.slice(0, bestStart).map((value) => value.toString(16)).join(':');
    const tail = hextets.slice(bestStart + bestLen).map((value) => value.toString(16)).join(':');
    if (!head && !tail) return '::';
    return `${head}::${tail}`;
}

export function normalizePanelIpAddress(value: any): string {
    let text = String(value || '').trim();
    if (!text || text.toLowerCase() === 'unknown') return '';

    if (text.includes(',')) {
        text = text.split(',')[0].trim();
    }

    if (text.startsWith('[')) {
        const bracketMatch = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
        if (!bracketMatch) return '';
        if (bracketMatch[2]) {
            const port = Number(bracketMatch[2]);
            if (!Number.isInteger(port) || port < 1 || port > 65535) return '';
        }
        text = bracketMatch[1].trim();
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(text)) {
        text = text.replace(/:\d{1,5}$/, '');
    }

    if (text.includes('%')) {
        text = text.split('%')[0].trim();
    }

    const ipv4 = parseIpv4Octets(text);
    if (ipv4) return ipv4.join('.');

    const hextets = parseIpv6Hextets(text);
    return hextets ? formatCanonicalIpv6(hextets) : '';
}

function looksLikeIp(value: any): boolean {
    return Boolean(normalizePanelIpAddress(value));
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
        const ip = normalizePanelIpAddress(row?.ip);
        if (!ip) return;

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
