function normalizeId(value) {
    return String(value || '').trim();
}

function normalizeIdList(input = []) {
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(
        input
            .map((item) => normalizeId(item))
            .filter(Boolean)
    ));
}

function normalizeServerDirection(value) {
    return String(value || '').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
}

function compareInboundFallback(left, right) {
    const portDiff = Number(left?.port || 0) - Number(right?.port || 0);
    if (portDiff !== 0) return portDiff;

    const remarkDiff = String(left?.remark || '').localeCompare(String(right?.remark || ''));
    if (remarkDiff !== 0) return remarkDiff;

    const protocolDiff = String(left?.protocol || '').localeCompare(String(right?.protocol || ''));
    if (protocolDiff !== 0) return protocolDiff;

    return normalizeId(left?.id).localeCompare(normalizeId(right?.id));
}

function compareServerGroup(left, right, direction = 'asc') {
    const nameDiff = String(left?.serverName || '').localeCompare(String(right?.serverName || ''));
    const baseResult = nameDiff !== 0
        ? nameDiff
        : normalizeId(left?.serverId).localeCompare(normalizeId(right?.serverId));
    return normalizeServerDirection(direction) === 'desc' ? baseResult * -1 : baseResult;
}

export function normalizeInboundOrderMap(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

    const output = {};
    Object.entries(input).forEach(([rawServerId, rawInboundIds]) => {
        const serverId = normalizeId(rawServerId);
        if (!serverId || !Array.isArray(rawInboundIds)) return;

        const inboundIds = Array.from(new Set(
            rawInboundIds
                .map((item) => normalizeId(item))
                .filter(Boolean)
        ));

        if (inboundIds.length > 0) {
            output[serverId] = inboundIds;
        }
    });
    return output;
}

export function sortServersByOrder(servers = [], serverOrder = [], options = {}) {
    const normalizedServerOrder = normalizeIdList(serverOrder);
    const orderIndex = new Map(normalizedServerOrder.map((id, index) => [id, index]));
    const direction = normalizeServerDirection(options?.direction);

    return [...(Array.isArray(servers) ? servers : [])].sort((left, right) => {
        const leftId = normalizeId(left?.id);
        const rightId = normalizeId(right?.id);
        const leftIndex = orderIndex.get(leftId);
        const rightIndex = orderIndex.get(rightId);
        const leftKnown = Number.isInteger(leftIndex);
        const rightKnown = Number.isInteger(rightIndex);

        if (leftKnown && rightKnown) return leftIndex - rightIndex;
        if (leftKnown) return -1;
        if (rightKnown) return 1;

        const nameDiff = String(left?.name || '').localeCompare(String(right?.name || ''));
        const baseResult = nameDiff !== 0
            ? nameDiff
            : leftId.localeCompare(rightId);
        return direction === 'desc' ? baseResult * -1 : baseResult;
    });
}

export function sortInboundsByOrder(inbounds = [], orderMap = {}, options = {}) {
    const normalizedOrderMap = normalizeInboundOrderMap(orderMap);
    const normalizedServerOrder = normalizeIdList(options?.serverOrder);
    const serverDirection = normalizeServerDirection(options?.serverDirection);
    const serverOrderIndex = new Map(normalizedServerOrder.map((id, index) => [id, index]));
    const serverIndexMap = new Map(
        Object.entries(normalizedOrderMap).map(([serverId, inboundIds]) => [
            serverId,
            new Map(inboundIds.map((id, index) => [normalizeId(id), index])),
        ])
    );

    return [...(Array.isArray(inbounds) ? inbounds : [])].sort((left, right) => {
        const leftServerId = normalizeId(left?.serverId);
        const rightServerId = normalizeId(right?.serverId);

        if (leftServerId !== rightServerId) {
            const leftServerIndex = serverOrderIndex.get(leftServerId);
            const rightServerIndex = serverOrderIndex.get(rightServerId);
            const leftServerKnown = Number.isInteger(leftServerIndex);
            const rightServerKnown = Number.isInteger(rightServerIndex);

            if (leftServerKnown && rightServerKnown) return leftServerIndex - rightServerIndex;
            if (leftServerKnown) return -1;
            if (rightServerKnown) return 1;
            return compareServerGroup(left, right, serverDirection);
        }

        const orderIndex = serverIndexMap.get(leftServerId) || new Map();
        const leftIndex = orderIndex.get(normalizeId(left?.id));
        const rightIndex = orderIndex.get(normalizeId(right?.id));
        const leftKnown = Number.isInteger(leftIndex);
        const rightKnown = Number.isInteger(rightIndex);

        if (leftKnown && rightKnown) return leftIndex - rightIndex;
        if (leftKnown) return -1;
        if (rightKnown) return 1;
        return compareInboundFallback(left, right);
    });
}

