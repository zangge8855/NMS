import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import {
    HiOutlineLockClosed,
    HiOutlineUser,
    HiOutlineEnvelope,
    HiOutlineArrowPath,
    HiOutlineShieldCheck,
    HiOutlineSun,
    HiOutlineMoon,
    HiOutlineComputerDesktop,
    HiOutlineChartBarSquare,
    HiOutlineLink,
    HiOutlineServerStack,
} from 'react-icons/hi2';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy.js';
import { buildSiteAssetPath } from '../../utils/sitePath.js';

const MODE_LOGIN = 'login';
const MODE_REGISTER = 'register';
const MODE_VERIFY = 'verify';
const MODE_FORGOT = 'forgot';
const SELF_SERVICE_PASSWORD_RESET_ENABLED = true;

export default function Login() {
    const logoSrc = buildSiteAssetPath('/nms-logo.png');
    const [mode, setMode] = useState(MODE_LOGIN);
    const { mode: themeMode, cycleTheme } = useTheme();
    const { t, toggleLocale, locale } = useI18n();

    const themeIcons = { dark: HiOutlineMoon, light: HiOutlineSun, auto: HiOutlineComputerDesktop };
    const ThemeIcon = themeIcons[themeMode] || HiOutlineMoon;
    const passwordPolicyHint = getPasswordPolicyHint(locale);
    const copy = locale === 'en-US'
        ? {
            loginVerifyRequired: 'Finish email verification first',
            loginFailed: 'Sign-in failed',
            networkFailed: 'Connection failed. Check the network and try again.',
            registerSuccessPending: 'Registration complete. You can sign in now.',
            registerSuccessVerify: 'Registration complete. Check your email for the verification code.',
            registerFailed: 'Registration failed',
            verifySuccess: 'Verification complete. Please sign in.',
            verifyFinished: 'Email verification complete. You can sign in now.',
            verifyFailed: 'Verification failed',
            resendDone: 'The verification code has been sent again',
            sendFailed: 'Send failed',
        }
        : {
            loginVerifyRequired: '请先完成邮箱验证',
            loginFailed: '登录失败',
            networkFailed: '连接失败，请检查网络',
            registerSuccessPending: '注册成功！现在可以登录',
            registerSuccessVerify: '注册成功！请查收邮箱验证码',
            registerFailed: '注册失败',
            verifySuccess: '验证成功！请登录',
            verifyFinished: '邮箱验证完成，现在可以登录了',
            verifyFailed: '验证失败',
            resendDone: '验证码已重新发送',
            sendFailed: '发送失败',
        };
    const themeToggleTitle = themeMode === 'dark'
        ? t('shell.themeLight')
        : themeMode === 'light'
            ? t('shell.themeAuto')
            : t('shell.themeDark');
    const showcaseCopy = locale === 'en-US'
        ? {
            eyebrow: 'Unified network operations',
            title: 'A cleaner entry for node operations and user self-service.',
            summary: 'The admin console keeps dense control where it matters, while the account portal stays simple enough to copy, scan, and move on.',
            accessOpen: 'Registration Open',
            accessInviteOnly: 'Invite Only',
            accessClosed: 'Registration Closed',
            passwordResetReady: 'Password Reset Ready',
            dualThemeReady: 'Dark & Light Themes',
            cards: [
                {
                    icon: HiOutlineServerStack,
                    title: 'Node-first operations',
                    text: 'Servers, inbounds, tools, and audit stay in a clearer action order for daily operations.',
                },
                {
                    icon: HiOutlineLink,
                    title: 'Self-service subscriptions',
                    text: 'Users can copy, scan, and update account access from the same portal flow.',
                },
                {
                    icon: HiOutlineChartBarSquare,
                    title: 'Responsive control room',
                    text: 'The same shell now adapts cleanly from mobile drawers to wide desktop workspaces.',
                },
            ],
        }
        : {
            eyebrow: '统一网络运维入口',
            title: '把节点操作和用户自助入口放进更清晰的一个界面。',
            summary: '管理端保留高密度控制感，用户端则收敛成复制、扫码、改密这些最常用动作，桌面和手机都更稳定。',
            accessOpen: '开放注册',
            accessInviteOnly: '邀请注册',
            accessClosed: '暂停注册',
            passwordResetReady: '支持自助重置密码',
            dualThemeReady: '深浅双主题已适配',
            cards: [
                {
                    icon: HiOutlineServerStack,
                    title: '按操作流组织节点工作区',
                    text: '服务器、入站、工具和审计按日常使用顺序展开，减少来回切换。',
                },
                {
                    icon: HiOutlineLink,
                    title: '订阅和账号自助更直接',
                    text: '用户在同一入口完成复制地址、扫码导入和账号密码维护。',
                },
                {
                    icon: HiOutlineChartBarSquare,
                    title: '桌面与移动端统一控制感',
                    text: '同一套壳层在手机抽屉和宽屏工作台之间平滑切换，不再靠零散补丁维持。',
                },
            ],
        };

    // Login fields
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    // Register fields
    const [regUsername, setRegUsername] = useState('');
    const [regEmail, setRegEmail] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regConfirm, setRegConfirm] = useState('');
    const [inviteCode, setInviteCode] = useState('');

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
    const [registrationStatus, setRegistrationStatus] = useState({
        enabled: true,
        inviteOnlyEnabled: false,
        loading: true,
    });

    const {
        login,
        register,
        verifyEmail: verifyEmailFn,
        resendCode,
        requestPasswordReset,
        resetPassword: resetPasswordFn,
    } = useAuth();
    const navigate = useNavigate();
    const registrationEnabled = registrationStatus.enabled !== false;
    const inviteOnlyEnabled = registrationStatus.inviteOnlyEnabled === true;
    const registrationStateLabel = registrationEnabled
        ? (inviteOnlyEnabled ? showcaseCopy.accessInviteOnly : showcaseCopy.accessOpen)
        : showcaseCopy.accessClosed;

    useEffect(() => {
        let active = true;

        const fetchRegistrationStatus = async () => {
            try {
                const res = await api.get('/auth/registration-status');
                if (!active) return;
                const payload = res.data?.obj || {};
                const next = {
                    enabled: payload.enabled !== false,
                    inviteOnlyEnabled: payload.inviteOnlyEnabled === true,
                    loading: false,
                };
                setRegistrationStatus(next);
                if (!next.enabled) {
                    setMode((prev) => (prev === MODE_REGISTER ? MODE_LOGIN : prev));
                }
            } catch {
                if (!active) return;
                setRegistrationStatus((prev) => ({
                    ...prev,
                    loading: false,
                }));
            }
        };

        fetchRegistrationStatus();
        return () => {
            active = false;
        };
    }, []);

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
                setSuccess(copy.loginVerifyRequired);
            } else {
                setError(result.msg || copy.loginFailed);
            }
        } catch {
            setError(copy.networkFailed);
        }
        setLoading(false);
    };

    // ── Register ────────────────────────────────────────────
    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (regPassword !== regConfirm) {
            setError(t('pages.login.passwordMismatch'));
            return;
        }

        const registerPasswordError = getPasswordPolicyError(regPassword, locale);
        if (registerPasswordError) {
            setError(registerPasswordError);
            return;
        }

        setLoading(true);
        try {
            const result = await register(regUsername, regEmail, regPassword, inviteCode);
            if (result.success) {
                setRegUsername('');
                setRegEmail('');
                setRegPassword('');
                setRegConfirm('');
                setInviteCode('');

                if (result.requireEmailVerification === false) {
                    setVerifyEmailAddr('');
                    setVerifyCode('');
                    setMode(MODE_LOGIN);
                    setSuccess(result.msg || copy.registerSuccessPending);
                } else {
                    setVerifyEmailAddr(result.email || regEmail);
                    setMode(MODE_VERIFY);
                    setSuccess(result.msg || copy.registerSuccessVerify);
                }
                setError('');
            } else {
                setError(result.msg || copy.registerFailed);
            }
        } catch {
            setError(copy.networkFailed);
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
                setSuccess(copy.verifySuccess);
                setTimeout(() => {
                    setMode(MODE_LOGIN);
                    setSuccess(copy.verifyFinished);
                    setError('');
                }, 1500);
            } else {
                setError(result.msg || copy.verifyFailed);
            }
        } catch {
            setError(copy.networkFailed);
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
                setSuccess(copy.resendDone);
                startCooldown(setResendCooldown, 60);
            } else {
                setError(result.msg || copy.sendFailed);
            }
        } catch {
            setError(copy.sendFailed);
        }
    };

    // ── Forgot Password ───────────────────────────────────
    const handleSendResetCode = async () => {
        if (!SELF_SERVICE_PASSWORD_RESET_ENABLED) return;
        if (resetCooldown > 0) return;
        setError('');
        setSuccess('');
        if (!resetEmail.trim()) {
            setError(t('pages.login.forgotEmailRequired'));
            return;
        }
        setLoading(true);
        try {
            const result = await requestPasswordReset(resetEmail.trim());
            if (result.success) {
                setSuccess(result.msg || t('pages.login.forgotCodeSent'));
                startCooldown(setResetCooldown, 60);
            } else {
                setError(result.msg || t('comp.common.operationFailed'));
            }
        } catch {
            setError(t('pages.login.forgotConnectionFailed'));
        }
        setLoading(false);
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (!SELF_SERVICE_PASSWORD_RESET_ENABLED) return;
        setError('');
        setSuccess('');

        if (!resetEmail.trim() || !resetCode || !resetPassword || !resetConfirm) {
            setError(t('pages.login.forgotFieldsRequired'));
            return;
        }
        if (resetCode.length !== 6) {
            setError(t('pages.login.forgotCodeInvalid'));
            return;
        }

        const resetPasswordError = getPasswordPolicyError(resetPassword, locale);
        if (resetPasswordError) {
            setError(resetPasswordError);
            return;
        }
        if (resetPassword !== resetConfirm) {
            setError(t('pages.login.passwordMismatch'));
            return;
        }

        setLoading(true);
        try {
            const result = await resetPasswordFn(resetEmail.trim(), resetCode.trim(), resetPassword);
            if (result.success) {
                setSuccess(result.msg || t('pages.login.forgotPasswordResetDone'));
                setTimeout(() => {
                    switchMode(MODE_LOGIN);
                    setSuccess(t('pages.login.forgotPasswordResetDone'));
                }, 1200);
            } else {
                setError(result.msg || t('comp.common.operationFailed'));
            }
        } catch {
            setError(t('pages.login.forgotConnectionFailed'));
        }
        setLoading(false);
    };

    const switchMode = (newMode) => {
        if (newMode === MODE_REGISTER && !registrationEnabled) {
            setMode(MODE_LOGIN);
        } else {
            setMode(newMode === MODE_FORGOT && !SELF_SERVICE_PASSWORD_RESET_ENABLED ? MODE_LOGIN : newMode);
        }
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
                            <img src={logoSrc} alt="NMS" className="login-brand-mark" />
                            <div className="login-brand-copy">
                                <span className="login-brand-name">NMS</span>
                                {t('shell.brandSubtitle') ? (
                                    <span className="login-brand-subtitle">{t('shell.brandSubtitle')}</span>
                                ) : null}
                            </div>
                        </div>
                        <div className="login-form-heading">
                            <h1>{modeTitle}</h1>
                        </div>

                        {registrationEnabled && (mode === MODE_LOGIN || mode === MODE_REGISTER) && (
                            <div className="auth-tabs" role="tablist" aria-label={t('pages.login.title')}>
                                <button
                                    type="button"
                                    className={`auth-tab ${mode === MODE_LOGIN ? 'active' : ''}`}
                                    role="tab"
                                    aria-selected={mode === MODE_LOGIN}
                                    onClick={() => switchMode(MODE_LOGIN)}
                                >
                                    {t('pages.login.title')}
                                </button>
                                <button
                                    type="button"
                                    className={`auth-tab ${mode === MODE_REGISTER ? 'active' : ''}`}
                                    role="tab"
                                    aria-selected={mode === MODE_REGISTER}
                                    onClick={() => switchMode(MODE_REGISTER)}
                                >
                                    {t('pages.login.registerTitle')}
                                </button>
                            </div>
                        )}

                        {success && <div className="success-alert">{success}</div>}
                        {error && <div className="error-alert">{error}</div>}
                        {!registrationStatus.loading && !registrationEnabled && mode === MODE_LOGIN && (
                            <div className="text-xs text-muted mb-3">{t('pages.login.registrationClosed')}</div>
                        )}

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
                                {SELF_SERVICE_PASSWORD_RESET_ENABLED && (
                                    <div className="verify-actions">
                                        <button
                                            type="button"
                                            className="btn-link"
                                            onClick={() => switchMode(MODE_FORGOT)}
                                        >
                                            {t('pages.login.toForgot')}
                                        </button>
                                    </div>
                                )}
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
                                        <p className="field-error">{t('pages.login.passwordMismatch')}</p>
                                    )}
                                </div>
                                {inviteOnlyEnabled && (
                                    <div className="form-group">
                                        <label className="form-label">{t('pages.login.inviteCode')}</label>
                                        <div className="input-icon-wrapper">
                                            <HiOutlineShieldCheck className="input-icon" />
                                            <input
                                                type="text"
                                                className="form-input input-with-icon"
                                                placeholder={t('pages.login.inviteCodePlaceholder')}
                                                value={inviteCode}
                                                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <p className="text-muted text-sm mt-1">{t('pages.login.inviteOnlyHint')}</p>
                                    </div>
                                )}
                                <button
                                    type="submit"
                                    className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                    disabled={loading || !regUsername || !regEmail || !regPassword || !regConfirm || regPassword !== regConfirm || (inviteOnlyEnabled && !inviteCode.trim())}
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
                                    <p className="text-muted text-xs">
                                        {t('pages.login.forgotPrivacyHint')}
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
                                        <p className="field-error">{t('pages.login.passwordMismatch')}</p>
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
                <aside className="login-showcase" aria-label={showcaseCopy.eyebrow}>
                    <div className="login-showcase-hero card">
                        <div className="login-showcase-eyebrow">{showcaseCopy.eyebrow}</div>
                        <h2 className="login-showcase-title">{showcaseCopy.title}</h2>
                        <p className="login-showcase-summary">{showcaseCopy.summary}</p>
                        <div className="login-showcase-badges">
                            <span className="badge badge-info">{registrationStateLabel}</span>
                            {SELF_SERVICE_PASSWORD_RESET_ENABLED && (
                                <span className="badge badge-success">{showcaseCopy.passwordResetReady}</span>
                            )}
                            <span className="badge badge-neutral">{showcaseCopy.dualThemeReady}</span>
                        </div>
                    </div>
                    <div className="login-showcase-grid">
                        {showcaseCopy.cards.map((item) => {
                            const Icon = item.icon;
                            return (
                                <div key={item.title} className="login-showcase-card card">
                                    <span className="login-showcase-card-icon" aria-hidden="true">
                                        <Icon />
                                    </span>
                                    <div className="login-showcase-card-title">{item.title}</div>
                                    <p className="login-showcase-card-text">{item.text}</p>
                                </div>
                            );
                        })}
                    </div>
                </aside>
            </div>
        </div>
    );
}
