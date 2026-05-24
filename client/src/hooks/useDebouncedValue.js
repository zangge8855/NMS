import { useEffect, useState } from 'react';

/**
 * Returns a value that updates only after `delayMs` of no further changes.
 * Useful for search/filter inputs that trigger API calls.
 */
export default function useDebouncedValue(value, delayMs = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const handle = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(handle);
    }, [value, delayMs]);
    return debounced;
}
