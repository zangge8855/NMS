import nodemailer from 'nodemailer';
import config from '../config.js';

let transporter = null;
let transporterCacheKey = '';
let lastDelivery = {
    ts: null,
    type: '',
    success: null,
    error: '',
    code: '',
    responseCode: null,
    command: '',
    hint: '',
    to: '',
};
let lastVerification = {
    ts: null,
    success: null,
    error: '',
    code: '',
    responseCode: null,
    command: '',
    hint: '',
};

function maskEmailAddress(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const atIndex = text.indexOf('@');
    if (atIndex <= 1) return text;
    const local = text.slice(0, atIndex);
    const domain = text.slice(atIndex + 1);
    if (!domain) return text;
    return `${local.slice(0, 1)}***@${domain}`;
}

function normalizeAuthMethod(value) {
    return String(value || '').trim().toUpperCase();
}

function resolveSmtpConfig() {
    const requireTLS = config.smtp.requireTLS === true;
    const ignoreTLS = requireTLS ? false : config.smtp.ignoreTLS === true;

    return {
        service: String(config.smtp.service || '').trim(),
        host: String(config.smtp.host || '').trim(),
        port: Number(config.smtp.port || 0),
        secure: config.smtp.secure === true,
        requireTLS,
        ignoreTLS,
        authMethod: normalizeAuthMethod(config.smtp.authMethod),
        tlsServername: String(config.smtp.tlsServername || '').trim(),
        tlsRejectUnauthorized: config.smtp.tlsRejectUnauthorized !== false,
        connectionTimeoutMs: Number(config.smtp.connectionTimeoutMs || 10000),
        greetingTimeoutMs: Number(config.smtp.greetingTimeoutMs || 10000),
        socketTimeoutMs: Number(config.smtp.socketTimeoutMs || 30000),
        user: String(config.smtp.user || ''),
        pass: String(config.smtp.pass || ''),
        from: String(config.smtp.from || '').trim(),
    };
}

function isSmtpConfigured(smtp = resolveSmtpConfig()) {
    return Boolean(
        (smtp.host || smtp.service)
        && String(smtp.user || '').trim()
        && String(smtp.pass || '').trim()
        && String(smtp.from || '').trim()
    );
}

export function buildSmtpTransportOptions(smtpInput = resolveSmtpConfig()) {
    const smtp = {
        ...smtpInput,
        authMethod: normalizeAuthMethod(smtpInput.authMethod),
    };

    const options = {
        secure: smtp.secure === true,
        auth: {
            user: smtp.user,
            pass: smtp.pass,
        },
        connectionTimeout: Number(smtp.connectionTimeoutMs || 10000),
        greetingTimeout: Number(smtp.greetingTimeoutMs || 10000),
        socketTimeout: Number(smtp.socketTimeoutMs || 30000),
    };

    if (smtp.service) options.service = smtp.service;
    if (smtp.host) options.host = smtp.host;
    if (smtp.port > 0) options.port = smtp.port;
    if (smtp.requireTLS === true) options.requireTLS = true;
    if (smtp.ignoreTLS === true) options.ignoreTLS = true;
    if (smtp.authMethod) options.authMethod = smtp.authMethod;

    const tls = {};
    if (smtp.tlsServername) tls.servername = smtp.tlsServername;
    if (typeof smtp.tlsRejectUnauthorized === 'boolean') {
        tls.rejectUnauthorized = smtp.tlsRejectUnauthorized;
    }
    if (Object.keys(tls).length > 0) {
        options.tls = tls;
    }

    return options;
}

function buildTransportCacheKey(smtp = resolveSmtpConfig()) {
    return JSON.stringify({
        service: smtp.service,
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        requireTLS: smtp.requireTLS,
        ignoreTLS: smtp.ignoreTLS,
        authMethod: smtp.authMethod,
        tlsServername: smtp.tlsServername,
        tlsRejectUnauthorized: smtp.tlsRejectUnauthorized,
        connectionTimeoutMs: smtp.connectionTimeoutMs,
        greetingTimeoutMs: smtp.greetingTimeoutMs,
        socketTimeoutMs: smtp.socketTimeoutMs,
        user: smtp.user,
        pass: smtp.pass,
        from: smtp.from,
    });
}

