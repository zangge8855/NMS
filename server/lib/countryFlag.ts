/**
 * Country / region code and flag emoji resolution for servers and nodes.
 *
 * Explicit ISO 3166-1 alpha-2 codes take priority, followed by any flag emoji
 * already present in a label, followed by conservative keyword/token matching
 * (word-bounded for Latin codes so ordinary words like "node", "dev", "cluster",
 * "status", "backup", "traffic" never false-match a country).
 */

const FLAG_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/u;

export function normalizeCountryCode(value: unknown): string {
    const code = String(value || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'ZZ') return '';
    return code;
}

export function countryCodeToFlag(code: unknown): string {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return '';
    return String.fromCodePoint(
        ...[...normalized].map((char) => 0x1F1E6 + char.charCodeAt(0) - 65)
    );
}

export function extractFlagEmoji(text: unknown): string {
    const match = String(text || '').match(FLAG_EMOJI_RE);
    return match ? match[0] : '';
}

export function flagEmojiToCountryCode(flag: unknown): string {
    const match = extractFlagEmoji(flag);
    if (!match) return '';
    const points = Array.from(match).map((char) => char.codePointAt(0) || 0);
    if (points.length !== 2) return '';
    const code = points.map((cp) => String.fromCharCode(65 + (cp - 0x1F1E6))).join('');
    return normalizeCountryCode(code);
}

interface CountryKeywordRule {
    code: string;
    cjk?: RegExp;
    words?: RegExp;
    tokens?: RegExp;
    caseSensitiveTokens?: RegExp;
}

function tokenPattern(codes: string[], caseSensitive: boolean = false): RegExp {
    // Match 2-3 letter ISO / IATA codes only when bounded by non-letters (allowing trailing digits like HK1 / JP02).
    return new RegExp(`(?:^|[^a-zA-Z])(?:${codes.join('|')})(?=$|[^a-zA-Z])`, caseSensitive ? '' : 'i');
}

