import { useState, useEffect, useRef } from 'react';

export default function useAnimatedCounter(target, duration = 600) {
    const [value, setValue] = useState(0);
    const rafRef = useRef(null);
    const startRef = useRef(null);
    const fromRef = useRef(0);

    useEffect(() => {
        const targetNum = Number(target) || 0;
        if (targetNum === fromRef.current) return;

        const from = fromRef.current;
        startRef.current = null;

        const animate = (timestamp) => {
            if (!startRef.current) startRef.current = timestamp;
            const elapsed = timestamp - startRef.current;
            const progress = Math.min(elapsed / duration, 1);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(from + (targetNum - from) * eased);
            setValue(current);

            if (progress < 1) {
                rafRef.current = requestAnimationFrame(animate);
            } else {
                fromRef.current = targetNum;
            }
        };

        rafRef.current = requestAnimationFrame(animate);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [target, duration]);

    return value;
}
