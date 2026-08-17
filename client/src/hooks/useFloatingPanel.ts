import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const HIDDEN_STYLE: CSSProperties = {
    position: 'fixed',
    top: '0px',
    left: '0px',
    visibility: 'hidden',
    pointerEvents: 'none',
};

export interface ComputePositionParams {
    anchorRect: DOMRect;
    panelRect: DOMRect;
    viewport: {
        width: number;
        height: number;
    };
}

export interface UseFloatingPanelOptions {
    open: boolean;
    anchorRef: RefObject<HTMLElement | null>;
    panelRef: RefObject<HTMLElement | null>;
    computePosition: (params: ComputePositionParams) => CSSProperties;
    deps?: any[];
}

export default function useFloatingPanel({
    open,
    anchorRef,
    panelRef,
    computePosition,
    deps = [],
}: UseFloatingPanelOptions): { panelStyle: CSSProperties; isReady: boolean } {
    const [panelStyle, setPanelStyle] = useState<CSSProperties>(HIDDEN_STYLE);
    const [isReady, setIsReady] = useState<boolean>(false);

    useLayoutEffect(() => {
        if (!open || typeof window === 'undefined') {
            setPanelStyle(HIDDEN_STYLE);
            setIsReady(false);
            return undefined;
        }

        let animationFrame = 0;
        let positioned = false;

        const syncPosition = () => {
            const anchor = anchorRef.current;
            const panel = panelRef.current;
            if (!anchor || !panel) return;

            const nextStyle = computePosition({
                anchorRect: anchor.getBoundingClientRect(),
                panelRect: panel.getBoundingClientRect(),
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight,
                },
            });

            setPanelStyle({
                position: 'fixed',
                visibility: 'visible',
                ...nextStyle,
            });

            if (!positioned) {
                positioned = true;
                setIsReady(true);
            }
        };

        const scheduleSync = () => {
            window.cancelAnimationFrame(animationFrame);
            animationFrame = window.requestAnimationFrame(syncPosition);
        };

        scheduleSync();
        window.addEventListener('resize', scheduleSync);
        window.addEventListener('scroll', scheduleSync, true);

        return () => {
            window.cancelAnimationFrame(animationFrame);
            window.removeEventListener('resize', scheduleSync);
            window.removeEventListener('scroll', scheduleSync, true);
            setPanelStyle(HIDDEN_STYLE);
            setIsReady(false);
        };
    }, [open, anchorRef, panelRef, computePosition, ...deps]);

    return { panelStyle, isReady };
}