const COUNTRY_RULES: CountryKeywordRule[] = [
    { code: 'HK', cjk: /香港|港线|港服/, words: /\bhong\s*kong\b/i, tokens: tokenPattern(['HK', 'HKG']) },
    { code: 'TW', cjk: /台湾|台灣|台北|臺北|高雄|新北|台中|彰化/, words: /\btaiwan\b|\btaipei\b|\bkaohsiung\b/i, tokens: tokenPattern(['TW', 'TPE', 'KHH']) },
    { code: 'MO', cjk: /澳门|澳門/, words: /\bmacau\b|\bmacao\b/i, tokens: tokenPattern(['MO', 'MFM']) },
    { code: 'JP', cjk: /日本|东京|東京|大阪|名古屋|福冈|札幌|横滨|冲绳/, words: /\bjapan\b|\btokyo\b|\bosaka\b|\bnagoya\b|\bfukuoka\b/i, tokens: tokenPattern(['JP', 'JPN', 'NRT', 'HND', 'KIX', 'TYO']) },
    { code: 'SG', cjk: /新加坡|狮城|獅城/, words: /\bsingapore\b/i, tokens: tokenPattern(['SG', 'SGP', 'SIN']) },
    { code: 'KR', cjk: /韩国|韓國|首尔|首爾|春川|釜山|仁川/, words: /\bkorea\b|\bseoul\b|\bbusan\b|\bincheon\b/i, tokens: tokenPattern(['KR', 'KOR', 'ICN', 'SEL']) },
    { code: 'US', cjk: /美国|美國|美西|美东|洛杉矶|洛杉磯|圣何塞|聖何塞|硅谷|西雅图|西雅圖|纽约|紐約|芝加哥|达拉斯|邁阿密|迈阿密|凤凰城|亚特兰大|华盛顿|俄勒冈|弗吉尼亚|加州/, words: /\bunited\s*states\b|\bamerica\b|\blos\s*angeles\b|\bsan\s*jose\b|\bsilicon\s*valley\b|\bseattle\b|\bnew\s*york\b|\bchicago\b|\bdallas\b|\bmiami\b|\bphoenix\b|\batlanta\b|\bashburn\b|\boregon\b|\bcalifornia\b|\bsanta\s*clara\b|\bfremont\b/i, tokens: tokenPattern(['US', 'USA', 'LAX', 'SJC', 'SEA', 'JFK', 'NYC', 'ORD', 'DFW', 'MIA', 'IAD', 'SFO', 'ATL']) },
    { code: 'GB', cjk: /英国|英國|伦敦|倫敦|曼彻斯特/, words: /\bunited\s*kingdom\b|\bbritain\b|\bengland\b|\blondon\b|\bmanchester\b/i, tokens: tokenPattern(['GB', 'UK', 'GBR', 'LHR', 'LON']) },
    { code: 'DE', cjk: /德国|德國|法兰克福|法蘭克福|柏林|慕尼黑|纽伦堡/, words: /\bgermany\b|\bfrankfurt\b|\bberlin\b|\bmunich\b|\bnuremberg\b|\bfalkenstein\b/i, tokens: tokenPattern(['DE', 'DEU', 'FRA', 'BER', 'MUC']) },
    { code: 'FR', cjk: /法国|法國|巴黎|马赛/, words: /\bfrance\b|\bparis\b|\bmarseille\b/i, tokens: tokenPattern(['FR', 'CDG', 'PAR']) },
    { code: 'NL', cjk: /荷兰|荷蘭|阿姆斯特丹/, words: /\bnetherlands\b|\bholland\b|\bamsterdam\b/i, tokens: tokenPattern(['NL', 'NLD', 'AMS']) },
    { code: 'CA', cjk: /加拿大|多伦多|多倫多|温哥华|溫哥華|蒙特利尔/, words: /\bcanada\b|\btoronto\b|\bvancouver\b|\bmontreal\b/i, tokens: tokenPattern(['CA', 'CAN', 'YYZ', 'YVR', 'YUL']) },
    { code: 'AU', cjk: /澳大利亚|澳大利亞|澳洲|悉尼|墨尔本|布里斯班/, words: /\baustralia\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b/i, tokens: tokenPattern(['AU', 'AUS', 'SYD', 'MEL']) },
    { code: 'RU', cjk: /俄罗斯|俄羅斯|莫斯科|圣彼得堡|伯力|新西伯利亚/, words: /\brussia\b|\bmoscow\b|\bsaint\s*petersburg\b/i, tokens: tokenPattern(['RU', 'RUS', 'MOW', 'SVO', 'LED']) },
    { code: 'TR', cjk: /土耳其|伊斯坦布尔|安卡拉/, words: /\bturkey\b|\bturkiye\b|\bistanbul\b|\bankara\b/i, tokens: tokenPattern(['TR', 'TUR', 'IST']) },
    { code: 'IN', cjk: /印度|孟买|新德里|班加罗尔|金奈/, words: /\bindia\b|\bmumbai\b|\bdelhi\b|\bbangalore\b|\bchennai\b/i, tokens: tokenPattern(['IND', 'BOM', 'DEL', 'BLR']), caseSensitiveTokens: tokenPattern(['IN'], true) },
    { code: 'PH', cjk: /菲律宾|菲律賓|马尼拉/, words: /\bphilippines\b|\bmanila\b/i, tokens: tokenPattern(['PH', 'PHL', 'MNL']) },
    { code: 'MY', cjk: /马来西亚|馬來西亞|马来|吉隆坡|柔佛/, words: /\bmalaysia\b|\bkuala\s*lumpur\b/i, tokens: tokenPattern(['MYS', 'KUL']), caseSensitiveTokens: tokenPattern(['MY'], true) },
    { code: 'TH', cjk: /泰国|泰國|曼谷/, words: /\bthailand\b|\bbangkok\b/i, tokens: tokenPattern(['TH', 'THA', 'BKK']) },
    { code: 'VN', cjk: /越南|胡志明|河内/, words: /\bvietnam\b|\bho\s*chi\s*minh\b|\bhanoi\b/i, tokens: tokenPattern(['VN', 'VNM', 'SGN', 'HAN']) },
    { code: 'ID', cjk: /印尼|印度尼西亚|雅加达/, words: /\bindonesia\b|\bjakarta\b/i, tokens: tokenPattern(['IDN', 'CGK']) },
    { code: 'BR', cjk: /巴西|圣保罗|里约/, words: /\bbrazil\b|\bsao\s*paulo\b/i, tokens: tokenPattern(['BR', 'BRA', 'GRU']) },
    { code: 'AR', cjk: /阿根廷|布宜诺斯艾利斯/, words: /\bargentina\b|\bbuenos\s*aires\b/i, tokens: tokenPattern(['AR', 'ARG', 'EZE']) },
    { code: 'CL', cjk: /智利|圣地亚哥/, words: /\bchile\b|\bsantiago\b/i, tokens: tokenPattern(['CL', 'CHL', 'SCL']) },
    { code: 'MX', cjk: /墨西哥/, words: /\bmexico\b/i, tokens: tokenPattern(['MX', 'MEX']) },
    { code: 'CH', cjk: /瑞士|苏黎世|日内瓦/, words: /\bswitzerland\b|\bzurich\b|\bgeneva\b/i, tokens: tokenPattern(['CH', 'CHE', 'ZRH']) },
    { code: 'SE', cjk: /瑞典|斯德哥尔摩/, words: /\bsweden\b|\bstockholm\b/i, tokens: tokenPattern(['SE', 'SWE', 'ARN']) },
    { code: 'FI', cjk: /芬兰|芬蘭|赫尔辛基/, words: /\bfinland\b|\bhelsinki\b/i, tokens: tokenPattern(['FI', 'FIN', 'HEL']) },
    { code: 'NO', cjk: /挪威|奥斯陆/, words: /\bnorway\b|\boslo\b/i, tokens: tokenPattern(['OSL']) },
    { code: 'PL', cjk: /波兰|波蘭|华沙/, words: /\bpoland\b|\bwarsaw\b/i, tokens: tokenPattern(['PL', 'POL', 'WAW']) },
    { code: 'IT', cjk: /意大利|義大利|米兰|罗马/, words: /\bitaly\b|\bmilan\b|\brome\b/i, tokens: tokenPattern(['ITA', 'MXP', 'FCO']) },
    { code: 'ES', cjk: /西班牙|马德里|巴塞罗那/, words: /\bspain\b|\bmadrid\b|\bbarcelona\b/i, tokens: tokenPattern(['ES', 'ESP', 'MAD', 'BCN']) },
    { code: 'IE', cjk: /爱尔兰|愛爾蘭|都柏林/, words: /\bireland\b|\bdublin\b/i, tokens: tokenPattern(['IE', 'IRL', 'DUB']) },
    { code: 'AT', cjk: /奥地利|維也納|维也纳/, words: /\baustria\b|\bvienna\b/i, tokens: tokenPattern(['VIE']) },
    { code: 'BE', cjk: /比利时|布鲁塞尔/, words: /\bbelgium\b|\bbrussels\b/i, tokens: tokenPattern(['BRU']) },
    { code: 'DK', cjk: /丹麦|哥本哈根/, words: /\bdenmark\b|\bcopenhagen\b/i, tokens: tokenPattern(['DK', 'DNK', 'CPH']) },
    { code: 'CZ', cjk: /捷克|布拉格/, words: /\bczech\b|\bprague\b/i, tokens: tokenPattern(['CZ', 'CZE', 'PRG']) },
    { code: 'UA', cjk: /乌克兰|基辅/, words: /\bukraine\b|\bkyiv\b|\bkiev\b/i, tokens: tokenPattern(['UA', 'UKR']) },
    { code: 'AE', cjk: /阿联酋|迪拜|阿布扎比/, words: /\buae\b|\bdubai\b|\babu\s*dhabi\b/i, tokens: tokenPattern(['AE', 'UAE', 'DXB']) },
    { code: 'IL', cjk: /以色列|特拉维夫/, words: /\bisrael\b|\btel\s*aviv\b/i, tokens: tokenPattern(['IL', 'ISR', 'TLV']) },
    { code: 'ZA', cjk: /南非|约翰内斯堡/, words: /\bsouth\s*africa\b|\bjohannesburg\b/i, tokens: tokenPattern(['ZA', 'ZAF', 'JNB']) },
    { code: 'NZ', cjk: /新西兰|奥克兰/, words: /\bnew\s*zealand\b|\bauckland\b/i, tokens: tokenPattern(['NZ', 'NZL', 'AKL']) },
    { code: 'KZ', cjk: /哈萨克斯坦|阿拉木图/, words: /\bkazakhstan\b|\balmaty\b/i, tokens: tokenPattern(['KZ', 'KAZ']) },
    { code: 'KH', cjk: /柬埔寨|金边/, words: /\bcambodia\b|\bphnom\s*penh\b/i, tokens: tokenPattern(['KH', 'KHM']) },
    { code: 'NG', cjk: /尼日利亚|拉各斯/, words: /\bnigeria\b|\blagos\b/i, tokens: tokenPattern(['NG', 'NGA']) },
    { code: 'EG', cjk: /埃及|开罗/, words: /\begypt\b|\bcairo\b/i, tokens: tokenPattern(['EG', 'EGY']) },
    { code: 'PT', cjk: /葡萄牙|里斯本/, words: /\bportugal\b|\blisbon\b/i, tokens: tokenPattern(['PT', 'PRT', 'LIS']) },
    { code: 'GR', cjk: /希腊|雅典/, words: /\bgreece\b|\bathens\b/i, tokens: tokenPattern(['GR', 'GRC', 'ATH']) },
    { code: 'HU', cjk: /匈牙利|布达佩斯/, words: /\bhungary\b|\bbudapest\b/i, tokens: tokenPattern(['HU', 'HUN', 'BUD']) },
    { code: 'CN', cjk: /中国|中國|大陆|上海|北京|广州|深圳|杭州|成都|南京|武汉|苏州|青岛|天津|直连/, words: /\bchina\b|\bshanghai\b|\bbeijing\b|\bguangzhou\b|\bshenzhen\b/i, tokens: tokenPattern(['CN', 'CHN', 'PVG', 'PEK', 'SZX']) },
];

