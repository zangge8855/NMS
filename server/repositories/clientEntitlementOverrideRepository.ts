import clientEntitlementOverrideStore from '../store/clientEntitlementOverrideStore.js';
import type { ClientEntitlementOverride } from '../types/index.js';

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function readSnapshotItems(): any[] {
    const snapshot = clientEntitlementOverrideStore.exportState();
    if (Array.isArray(snapshot)) {
        return snapshot;
    }
    if (Array.isArray(snapshot?.records)) {
        return snapshot.records;
    }
    return Object.values(snapshot?.records || {});
}

export interface ClientOverrideFilters {
    serverId?: string;
    inboundId?: string | number;
    [key: string]: any;
}

const clientEntitlementOverrideRepository = {
    list(filters: ClientOverrideFilters = {}): ClientEntitlementOverride[] {
        const serverId = normalizeText(filters.serverId);
        const inboundId = normalizeText(filters.inboundId);
        return readSnapshotItems()
            .filter((item: any) => {
                if (serverId && item.serverId !== serverId) return false;
                if (inboundId && String(item.inboundId) !== inboundId) return false;
                return true;
            })
            .map((item: any) => ({ ...item }));
    },

    get(serverId: string, inboundId: string | number, clientIdentifier: string): ClientEntitlementOverride | undefined {
        return clientEntitlementOverrideStore.get(serverId, inboundId, clientIdentifier);
    },

    upsert(payload: any, actor?: string): ClientEntitlementOverride {
        return clientEntitlementOverrideStore.upsert(payload, actor);
    },

    remove(serverId: string, inboundId: string | number, clientIdentifier: string): boolean {
        return clientEntitlementOverrideStore.remove(serverId, inboundId, clientIdentifier);
    },
};

export default clientEntitlementOverrideRepository;
