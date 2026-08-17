import { useEffect, useState } from 'react';

/**
 * Returns a value that updates only after `delayMs` of no further changes.
 * Useful for search/filter inputs that trigger API calls.
 */
export default function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
    const [debounced, setDebounced] = useState<T>(value);
    useEffect(() => {
        const handle = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(handle);
    }, [value, delayMs]);
    return debounced;
}
