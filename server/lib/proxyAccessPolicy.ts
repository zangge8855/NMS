/**
 * Role policy for the node-panel proxy (`/api/panel/:serverId/*`).
 *
 * The proxy forwards requests to 3x-ui / s-ui panels with the panel's own
 * administrator session, so anything reachable here runs with full panel
 * rights. NMS roles therefore have to be enforced on the path itself:
 *
 *   admin    → everything the proxy allows.
 *   operator → node and client management, but not the panel's own
 *              administration surface (panel settings and credentials, API
 *              tokens, panel users and sessions, raw database export/import).
 *              Those stay admin-only, matching the adminOnly NMS routes for
 *              panel API tokens.
 *   auditor  → an explicit allow-list of read-only queries. Anything not
 *              listed is denied, so new panel endpoints are closed by default.
 *   other    → denied.
 *
 * Paths are matched after decoding and posix normalisation, so callers must pass
 * the canonical path computed by the proxy route.
 */

export type ProxyAccessDenyReason =
    | 'role_not_permitted'
    | 'admin_only_endpoint'
    | 'auditor_read_only';

export interface ProxyAccessDecision {
    allowed: boolean;
    reason?: ProxyAccessDenyReason;
}

const KEY_GENERATOR_PATHS = [
    /^\/panel\/api\/server\/getNew(?:UUID|X25519Cert|mldsa65|mlkem768|VlessEnc|EchCert)$/,
    /^\/panel\/api\/inbounds\/getNew(?:X25519Cert|mlkem768)$/,
];

/** POST endpoints that only read state (3x-ui uses POST for several queries). */
const READ_ONLY_POST_PATHS = [
    /^\/panel\/api\/clients\/(?:onlines|onlinesByGuid|onlinesByNode|lastOnline)$/,
    /^\/panel\/api\/inbounds\/(?:onlines|lastOnline)$/,
    /^\/panel\/api\/inbounds\/clientIps\/[^/]+$/,
    /^\/panel\/api\/clients\/ips\/[^/]+$/,
    /^\/panel\/api\/server\/logs\/[^/]+$/,
    /^\/panel\/api\/server\/xraylogs\/[^/]+$/,
    /^\/panel\/api\/inbounds\/getClientTraffics\/[^/]+$/,
    /^\/server\/api\/server\/log$/,
    ...KEY_GENERATOR_PATHS,
];

/** GET endpoints an auditor may read. */
const AUDITOR_GET_PATHS = [
    /^\/panel\/api\/inbounds\/list$/,
    /^\/panel\/api\/inbounds\/get\/[^/]+$/,
    /^\/panel\/api\/inbounds\/getClientTraffics\/[^/]+$/,
    /^\/panel\/api\/inbounds\/getClientTrafficsById\/[^/]+$/,
    /^\/panel\/api\/clients\/list$/,
    /^\/panel\/api\/clients\/get\/[^/]+$/,
    /^\/panel\/api\/clients\/lastOnline$/,
    /^\/panel\/api\/server\/(?:status|getXrayVersion|getPanelUpdateInfo|xrayMetricsState|xrayObservatory)$/,
    /^\/panel\/api\/custom-geo\/list$/,
    /^\/server\/api\/server\/log$/,
    ...KEY_GENERATOR_PATHS,
    // Native s-ui reads. Excluded on purpose: load (bundles users and settings),
    // users, settings, sessions, tokens, getdb, and checkOutbound (makes the node
    // dial out).
    /^\/sui\/(?:inbounds|outbounds|endpoints|services|tls|clients|config|stats|status|onlines|logs|changes|keypairs|singbox-config|checkUpdate)$/,
];

/** Panel administration endpoints reserved for NMS admins. */
const ADMIN_ONLY_PATHS = [
    // 3x-ui panel settings, panel login credentials and API tokens.
    /^\/panel\/api\/setting(?:\/|$)/,
    // Raw panel database: contains the panel admin credentials and tokens, and an
    // import replaces them.
    /^\/panel\/api\/server\/(?:database\/(?:export|import)|getDb|importDB)$/,
    // s-ui panel administration.
    /^\/sui\/(?:tokens|addToken|deleteToken|users|sessions|closeSessions|settings|load|getdb|importdb)(?:\/|$)/,
];

function matchesAny(patterns: RegExp[], value: string): boolean {
    return patterns.some((pattern) => pattern.test(value));
}

export function isReadOnlyProxyPost(method: string, canonicalPath: string): boolean {
    return String(method || '').toUpperCase() === 'POST' && matchesAny(READ_ONLY_POST_PATHS, canonicalPath);
}

export function isMutatingProxyRequest(method: string, canonicalPath: string): boolean {
    const normalizedMethod = String(method || '').toUpperCase();
    if (normalizedMethod === 'PUT' || normalizedMethod === 'PATCH' || normalizedMethod === 'DELETE') {
        return true;
    }
    if (normalizedMethod === 'POST') {
        return !isReadOnlyProxyPost(normalizedMethod, canonicalPath);
    }
    return false;
}

/** `/sui/save` writes any s-ui object; saving `settings` changes the panel itself. */
function isSuiSettingsSave(canonicalPath: string, body: unknown): boolean {
    if (canonicalPath !== '/sui/save') return false;
    const object = body && typeof body === 'object' ? (body as Record<string, unknown>).object : undefined;
    return String(object || '').trim().toLowerCase() === 'settings';
}

export function isAdminOnlyProxyRequest(canonicalPath: string, body?: unknown): boolean {
    return matchesAny(ADMIN_ONLY_PATHS, canonicalPath) || isSuiSettingsSave(canonicalPath, body);
}

export function evaluateProxyAccess(
    role: unknown,
    method: string,
    canonicalPath: string,
    body?: unknown,
): ProxyAccessDecision {
    const normalizedRole = String(role || '').trim().toLowerCase();
    const normalizedMethod = String(method || '').toUpperCase();

    if (normalizedRole === 'admin') {
        return { allowed: true };
    }

    if (normalizedRole === 'operator') {
        if (isAdminOnlyProxyRequest(canonicalPath, body)) {
            return { allowed: false, reason: 'admin_only_endpoint' };
        }
        return { allowed: true };
    }

    if (normalizedRole === 'auditor') {
        if (normalizedMethod === 'GET' && matchesAny(AUDITOR_GET_PATHS, canonicalPath)) {
            return { allowed: true };
        }
        if (isReadOnlyProxyPost(normalizedMethod, canonicalPath)) {
            return { allowed: true };
        }
        return { allowed: false, reason: 'auditor_read_only' };
    }

    return { allowed: false, reason: 'role_not_permitted' };
}
