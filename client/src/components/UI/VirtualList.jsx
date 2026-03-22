import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';

function resolveItemKey(item, index, getKey) {
    if (typeof getKey === 'function') {
        return getKey(item, index);
    }
    return index;
}

const VirtualList = forwardRef(function VirtualList({
    items = [],
    itemSize = 48,
    overscan = 6,
    className = '',
    innerClassName = '',
    style = undefined,
    role = 'list',
    ariaLabel = '',
    renderItem,
    getKey,
}, forwardedRef) {
    const containerRef = useRef(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const safeItemSize = Math.max(1, Number(itemSize) || 1);

    useImperativeHandle(forwardedRef, () => containerRef.current);

    useEffect(() => {
        const node = containerRef.current;
        if (!node) return undefined;

        const syncHeight = () => {
            setViewportHeight(node.clientHeight || 0);
        };

        syncHeight();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', syncHeight);
            return () => window.removeEventListener('resize', syncHeight);
        }

        const observer = new ResizeObserver(() => {
            syncHeight();
        });
        observer.observe(node);

        return () => observer.disconnect();
    }, []);

    const totalHeight = items.length * safeItemSize;
    const startIndex = Math.max(0, Math.floor(scrollTop / safeItemSize) - overscan);
    const endIndex = Math.min(
        items.length,
        Math.ceil((scrollTop + viewportHeight) / safeItemSize) + overscan
    );

    const visibleItems = useMemo(() => {
        return items.slice(startIndex, endIndex).map((item, offset) => {
            const index = startIndex + offset;
            return {
                item,
                index,
                top: index * safeItemSize,
            };
        });
    }, [endIndex, items, safeItemSize, startIndex]);

    return (
        <div
            ref={containerRef}
            className={`virtual-list ${className}`.trim()}
            style={style}
            role={role}
            aria-label={ariaLabel}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
            <div
                className={`virtual-list-inner ${innerClassName}`.trim()}
                style={{ height: `${totalHeight}px` }}
            >
                {visibleItems.map(({ item, index, top }) => (
                    <div
                        key={resolveItemKey(item, index, getKey)}
                        className="virtual-list-item"
                        style={{
                            height: `${safeItemSize}px`,
                            transform: `translateY(${top}px)`,
                        }}
                    >
                        {renderItem(item, index)}
                    </div>
                ))}
            </div>
        </div>
    );
});

export default VirtualList;
