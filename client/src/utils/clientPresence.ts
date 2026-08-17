import { getClientIdentifier } from './protocol';

export function normalizeOnlineValue(value?: string | number | null): string {
    return String(value || '').trim().toLowerCase();
}

export function normalizeOnlineKeys(item: any): string[] {
    if (typeof item === 'string') {
        const value = normalizeOnlineValue(item);
        return value ? [value] : [];
    }
    if (!item || typeof item !== 'object') {
        return [];
    }
    return Array.from(new Set(
        [
            item.email,
            item.user,
            item.username,
            item.clientEmail,
            item.client,
            item.remark,
            item.id,
            item.password,
        ]
            .map((value) => normalizeOnlineValue(value))
            .filter(Boolean)
    ));
}

export function buildClientOnlineKeys(client?: any, protocol?: string): string[] {
    const keys = new Set<string>();
    const email = normalizeOnlineValue(client?.email);
    const identifier = normalizeOnlineValue(getClientIdentifier(client, protocol));
    const id = normalizeOnlineValue(client?.id);
    const password = normalizeOnlineValue(client?.password);

    if (email) keys.add(email);
    if (identifier) keys.add(identifier);
    if (id) keys.add(id);
    if (password) keys.add(password);

    return Array.from(keys);
}

export function buildOnlineMatchMap(entries: any[] = []): Map<string, Set<number>> {
    const matchMap = new Map<string, Set<number>>();

    (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
        normalizeOnlineKeys(entry).forEach((key) => {
            if (!matchMap.has(key)) {
                matchMap.set(key, new Set());
            }
            matchMap.get(key)!.add(index);
        });
    });

    return matchMap;
}

export function countClientOnlineSessions(client: any, protocol?: string, onlineMatchMap?: Map<string, Set<number>>): number {
    const matchMap = onlineMatchMap instanceof Map ? onlineMatchMap : new Map<string, Set<number>>();
    const matchedSessions = new Set<number>();

    buildClientOnlineKeys(client, protocol).forEach((key) => {
        const matches = matchMap.get(key);
        if (!matches) return;
        matches.forEach((index) => matchedSessions.add(index));
    });

    return matchedSessions.size;
}
