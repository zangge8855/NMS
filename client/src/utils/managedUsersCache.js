import { readSessionSnapshot, writeSessionSnapshot } from './sessionSnapshot.js';

const DEFAULT_TTL_MS = 30_000;
const SNAPSHOT_KEY = 'managed_users_v1';
const SNAPSHOT_TTL_MS = 2 * 60_000;

let cachedUsers = null;
let cachedAtMs = 0;
let pendingPromise = null;
let snapshotHydrated = false;

function normalizeUserList(response) {
    const list = Array.isArray(response?.data?.obj) ? response.data.obj : [];
    return list.filter((user) => user?.role !== 'admin');
}

function hydrateManagedUsersSnapshot() {
    if (snapshotHydrated) return;
    snapshotHydrated = true;
    const snapshot = readSessionSnapshot(SNAPSHOT_KEY, {
        maxAgeMs: SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (Array.isArray(snapshot)) {
        cachedUsers = snapshot.filter((user) => user?.role !== 'admin');
        cachedAtMs = Date.now();
    }
}

export async function fetchManagedUsers(api, options = {}) {
    hydrateManagedUsersSnapshot();
    const force = options.force === true;
    const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
    const ageMs = Date.now() - cachedAtMs;

    if (!force && Array.isArray(cachedUsers) && ageMs >= 0 && ageMs <= ttlMs) {
        return cachedUsers;
    }

    if (!force && pendingPromise) {
        return pendingPromise;
    }

    const request = api.get('/auth/users')
        .then((response) => {
            const nextUsers = normalizeUserList(response);
            cachedUsers = nextUsers;
            cachedAtMs = Date.now();
            writeSessionSnapshot(SNAPSHOT_KEY, nextUsers);
            return nextUsers;
        })
        .finally(() => {
            if (pendingPromise === request) {
                pendingPromise = null;
            }
        });

    pendingPromise = request;
    return request;
}

export function getManagedUsersSnapshot() {
    hydrateManagedUsersSnapshot();
    return Array.isArray(cachedUsers) ? cachedUsers : [];
}

export function invalidateManagedUsersCache() {
    cachedUsers = null;
    cachedAtMs = 0;
    pendingPromise = null;
    snapshotHydrated = false;
}
