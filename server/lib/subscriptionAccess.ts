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

export function canAccessSubscriptionEmail(user: any, requestedEmail: unknown, options: { findUserById?: (id: string) => any } = {}): boolean {
    const role = String(user?.role || '').toLowerCase();
    if (role === 'admin') return true;

    const normalizedRequested = normalizeSubscriptionIdentity(requestedEmail);
    if (!normalizedRequested) return false;

    const identities = collectViewerIdentities(user, options);
    return identities.includes(normalizedRequested);
}
