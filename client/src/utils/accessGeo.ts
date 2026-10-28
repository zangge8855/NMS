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

// Server-side label for private/loopback addresses (see server/lib/ipGeoResolver.ts).
export const LOCAL_IP_LOCATION_LABEL = '内网/本地';

// Provider spellings that Intl.DisplayNames does not produce verbatim.
const REGION_NAME_ALIASES: Record<string, string> = {
    '香港': 'HK',
    '中国香港': 'HK',
    '澳门': 'MO',
    '中国澳门': 'MO',
    '台湾': 'TW',
    '中国台湾': 'TW',
    '韩国': 'KR',
    '朝鲜': 'KP',
};

let regionNameIndex: Map<string, string> | null = null;

function getRegionNameIndex(): Map<string, string> {
    if (regionNameIndex) return regionNameIndex;
    const index = new Map<string, string>();
    try {
        const displays = ['zh-CN', 'en'].map((lang) => new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' }));
        for (let first = 65; first <= 90; first += 1) {
            for (let second = 65; second <= 90; second += 1) {
                const code = String.fromCharCode(first, second);
                // Skip deprecated aliases (DD→DE, SU→RU, UK→GB) so names map to the current code.
                if (code === 'ZZ' || new Intl.Locale(`und-${code}`).region !== code) continue;
                for (const display of displays) {
                    const name = display.of(code);
                    if (name && name !== code && !index.has(name.toLowerCase())) {
                        index.set(name.toLowerCase(), code);
                    }
                }
            }
        }
    } catch {
        // Intl.DisplayNames unavailable: only the alias table is used.
    }
    regionNameIndex = index;
    return index;
}

function normalizeRegionCode(value?: string | null): string {
    const code = String(value || '').trim().toUpperCase();
    // Cloudflare uses XX for unknown and T1 for Tor exit nodes; neither is a country.
    if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'ZZ') return '';
    return code;
}

export function resolveRegionCodeFromName(name?: string | null): string {
    const text = String(name || '').trim();
    if (!text) return '';
    return REGION_NAME_ALIASES[text] || getRegionNameIndex().get(text.toLowerCase()) || '';
}

export function resolveRegionDisplayName(code: string, locale: string): string {
    try {
        return new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code) || '';
    } catch {
        return '';
    }
}

export function regionCodeToFlag(code?: string | null): string {
    const normalized = normalizeRegionCode(code);
    if (!normalized) return '🌐';
    return String.fromCodePoint(...[...normalized].map((char) => 0x1F1E6 + char.charCodeAt(0) - 65));
}

export interface AccessCountry {
    name: string;
    code: string;
    local: boolean;
}

/**
 * Country of an access-log entry. `ipLocation` is a space separated
 * "country region city" string from the geo provider; `cfCountry` is the
 * ISO code Cloudflare forwards when the panel sits behind it.
 */
export function resolveAccessCountry(item?: { ipLocation?: string; cfCountry?: string } | null): AccessCountry {
    const location = String(item?.ipLocation || '').trim();
    const cfCode = normalizeRegionCode(item?.cfCountry);

    if (location === LOCAL_IP_LOCATION_LABEL) {
        return { name: location, code: '', local: true };
    }
    if (location) {
        const name = location.split(/\s+/)[0];
        return { name, code: resolveRegionCodeFromName(name) || cfCode, local: false };
    }
    if (cfCode) {
        return { name: resolveRegionDisplayName(cfCode, 'zh-CN') || cfCode, code: cfCode, local: false };
    }
    return { name: '', code: '', local: false };
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
