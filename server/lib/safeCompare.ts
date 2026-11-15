import crypto from 'crypto';

/**
 * Constant-time string comparison for secrets (passwords, tokens).
 *
 * Both sides are hashed first so the comparison time does not depend on the
 * length or the position of the first differing character. An empty or
 * non-string value never matches, so an unset secret cannot be "guessed" by
 * sending an empty one.
 */
export function timingSafeStringEqual(candidate: unknown, expected: unknown): boolean {
    if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
    if (!candidate || !expected) return false;
    const left = crypto.createHash('sha256').update(candidate, 'utf8').digest();
    const right = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(left, right);
}
