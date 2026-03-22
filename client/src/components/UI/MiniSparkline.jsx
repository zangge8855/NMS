import React, { useMemo } from 'react';

function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function buildSegments(points = [], width = 120, height = 34, padding = 4, domain = null) {
    const normalized = (Array.isArray(points) ? points : []).map((value, index) => {
        const numeric = Number(value);
        return {
            index,
            value: Number.isFinite(numeric) ? numeric : null,
        };
    });
    const numericValues = normalized
        .map((item) => item.value)
        .filter((value) => Number.isFinite(value));
    if (numericValues.length === 0) return null;

    const min = Array.isArray(domain) && Number.isFinite(domain[0]) ? domain[0] : Math.min(...numericValues);
    const max = Array.isArray(domain) && Number.isFinite(domain[1]) ? domain[1] : Math.max(...numericValues);
    const range = Math.max(1, max - min);
    const innerWidth = Math.max(1, width - (padding * 2));
    const innerHeight = Math.max(1, height - (padding * 2));
    const step = normalized.length <= 1 ? 0 : innerWidth / Math.max(1, normalized.length - 1);

    const segments = [];
    let activeSegment = [];
    let lastPoint = null;

    normalized.forEach((item) => {
        if (!Number.isFinite(item.value)) {
            if (activeSegment.length > 0) {
                segments.push(activeSegment);
                activeSegment = [];
            }
            return;
        }
        const x = padding + (step * item.index);
        const y = padding + (innerHeight - (((item.value - min) / range) * innerHeight));
        const point = {
            x,
            y: clampValue(y, padding, padding + innerHeight),
            value: item.value,
        };
        activeSegment.push(point);
        lastPoint = point;
    });

    if (activeSegment.length > 0) {
        segments.push(activeSegment);
    }
    if (segments.length === 0 || !lastPoint) return null;

    const linePath = segments
        .map((segment) => segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '))
        .join(' ');
    const areaPaths = segments.map((segment) => {
        const first = segment[0];
        const last = segment[segment.length - 1];
        const body = segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
        return `${body} L ${last.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${first.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;
    });

    return {
        linePath,
        areaPaths,
        lastPoint,
    };
}

export default function MiniSparkline({
    points = [],
    tone = 'primary',
    className = '',
    width = 120,
    height = 34,
    domain = null,
    showArea = true,
    showGrid = true,
}) {
    const geometry = useMemo(
        () => buildSegments(points, width, height, 4, domain),
        [domain, height, points, width]
    );

    if (!geometry) {
        return (
            <div className={`mini-sparkline mini-sparkline--empty ${className}`.trim()} aria-hidden="true">
                <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                    {showGrid ? <path className="mini-sparkline-grid" d={`M 0 ${height - 1} L ${width} ${height - 1}`} /> : null}
                </svg>
            </div>
        );
    }

    return (
        <div
            className={`mini-sparkline mini-sparkline--${tone} ${className}`.trim()}
            aria-hidden="true"
        >
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                {showGrid ? <path className="mini-sparkline-grid" d={`M 0 ${height - 1} L ${width} ${height - 1}`} /> : null}
                {showArea
                    ? geometry.areaPaths.map((path, index) => (
                        <path key={`area-${index}`} className="mini-sparkline-area" d={path} />
                    ))
                    : null}
                <path className="mini-sparkline-line" d={geometry.linePath} />
                <circle
                    className="mini-sparkline-end"
                    cx={geometry.lastPoint.x}
                    cy={geometry.lastPoint.y}
                    r="2.8"
                />
            </svg>
        </div>
    );
}
