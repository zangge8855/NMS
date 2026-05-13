import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { HiOutlineShieldCheck, HiOutlineLockClosed, HiOutlineKey, HiOutlineClipboard } from 'react-icons/hi2';
import api from '../../api/client.js';
import { getErrorMessage } from '../../utils/format.js';

function getCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Two-Factor Auth (TOTP)',
            subtitle: 'Strengthen sign-in with a time-based one-time password app such as Aegis, 1Password, Authy, or Google Authenticator.',
            statusEnabled: 'Enabled',
            statusDisabled: 'Disabled',
            backupRemaining: (n) => `${n} backup codes left`,
            enabledAt: (ts) => `Enabled at ${ts}`,
            enable: 'Enable',
            disable: 'Disable',
            setupStarted: 'Scan this QR with your authenticator and enter the 6-digit code.',
            qrAlt: 'TOTP enrolment QR code',
            secret: 'Manual key',
            secretCopied: 'Secret copied',
            verifyCode: 'Verification code',
            verify: 'Confirm & enable',
            cancel: 'Cancel',
            invalidCode: 'Invalid code — try again',
            generic: 'Action failed',
            backupTitle: 'Backup codes',
            backupHint: 'Store these one-time codes somewhere safe. Each can substitute for a TOTP code once.',
            backupCopied: 'Backup codes copied',
            done: 'I saved them',
            disableConfirm: 'Confirm with the current account password to disable 2FA.',
            currentPassword: 'Current password',
            disabledOk: '2FA disabled',
        };
    }
    return {
        title: '二步验证 (TOTP)',
        subtitle: '使用 Aegis、1Password、Authy 或 Google Authenticator 之类的 TOTP 应用强化登录。',
        statusEnabled: '已启用',
        statusDisabled: '未启用',
        backupRemaining: (n) => `剩余 ${n} 个备用码`,
        enabledAt: (ts) => `启用时间: ${ts}`,
        enable: '开启',
        disable: '关闭',
        setupStarted: '用验证器扫描下面的二维码,再输入 6 位验证码。',
        qrAlt: '2FA 注册二维码',
        secret: '手动密钥',
        secretCopied: '密钥已复制',
        verifyCode: '验证码',
        verify: '确认开启',
        cancel: '取消',
        invalidCode: '验证码不正确,请重试',
        generic: '操作失败',
        backupTitle: '备用码',
        backupHint: '请妥善保存以下一次性备用码,每个可代替一次 TOTP 验证码使用。',
        backupCopied: '备用码已复制',
        done: '我已保存',
        disableConfirm: '请输入当前账号密码以确认关闭 2FA。',
        currentPassword: '当前账号密码',
        disabledOk: '2FA 已关闭',
    };
}

