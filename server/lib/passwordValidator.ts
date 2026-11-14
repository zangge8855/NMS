import { pickLocalizedText, type AppLocale } from './requestLocale.js';

// UUID v4 格式正则
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOWERCASE_REGEX = /[a-z]/;
const UPPERCASE_REGEX = /[A-Z]/;
const DIGIT_REGEX = /\d/;
const SPECIAL_REGEX = /[^A-Za-z0-9]/;

export const PASSWORD_POLICY_MIN_LENGTH = 8;
export const PASSWORD_POLICY_MIN_TYPES = 3;
export const PASSWORD_POLICY_HINT = '密码至少 8 位，且至少包含大写字母、小写字母、数字、特殊字符中的 3 类';
export const PASSWORD_POLICY_HINT_EN = 'Password must be at least 8 characters and include at least 3 of uppercase, lowercase, digits, and special characters';

export interface PasswordCheckResult {
    valid: boolean;
    reason?: string;
}

/**
 * 检查密码复杂度:
 * 1. 长度 >= 8
 * 2. 大写/小写/数字/特殊字符 四类中至少三类
 *
 * @param password 待检查的密码
 */
export function checkPasswordComplexity(password: unknown, locale: AppLocale = 'zh-CN'): PasswordCheckResult {
    const value = String(password || '');
    if (!value) {
        return { valid: false, reason: pickLocalizedText(locale, '密码不能为空', 'Password is required') };
    }
    const hint = pickLocalizedText(locale, PASSWORD_POLICY_HINT, PASSWORD_POLICY_HINT_EN);
    if (value.length < PASSWORD_POLICY_MIN_LENGTH) {
        return { valid: false, reason: hint };
    }

    const typeCount = [
        LOWERCASE_REGEX.test(value),
        UPPERCASE_REGEX.test(value),
        DIGIT_REGEX.test(value),
        SPECIAL_REGEX.test(value),
    ].filter(Boolean).length;

    if (typeCount < PASSWORD_POLICY_MIN_TYPES) {
        return { valid: false, reason: hint };
    }

    return { valid: true };
}

/**
 * 检查密码是否为 UUID 格式。
 * UUID 格式密码容易与协议凭据冲突，直接禁止。
 *
 * @param password 待检查的密码
 */
export function checkPasswordNotUUID(password: unknown, locale: AppLocale = 'zh-CN'): PasswordCheckResult {
    const value = String(password || '');
    if (!value) {
        return { valid: false, reason: pickLocalizedText(locale, '密码不能为空', 'Password is required') };
    }

    if (UUID_REGEX.test(value.trim())) {
        return {
            valid: false,
            reason: pickLocalizedText(
                locale,
                '密码不能使用 UUID 格式 — 这与客户端凭据冲突，存在安全风险',
                'Password cannot be a UUID — it conflicts with client credentials'
            ),
        };
    }

    return { valid: true };
}

/**
 * 账号密码统一校验:
 * 1) 复杂度策略
 * 2) 禁止 UUID 格式
 *
 * @param password 待检查密码
 */
export function checkAccountPassword(password: unknown, locale: AppLocale = 'zh-CN'): PasswordCheckResult {
    const complexity = checkPasswordComplexity(password, locale);
    if (!complexity.valid) return complexity;
    return checkPasswordNotUUID(password, locale);
}
