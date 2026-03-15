import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildRobotsTxt,
    createSearchBotProtectionMiddleware,
    getBlockedBotId,
    getRobotsHeaderValue,
} from '../middleware/searchBotProtection.js';

function createMockResponse() {
    return {
        statusCode: 200,
        headers: new Map(),
        body: '',
        contentType: '',
        setHeader(name, value) {
            this.headers.set(name, value);
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        type(value) {
            this.contentType = value;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
    };
}

describe('search bot protection middleware', () => {
    it('detects common search engine and AI bot user agents', () => {
        assert.equal(getBlockedBotId('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), 'googlebot');
        assert.equal(getBlockedBotId('Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)'), 'gptbot');
        assert.equal(getBlockedBotId('ClaudeBot/1.0 (+https://www.anthropic.com/claudebot)'), 'claudebot');
        assert.equal(getBlockedBotId('Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://www.perplexity.ai/perplexitybot)'), 'perplexitybot');
        assert.equal(getBlockedBotId('Mozilla/5.0 AppleWebKit/537.36 Chrome/123.0 Safari/537.36'), '');
    });

    it('serves a disallow-all robots.txt with AI directives', () => {
        const middleware = createSearchBotProtectionMiddleware();
        const res = createMockResponse();

        middleware({
            path: '/robots.txt',
            headers: {
                'user-agent': 'Mozilla/5.0',
            },
        }, res, () => {
            throw new Error('next should not be called');
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.contentType, 'text/plain');
        assert.equal(res.headers.get('X-Robots-Tag'), getRobotsHeaderValue());
        assert.match(res.body, /^User-agent: \*\nDisallow: \//);
        assert.match(res.body, /User-agent: GPTBot\nDisallow: \//);
        assert.match(res.body, /User-agent: ClaudeBot\nDisallow: \//);
        assert.match(res.body, /User-agent: PerplexityBot\nDisallow: \//);
        assert.equal(res.body, buildRobotsTxt());
    });

    it('blocks matched crawler user agents with a hard 403', () => {
        const middleware = createSearchBotProtectionMiddleware();
        const res = createMockResponse();
        let nextCalled = false;

        middleware({
            path: '/',
            headers: {
                'user-agent': 'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
            },
        }, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 403);
        assert.equal(res.contentType, 'text/plain');
        assert.equal(res.body, 'Forbidden');
        assert.equal(res.headers.get('X-Robots-Tag'), getRobotsHeaderValue());
        assert.equal(res.headers.get('Vary'), 'User-Agent');
    });

    it('allows normal browsers to continue while still setting anti-index headers', () => {
        const middleware = createSearchBotProtectionMiddleware();
        const res = createMockResponse();
        let nextCalled = false;

        middleware({
            path: '/dashboard',
            headers: {
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
            },
        }, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers.get('X-Robots-Tag'), getRobotsHeaderValue());
        assert.equal(res.body, '');
    });
});
