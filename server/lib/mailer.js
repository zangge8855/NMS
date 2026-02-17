import nodemailer from 'nodemailer';
import config from '../config.js';

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (!config.smtp.host || !config.smtp.user) {
        console.warn('  ⚠️  SMTP not configured — email verification will not work');
        return null;
    }
    transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
            user: config.smtp.user,
            pass: config.smtp.pass,
        },
    });
    return transporter;
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
    const t = getTransporter();
    if (!t) {
        throw new Error('SMTP 未配置，无法发送验证邮件。请在 .env 中配置 SMTP_HOST 等参数');
    }

    const ttl = config.registration.verifyCodeTtlMinutes;

    const html = `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:#fff;">Node Management System (NMS)</h1>
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
        <p style="margin:0;font-size:11px;color:#475569;">© Node Management System (NMS) — 多节点统一管理面板</p>
      </div>
    </div>`;

    await t.sendMail({
        from: config.smtp.from,
        to: toEmail,
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
    const t = getTransporter();
    if (!t) {
        throw new Error('SMTP 未配置，无法发送重置邮件。请在 .env 中配置 SMTP_HOST 等参数');
    }

    const ttl = config.registration.passwordResetCodeTtlMinutes || config.registration.verifyCodeTtlMinutes;
    const html = `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:#fff;">Node Management System (NMS)</h1>
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
        <p style="margin:0;font-size:11px;color:#475569;">© Node Management System (NMS) — 多节点统一管理面板</p>
      </div>
    </div>`;

    await t.sendMail({
        from: config.smtp.from,
        to: toEmail,
        subject: `[NMS] 密码重置验证码: ${code}`,
        html,
    });
}
