export const PASSWORD_POLICY_HINT = '密码至少 8 位，且至少包含大写字母、小写字母、数字、特殊字符中的 3 类';

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

export function getPasswordPolicyError(password = '') {
    if (!String(password || '')) return '密码不能为空';
    const result = evaluatePasswordPolicy(password);
    if (!result.valid) return PASSWORD_POLICY_HINT;
    return '';
}

