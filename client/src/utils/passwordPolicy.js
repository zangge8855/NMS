export const PASSWORD_POLICY_HINT = '密码至少 8 位，且至少包含大写字母、小写字母、数字、特殊字符中的 3 类';
export const PASSWORD_POLICY_HINT_EN = 'Use at least 8 characters and include 3 character types.';

const LOWERCASE_REGEX = /[a-z]/;
const UPPERCASE_REGEX = /[A-Z]/;
const DIGIT_REGEX = /\d/;
const SPECIAL_REGEX = /[^A-Za-z0-9]/;

export function evaluatePasswordPolicy(password = '') {
    const value = String(password || '');
    const lengthOk = value.length >= 8;
    const typeCount = [
        LOWERCASE_REGEX.test(value),
        UPPERCASE_REGEX.test(value),
        DIGIT_REGEX.test(value),
        SPECIAL_REGEX.test(value),
    ].filter(Boolean).length;
    const typeOk = typeCount >= 3;

    return {
        valid: lengthOk && typeOk,
        lengthOk,
        typeOk,
        typeCount,
    };
}

export function getPasswordPolicyHint(locale = 'zh-CN') {
    return locale === 'en-US' ? PASSWORD_POLICY_HINT_EN : PASSWORD_POLICY_HINT;
}

export function getPasswordPolicyError(password = '', locale = 'zh-CN') {
    if (!String(password || '')) {
        return locale === 'en-US' ? 'Password is required' : '密码不能为空';
    }
    const result = evaluatePasswordPolicy(password);
    if (!result.valid) return getPasswordPolicyHint(locale);
    return '';
}
