export interface CarrierAlias {
    canonical: string;
    variants: string[];
}

const CARRIER_ALIASES: CarrierAlias[] = [
    { canonical: '中国电信', variants: ['中国电信', '电信'] },
    { canonical: '中国联通', variants: ['中国联通', '联通'] },
    { canonical: '中国移动', variants: ['中国移动', '移动'] },
    { canonical: '中国广电', variants: ['中国广电', '广电'] },
    { canonical: '中国教育网', variants: ['中国教育网', '教育网', 'CERNET'] },
    { canonical: '长城宽带', variants: ['长城宽带', '长宽'] },
];

export function normalizeCarrierLabel(value?: string | null): string {
    const text = String(value || '').trim();
    if (!text) return '';
    const matched = CARRIER_ALIASES.find((item) => item.variants.some((variant) => text.includes(variant)));
    return matched?.canonical || text;
}

export function stripCarrierFromLocation(location?: string | null, carrier?: string | null): string {
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

export interface AccessGeoDisplay {
    location: string;
    carrier: string;
}

export function resolveAccessGeoDisplay(item?: { ipLocation?: string; cfCountry?: string; ipCarrier?: string } | null): AccessGeoDisplay {
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

export function resolveNodeCountryEmoji(nameOrLocation: string = ''): string {
    const text = String(nameOrLocation || '').toLowerCase();
    if (!text) return '🌐';
    if (/香港|hk|hong\s*kong/.test(text)) return '🇭🇰';
    if (/日本|jp|japan|东京|tokyo|大阪|osaka/.test(text)) return '🇯🇵';
    if (/美国|us|usa|america|洛杉矶|硅谷|西雅图|纽约|los\s*angeles|seattle|new\s*york/.test(text)) return '🇺🇸';
    if (/新加坡|sg|singapore|狮城/.test(text)) return '🇸🇬';
    if (/台湾|tw|taiwan|台北/.test(text)) return '🇹🇼';
    if (/韩国|kr|korea|首尔|seoul/.test(text)) return '🇰🇷';
    if (/英国|uk|gb|britain|伦敦|london/.test(text)) return '🇬🇧';
    if (/德国|de|germany|法兰克福|frankfurt/.test(text)) return '🇩🇪';
    if (/法国|fr|france|巴黎|paris/.test(text)) return '🇫🇷';
    if (/加拿大|ca|canada/.test(text)) return '🇨🇦';
    if (/澳大利亚|au|australia|悉尼|sydney/.test(text)) return '🇦🇺';
    if (/俄罗斯|ru|russia|莫斯科|moscow/.test(text)) return '🇷🇺';
    if (/土耳其|tr|turkey/.test(text)) return '🇹🇷';
    if (/荷兰|nl|netherlands|阿姆斯特丹/.test(text)) return '🇳🇱';
    if (/中国|cn|china|直连/.test(text)) return '🇨🇳';
    return '🌐';
}
