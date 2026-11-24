import React from 'react';
import { extractFlagEmoji } from '../../utils/accessGeo';

interface CountryFlagProps {
    flag?: string | null;
    /** Optional label next to this flag — suppresses duplicate flags if label already contains one. */
    label?: string | null;
    className?: string;
}

export default function CountryFlag({ flag, label, className = '' }: CountryFlagProps) {
    const cleanFlag = String(flag || '').trim();
    if (!cleanFlag) return null;
    if (label && extractFlagEmoji(label)) return null;
    return (
        <span
            className={`country-flag ${className}`.trim()}
            aria-hidden="true"
        >
            {cleanFlag}
        </span>
    );
}