export function inferCountryCodeFromText(text: unknown): string {
    const raw = String(text || '').trim();
    if (!raw) return '';

    const flagCode = flagEmojiToCountryCode(raw);
    if (flagCode) return flagCode;

    for (const rule of COUNTRY_RULES) {
        if (rule.cjk && rule.cjk.test(raw)) return rule.code;
        if (rule.words && rule.words.test(raw)) return rule.code;
        if (rule.tokens && rule.tokens.test(raw)) return rule.code;
        if (rule.caseSensitiveTokens && rule.caseSensitiveTokens.test(raw)) return rule.code;
    }

    return '';
}

export function resolveServerCountryCode(server?: {
    countryCode?: unknown;
    name?: unknown;
    group?: unknown;
    tags?: unknown;
} | null): string {
    if (!server || typeof server !== 'object') return '';
    const explicit = normalizeCountryCode(server.countryCode);
    if (explicit) return explicit;

    const fromName = inferCountryCodeFromText(server.name);
    if (fromName) return fromName;

    const fromGroup = inferCountryCodeFromText(server.group);
    if (fromGroup) return fromGroup;

    if (Array.isArray(server.tags)) {
        for (const tag of server.tags) {
            const fromTag = inferCountryCodeFromText(tag);
            if (fromTag) return fromTag;
        }
    }

    return '';
}

export function resolveServerFlag(server?: {
    countryCode?: unknown;
    name?: unknown;
    group?: unknown;
    tags?: unknown;
} | null): string {
    const code = resolveServerCountryCode(server);
    return code ? countryCodeToFlag(code) : '';
}

/**
 * Prepends a flag emoji to a label when the flag is present and the label
 * does not already contain any flag emoji.
 */
export function formatFlaggedLabel(label: unknown, flag: unknown): string {
    const cleanLabel = String(label || '').trim();
    const cleanFlag = String(flag || '').trim();
    if (!cleanFlag || !cleanLabel) return cleanLabel;
    if (extractFlagEmoji(cleanLabel)) return cleanLabel;
    return `${cleanFlag} ${cleanLabel}`;
}
