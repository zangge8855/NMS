const DEFAULT_TTL_MS = 30_000;

let cachedUsers = null;
let cachedAtMs = 0;
let pendingPromise = null;

function normalizeUserList(response) {
    const list = Array.isArray(response?.data?.obj) ? response.data.obj : [];
    return list.filter((user) => user?.role !== 'admin');
}

export async function fetchManagedUsers(api, options = {}) {
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

export function invalidateManagedUsersCache() {
    cachedUsers = null;
    cachedAtMs = 0;
    pendingPromise = null;
}
