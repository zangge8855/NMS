import React from 'react';
import CountryFlag from './CountryFlag';

export function resolveInboundRemarkTone(protocol?: string): string {
    return 'is-neutral';
}

export interface InboundRemarkPillProps {
    remark?: string;
    protocol?: string;
    flag?: string;
    className?: string;
    title?: string;
}

export default function InboundRemarkPill({ remark, protocol, flag, className = '', title }: InboundRemarkPillProps) {
    const text = String(remark || '').trim() || '—';
    const tone = resolveInboundRemarkTone(protocol);
    const classes = ['badge', 'badge-neutral', 'inbound-remark-pill', tone, className].filter(Boolean).join(' ');

    return (
        <span className={classes} title={title || text}>
            <CountryFlag flag={flag} label={text} />
            <span className="inbound-remark-pill-text">{text}</span>
        </span>
    );
}
