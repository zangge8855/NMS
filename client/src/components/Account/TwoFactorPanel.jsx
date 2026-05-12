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
        <div className="bg-surface-soft border border-stroke-soft rounded-xl p-4 space-y-3 mt-6">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-base font-bold text-primary flex items-center gap-2">
                        <HiOutlineShieldCheck /> {copy.title}
                    </h3>
                    <p className="text-sm text-secondary mt-1">{copy.subtitle}</p>
                </div>
                <span className={`badge ${enabled ? 'badge-success' : 'badge-neutral'} text-xs`}>
                    {statusLoading ? '...' : (enabled ? copy.statusEnabled : copy.statusDisabled)}
                </span>
            </div>

            {enabled && !disableMode ? (
                <div className="space-y-2">
                    <div className="text-xs text-secondary">
                        {copy.enabledAt(status?.enabledAt || '')}
                        {' · '}
                        {copy.backupRemaining(Number(status?.backupCodesRemaining || 0))}
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm rounded-md" onClick={() => setDisableMode(true)}>
                        <HiOutlineLockClosed className="inline-block mr-1" /> {copy.disable}
                    </button>
                </div>
            ) : null}

            {enabled && disableMode ? (
                <div className="space-y-2">
                    <div className="text-sm text-warning">{copy.disableConfirm}</div>
                    <input
                        type="password"
                        className="form-input"
                        placeholder={copy.currentPassword}
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        autoComplete="current-password"
                    />
                    <div className="flex gap-2">
                        <button type="button" className="btn btn-primary btn-sm rounded-md" onClick={confirmDisable} disabled={busy || !disablePassword}>
                            {copy.disable}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm rounded-md" onClick={() => { setDisableMode(false); setDisablePassword(''); }}>
                            {copy.cancel}
                        </button>
                    </div>
                </div>
            ) : null}

            {!enabled && !enrollment ? (
                <button type="button" className="btn btn-primary btn-sm rounded-md" onClick={startSetup} disabled={busy}>
                    <HiOutlineKey className="inline-block mr-1" /> {copy.enable}
                </button>
            ) : null}

            {enrollment ? (
                <div className="space-y-3">
                    <div className="text-sm text-secondary">{copy.setupStarted}</div>
                    <div className="bg-surface p-3 rounded-lg inline-block">
                        <QRCodeSVG value={enrollment.otpauth} size={160} aria-label={copy.qrAlt} />
                    </div>
                    <div className="text-xs">
                        <span className="text-secondary mr-2">{copy.secret}:</span>
                        <code className="font-mono break-all">{enrollment.secret}</code>
                        <button
                            type="button"
                            className="ml-2 text-primary inline-flex items-center gap-1"
                            onClick={() => copyText(enrollment.secret, copy.secretCopied)}
                        >
                            <HiOutlineClipboard /> {locale === 'en-US' ? 'Copy' : '复制'}
                        </button>
                    </div>
                    <div className="form-group mb-0">
                        <label className="form-label">{copy.verifyCode}</label>
                        <input
                            className="form-input font-mono tracking-widest"
                            inputMode="numeric"
                            maxLength={6}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                        />
                    </div>
                    <div className="flex gap-2">
                        <button type="button" className="btn btn-primary btn-sm rounded-md" onClick={confirmEnable} disabled={busy || code.length !== 6}>
                            {copy.verify}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm rounded-md" onClick={cancelSetup}>
                            {copy.cancel}
                        </button>
                    </div>
                </div>
            ) : null}

            {backupCodes && backupCodes.length > 0 ? (
                <div className="mt-3 p-3 border border-warning rounded-md bg-warning-soft">
                    <div className="font-bold text-warning mb-1">{copy.backupTitle}</div>
                    <div className="text-xs text-secondary mb-2">{copy.backupHint}</div>
                    <div className="grid grid-cols-2 gap-1 font-mono text-sm">
                        {backupCodes.map((c) => (<span key={c}>{c}</span>))}
                    </div>
                    <div className="flex gap-2 mt-2">
                        <button type="button" className="btn btn-secondary btn-sm rounded-md" onClick={() => copyText(backupCodes.join('\n'), copy.backupCopied)}>
                            <HiOutlineClipboard className="inline-block mr-1" /> {locale === 'en-US' ? 'Copy' : '复制'}
                        </button>
                        <button type="button" className="btn btn-primary btn-sm rounded-md" onClick={() => setBackupCodes(null)}>
                            {copy.done}
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
