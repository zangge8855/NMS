const CARRIER_ALIASES = [
    { canonical: '中国电信', variants: ['中国电信', '电信'] },
    { canonical: '中国联通', variants: ['中国联通', '联通'] },
    { canonical: '中国移动', variants: ['中国移动', '移动'] },
    { canonical: '中国广电', variants: ['中国广电', '广电'] },
    { canonical: '中国教育网', variants: ['中国教育网', '教育网', 'CERNET'] },
    { canonical: '长城宽带', variants: ['长城宽带', '长宽'] },
];

export function normalizeCarrierLabel(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const matched = CARRIER_ALIASES.find((item) => item.variants.some((variant) => text.includes(variant)));
    return matched?.canonical || text;
}

export function stripCarrierFromLocation(location, carrier) {
    const text = String(location || '').trim();
    const normalizedCarrier = normalizeCarrierLabel(carrier);
    if (!text || !normalizedCarrier) return text;

    const matched = CARRIER_ALIASES.find((item) => item.canonical === normalizedCarrier);
    const variants = matched?.variants || [normalizedCarrier];

    return variants.reduce((result, variant) => result.replaceAll(variant, ' '), text)
        .replace(/[|/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[,，\-\s]+|[,，\-\s]+$/g, '')
        .trim();
}

export function resolveAccessGeoDisplay(item) {
    const rawLocation = String(item?.ipLocation || item?.cfCountry || '').trim();
    const carrier = normalizeCarrierLabel(item?.ipCarrier || '');

    if (!rawLocation) {
        return { location: carrier || '-', carrier: '' };
    }
    if (!carrier) {
        return { location: rawLocation, carrier: '' };
    }

    const strippedLocation = stripCarrierFromLocation(rawLocation, carrier);
    if (!strippedLocation) {
        return { location: rawLocation, carrier: '' };
    }
    if (strippedLocation !== rawLocation) {
        return { location: strippedLocation, carrier };
    }
    return { location: rawLocation, carrier };
}
