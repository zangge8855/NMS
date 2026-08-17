export function normalizeSubscriptionIdentity(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

export function collectViewerIdentities(user: any, options: { findUserById?: (id: string) => any } = {}): string[] {
    const identities = new Set<string>();
    const directHasBinding = !!user && typeof user === 'object'
        && Object.prototype.hasOwnProperty.call(user, 'subscriptionEmail');
    const directEmail = normalizeSubscriptionIdentity(user?.email);
    if (directEmail && !directHasBinding) identities.add(directEmail);
    const directSubscriptionEmail = normalizeSubscriptionIdentity(user?.subscriptionEmail);
    if (directSubscriptionEmail) identities.add(directSubscriptionEmail);

    const userId = String(user?.userId || '').trim();
    if (userId && typeof options.findUserById === 'function') {
        const stored = options.findUserById(userId);
        const storedHasBinding = !!stored && typeof stored === 'object'
            && Object.prototype.hasOwnProperty.call(stored, 'subscriptionEmail');
        const storedEmail = normalizeSubscriptionIdentity(stored?.email);
        const storedSubscriptionEmail = normalizeSubscriptionIdentity(stored?.subscriptionEmail);
        if (storedEmail && !storedHasBinding) identities.add(storedEmail);
        if (storedSubscriptionEmail) identities.add(storedSubscriptionEmail);
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