export function normalizeSmtpError(error) {
    return {
        message: String(error?.message || 'SMTP 操作失败').trim() || 'SMTP 操作失败',
        code: String(error?.code || '').trim(),
        responseCode: Number.isFinite(Number(error?.responseCode)) ? Number(error.responseCode) : null,
        response: String(error?.response || '').trim(),
        command: String(error?.command || '').trim(),
    };
}

export function buildSmtpHint(error, smtpInput = resolveSmtpConfig()) {
    const smtp = smtpInput || resolveSmtpConfig();
    const diagnostic = normalizeSmtpError(error);
    const haystack = `${diagnostic.message}\n${diagnostic.response}\n${diagnostic.code}\n${diagnostic.command}`.toLowerCase();

    if (!isSmtpConfigured(smtp)) {
        return '请先在 .env 中设置 SMTP_HOST 或 SMTP_SERVICE、SMTP_USER、SMTP_PASS、SMTP_FROM，并重启服务。';
    }
    if (diagnostic.responseCode === 535 || haystack.includes('invalid login') || haystack.includes('authentication failed')) {
        const secureHint = smtp.port === 465 && smtp.secure !== true
            ? '当前端口 465 通常需要 SMTP_SECURE=true。'
            : (smtp.port === 587 && smtp.secure === true ? '当前端口 587 通常建议 SMTP_SECURE=false，并使用 STARTTLS。' : '');
        return `认证失败：请确认 SMTP_USER 使用完整邮箱地址，SMTP_PASS 使用 SMTP 授权码而非网页登录密码。${secureHint}${smtp.authMethod ? ` 当前已固定 SMTP_AUTH_METHOD=${smtp.authMethod}。` : ' 如服务商兼容性较差，可尝试 SMTP_AUTH_METHOD=LOGIN。'}`;
    }
    if (haystack.includes('certificate') || haystack.includes('self signed')) {
        return 'TLS 证书校验失败：如证书域名与 SMTP_HOST 不一致，可设置 SMTP_TLS_SERVERNAME；仅在完全可信的内网环境下才考虑 SMTP_TLS_REJECT_UNAUTHORIZED=false。';
    }
    if (haystack.includes('greeting never received') || haystack.includes('etimedout') || haystack.includes('connection timeout')) {
        return '连接超时：请检查 SMTP_HOST、SMTP_PORT、防火墙和服务商网络连通性。';
    }
    if (haystack.includes('wrong version number') || haystack.includes('ssl routines') || haystack.includes('starttls')) {
        return 'TLS 模式可能不匹配：465 通常使用 SMTP_SECURE=true；587 通常使用 SMTP_SECURE=false，并按需启用 SMTP_REQUIRE_TLS=true。';
    }
    return '请检查 SMTP 主机、端口、TLS 模式以及服务商是否要求授权码登录。';
}

function recordDelivery(type, toEmail, success, diagnostic = {}) {
    lastDelivery = {
        ts: new Date().toISOString(),
        type: String(type || '').trim(),
        success: success === true,
        error: String(diagnostic.message || '').trim(),
        code: String(diagnostic.code || '').trim(),
        responseCode: Number.isFinite(Number(diagnostic.responseCode)) ? Number(diagnostic.responseCode) : null,
        command: String(diagnostic.command || '').trim(),
        hint: String(diagnostic.hint || '').trim(),
        to: maskEmailAddress(toEmail),
    };
}

function recordVerification(success, diagnostic = {}) {
    lastVerification = {
        ts: new Date().toISOString(),
        success: success === true,
        error: String(diagnostic.message || '').trim(),
        code: String(diagnostic.code || '').trim(),
        responseCode: Number.isFinite(Number(diagnostic.responseCode)) ? Number(diagnostic.responseCode) : null,
        command: String(diagnostic.command || '').trim(),
        hint: String(diagnostic.hint || '').trim(),
    };
}

