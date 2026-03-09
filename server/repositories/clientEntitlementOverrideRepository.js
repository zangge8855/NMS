import clientEntitlementOverrideStore from '../store/clientEntitlementOverrideStore.js';

function normalizeText(value) {
    return String(value || '').trim();
}

function readSnapshotItems() {
    const snapshot = clientEntitlementOverrideStore.exportState();
    if (Array.isArray(snapshot)) {
        return snapshot;
    }
    if (Array.isArray(snapshot?.records)) {
        return snapshot.records;
    }
    return Object.values(snapshot?.records || {});
}

const clientEntitlementOverrideRepository = {
    list(filters = {}) {
        const serverId = normalizeText(filters.serverId);
        const inboundId = normalizeText(filters.inboundId);
        return readSnapshotItems()
            .filter((item) => {
                if (serverId && item.serverId !== serverId) return false;
                if (inboundId && String(item.inboundId) !== inboundId) return false;
                return true;
            })
            .map((item) => ({ ...item }));
    },

    get(serverId, inboundId, clientIdentifier) {
        return clientEntitlementOverrideStore.get(serverId, inboundId, clientIdentifier);
    },

    upsert(payload, actor) {
        return clientEntitlementOverrideStore.upsert(payload, actor);
    },

    remove(serverId, inboundId, clientIdentifier) {
        return clientEntitlementOverrideStore.remove(serverId, inboundId, clientIdentifier);
    },
};

export default clientEntitlementOverrideRepository;
