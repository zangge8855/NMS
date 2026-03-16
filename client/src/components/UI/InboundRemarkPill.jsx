import React from 'react';

const REMARK_TONE_MAP = {
    vless: 'is-cyan',
    vmess: 'is-blue',
    trojan: 'is-amber',
    shadowsocks: 'is-violet',
    'shadowsocks-2022': 'is-violet',
    hysteria: 'is-emerald',
    hysteria2: 'is-emerald',
    hy2: 'is-emerald',
    tuic: 'is-rose',
    wireguard: 'is-indigo',
    'dokodemo-door': 'is-slate',
    socks: 'is-slate',
    http: 'is-slate',
};

export function resolveInboundRemarkTone(protocol = '') {
    const normalized = String(protocol || '').trim().toLowerCase();
    return REMARK_TONE_MAP[normalized] || 'is-neutral';
}

export default function InboundRemarkPill({ remark, protocol, className = '', title }) {
    const text = String(remark || '').trim() || '-';
    const tone = resolveInboundRemarkTone(protocol);
    const classes = ['inbound-remark-pill', tone, className].filter(Boolean).join(' ');

    return (
        <span className={classes} title={title || text}>
            <span className="inbound-remark-pill-accent" aria-hidden="true" />
            <span className="inbound-remark-pill-text">{text}</span>
        </span>
    );
}
