import type { Request, Response, NextFunction } from 'express';
import { isEnglishLocale, localizeUserStoreErrorMessage, resolveRequestLocale, type AppLocale } from './requestLocale.js';

// Stores and libraries throw Chinese Error messages that routes forward verbatim as
// `msg`. Rather than threading the request locale through every layer, known
// messages are translated once at the response boundary for en-US requests.
const EXACT_MESSAGES: Record<string, string> = {
    // lib/systemBackup.ts
    '未配置 CREDENTIALS_SECRET，无法加密或解密系统备份': 'CREDENTIALS_SECRET is not configured; system backups cannot be encrypted or decrypted',
    '备份格式不受支持': 'Unsupported backup format',
    '备份版本不受支持': 'Unsupported backup version',
    '备份快照结构无效': 'Invalid backup snapshot structure',
    '备份文件解析失败，请确认上传的是 NMS 导出的 `.nmsbak` 加密备份或旧版 `.json.gz` 备份': 'Could not parse the backup file. Upload an encrypted `.nmsbak` backup exported by NMS or a legacy `.json.gz` backup.',
    '加密备份结构无效': 'Invalid encrypted backup structure',
    '备份文件无法解密，请确认当前 NMS 的 CREDENTIALS_SECRET 与备份创建时一致': 'The backup cannot be decrypted. Make sure this NMS uses the same CREDENTIALS_SECRET as when the backup was created.',
    '备份文件解密成功，但内容已损坏': 'The backup was decrypted but its content is corrupted',
    '仅支持 `.nmsbak` 加密备份文件；如需恢复旧版 `.json.gz` 明文备份，请显式启用兼容选项': 'Only encrypted `.nmsbak` backups are supported. To restore a legacy plaintext `.json.gz` backup, enable the compatibility option explicitly.',
    '备份中没有可恢复的 store': 'The backup contains no restorable stores',
    '备份文件名无效': 'Invalid backup file name',
    '本机备份不存在': 'Local backup not found',
    // lib/securityBootstrap.ts
    '当前会话未绑定有效管理员账号': 'The current session is not bound to a valid administrator account',
    'JWT_SECRET 强度不足，请使用长度不少于 32 的随机密钥': 'JWT_SECRET is too weak; use a random secret of at least 32 characters',
    '管理员用户名过弱，请使用非默认用户名': 'The administrator username is too weak; use a non-default username',
    '管理员密码过弱，请至少使用 8 位并覆盖大小写、数字、符号中的 3 类': 'The administrator password is too weak; use at least 8 characters from 3 of: lowercase, uppercase, digits, symbols',
    'CREDENTIALS_SECRET 强度不足，且不能复用 JWT_SECRET': 'CREDENTIALS_SECRET is too weak or reuses JWT_SECRET',
    '安全启动向导仍存在未解决项，请检查输入值': 'The security setup wizard still has unresolved items; check the values entered',
    // store/inviteCodeStore.ts
    '生成邀请码失败，请重试': 'Failed to generate an invite code; please try again',
    '邀请码无效': 'Invalid invite code',
    '邀请码已失效': 'The invite code has expired',
    '邀请码不存在': 'Invite code not found',
    // store/userGroupStore.ts
    '分组名称不能为空': 'Group name is required',
    // services/registeredUserNoticeService.ts
    '通知主题不能为空': 'Notification subject is required',
    '通知内容不能为空': 'Notification content is required',
    '通知发送已取消': 'Notification delivery cancelled',
    // lib/mailer.ts
    'SMTP 未配置，无法验证连接。请在 .env 中配置后重启服务。': 'SMTP is not configured, so the connection cannot be verified. Configure it and restart the service.',
    'SMTP 未配置，无法发送邮件。请在 .env 中配置 SMTP_HOST 等参数': 'SMTP is not configured, so email cannot be sent. Set SMTP_HOST and the related settings.',
    // routes/system.ts, lib/telegramAlertService.ts
    'Telegram 未启用或配置不完整': 'Telegram is disabled or not fully configured',
};

const PATTERN_MESSAGES: Array<[RegExp, string]> = [
    [/^用户分组 "(.*)" 已存在$/, 'User group "$1" already exists'],
    [/^订阅策略 "(.*)" 已存在，无法安全迁移$/, 'Subscription policy "$1" already exists and cannot be migrated safely'],
    [/^风控令牌校验失败（(.*)）$/, 'Risk token verification failed ($1)'],
];

const CJK_PATTERN = /[一-鿿]/;

export function localizeServerMessage(message: unknown, locale: AppLocale): string {
    const raw = String(message ?? '');
    if (!isEnglishLocale(locale) || !CJK_PATTERN.test(raw)) return raw;
    const trimmed = raw.trim();
    const exact = EXACT_MESSAGES[trimmed];
    if (exact) return exact;
    for (const [pattern, replacement] of PATTERN_MESSAGES) {
        if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement);
    }
    return localizeUserStoreErrorMessage(trimmed, locale);
}

/** Translates known Chinese `msg` fields in JSON responses for en-US requests. */
export function createResponseMessageLocalizer() {
    return (req: Request, res: Response, next: NextFunction): void => {
        const originalJson = res.json.bind(res);
        res.json = ((body?: any) => {
            if (body && typeof body === 'object' && !Array.isArray(body)
                && typeof body.msg === 'string' && CJK_PATTERN.test(body.msg)) {
                const locale = resolveRequestLocale(req);
                if (isEnglishLocale(locale)) {
                    const translated = localizeServerMessage(body.msg, locale);
                    if (translated !== body.msg) body = { ...body, msg: translated };
                }
            }
            return originalJson(body);
        }) as Response['json'];
        next();
    };
}
