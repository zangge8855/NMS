import React from 'react';

export function resolveInboundRemarkTone() {
    return 'is-neutral';
}

export default function InboundRemarkPill({ remark, protocol, className = '', title }) {
    const text = String(remark || '').trim() || '-';
    const tone = resolveInboundRemarkTone(protocol);
    const classes = ['badge', 'badge-neutral', 'inbound-remark-pill', tone, className].filter(Boolean).join(' ');

    return (
        <span className={classes} title={title || text}>
            <span className="inbound-remark-pill-text">{text}</span>
        </span>
    );
}
