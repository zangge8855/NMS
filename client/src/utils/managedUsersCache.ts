import { readSessionSnapshot, writeSessionSnapshot } from './sessionSnapshot';

const DEFAULT_TTL_MS = 30_000;
const SNAPSHOT_KEY = 'managed_users_v1';
const SNAPSHOT_TTL_MS = 2 * 60_000;

let cachedUsers: any[] | null = null;
let cachedAtMs = 0;
let pendingPromise: Promise<any> | null = null;
let snapshotHydrated = false;
let cachedSource = 'snapshot';

const STAFF_ROLES = new Set(['admin', 'operator', 'auditor']);

function normalizeUserList(response: any): any[] {
    const list = Array.isArray(response?.data?.obj) ? response.data.obj : [];
    return list.filter((user: any) => !STAFF_ROLES.has(String(user?.role || '')));
}

function normalizeCachedUsers(value: any): any[] {
    return Array.isArray(value) ? value.filter((user: any) => !STAFF_ROLES.has(String(user?.role || ''))) : [];
}

export function applyManagedUsersSnapshot(users: any[], options: { source?: string } = {}): any[] {
    cachedUsers = normalizeCachedUsers(users);
    cachedAtMs = Date.now();
    cachedSource = String(options.source || 'snapshot').trim() || 'snapshot';
    snapshotHydrated = true;
    return cachedUsers;
}

function hydrateManagedUsersSnapshot(): void {
    if (snapshotHydrated && Array.isArray(cachedUsers)) return;
    snapshotHydrated = true;
    const snapshot = readSessionSnapshot<any[]>(SNAPSHOT_KEY, {
        maxAgeMs: SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (Array.isArray(snapshot)) {
        applyManagedUsersSnapshot(snapshot, { source: 'snapshot' });
    }
}

export interface FetchManagedUsersOptions {
    force?: boolean;
    ttlMs?: number;
    returnMeta?: boolean;
}

export async function fetchManagedUsers(api: any, options: FetchManagedUsersOptions = {}): Promise<any> {
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
        .then(async (response: any) => {
            let combined = Array.isArray(response?.data?.obj) ? [...response.data.obj] : [];
            const totalPages = Math.min(20, Number(response?.data?.totalPages || 1));
            const pageSize = Number(response?.data?.pageSize || 50);
            if (totalPages > 1) {
                const pagePromises: Promise<any>[] = [];
                for (let page = 2; page <= totalPages; page += 1) {
                    pagePromises.push(
                        api.get('/auth/users', { params: { page, pageSize } }).catch(() => null)
                    );
                }
                const extraPages = await Promise.all(pagePromises);
                for (const extra of extraPages) {
                    if (Array.isArray(extra?.data?.obj)) {
                        combined = combined.concat(extra.data.obj);
                    }
                }
            }
            const nextUsers = normalizeCachedUsers(combined);
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
        ? request.then((users: any) => ({ users, source: 'live' }))
        : request;
}

export function getManagedUsersSnapshot(): any[] {
    hydrateManagedUsersSnapshot();
    return Array.isArray(cachedUsers) ? cachedUsers : [];
}

export function getManagedUsersSnapshotMeta(): { users: any[]; source: string } {
    hydrateManagedUsersSnapshot();
    return {
        users: Array.isArray(cachedUsers) ? cachedUsers : [],
        source: cachedSource,
    };
}

export function invalidateManagedUsersCache(): void {
    cachedUsers = null;
    cachedAtMs = 0;
    pendingPromise = null;
    snapshotHydrated = false;
    cachedSource = 'snapshot';
}
