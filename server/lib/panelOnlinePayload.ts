function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeEmailLike(value: unknown): string {
    return normalizeText(value).toLowerCase();
}

function buildNodeIdByGuid(nodes: any[] = []): Map<string, number> {
    const map = new Map<string, number>();
    for (const node of Array.isArray(nodes) ? nodes : []) {
        const guid = normalizeText(node?.guid || node?.nodeGuid || node?.panelGuid);
        if (!guid) continue;
        const id = Number(node?.id ?? node?.nodeId);
        if (Number.isFinite(id)) {
            map.set(guid, id);
        }
    }
    return map;
}

function readOnlineEmail(item: any): string {
    if (typeof item === 'string') return normalizeText(item);
    if (!item || typeof item !== 'object') return '';
    return normalizeText(item.email || item.user || item.username || item.clientEmail);
}

function pushOnlineEntry(rows: any[], item: any, extra: Record<string, any> = {}): void {
    const email = readOnlineEmail(item);
    if (!email) return;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
        rows.push({ ...item, ...extra, email });
    } else {
        rows.push({ ...extra, email });
    }
}

function isNumericNodeMap(entries: [string, any][]): boolean {
    return entries.length > 0 && entries.every(([key]) => {
        const num = Number(key);
        return Number.isInteger(num) && num >= 0;
    });
}

function isGuidOnlineMap(entries: [string, any][]): boolean {
    return entries.length > 0 && entries.every(([key, value]) => (
        Array.isArray(value)
        && normalizeText(key)
        && !normalizeText(key).includes('@')
    ));
}

export function normalizeOnlineEntries(items: any, options: { nodes?: any[] } = {}): any[] {
    if (!items) return [];

    if (Array.isArray(items)) {
        const rows: any[] = [];
        for (const item of items) {
            pushOnlineEntry(rows, item);
        }
        return rows;
    }

    if (typeof items !== 'object') return [];

    const rows: any[] = [];
    const entries = Object.entries(items);
    if (isNumericNodeMap(entries)) {
        for (const [nodeIdStr, value] of entries) {
            const nodeId = Number(nodeIdStr);
            const list = Array.isArray(value) ? value : [];
            for (const item of list) {
                pushOnlineEntry(rows, item, { nodeId });
            }
        }
        return rows;
    }

    if (isGuidOnlineMap(entries)) {
        const nodeIdByGuid = buildNodeIdByGuid(options.nodes);
        for (const [nodeGuid, value] of entries) {
            const extra: Record<string, any> = { nodeGuid };
            const nodeId = nodeIdByGuid.get(nodeGuid);
            if (nodeId !== undefined) {
                extra.nodeId = nodeId;
            }
            for (const item of value as any[]) {
                pushOnlineEntry(rows, item, extra);
            }
        }
        return rows;
    }

    for (const [emailKey, value] of entries) {
        const email = normalizeText(emailKey);
        if (!email) continue;
        const entry: Record<string, any> = { email };
        if (Array.isArray(value)) {
            entry.ips = value;
        } else if (value && typeof value === 'object') {
            Object.assign(entry, value);
        }
        if (normalizeEmailLike(entry.email)) {
            rows.push(entry);
        }
    }
    return rows;
}
