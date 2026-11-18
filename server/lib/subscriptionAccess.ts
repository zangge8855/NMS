export function normalizeSubscriptionIdentity(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

export function collectViewerIdentities(user: any, options: { findUserById?: (id: string) => any } = {}): string[] {
    const identities = new Set<string>();
    const directSubscriptionEmail = normalizeSubscriptionIdentity(user?.subscriptionEmail);
    const directEmail = normalizeSubscriptionIdentity(user?.email);
    if (directSubscriptionEmail) {
        identities.add(directSubscriptionEmail);
    } else if (directEmail) {
        identities.add(directEmail);
    }

    const userId = String(user?.userId || user?.id || '').trim();
    if (userId && typeof options.findUserById === 'function') {
        const stored = options.findUserById(userId);
        const storedSubscriptionEmail = normalizeSubscriptionIdentity(stored?.subscriptionEmail);
        const storedEmail = normalizeSubscriptionIdentity(stored?.email);
        if (storedSubscriptionEmail) {
            identities.add(storedSubscriptionEmail);
        } else if (storedEmail) {
            identities.add(storedEmail);
        }
    }

    return Array.from(identities.values());
}

export type SubscriptionAccessMode = 'read' | 'write';

export interface SubscriptionAccessOptions {
    findUserById?: (id: string) => any;
    findUserByEmail?: (email: string) => any;
    mode?: SubscriptionAccessMode;
}

export function isStaffSubscriptionRole(role: unknown): boolean {
    const normalized = String(role || '').trim().toLowerCase();
    return normalized === 'admin' || normalized === 'operator' || normalized === 'auditor';
}

export function isReadOnlySubscriptionRole(role: unknown): boolean {
    return String(role || '').trim().toLowerCase() === 'auditor';
}

export function canAccessSubscriptionEmail(
    user: any,
    requestedEmail: unknown,
    options: SubscriptionAccessOptions = {}
): boolean {
    const role = String(user?.role || '').trim().toLowerCase();
    const mode: SubscriptionAccessMode = options.mode === 'write' ? 'write' : 'read';
    if (role === 'admin') return true;
    if (role === 'auditor' && mode === 'write') return false;

    const normalizedRequested = normalizeSubscriptionIdentity(requestedEmail);
    if (!normalizedRequested) return false;

    if (role === 'operator' || (role === 'auditor' && mode === 'read')) {
        if (typeof options.findUserByEmail === 'function') {
            const targetUser = options.findUserByEmail(normalizedRequested);
            const targetRole = String(targetUser?.role || 'user').trim().toLowerCase();
            if (targetUser && targetRole !== 'user') {
                return collectViewerIdentities(user, options).includes(normalizedRequested);
            }
        }
        return true;
    }

    const identities = collectViewerIdentities(user, options);
    return identities.includes(normalizedRequested);
}

export function canReadSubscriptionEmail(
    user: any,
    requestedEmail: unknown,
    options: SubscriptionAccessOptions = {}
): boolean {
    return canAccessSubscriptionEmail(user, requestedEmail, { ...options, mode: 'read' });
}

export function canManageSubscriptionEmail(
    user: any,
    requestedEmail: unknown,
    options: SubscriptionAccessOptions = {}
): boolean {
    return canAccessSubscriptionEmail(user, requestedEmail, { ...options, mode: 'write' });
}
