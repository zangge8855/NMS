function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmailLike(value) {
    return normalizeText(value).toLowerCase();
}

function buildNodeIdByGuid(nodes = []) {
    const map = new Map();
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

function readOnlineEmail(item) {
    if (typeof item === 'string') return normalizeText(item);
    if (!item || typeof item !== 'object') return '';
    return normalizeText(item.email || item.user || item.username || item.clientEmail);
}

function pushOnlineEntry(rows, item, extra = {}) {
    const email = readOnlineEmail(item);
    if (!email) return;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
        rows.push({ ...item, ...extra, email });
    } else {
        rows.push({ ...extra, email });
    }
}

function isNumericNodeMap(entries) {
    return entries.length > 0 && entries.every(([key]) => {
        const num = Number(key);
        return Number.isInteger(num) && num >= 0;
    });
}

function isGuidOnlineMap(entries) {
    return entries.length > 0 && entries.every(([key, value]) => (
        Array.isArray(value)
        && normalizeText(key)
        && !normalizeText(key).includes('@')
    ));
}

export function normalizeOnlineEntries(items, options = {}) {
    if (!items) return [];

    if (Array.isArray(items)) {
        const rows = [];
        for (const item of items) {
            pushOnlineEntry(rows, item);
        }
        return rows;
    }

    if (typeof items !== 'object') return [];

    const rows = [];
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
            const extra = { nodeGuid };
            const nodeId = nodeIdByGuid.get(nodeGuid);
            if (nodeId !== undefined) {
                extra.nodeId = nodeId;
            }
            for (const item of value) {
                pushOnlineEntry(rows, item, extra);
            }
        }
        return rows;
    }

    for (const [emailKey, value] of entries) {
        const email = normalizeText(emailKey);
        if (!email) continue;
        const entry = { email };
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
