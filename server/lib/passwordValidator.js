// UUID v4 格式正则
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOWERCASE_REGEX = /[a-z]/;
const UPPERCASE_REGEX = /[A-Z]/;
const DIGIT_REGEX = /\d/;
const SPECIAL_REGEX = /[^A-Za-z0-9]/;

export const PASSWORD_POLICY_MIN_LENGTH = 8;
export const PASSWORD_POLICY_MIN_TYPES = 3;
export const PASSWORD_POLICY_HINT = '密码至少 8 位，且至少包含大写字母、小写字母、数字、特殊字符中的 3 类';

/**
 * 检查密码复杂度:
 * 1. 长度 >= 8
 * 2. 大写/小写/数字/特殊字符 四类中至少三类
 *
 * @param {string} password 待检查的密码
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkPasswordComplexity(password) {
    const value = String(password || '');
    if (!value) {
        return { valid: false, reason: '密码不能为空' };
    }
    if (value.length < PASSWORD_POLICY_MIN_LENGTH) {
        return { valid: false, reason: PASSWORD_POLICY_HINT };
    }

    const typeCount = [
        LOWERCASE_REGEX.test(value),
        UPPERCASE_REGEX.test(value),
        DIGIT_REGEX.test(value),
        SPECIAL_REGEX.test(value),
    ].filter(Boolean).length;

    if (typeCount < PASSWORD_POLICY_MIN_TYPES) {
        return { valid: false, reason: PASSWORD_POLICY_HINT };
    }

    return { valid: true };
}

/**
 * 检查密码是否为 UUID 格式。
 * UUID 格式密码容易与协议凭据冲突，直接禁止。
 *
 * @param {string} password 待检查的密码
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkPasswordNotUUID(password) {
    const value = String(password || '');
    if (!value) {
        return { valid: false, reason: '密码不能为空' };
    }

    if (UUID_REGEX.test(value.trim())) {
        return {
            valid: false,
            reason: '密码不能使用 UUID 格式 — 这与客户端凭据冲突，存在安全风险',
        };
    }

    return { valid: true };
}

/**
 * 账号密码统一校验:
 * 1) 复杂度策略
 * 2) 禁止 UUID 格式
 *
 * @param {string} password 待检查密码
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkAccountPassword(password) {
    const complexity = checkPasswordComplexity(password);
    if (!complexity.valid) return complexity;
    return checkPasswordNotUUID(password);
}
