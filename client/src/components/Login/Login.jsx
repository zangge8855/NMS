import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { HiOutlineLockClosed, HiOutlineUser, HiOutlineEnvelope, HiOutlineArrowPath, HiOutlineShieldCheck, HiOutlineSun, HiOutlineMoon, HiOutlineComputerDesktop } from 'react-icons/hi2';
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from '../../utils/passwordPolicy.js';

const MODE_LOGIN = 'login';
const MODE_REGISTER = 'register';
const MODE_VERIFY = 'verify';
const MODE_FORGOT = 'forgot';
const SELF_SERVICE_PASSWORD_RESET_ENABLED = false;

export default function Login() {
    const [mode, setMode] = useState(MODE_LOGIN);
    const { mode: themeMode, cycleTheme } = useTheme();
    const { t, toggleLocale, locale } = useI18n();

    const themeIcons = { dark: HiOutlineMoon, light: HiOutlineSun, auto: HiOutlineComputerDesktop };
    const ThemeIcon = themeIcons[themeMode] || HiOutlineMoon;
    const passwordPolicyHint = locale === 'en-US'
        ? 'Use at least 8 characters and include 3 character types.'
        : PASSWORD_POLICY_HINT;
    const themeToggleTitle = themeMode === 'dark'
        ? t('shell.themeLight')
        : themeMode === 'light'
            ? t('shell.themeAuto')
            : t('shell.themeDark');

    // Login fields
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    // Register fields
    const [regUsername, setRegUsername] = useState('');
    const [regEmail, setRegEmail] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regConfirm, setRegConfirm] = useState('');

    // Verify fields
    const [verifyEmail, setVerifyEmailAddr] = useState('');
    const [verifyCode, setVerifyCode] = useState('');
    const [resetEmail, setResetEmail] = useState('');
    const [resetCode, setResetCode] = useState('');
    const [resetPassword, setResetPassword] = useState('');
    const [resetConfirm, setResetConfirm] = useState('');

    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [resetCooldown, setResetCooldown] = useState(0);

    const {
        login,
        register,
        verifyEmail: verifyEmailFn,
        resendCode,
        requestPasswordReset,
        resetPassword: resetPasswordFn,
    } = useAuth();
    const navigate = useNavigate();

    const startCooldown = (setter, seconds = 60) => {
        setter(seconds);
        const timer = setInterval(() => {
            setter((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    // ── Login ───────────────────────────────────────────────
    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            const result = await login(username, password);
            if (result.success) {
                navigate('/', { replace: true });
            } else if (result.needVerify) {
                setVerifyEmailAddr(result.email || '');
                setMode(MODE_VERIFY);
                setError('');
                setSuccess('请先完成邮箱验证');
            } else {
                setError(result.msg || '登录失败');
            }
        } catch {
            setError('连接失败，请检查网络');
        }
        setLoading(false);
    };

    // ── Register ────────────────────────────────────────────
    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (regPassword !== regConfirm) {
            setError('两次输入的密码不一致');
            return;
        }

        const registerPasswordError = getPasswordPolicyError(regPassword);
        if (registerPasswordError) {
            setError(registerPasswordError);
            return;
        }

        setLoading(true);
        try {
            const result = await register(regUsername, regEmail, regPassword);
            if (result.success) {
                setVerifyEmailAddr(result.email || regEmail);
                setMode(MODE_VERIFY);
                setSuccess('注册成功！请查收邮箱验证码');
                setError('');
            } else {
                setError(result.msg || '注册失败');
            }
        } catch {
            setError('连接失败，请检查网络');
        }
        setLoading(false);
    };

    // ── Verify Email ────────────────────────────────────────
    const handleVerify = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            const result = await verifyEmailFn(verifyEmail, verifyCode);
            if (result.success) {
                setSuccess('验证成功！请登录');
                setTimeout(() => {
                    setMode(MODE_LOGIN);
                    setSuccess('邮箱验证完成，现在可以登录了');
                    setError('');
                }, 1500);
            } else {
                setError(result.msg || '验证失败');
            }
        } catch {
            setError('连接失败');
        }
        setLoading(false);
    };

    // ── Resend Code ─────────────────────────────────────────
    const handleResend = async () => {
        if (resendCooldown > 0) return;
        setError('');
        setSuccess('');
        try {
            const result = await resendCode(verifyEmail);
            if (result.success) {
                setSuccess('验证码已重新发送');
                startCooldown(setResendCooldown, 60);
            } else {
                setError(result.msg || '发送失败');
            }
        } catch {
            setError('发送失败');
        }
    };

    // ── Forgot Password ───────────────────────────────────
    const handleSendResetCode = async () => {
        if (!SELF_SERVICE_PASSWORD_RESET_ENABLED) return;
        if (resetCooldown > 0) return;
        setError('');
        setSuccess('');
        if (!resetEmail.trim()) {
            setError('请输入注册邮箱');
            return;
        }
        setLoading(true);
        try {
            const result = await requestPasswordReset(resetEmail.trim());
            if (result.success) {
                setSuccess(result.msg || '验证码已发送，请查收邮箱');
                startCooldown(setResetCooldown, 60);
            } else {
                setError(result.msg || '发送失败');
            }
        } catch {
            setError('连接失败');
        }
        setLoading(false);
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (!SELF_SERVICE_PASSWORD_RESET_ENABLED) return;
        setError('');
        setSuccess('');

        if (!resetEmail.trim() || !resetCode || !resetPassword || !resetConfirm) {
            setError('请完整填写邮箱、验证码和新密码');
            return;
        }
        if (resetCode.length !== 6) {
            setError('验证码应为 6 位数字');
            return;
        }

        const resetPasswordError = getPasswordPolicyError(resetPassword);
        if (resetPasswordError) {
            setError(resetPasswordError);
            return;
        }
        if (resetPassword !== resetConfirm) {
            setError('两次输入的密码不一致');
            return;
        }

        setLoading(true);
        try {
            const result = await resetPasswordFn(resetEmail.trim(), resetCode.trim(), resetPassword);
            if (result.success) {
                setSuccess(result.msg || '密码重置成功，请登录');
                setTimeout(() => {
                    switchMode(MODE_LOGIN);
                    setSuccess('密码已重置，请使用新密码登录');
                }, 1200);
            } else {
                setError(result.msg || '重置失败');
            }
        } catch {
            setError('连接失败');
        }
        setLoading(false);
    };

    const switchMode = (newMode) => {
        setMode(newMode === MODE_FORGOT && !SELF_SERVICE_PASSWORD_RESET_ENABLED ? MODE_LOGIN : newMode);
        setError('');
        setSuccess('');
    };

    const modeTitle = mode === MODE_LOGIN
        ? t('pages.login.title')
        : mode === MODE_REGISTER
            ? t('pages.login.registerTitle')
            : mode === MODE_VERIFY
                ? t('pages.login.verifyTitle')
                : SELF_SERVICE_PASSWORD_RESET_ENABLED
                    ? t('pages.login.forgotTitle')
                    : t('pages.login.title');

    // ── Render ───────────────────────────────────────────────
    return (
        <div className="login-page">
            <div className="login-bg-glow one" />
            <div className="login-bg-glow two" />
            <div className="login-bg-glow three" />

            <div className="login-top-actions">
                <button
                    type="button"
                    className="login-locale-toggle theme-toggle-btn language-toggle-btn"
                    onClick={toggleLocale}
                    title={t('shell.switchLanguage')}
                    aria-label={t('shell.switchLanguage')}
                >
                    <span className="language-toggle-label">{t('shell.langLabel')}</span>
                </button>
                <button
                    type="button"
                    className="login-theme-toggle theme-toggle-btn"
                    onClick={cycleTheme}
                    title={themeToggleTitle}
                    aria-label={themeToggleTitle}
                >
                    <ThemeIcon />
                </button>
            </div>

            <div className="login-shell">
                <div className="login-card-column">
                    <div className="login-card">
                        <div className="login-card-border" />
                        <div className="login-brand-row">
                            <img src="/nms-logo.png" alt="NMS" className="login-brand-mark" />
                            <div className="login-brand-copy">
                                <span className="login-brand-name">NMS</span>
                                <span className="login-brand-subtitle">{t('shell.brandSubtitle')}</span>
                            </div>
                        </div>
                        <div className="login-form-heading">
                            <h1>{modeTitle}</h1>
                        </div>

                        {(mode === MODE_LOGIN || mode === MODE_REGISTER) && (
                            <div className="auth-tabs">
                                <button
                                    type="button"
                                    className={`auth-tab ${mode === MODE_LOGIN ? 'active' : ''}`}
                                    onClick={() => switchMode(MODE_LOGIN)}
                                >
                                    {t('pages.login.title')}
                                </button>
                                <button
                                    type="button"
                                    className={`auth-tab ${mode === MODE_REGISTER ? 'active' : ''}`}
                                    onClick={() => switchMode(MODE_REGISTER)}
                                >
                                    {t('pages.login.registerTitle')}
                                </button>
                            </div>
                        )}

                        {success && <div className="success-alert">{success}</div>}
                        {error && <div className="error-alert">{error}</div>}

                        {mode === MODE_LOGIN && (
                            <form onSubmit={handleLogin} className="auth-form">
                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.username')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineUser className="input-icon" />
                                        <input
                                            type="text"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.usernamePlaceholder')}
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            autoFocus
                                            autoComplete="username"
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.password')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineLockClosed className="input-icon" />
                                        <input
                                            type="password"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.passwordPlaceholder')}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            autoComplete="current-password"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                    disabled={loading || !password}
                                >
                                    {loading ? <span className="spinner" /> : t('pages.login.loginButton')}
                                </button>
                            </form>
                        )}

                        {mode === MODE_REGISTER && (
                            <form onSubmit={handleRegister} className="auth-form">
                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.username')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineUser className="input-icon" />
                                        <input
                                            type="text"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.registerUsernamePlaceholder')}
                                            value={regUsername}
                                            onChange={(e) => setRegUsername(e.target.value)}
                                            autoFocus
                                            autoComplete="username"
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.email')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineEnvelope className="input-icon" />
                                        <input
                                            type="email"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.registerEmailPlaceholder')}
                                            value={regEmail}
                                            onChange={(e) => setRegEmail(e.target.value)}
                                            autoComplete="email"
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.password')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineLockClosed className="input-icon" />
                                        <input
                                            type="password"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.registerPasswordPlaceholder')}
                                            value={regPassword}
                                            onChange={(e) => setRegPassword(e.target.value)}
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <p className="text-muted text-sm mt-1">{passwordPolicyHint}</p>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.confirmPassword')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineLockClosed className="input-icon" />
                                        <input
                                            type="password"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.confirmPasswordPlaceholder')}
                                            value={regConfirm}
                                            onChange={(e) => setRegConfirm(e.target.value)}
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    {regConfirm && regPassword !== regConfirm && (
                                        <p className="field-error">密码不一致</p>
                                    )}
                                </div>
                                <button
                                    type="submit"
                                    className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                    disabled={loading || !regUsername || !regEmail || !regPassword || !regConfirm || regPassword !== regConfirm}
                                >
                                    {loading ? <span className="spinner" /> : t('pages.login.registerButton')}
                                </button>
                            </form>
                        )}

                        {mode === MODE_VERIFY && (
                            <form onSubmit={handleVerify} className="auth-form">
                                <div className="verify-header">
                                    <HiOutlineShieldCheck className="verify-icon" />
                                    <h2>{t('pages.login.verifyTitle')}</h2>
                                    <p className="text-muted text-sm">
                                        {t('pages.login.verifySentTo', { email: verifyEmail })}
                                    </p>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.verifyCode')}</label>
                                    <input
                                        type="text"
                                        className="form-input verify-code-input"
                                        placeholder={t('pages.login.verifyCodePlaceholder')}
                                        value={verifyCode}
                                        onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        maxLength={6}
                                        autoFocus
                                        autoComplete="one-time-code"
                                        inputMode="numeric"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                    disabled={loading || verifyCode.length !== 6}
                                >
                                    {loading ? <span className="spinner" /> : t('pages.login.verifyButton')}
                                </button>
                                <div className="verify-actions">
                                    <button
                                        type="button"
                                        className="btn-link"
                                        onClick={handleResend}
                                        disabled={resendCooldown > 0}
                                    >
                                        <HiOutlineArrowPath className={resendCooldown > 0 ? '' : 'spin-on-hover'} />
                                        {resendCooldown > 0 ? `${resendCooldown}s` : t('pages.login.resendCode')}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-link"
                                        onClick={() => switchMode(MODE_LOGIN)}
                                    >
                                        {t('pages.login.toLogin')}
                                    </button>
                                </div>
                            </form>
                        )}

                        {SELF_SERVICE_PASSWORD_RESET_ENABLED && mode === MODE_FORGOT && (
                            <form onSubmit={handleResetPassword} className="auth-form">
                                <div className="verify-header">
                                    <HiOutlineShieldCheck className="verify-icon" />
                                    <h2>{t('pages.login.forgotTitle')}</h2>
                                    <p className="text-muted text-sm">
                                        {t('pages.login.forgotSubtitle')}
                                    </p>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.email')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineEnvelope className="input-icon" />
                                        <input
                                            type="email"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.resetEmailPlaceholder')}
                                            value={resetEmail}
                                            onChange={(e) => setResetEmail(e.target.value)}
                                            autoComplete="email"
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.verifyCode')}</label>
                                    <div className="verify-code-row">
                                        <input
                                            type="text"
                                            className="form-input verify-code-input"
                                            placeholder={t('pages.login.resetCodePlaceholder')}
                                            value={resetCode}
                                            onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            maxLength={6}
                                            inputMode="numeric"
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm verify-code-send-btn"
                                            onClick={handleSendResetCode}
                                            disabled={loading || !resetEmail || resetCooldown > 0}
                                        >
                                            <HiOutlineArrowPath className={resetCooldown > 0 ? '' : 'spin-on-hover'} />
                                            {resetCooldown > 0 ? `${resetCooldown}s` : t('pages.login.sendCode')}
                                        </button>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.newPassword')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineLockClosed className="input-icon" />
                                        <input
                                            type="password"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.resetPasswordPlaceholder')}
                                            value={resetPassword}
                                            onChange={(e) => setResetPassword(e.target.value)}
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <p className="text-muted text-sm mt-1">{passwordPolicyHint}</p>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">{t('pages.login.confirmPassword')}</label>
                                    <div className="input-icon-wrapper">
                                        <HiOutlineLockClosed className="input-icon" />
                                        <input
                                            type="password"
                                            className="form-input input-with-icon"
                                            placeholder={t('pages.login.resetConfirmPlaceholder')}
                                            value={resetConfirm}
                                            onChange={(e) => setResetConfirm(e.target.value)}
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    {resetConfirm && resetPassword !== resetConfirm && (
                                        <p className="field-error">密码不一致</p>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                    disabled={loading || !resetEmail || resetCode.length !== 6 || !resetPassword || !resetConfirm || resetPassword !== resetConfirm}
                                >
                                    {loading ? <span className="spinner" /> : t('pages.login.resetButton')}
                                </button>

                                <div className="verify-actions">
                                    <button
                                        type="button"
                                        className="btn-link"
                                        onClick={() => switchMode(MODE_LOGIN)}
                                    >
                                        {t('pages.login.toLogin')}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
