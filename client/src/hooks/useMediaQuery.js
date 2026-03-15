import { useEffect, useState } from 'react';

function getInitialMatch(query) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return Boolean(window.matchMedia(query)?.matches);
}

export default function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => getInitialMatch(query));

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia(query);
        if (!mediaQuery) {
            setMatches(false);
            return undefined;
        }
        const handleChange = (event) => {
            setMatches(event.matches);
        };

        setMatches(mediaQuery.matches);
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange);
            return () => mediaQuery.removeEventListener('change', handleChange);
        }

        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
    }, [query]);

    return matches;
}