function buildDiagnostic(error, smtp = resolveSmtpConfig()) {
    const normalized = normalizeSmtpError(error);
    return {
        ...normalized,
        hint: buildSmtpHint(normalized, smtp),
    };
}

function createDiagnosticError(diagnostic) {
    const wrapped = new Error(diagnostic.message || 'SMTP 操作失败');
    wrapped.code = diagnostic.code || '';
    wrapped.responseCode = diagnostic.responseCode;
    wrapped.command = diagnostic.command || '';
    wrapped.hint = diagnostic.hint || '';
    return wrapped;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderParagraphs(value) {
    const blocks = String(value || '')
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter(Boolean);
    if (blocks.length === 0) return '';
    return blocks
        .map((item) => `<p style="margin:0 0 16px;font-size:14px;line-height:1.75;color:#cbd5e1;">${escapeHtml(item).replace(/\n/g, '<br />')}</p>`)
        .join('');
}

function getTransporter() {
    const smtp = resolveSmtpConfig();
    if (!isSmtpConfigured(smtp)) {
        console.warn('  ⚠️  SMTP not configured — email verification will not work');
        transporter = null;
        transporterCacheKey = '';
        return null;
    }

    const nextKey = buildTransportCacheKey(smtp);
    if (transporter && transporterCacheKey === nextKey) return transporter;

    transporter = nodemailer.createTransport(buildSmtpTransportOptions(smtp));
    transporterCacheKey = nextKey;
    return transporter;
}

export function getEmailStatus() {
    const smtp = resolveSmtpConfig();

    return {
        configured: isSmtpConfigured(smtp),
        service: smtp.service,
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure === true,
        requireTLS: smtp.requireTLS === true,
        ignoreTLS: smtp.ignoreTLS === true,
        authMethod: smtp.authMethod,
        tlsServername: smtp.tlsServername,
        tlsRejectUnauthorized: smtp.tlsRejectUnauthorized !== false,
        from: smtp.from,
        userMasked: maskEmailAddress(smtp.user),
        lastDelivery: { ...lastDelivery },
        lastVerification: { ...lastVerification },
    };
}

export function resetEmailStatusForTests() {
    transporter = null;
    transporterCacheKey = '';
    lastDelivery = {
        ts: null,
        type: '',
        success: null,
        error: '',
        code: '',
        responseCode: null,
        command: '',
        hint: '',
        to: '',
    };
    lastVerification = {
        ts: null,
        success: null,
        error: '',
        code: '',
        responseCode: null,
        command: '',
        hint: '',
    };
}

export async function verifySmtpConnection() {
    const smtp = resolveSmtpConfig();
    const t = getTransporter();
    if (!t) {
        const diagnostic = buildDiagnostic(new Error('SMTP 未配置，无法验证连接。请在 .env 中配置后重启服务。'), smtp);
        recordVerification(false, diagnostic);
        throw createDiagnosticError(diagnostic);
    }

    try {
        await t.verify();
        recordVerification(true, {
            message: 'SMTP 连接验证成功',
            code: '',
            responseCode: null,
            command: '',
            hint: '',
        });
        return {
            ok: true,
            message: 'SMTP 连接验证成功',
        };
    } catch (error) {
        const diagnostic = buildDiagnostic(error, smtp);
        recordVerification(false, diagnostic);
        throw createDiagnosticError(diagnostic);
    }
}

async function sendTrackedEmail({ type, toEmail, subject, html }) {
    const smtp = resolveSmtpConfig();
    const t = getTransporter();
    if (!t) {
        const diagnostic = buildDiagnostic(new Error('SMTP 未配置，无法发送邮件。请在 .env 中配置 SMTP_HOST 等参数'), smtp);
        recordDelivery(type, toEmail, false, diagnostic);
        throw createDiagnosticError(diagnostic);
    }

    try {
        await t.sendMail({
            from: smtp.from,
            to: toEmail,
            subject,
            html,
        });
        recordDelivery(type, toEmail, true, {
            message: '',
            code: '',
            responseCode: null,
            command: '',
            hint: '',
        });
    } catch (error) {
        const diagnostic = buildDiagnostic(error, smtp);
        recordDelivery(type, toEmail, false, diagnostic);
        throw createDiagnosticError(diagnostic);
    }
}

/**
 * 生成 6 位数字验证码
 */
export function generateVerifyCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 发送邮箱验证码邮件
 * @param {string} toEmail 收件人邮箱
 * @param {string} code    验证码
 * @param {string} username 用户名 (可选)
 */
export async function sendVerificationEmail(toEmail, code, username = '') {
    const ttl = config.registration.verifyCodeTtlMinutes;

    const html = `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:#fff;">NMS</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">邮箱验证</p>
      </div>
      <div style="padding:32px 24px;">
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">你好${username ? ` ${username}` : ''}，</p>
        <p style="margin:0 0 24px;font-size:14px;color:#cbd5e1;">请使用以下验证码完成邮箱验证：</p>
        <div style="background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#a5b4fc;">${code}</span>
        </div>
        <p style="margin:0;font-size:12px;color:#64748b;">验证码将在 ${ttl} 分钟后过期。如果你没有请求此验证，请忽略本邮件。</p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
        <p style="margin:0;font-size:11px;color:#475569;">© NMS</p>
      </div>
    </div>`;

    await sendTrackedEmail({
        type: 'verification',
        toEmail,
        subject: `[NMS] 邮箱验证码: ${code}`,
        html,
    });
}

/**
 * 发送密码重置验证码邮件
 * @param {string} toEmail 收件人邮箱
 * @param {string} code    验证码
 * @param {string} username 用户名 (可选)
 */
export async function sendPasswordResetEmail(toEmail, code, username = '') {
    const ttl = config.registration.passwordResetCodeTtlMinutes || config.registration.verifyCodeTtlMinutes;
    const html = `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:#fff;">NMS</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">密码重置</p>
      </div>
      <div style="padding:32px 24px;">
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">你好${username ? ` ${username}` : ''}，</p>
        <p style="margin:0 0 24px;font-size:14px;color:#cbd5e1;">你正在重置登录密码，请输入以下验证码：</p>
        <div style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#93c5fd;">${code}</span>
        </div>
        <p style="margin:0;font-size:12px;color:#64748b;">验证码将在 ${ttl} 分钟后过期。如果这不是你的操作，请尽快修改邮箱密码并联系管理员。</p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
        <p style="margin:0;font-size:11px;color:#475569;">© NMS</p>
      </div>
    </div>`;

    await sendTrackedEmail({
        type: 'password_reset',
        toEmail,
        subject: `[NMS] 密码重置验证码: ${code}`,
        html,
    });
}

export function buildInviteRegistrationEmail(payload = {}) {
    const subject = String(payload.subject || '').trim() || '[NMS] 注册邀请';
    const inviteCode = String(payload.inviteCode || '').trim().toUpperCase();
    const usageLimit = Math.max(1, Number.parseInt(String(payload.usageLimit || ''), 10) || 1);
    const subscriptionDays = Math.max(0, Number.parseInt(String(payload.subscriptionDays || ''), 10) || 0);
    const registrationUrl = String(payload.registrationUrl || '').trim();
    const inviterName = String(payload.inviterName || '').trim();
    const message = String(payload.message || '').trim();
    const durationLabel = subscriptionDays > 0 ? `${subscriptionDays} 天` : '不限时';
    const intro = inviterName
        ? `管理员 ${escapeHtml(inviterName)} 邀请你注册 NMS。`
        : '你收到了一封新的 NMS 注册邀请。';
    const actionHtml = registrationUrl
        ? `
        <div style="margin-top:24px;">
          <a href="${escapeHtml(registrationUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#0f766e);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
            打开注册页面
          </a>
          <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
            如果按钮无法打开，请复制以下地址：<br />${escapeHtml(registrationUrl)}
          </div>
        </div>`
        : '';
    const messageHtml = message ? renderParagraphs(message) : '';
    const html = `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;border-radius:18px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0f766e,#2563eb);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:#fff;">NMS</h1>
        <p style="margin:10px 0 0;color:rgba(255,255,255,0.84);font-size:14px;">注册邀请</p>
      </div>
      <div style="padding:32px 24px;">
        <p style="margin:0 0 18px;font-size:14px;line-height:1.75;color:#94a3b8;">${intro}</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.75;color:#cbd5e1;">请使用以下邀请码完成注册。每个邀请链接会绑定当前邮箱并自动打开注册表单。</p>
        <div style="background:rgba(37,99,235,0.14);border:1px solid rgba(59,130,246,0.3);border-radius:14px;padding:20px;margin-bottom:20px;text-align:center;">
          <div style="margin:0 0 10px;font-size:12px;color:#94a3b8;">邀请码</div>
          <div style="font-size:28px;font-weight:700;letter-spacing:4px;color:#bfdbfe;word-break:break-all;">${escapeHtml(inviteCode || '-')}</div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
          <div style="flex:1 1 180px;min-width:180px;background:rgba(15,23,42,0.42);border:1px solid rgba(148,163,184,0.16);border-radius:12px;padding:14px 16px;">
            <div style="font-size:12px;color:#94a3b8;">可用次数</div>
            <div style="margin-top:8px;font-size:18px;font-weight:700;color:#f8fafc;">${usageLimit} 次</div>
          </div>
          <div style="flex:1 1 180px;min-width:180px;background:rgba(15,23,42,0.42);border:1px solid rgba(148,163,184,0.16);border-radius:12px;padding:14px 16px;">
            <div style="font-size:12px;color:#94a3b8;">开通时长</div>
            <div style="margin-top:8px;font-size:18px;font-weight:700;color:#f8fafc;">${escapeHtml(durationLabel)}</div>
          </div>
        </div>
        ${messageHtml}
        ${actionHtml}
      </div>
      <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
        <p style="margin:0;font-size:11px;color:#475569;">© NMS</p>
      </div>
    </div>`;

    return {
        subject,
        html,
    };
}

export async function sendInviteRegistrationEmail(toEmail, payload = {}) {
    const { subject, html } = buildInviteRegistrationEmail(payload);
    await sendTrackedEmail({
        type: 'invite_registration',
        toEmail,
        subject,
        html,
    });
}

export function buildOperationalNoticeEmail(payload = {}) {
    const subject = String(payload.subject || '').trim() || '[NMS] 服务通知';
    const message = String(payload.message || '').trim();
    const actionUrl = String(payload.actionUrl || '').trim();
    const actionLabel = String(payload.actionLabel || '').trim() || '查看详情';
    const username = String(payload.username || '').trim();
    const intro = username
        ? `你好 ${escapeHtml(username)}，以下是管理员发布的最新服务变更通知。`
        : '你好，以下是管理员发布的最新服务变更通知。';

    const actionHtml = actionUrl
        ? `
        <div style="margin-top:24px;">
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
            ${escapeHtml(actionLabel)}
          </a>
          <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
            如果按钮无法打开，请复制以下地址：<br />${escapeHtml(actionUrl)}
          </div>
        </div>`
        : '';

    const html = `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;border-radius:18px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0f766e,#2563eb);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:#fff;">NMS</h1>
        <p style="margin:10px 0 0;color:rgba(255,255,255,0.84);font-size:14px;">服务变更通知</p>
      </div>
      <div style="padding:32px 24px;">
        <p style="margin:0 0 18px;font-size:14px;line-height:1.75;color:#94a3b8;">${intro}</p>
        <h2 style="margin:0 0 20px;font-size:22px;line-height:1.35;color:#f8fafc;">${escapeHtml(subject)}</h2>
        ${renderParagraphs(message)}
        ${actionHtml}
      </div>
      <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
        <p style="margin:0;font-size:11px;color:#475569;">© NMS</p>
      </div>
    </div>`;

    return {
        subject,
        html,
    };
}

export async function sendOperationalNoticeEmail(toEmail, payload = {}) {
    const { subject, html } = buildOperationalNoticeEmail(payload);
    await sendTrackedEmail({
        type: 'operational_notice',
        toEmail,
        subject,
        html,
    });
}