export function reorderInboundsWithinServer(inbounds = [], draggedKey, targetKey) {
    const rows = Array.isArray(inbounds) ? [...inbounds] : [];
    const dragged = rows.find((item) => item?.uiKey === draggedKey);
    const target = rows.find((item) => item?.uiKey === targetKey);

    if (!dragged || !target || dragged.uiKey === target.uiKey) {
        return { changed: false, items: rows, serverId: '', inboundIds: [] };
    }
    if (normalizeId(dragged.serverId) !== normalizeId(target.serverId)) {
        return { changed: false, items: rows, serverId: '', inboundIds: [] };
    }

    const serverId = normalizeId(dragged.serverId);
    const group = rows.filter((item) => normalizeId(item?.serverId) === serverId);
    const fromIndex = group.findIndex((item) => item?.uiKey === draggedKey);
    const toIndex = group.findIndex((item) => item?.uiKey === targetKey);

    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return { changed: false, items: rows, serverId: '', inboundIds: [] };
    }

    const reorderedGroup = [...group];
    const [moved] = reorderedGroup.splice(fromIndex, 1);
    reorderedGroup.splice(toIndex, 0, moved);

    let cursor = 0;
    const items = rows.map((item) => {
        if (normalizeId(item?.serverId) !== serverId) return item;
        const nextItem = reorderedGroup[cursor];
        cursor += 1;
        return nextItem;
    });

    return {
        changed: true,
        items,
        serverId,
        inboundIds: reorderedGroup.map((item) => normalizeId(item?.id)).filter(Boolean),
    };
}

export function moveServerGroupToPosition(inbounds = [], serverId, position) {
    const rows = Array.isArray(inbounds) ? [...inbounds] : [];
    const normalizedServerId = normalizeId(serverId);
    if (!normalizedServerId) {
        return { changed: false, items: rows, serverIds: [] };
    }

    const groups = new Map();
    const serverIds = [];
    rows.forEach((item) => {
        const itemServerId = normalizeId(item?.serverId);
        if (!itemServerId) return;
        if (!groups.has(itemServerId)) {
            groups.set(itemServerId, []);
            serverIds.push(itemServerId);
        }
        groups.get(itemServerId).push(item);
    });

    const fromIndex = serverIds.indexOf(normalizedServerId);
    const targetIndex = Math.max(0, Math.min(serverIds.length - 1, Number(position)));
    if (fromIndex < 0 || fromIndex === targetIndex) {
        return { changed: false, items: rows, serverIds };
    }

    const reorderedServerIds = [...serverIds];
    const [picked] = reorderedServerIds.splice(fromIndex, 1);
    reorderedServerIds.splice(targetIndex, 0, picked);

    const items = reorderedServerIds.flatMap((id) => groups.get(id) || []);
    return {
        changed: true,
        items,
        serverIds: reorderedServerIds,
    };
}

export function moveInboundWithinServerToPosition(inbounds = [], movedKey, position) {
    const rows = Array.isArray(inbounds) ? [...inbounds] : [];
    const moved = rows.find((item) => item?.uiKey === movedKey);

    if (!moved) {
        return { changed: false, items: rows, serverId: '', inboundIds: [] };
    }

    const serverId = normalizeId(moved.serverId);
    const group = rows.filter((item) => normalizeId(item?.serverId) === serverId);
    const fromIndex = group.findIndex((item) => item?.uiKey === movedKey);
    const targetIndex = Math.max(0, Math.min(group.length - 1, Number(position)));

    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
        return { changed: false, items: rows, serverId: '', inboundIds: [] };
    }

    const reorderedGroup = [...group];
    const [picked] = reorderedGroup.splice(fromIndex, 1);
    reorderedGroup.splice(targetIndex, 0, picked);

    let cursor = 0;
    const items = rows.map((item) => {
        if (normalizeId(item?.serverId) !== serverId) return item;
        const nextItem = reorderedGroup[cursor];
        cursor += 1;
        return nextItem;
    });

    return {
        changed: true,
        items,
        serverId,
        inboundIds: reorderedGroup.map((item) => normalizeId(item?.id)).filter(Boolean),
    };
}
