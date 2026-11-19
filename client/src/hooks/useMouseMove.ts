import { useRef, useEffect, type RefObject } from 'react';

/**
 * Hook to track mouse position relative to an element and set custom properties
 * --mouse-x and --mouse-y for CSS effects (like spotlight).
 */
export function useMouseMove<T extends HTMLElement = HTMLElement>(): RefObject<T | null> {
    const ref = useRef<T | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        let rafId = 0;
        let lastClientX = 0;
        let lastClientY = 0;

        const updatePosition = () => {
            rafId = 0;
            const rect = el.getBoundingClientRect();
            const x = lastClientX - rect.left;
            const y = lastClientY - rect.top;
            el.style.setProperty('--mouse-x', `${x}px`);
            el.style.setProperty('--mouse-y', `${y}px`);
        };

        const handleMouseMove = (e: MouseEvent) => {
            lastClientX = e.clientX;
            lastClientY = e.clientY;
            if (!rafId) {
                rafId = window.requestAnimationFrame(updatePosition);
            }
        };

        el.addEventListener('mousemove', handleMouseMove, { passive: true });
        return () => {
            if (rafId) window.cancelAnimationFrame(rafId);
            el.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    return ref;
}
