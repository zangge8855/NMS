import { useRef, useEffect } from 'react';

/**
 * Hook to track mouse position relative to an element and set custom properties
 * --mouse-x and --mouse-y for CSS effects (like spotlight).
 */
export function useMouseMove() {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const handleMouseMove = (e) => {
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            el.style.setProperty('--mouse-x', `${x}px`);
            el.style.setProperty('--mouse-y', `${y}px`);
        };

        el.addEventListener('mousemove', handleMouseMove);
        return () => el.removeEventListener('mousemove', handleMouseMove);
    }, []);

    return ref;
}
