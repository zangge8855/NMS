import React from 'react';

function clampProgress(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, numeric));
}

export default function CircularMeter({
    label = '',
    value = '',
    meta = '',
    progress = 0,
    tone = 'info',
    pulse = false,
}) {
    const normalizedProgress = clampProgress(progress);
    const radius = 34;
    const circumference = Math.PI * 2 * radius;
    const offset = circumference - (normalizedProgress / 100) * circumference;

    return (
        <div className={`circular-meter circular-meter--${tone}${pulse ? ' is-pulse' : ''}`}>
            <div className="circular-meter-visual" aria-hidden="true">
                <svg viewBox="0 0 88 88" className="circular-meter-svg">
                    <circle className="circular-meter-track" cx="44" cy="44" r={radius} />
                    <circle
                        className="circular-meter-value-ring"
                        cx="44"
                        cy="44"
                        r={radius}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                    />
                </svg>
                <div className="circular-meter-center">
                    <div className="circular-meter-percent">{Math.round(normalizedProgress)}%</div>
                </div>
            </div>
            <div className="circular-meter-copy">
                <div className="circular-meter-label">{label}</div>
                <div className="circular-meter-value">{value}</div>
                {meta ? <div className="circular-meter-meta">{meta}</div> : null}
            </div>
        </div>
    );
}
