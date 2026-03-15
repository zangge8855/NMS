const ROBOTS_HEADER_VALUE = 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai';

const BLOCKED_BOT_PATTERNS = [
    ['googlebot', /\b(?:googlebot|google-extended|googleother|adsbot-google|apis-google)\b/i],
    ['bingbot', /\b(?:bingbot|bingpreview|adidxbot|msnbot)\b/i],
    ['duckduckbot', /\bduckduckbot\b/i],
    ['yahooslurp', /\b(?:slurp|yahoo! slurp)\b/i],
    ['baiduspider', /\bbaiduspider\b/i],
    ['yandexbot', /\byandex(?:bot|images|mobilebot)\b/i],
    ['bytespider', /\bbytespider\b/i],
    ['applebot', /\b(?:applebot|applebot-extended)\b/i],
    ['amazonbot', /\bamazonbot\b/i],
    ['semrushbot', /\bsemrushbot\b/i],
    ['ahrefsbot', /\bahrefsbot\b/i],
    ['mj12bot', /\bmj12bot\b/i],
    ['dotbot', /\bdotbot\b/i],
    ['petalbot', /\bpetalbot\b/i],
    ['sogou', /\bsogou(?: web spider| inst spider| spider)?\b/i],
    ['ccbot', /\bccbot\b/i],
    ['gptbot', /\b(?:gptbot|chatgpt-user|oai-searchbot)\b/i],
    ['claudebot', /\b(?:claudebot|claude-web|anthropic-ai)\b/i],
    ['perplexitybot', /\b(?:perplexitybot|perplexity-user)\b/i],
    ['cohere-ai', /\bcohere-ai\b/i],
    ['meta', /\b(?:meta-externalagent|meta-externalfetcher|facebookexternalhit|facebot)\b/i],
];

export function getRobotsHeaderValue() {
    return ROBOTS_HEADER_VALUE;
}

export function getBlockedBotId(userAgent = '') {
    const text = String(userAgent || '').trim();
    if (!text) return '';
    const match = BLOCKED_BOT_PATTERNS.find(([, pattern]) => pattern.test(text));
    return match ? match[0] : '';
}

export function buildRobotsTxt() {
    return [
        'User-agent: *',
        'Disallow: /',
        '',
        '# AI crawlers are not permitted',
        'User-agent: GPTBot',
        'Disallow: /',
        'User-agent: ChatGPT-User',
        'Disallow: /',
        'User-agent: OAI-SearchBot',
        'Disallow: /',
        'User-agent: ClaudeBot',
        'Disallow: /',
        'User-agent: Claude-Web',
        'Disallow: /',
        'User-agent: PerplexityBot',
        'Disallow: /',
        'User-agent: Perplexity-User',
        'Disallow: /',
        'User-agent: Cohere-AI',
        'Disallow: /',
        '',
    ].join('\n');
}

export function createSearchBotProtectionMiddleware(options = {}) {
    const forbiddenBody = String(options.forbiddenBody || 'Forbidden').trim() || 'Forbidden';
    const robotsBody = options.robotsBody || buildRobotsTxt();

    return (req, res, next) => {
        res.setHeader('X-Robots-Tag', ROBOTS_HEADER_VALUE);

        if (req.path === '/robots.txt') {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.type('text/plain').send(robotsBody);
        }

        const blockedBotId = getBlockedBotId(req.headers?.['user-agent']);
        if (!blockedBotId) {
            return next();
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Vary', 'User-Agent');
        return res.status(403).type('text/plain').send(forbiddenBody);
    };
}

export default createSearchBotProtectionMiddleware;