export default function TwoFactorPanel({ locale = 'zh-CN' }) {
    const copy = useMemo(() => getCopy(locale), [locale]);
    const [status, setStatus] = useState(null);
    const [statusLoading, setStatusLoading] = useState(true);
    const [enrollment, setEnrollment] = useState(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [backupCodes, setBackupCodes] = useState(null);
    const [disablePassword, setDisablePassword] = useState('');
    const [disableMode, setDisableMode] = useState(false);

    const loadStatus = useCallback(async () => {
        setStatusLoading(true);
        try {
            const res = await api.get('/auth/2fa/status');
            setStatus(res?.data?.obj || { enabled: false });
        } catch (err) {
            toast.error(getErrorMessage(err) || copy.generic);
            setStatus({ enabled: false });
        } finally {
            setStatusLoading(false);
        }
    }, [copy.generic]);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    const startSetup = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await api.post('/auth/2fa/setup');
            setEnrollment(res?.data?.obj || null);
            setCode('');
        } catch (err) {
            toast.error(getErrorMessage(err) || copy.generic);
        } finally { setBusy(false); }
    };

    const cancelSetup = () => {
        setEnrollment(null);
        setCode('');
    };

    const confirmEnable = async () => {
        if (busy || !enrollment) return;
        const trimmed = String(code || '').replace(/\s+/g, '');
        if (!/^\d{6}$/.test(trimmed)) {
            toast.error(copy.invalidCode);
            return;
        }
        setBusy(true);
        try {
            const res = await api.post('/auth/2fa/enable', { secret: enrollment.secret, code: trimmed });
            setBackupCodes(res?.data?.obj?.backupCodes || []);
            setEnrollment(null);
            setCode('');
            await loadStatus();
        } catch (err) {
            toast.error(getErrorMessage(err) || copy.invalidCode);
        } finally { setBusy(false); }
    };

    const confirmDisable = async () => {
        if (busy || !disablePassword) return;
        setBusy(true);
        try {
            await api.post('/auth/2fa/disable', { password: disablePassword });
            setDisablePassword('');
            setDisableMode(false);
            await loadStatus();
            toast.success(copy.disabledOk);
        } catch (err) {
            toast.error(getErrorMessage(err) || copy.generic);
        } finally { setBusy(false); }
    };

    const copyText = async (text, msg) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(msg);
        } catch {
            toast.error(copy.generic);
        }
    };

    const enabled = status?.enabled === true;

    return (
        <div className="card account-twofactor-card">
            <div className="account-twofactor-head">
                <div className="account-twofactor-copy">
                    <h3 className="account-twofactor-title">
                        <HiOutlineShieldCheck /> {copy.title}
                    </h3>
                    <p className="account-twofactor-subtitle">{copy.subtitle}</p>
                </div>
                <span className={`badge ${enabled ? 'badge-success' : 'badge-neutral'}`}>
                    {statusLoading ? '...' : (enabled ? copy.statusEnabled : copy.statusDisabled)}
                </span>
            </div>

            {enabled && !disableMode ? (
                <div className="account-twofactor-section">
                    <div className="account-twofactor-meta">
                        {copy.enabledAt(status?.enabledAt || '')}
                        {' · '}
                        {copy.backupRemaining(Number(status?.backupCodesRemaining || 0))}
                    </div>
                    <div className="account-twofactor-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDisableMode(true)}>
                            <HiOutlineLockClosed /> {copy.disable}
                        </button>
                    </div>
                </div>
            ) : null}

            {enabled && disableMode ? (
                <div className="account-twofactor-section">
                    <div className="account-twofactor-warn">{copy.disableConfirm}</div>
                    <div className="form-group mb-0">
                        <input
                            type="password"
                            className="form-input"
                            placeholder={copy.currentPassword}
                            value={disablePassword}
                            onChange={(e) => setDisablePassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    </div>
                    <div className="account-twofactor-actions">
                        <button type="button" className="btn btn-danger btn-sm" onClick={confirmDisable} disabled={busy || !disablePassword}>
                            {copy.disable}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDisableMode(false); setDisablePassword(''); }}>
                            {copy.cancel}
                        </button>
                    </div>
                </div>
            ) : null}

            {!enabled && !enrollment ? (
                <div className="account-twofactor-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={startSetup} disabled={busy}>
                        <HiOutlineKey /> {copy.enable}
                    </button>
                </div>
            ) : null}

            {enrollment ? (
                <div className="account-twofactor-section account-twofactor-enroll">
                    <div className="account-twofactor-meta">{copy.setupStarted}</div>
                    <div className="account-twofactor-qr">
                        <QRCodeSVG value={enrollment.otpauth} size={160} aria-label={copy.qrAlt} />
                    </div>
                    <div className="account-twofactor-secret">
                        <span className="account-twofactor-secret-label">{copy.secret}:</span>
                        <code className="account-twofactor-secret-value">{enrollment.secret}</code>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => copyText(enrollment.secret, copy.secretCopied)}
                        >
                            <HiOutlineClipboard /> {locale === 'en-US' ? 'Copy' : '复制'}
                        </button>
                    </div>
                    <div className="form-group mb-0">
                        <label className="form-label">{copy.verifyCode}</label>
                        <input
                            className="form-input cell-mono account-twofactor-code-input"
                            inputMode="numeric"
                            maxLength={6}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                        />
                    </div>
                    <div className="account-twofactor-actions">
                        <button type="button" className="btn btn-primary btn-sm" onClick={confirmEnable} disabled={busy || code.length !== 6}>
                            {copy.verify}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={cancelSetup}>
                            {copy.cancel}
                        </button>
                    </div>
                </div>
            ) : null}

            {backupCodes && backupCodes.length > 0 ? (
                <div className="account-twofactor-backup">
                    <div className="account-twofactor-backup-title">{copy.backupTitle}</div>
                    <div className="account-twofactor-backup-hint">{copy.backupHint}</div>
                    <div className="account-twofactor-backup-grid">
                        {backupCodes.map((c) => (<span key={c}>{c}</span>))}
                    </div>
                    <div className="account-twofactor-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyText(backupCodes.join('\n'), copy.backupCopied)}>
                            <HiOutlineClipboard /> {locale === 'en-US' ? 'Copy' : '复制'}
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setBackupCodes(null)}>
                            {copy.done}
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
