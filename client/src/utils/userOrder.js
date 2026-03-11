function normalizeId(value) {
    return String(value || '').trim();
}

export function normalizeUserOrder(input = []) {
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(
        input
            .map((item) => normalizeId(item))
            .filter(Boolean)
    ));
}

export function sortUsersByOrder(users = [], order = [], fallbackCompare = null) {
    const normalizedOrder = normalizeUserOrder(order);
    const orderIndex = new Map(normalizedOrder.map((id, index) => [id, index]));
    const rows = [...(Array.isArray(users) ? users : [])];

    return rows.sort((left, right) => {
        const leftIndex = orderIndex.get(normalizeId(left?.id));
        const rightIndex = orderIndex.get(normalizeId(right?.id));
        const leftKnown = Number.isInteger(leftIndex);
        const rightKnown = Number.isInteger(rightIndex);

        if (leftKnown && rightKnown) return leftIndex - rightIndex;
        if (leftKnown) return -1;
        if (rightKnown) return 1;
        if (typeof fallbackCompare === 'function') return fallbackCompare(left, right);
        return 0;
    });
}

export function moveUserToPosition(users = [], userId, position) {
    const rows = Array.isArray(users) ? [...users] : [];
    const normalizedUserId = normalizeId(userId);
    const fromIndex = rows.findIndex((item) => normalizeId(item?.id) === normalizedUserId);
    const targetIndex = Math.max(0, Math.min(rows.length - 1, Number(position)));

    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
        return {
            changed: false,
            items: rows,
            userIds: rows.map((item) => normalizeId(item?.id)).filter(Boolean),
        };
    }

    const reordered = [...rows];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    return {
        changed: true,
        items: reordered,
        userIds: reordered.map((item) => normalizeId(item?.id)).filter(Boolean),
    };
}
