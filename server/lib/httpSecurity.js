const SENSITIVE_QUERY_KEYS = new Set([
    'access_token',
    'auth',
    'jwt',
    'secret',
    'sig',
    'signature',
    'token',
]);

function redactPathSegments(pathname) {
    const parts = String(pathname || '').split('/');
    const publicIndex = parts.findIndex((part, index) => part === 'public' && parts[index - 1] === 'subscriptions');
    if (publicIndex < 0) return pathname;

    const suffix = parts.slice(publicIndex + 1);
    if (suffix[0] === 't') {
        if (parts[publicIndex + 3]) parts[publicIndex + 3] = '[redacted]';
        return parts.join('/');
    }

    if (suffix.length >= 3) {
        if (parts[publicIndex + 3]) parts[publicIndex + 3] = '[redacted]';
        return parts.join('/');
    }

    if (suffix.length >= 2) {
        if (parts[publicIndex + 2]) parts[publicIndex + 2] = '[redacted]';
    }
    return parts.join('/');
}

export function redactRequestUrl(rawUrl = '') {
    const original = String(rawUrl || '');
    if (!original) return '';

    try {
        const parsed = new URL(original, 'http://nms.local');
        const redactedPath = redactPathSegments(parsed.pathname);
        const params = parsed.searchParams;
        for (const key of Array.from(params.keys())) {
            if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
                params.set(key, '[redacted]');
            }
        }
        const query = params.toString();
        return `${redactedPath}${query ? `?${query}` : ''}`;
    } catch {
        return redactPathSegments(original).replace(
            /([?&](?:access_token|auth|jwt|secret|sig|signature|token)=)[^&\s]*/gi,
            '$1[redacted]'
        );
    }
}

export function createSecurityHeadersMiddleware(options = {}) {
    const isProduction = options.nodeEnv === 'production';
    const csp = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:*",
    ].join('; ');

    return (req, res, next) => {
        res.setHeader('Content-Security-Policy', csp);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Permissions-Policy', [
            'camera=()',
            'microphone=()',
            'geolocation=()',
            'payment=()',
            'usb=()',
        ].join(', '));
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        if (isProduction) {
            res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
        }
        next();
    };
}
