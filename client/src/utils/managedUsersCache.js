import { readSessionSnapshot, writeSessionSnapshot } from './sessionSnapshot.js';

const DEFAULT_TTL_MS = 30_000;
const SNAPSHOT_KEY = 'managed_users_v1';
const SNAPSHOT_TTL_MS = 2 * 60_000;

let cachedUsers = null;
let cachedAtMs = 0;
let pendingPromise = null;
let snapshotHydrated = false;
let cachedSource = 'snapshot';

function normalizeUserList(response) {
    const list = Array.isArray(response?.data?.obj) ? response.data.obj : [];
    return list.filter((user) => user?.role !== 'admin');
}

function normalizeCachedUsers(value) {
    return Array.isArray(value) ? value.filter((user) => user?.role !== 'admin') : [];
}

export function applyManagedUsersSnapshot(users, options = {}) {
    cachedUsers = normalizeCachedUsers(users);
    cachedAtMs = Date.now();
    cachedSource = String(options.source || 'snapshot').trim() || 'snapshot';
    snapshotHydrated = true;
    return cachedUsers;
}

function hydrateManagedUsersSnapshot() {
    if (snapshotHydrated && Array.isArray(cachedUsers)) return;
    snapshotHydrated = true;
    const snapshot = readSessionSnapshot(SNAPSHOT_KEY, {
        maxAgeMs: SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (Array.isArray(snapshot)) {
        applyManagedUsersSnapshot(snapshot, { source: 'snapshot' });
    }
}

export async function fetchManagedUsers(api, options = {}) {
    hydrateManagedUsersSnapshot();
    const force = options.force === true;
    const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
    const ageMs = Date.now() - cachedAtMs;

    if (!force && Array.isArray(cachedUsers) && ageMs >= 0 && ageMs <= ttlMs) {
        return options.returnMeta === true
            ? { users: cachedUsers, source: cachedSource }
            : cachedUsers;
    }

    if (!force && pendingPromise) {
        return options.returnMeta === true
            ? pendingPromise.then((users) => ({ users, source: 'live' }))
            : pendingPromise;
    }

    const request = api.get('/auth/users')
        .then((response) => {
            const nextUsers = normalizeUserList(response);
            cachedUsers = nextUsers;
            cachedAtMs = Date.now();
            cachedSource = 'live';
            writeSessionSnapshot(SNAPSHOT_KEY, nextUsers);
            return nextUsers;
        })
        .finally(() => {
            if (pendingPromise === request) {
                pendingPromise = null;
            }
        });

    pendingPromise = request;
    return options.returnMeta === true
        ? request.then((users) => ({ users, source: 'live' }))
        : request;
}

export function getManagedUsersSnapshot() {
    hydrateManagedUsersSnapshot();
    return Array.isArray(cachedUsers) ? cachedUsers : [];
}

export function getManagedUsersSnapshotMeta() {
    hydrateManagedUsersSnapshot();
    return {
        users: Array.isArray(cachedUsers) ? cachedUsers : [],
        source: cachedSource,
    };
}

export function invalidateManagedUsersCache() {
    cachedUsers = null;
    cachedAtMs = 0;
    pendingPromise = null;
    snapshotHydrated = false;
    cachedSource = 'snapshot';
}
