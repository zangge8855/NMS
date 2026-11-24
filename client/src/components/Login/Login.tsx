import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import api, { setStoredToken } from '../../api/client';
import { clearAppSessionState } from '../../utils/appBootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
    HiOutlineLockClosed,
    HiOutlineUser,
    HiOutlineEnvelope,
    HiOutlineArrowPath,
    HiOutlineShieldCheck,
    HiOutlineKey,
    HiOutlineFingerPrint,
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineSun,
    HiOutlineMoon,
    HiOutlineComputerDesktop,
} from 'react-icons/hi2';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy';
import { handleRovingTabKeyDown } from '../../utils/rovingTabs';
import { buildSiteAssetPath } from '../../utils/sitePath';
import PasswordStrengthMeter from '../UI/PasswordStrengthMeter';

const MODE_LOGIN = 'login';
const MODE_REGISTER = 'register';
const MODE_VERIFY = 'verify';
const MODE_FORGOT = 'forgot';
const MODE_TWO_FACTOR = 'two_factor';
const AUTH_TABS = [
    { id: MODE_LOGIN },
    { id: MODE_REGISTER },
] as const;

type AuthMode = typeof MODE_LOGIN | typeof MODE_REGISTER | typeof MODE_VERIFY | typeof MODE_FORGOT | typeof MODE_TWO_FACTOR;

export default function Login() {
    const logoSrc = buildSiteAssetPath('/nms-logo.png');
    const [mode, setMode] = useState<AuthMode>(MODE_LOGIN);
    const { t, toggleLocale, locale } = useI18n();
    const { mode: themeMode, resolvedTheme, cycleTheme } = useTheme();

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
            twoFactorRequired: 'Please enter your 2FA authenticator code',
            twoFactorFailed: 'Two-factor verification failed',
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
            twoFactorRequired: '请输入 2FA 动态验证码',
            twoFactorFailed: '2FA 验证失败',
        };
    // Login fields
    const [loginIdentifier, setLoginIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);

    // 2FA fields
    const [twoFactorChallengeToken, setTwoFactorChallengeToken] = useState('');
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [twoFactorBackupCode, setTwoFactorBackupCode] = useState('');
    const [twoFactorUseBackup, setTwoFactorUseBackup] = useState(false);

    // Register fields
    const [regUsername, setRegUsername] = useState('');
    const [regEmail, setRegEmail] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regConfirm, setRegConfirm] = useState('');
    const [showRegPassword, setShowRegPassword] = useState(false);
    const [showRegConfirm, setShowRegConfirm] = useState(false);
    const [inviteCode, setInviteCode] = useState('');

    // Verify fields
    const [verifyEmail, setVerifyEmailAddr] = useState('');
    const [verifyCode, setVerifyCode] = useState('');
    const [resetEmail, setResetEmail] = useState('');
    const [resetCode, setResetCode] = useState('');
    const [resetPassword, setResetPassword] = useState('');
    const [resetConfirm, setResetConfirm] = useState('');
    const [showResetPassword, setShowResetPassword] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [resetCooldown, setResetCooldown] = useState(0);
    const [registrationStatus, setRegistrationStatus] = useState({
        enabled: true,
        inviteOnlyEnabled: false,
        passwordResetEnabled: true,
        loading: true,
    });
    const intervalTimersRef = useRef(new Set<any>());
    const timeoutTimersRef = useRef(new Set<any>());

    const {
        login,
        loginTwoFactor,
        register,
        verifyEmail: verifyEmailFn,
        resendCode,
        requestPasswordReset,
        resetPassword: resetPasswordFn,
        refreshAuth,
    } = useAuth();
    const navigate = useNavigate();
    const registrationEnabled = registrationStatus.enabled !== false;
    const inviteOnlyEnabled = registrationStatus.inviteOnlyEnabled === true;
    const passwordResetEnabled = registrationStatus.passwordResetEnabled !== false;

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
                    passwordResetEnabled: payload.passwordResetEnabled !== false,
                    loading: false,
                };
                setRegistrationStatus(next);
                setMode((prev) => {
                    if (!next.enabled && prev === MODE_REGISTER) return MODE_LOGIN;
                    if (!next.passwordResetEnabled && prev === MODE_FORGOT) return MODE_LOGIN;
                    return prev;
                });
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

    useEffect(() => () => {
        intervalTimersRef.current.forEach((timer) => clearInterval(timer));
        timeoutTimersRef.current.forEach((timer) => clearTimeout(timer));
        intervalTimersRef.current.clear();
        timeoutTimersRef.current.clear();
    }, []);

    const startCooldown = (setter: React.Dispatch<React.SetStateAction<number>>, seconds = 60) => {
        setter(seconds);
        const timer = setInterval(() => {
            setter((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    intervalTimersRef.current.delete(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        intervalTimersRef.current.add(timer);
    };

    const scheduleDeferredAction = (callback: () => void, delayMs: number) => {
        const timer = setTimeout(() => {
            timeoutTimersRef.current.delete(timer);
            callback();
        }, delayMs);
        timeoutTimersRef.current.add(timer);
    };

    // ── Login ───────────────────────────────────────────────
    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        const formData = new FormData(e.currentTarget);
        const resolvedIdentifier = (loginIdentifier || String(formData.get('username') || '')).trim();
        const resolvedPassword = password || String(formData.get('password') || '');
        if (!resolvedIdentifier || !resolvedPassword) {
            setError(locale === 'en-US' ? 'Please enter your username/email and password.' : '请输入用户名或邮箱及密码');
            return;
        }
        setLoading(true);
        try {
            const result = await login(resolvedIdentifier, resolvedPassword, { rememberMe });
            if (result.success) {
                navigate('/', { replace: true });
            } else if (result.needTwoFactor) {
                setTwoFactorChallengeToken(result.challengeToken || '');
                setTwoFactorCode('');
                setTwoFactorBackupCode('');
                setTwoFactorUseBackup(false);
                setMode(MODE_TWO_FACTOR);
                setError('');
                setSuccess(result.msg || copy.twoFactorRequired);
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

    // ── Passkey (WebAuthn) ──────────────────────────────────
    const handlePasskeyLogin = async () => {
        if (loading) return;
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            const optRes = await api.post('/auth/passkey/login-options', {
                identifier: loginIdentifier.trim() || undefined,
            });
            if (!optRes.data?.success || !optRes.data?.obj) {
                throw new Error(optRes.data?.msg || (locale === 'en-US' ? 'Failed to get Passkey challenge' : '获取 Passkey 挑战失败'));
            }
            const { options, challengeSessionId } = optRes.data.obj;
            const asseResp = await startAuthentication({ optionsJSON: options });
            const verifyRes = await api.post('/auth/passkey/login-verify', {
                challengeSessionId,
                response: asseResp,
                rememberMe,
            });
            if (verifyRes.data?.success) {
                clearAppSessionState();
                const persistent = verifyRes.data.persistent !== undefined ? Boolean(verifyRes.data.persistent) : rememberMe;
                setStoredToken(verifyRes.data.token, { persistent });
                await refreshAuth();
                navigate('/', { replace: true });
            } else {
                throw new Error(verifyRes.data?.msg || (locale === 'en-US' ? 'Passkey verification failed' : 'Passkey 验证失败'));
            }
        } catch (err: any) {
            if (err.name === 'NotAllowedError') {
                setError(locale === 'en-US' ? 'Passkey sign-in cancelled' : '已取消通行密钥验证');
            } else {
                setError(err.response?.data?.msg || err.message || (locale === 'en-US' ? 'Passkey sign-in failed' : '通行密钥登录失败'));
            }
        } finally {
            setLoading(false);
        }
    };

    // ── Two-Factor Authentication ───────────────────────────
    const handleTwoFactorLogin = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (loading) return;
        setError('');
        setSuccess('');
        if (!twoFactorChallengeToken) {
            setError(copy.loginFailed);
            setMode(MODE_LOGIN);
            return;
        }
        const codeToSubmit = twoFactorUseBackup ? twoFactorBackupCode.trim() : twoFactorCode.trim();
        if (!codeToSubmit) {
            setError(twoFactorUseBackup ? t('pages.login.twoFactorBackupCodeInvalid') : t('pages.login.twoFactorCodeInvalid'));
            return;
        }
        if (!twoFactorUseBackup && !/^\d{6}$/.test(codeToSubmit)) {
            setError(t('pages.login.twoFactorCodeInvalid'));
            return;
        }
        setLoading(true);
        try {
            const result = await loginTwoFactor(twoFactorChallengeToken, codeToSubmit, twoFactorUseBackup, { rememberMe });
            if (result.success) {
                navigate('/', { replace: true });
            } else {
                setError(result.msg || copy.twoFactorFailed);
            }
        } catch {
            setError(copy.networkFailed);
        }
        setLoading(false);
    };

    const handleTwoFactorCodeChange = (val: string) => {
        const cleaned = val.replace(/\D/g, '').slice(0, 6);
        setTwoFactorCode(cleaned);
        if (cleaned.length === 6 && !loading && twoFactorChallengeToken) {
            setError('');
            setLoading(true);
            loginTwoFactor(twoFactorChallengeToken, cleaned, false, { rememberMe })
                .then((result) => {
                    if (result.success) {
                        navigate('/', { replace: true });
                    } else {
                        setError(result.msg || copy.twoFactorFailed);
                        setLoading(false);
                    }
                })
                .catch(() => {
                    setError(copy.networkFailed);
                    setLoading(false);
                });
        }
    };

    // ── Register ────────────────────────────────────────────
    const handleRegister = async (e: React.FormEvent) => {
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
            const trimmedUsername = regUsername.trim();
            const trimmedEmail = regEmail.trim();
            const trimmedInviteCode = inviteCode.trim();
            const result = await register(trimmedUsername, trimmedEmail, regPassword, trimmedInviteCode);
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
                    setVerifyEmailAddr(result.email || trimmedEmail);
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
    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            const result = await verifyEmailFn(verifyEmail.trim(), verifyCode.trim());
            if (result.success) {
                setSuccess(copy.verifySuccess);
                scheduleDeferredAction(() => {
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
        if (resendCooldown > 0 || loading) return;
        setError('');
        setSuccess('');
        try {
            const result = await resendCode(verifyEmail.trim());
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
        if (!passwordResetEnabled || resetCooldown > 0 || loading) return;
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

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!passwordResetEnabled) return;
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
                scheduleDeferredAction(() => {
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

    const switchMode = (newMode: AuthMode) => {
        if (newMode === MODE_REGISTER && !registrationEnabled) {
            setMode(MODE_LOGIN);
        } else {
            setMode(newMode === MODE_FORGOT && !passwordResetEnabled ? MODE_LOGIN : newMode);
        }
        setError('');
        setSuccess('');
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.scrollTo(0, 0);
    }, [mode]);

    const modeTitle = mode === MODE_LOGIN
        ? t('pages.login.title')
        : mode === MODE_REGISTER
            ? t('pages.login.registerTitle')
        : mode === MODE_VERIFY
            ? t('pages.login.verifyTitle')
        : mode === MODE_TWO_FACTOR
            ? t('pages.login.twoFactorTitle')
            : passwordResetEnabled
                ? t('pages.login.forgotTitle')
                : t('pages.login.title');

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.title = modeTitle ? `${modeTitle} · NMS` : 'NMS';
    }, [modeTitle]);

    // ── Render ───────────────────────────────────────────────
    return (
        <div className={`login-page login-page--${mode}`}>
            <div className="login-top-actions">
                <button
                    type="button"
                    className="theme-toggle-btn"
                    onClick={cycleTheme}
                    title={locale === 'en-US'
                        ? `Theme: ${themeMode === 'auto' ? `Auto (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})` : themeMode === 'dark' ? 'Dark' : 'Light'} (click to switch)`
                        : `外观：${themeMode === 'auto' ? `跟随系统（当前${resolvedTheme === 'dark' ? '深色' : '浅色'}）` : themeMode === 'dark' ? '深色' : '浅色'}（点击切换）`}
                    aria-label={locale === 'en-US' ? 'Toggle theme' : '切换外观主题'}
                >
                    {themeMode === 'auto' ? (
                        <HiOutlineComputerDesktop className="theme-toggle-icon" />
                    ) : resolvedTheme === 'dark' ? (
                        <HiOutlineSun className="theme-toggle-icon" />
                    ) : (
                        <HiOutlineMoon className="theme-toggle-icon" />
                    )}
                </button>
                <button
                    type="button"
                    className="login-locale-toggle theme-toggle-btn language-toggle-btn"
                    onClick={toggleLocale}
                    title={t('shell.switchLanguage')}
                    aria-label={t('shell.switchLanguage')}
                >
                    <span className="language-toggle-label">{t('shell.langLabel')}</span>
                </button>
            </div>

            <main className={`login-shell login-shell--${mode}`}>
                <div className="login-card-column">
                    <div className={`login-card login-pass login-card--${mode}`}>
                        <div className="login-brand-row login-pass-stub">
                            <img src={logoSrc} alt="" className="login-brand-mark" />
                            <div className="login-brand-copy">
                                <span className="login-brand-name">NMS</span>
                            </div>
                        </div>
                        <div className="login-pass-perf" aria-hidden="true" />
                        <div className="login-pass-body">
                            {(!registrationEnabled || (mode !== MODE_LOGIN && mode !== MODE_REGISTER)) && mode !== MODE_VERIFY && mode !== MODE_FORGOT && mode !== MODE_TWO_FACTOR ? (
                                <div className="login-form-heading">
                                    <h1>{modeTitle}</h1>
                                </div>
                            ) : (mode === MODE_LOGIN || mode === MODE_REGISTER) ? (
                                <h1 className="sr-only">{modeTitle}</h1>
                            ) : null}

                            {registrationEnabled && (mode === MODE_LOGIN || mode === MODE_REGISTER) && (
                                <div
                                    className="auth-tabs"
                                    role="tablist"
                                    aria-label={t('pages.login.title')}
                                    onKeyDown={(e) => handleRovingTabKeyDown(e, AUTH_TABS, mode, switchMode)}
                                >
                                    <button
                                        id="auth-tab-login"
                                        type="button"
                                        className={`auth-tab ${mode === MODE_LOGIN ? 'active' : ''}`}
                                        role="tab"
                                        aria-selected={mode === MODE_LOGIN}
                                        tabIndex={mode === MODE_LOGIN ? 0 : -1}
                                        onClick={() => switchMode(MODE_LOGIN)}
                                    >
                                        {t('pages.login.title')}
                                    </button>
                                    <button
                                        id="auth-tab-register"
                                        type="button"
                                        className={`auth-tab ${mode === MODE_REGISTER ? 'active' : ''}`}
                                        role="tab"
                                        aria-selected={mode === MODE_REGISTER}
                                        tabIndex={mode === MODE_REGISTER ? 0 : -1}
                                        onClick={() => switchMode(MODE_REGISTER)}
                                    >
                                        {t('pages.login.registerTitle')}
                                    </button>
                                </div>
                            )}

                            {success && <div className="success-alert" role="status" aria-live="polite">{success}</div>}
                            {error && <div className="error-alert" role="alert" aria-live="assertive">{error}</div>}
                            {!registrationStatus.loading && !registrationEnabled && mode === MODE_LOGIN && (
                                <div className="text-xs text-muted mb-3">{t('pages.login.registrationClosed')}</div>
                            )}

                            {mode === MODE_LOGIN && (
                                <form
                                    onSubmit={handleLogin}
                                    className="auth-form"
                                    role={registrationEnabled ? 'tabpanel' : undefined}
                                    aria-labelledby={registrationEnabled ? 'auth-tab-login' : undefined}
                                >
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="login-identifier">{t('pages.login.loginIdentifier')}</label>
                                        <div className="input-icon-wrapper">
                                            <HiOutlineUser className="input-icon" aria-hidden="true" />
                                            <input
                                                id="login-identifier"
                                                name="username"
                                                type="text"
                                                className="form-input input-with-icon"
                                                placeholder={t('pages.login.loginIdentifierPlaceholder')}
                                                value={loginIdentifier}
                                                onChange={(e) => setLoginIdentifier(e.target.value)}
                                                autoFocus
                                                required
                                                disabled={loading}
                                                autoComplete="username"
                                                autoCapitalize="none"
                                                autoCorrect="off"
                                                spellCheck={false}
                                                enterKeyHint="next"
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <div className="login-label-row">
                                            <label className="form-label" htmlFor="login-password">{t('pages.login.password')}</label>
                                            {passwordResetEnabled && (
                                                <button
                                                    type="button"
                                                    className="btn-link login-forgot-link"
                                                    onClick={() => switchMode(MODE_FORGOT)}
                                                >
                                                    {t('pages.login.toForgot')}
                                                </button>
                                            )}
                                        </div>
                                        <div className="input-icon-wrapper">
                                            <HiOutlineLockClosed className="input-icon" aria-hidden="true" />
                                            <input
                                                id="login-password"
                                                name="password"
                                                type={showPassword ? 'text' : 'password'}
                                                className="form-input input-with-icon input-with-trailing-action"
                                                placeholder={t('pages.login.passwordPlaceholder')}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                required
                                                disabled={loading}
                                                autoComplete="current-password"
                                                enterKeyHint="done"
                                            />
                                            <button
                                                type="button"
                                                className="input-trailing-action-btn"
                                                onClick={() => setShowPassword((prev) => !prev)}
                                                aria-pressed={showPassword}
                                                aria-label={showPassword ? t('comp.common.hidePassword') : t('comp.common.showPassword')}
                                            >
                                                {showPassword ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                                            </button>
                                        </div>
                                    </div>
                                    <label className="login-remember-row" htmlFor="login-remember-me">
                                        <input
                                            id="login-remember-me"
                                            type="checkbox"
                                            checked={rememberMe}
                                            onChange={(e) => setRememberMe(e.target.checked)}
                                            disabled={loading}
                                        />
                                        <span>
                                            {locale === 'en-US'
                                                ? 'Keep me signed in (stays active after closing tab)'
                                                : '保持登录状态（关闭标签页仍有效）'}
                                        </span>
                                    </label>
                                    <button
                                        type="submit"
                                        className="btn btn-primary w-full h-11 text-sm font-semibold login-submit-btn"
                                        disabled={loading}
                                    >
                                        {loading ? <span className="spinner" /> : t('pages.login.loginButton')}
                                    </button>

                                    <div className="login-divider">
                                        <span>{locale === 'en-US' ? 'or' : '或'}</span>
                                    </div>

                                    <button
                                        type="button"
                                        className="btn btn-secondary w-full h-11 text-sm font-medium login-passkey-btn"
                                        onClick={handlePasskeyLogin}
                                        disabled={loading}
                                    >
                                        <HiOutlineFingerPrint className="w-5 h-5" aria-hidden="true" />
                                        <span>{locale === 'en-US' ? 'Sign in with a passkey' : '使用通行密钥登录'}</span>
                                    </button>
                                </form>
                            )}

                            {mode === MODE_REGISTER && (
                                <form
                                    onSubmit={handleRegister}
                                    className="auth-form"
                                    role="tabpanel"
                                    aria-labelledby="auth-tab-register"
                                >
                                    <div className="login-form-grid">
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="register-username">{t('pages.login.username')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineUser className="input-icon" aria-hidden="true" />
                                                <input
                                                    id="register-username"
                                                    type="text"
                                                    className="form-input input-with-icon"
                                                    placeholder={t('pages.login.registerUsernamePlaceholder')}
                                                    value={regUsername}
                                                    onChange={(e) => setRegUsername(e.target.value)}
                                                    autoFocus
                                                    disabled={loading}
                                                    autoComplete="username"
                                                    autoCapitalize="none"
                                                    autoCorrect="off"
                                                    spellCheck={false}
                                                />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="register-email">{t('pages.login.email')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineEnvelope className="input-icon" aria-hidden="true" />
                                                <input
                                                    id="register-email"
                                                    type="email"
                                                    className="form-input input-with-icon"
                                                    placeholder={t('pages.login.registerEmailPlaceholder')}
                                                    value={regEmail}
                                                    onChange={(e) => setRegEmail(e.target.value)}
                                                    disabled={loading}
                                                    autoComplete="email"
                                                    autoCapitalize="none"
                                                    autoCorrect="off"
                                                    spellCheck={false}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="login-form-grid">
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="register-password">{t('pages.login.password')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineLockClosed className="input-icon" aria-hidden="true" />
                                                <input
                                                    id="register-password"
                                                    type={showRegPassword ? 'text' : 'password'}
                                                    className="form-input input-with-icon input-with-trailing-action"
                                                    placeholder={t('pages.login.registerPasswordPlaceholder')}
                                                    value={regPassword}
                                                    onChange={(e) => setRegPassword(e.target.value)}
                                                    disabled={loading}
                                                    autoComplete="new-password"
                                                />
                                                <button
                                                    type="button"
                                                    className="input-trailing-action-btn"
                                                    onClick={() => setShowRegPassword((prev) => !prev)}
                                                    aria-pressed={showRegPassword}
                                                    aria-label={showRegPassword ? t('comp.common.hidePassword') : t('comp.common.showPassword')}
                                                >
                                                    {showRegPassword ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                                                </button>
                                            </div>
                                            <PasswordStrengthMeter password={regPassword} locale={locale} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="register-confirm">{t('pages.login.confirmPassword')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineLockClosed className="input-icon" aria-hidden="true" />
                                                <input
                                                    id="register-confirm"
                                                    type={showRegConfirm ? 'text' : 'password'}
                                                    className="form-input input-with-icon input-with-trailing-action"
                                                    placeholder={t('pages.login.confirmPasswordPlaceholder')}
                                                    value={regConfirm}
                                                    onChange={(e) => setRegConfirm(e.target.value)}
                                                    disabled={loading}
                                                    autoComplete="new-password"
                                                />
                                                <button
                                                    type="button"
                                                    className="input-trailing-action-btn"
                                                    onClick={() => setShowRegConfirm((prev) => !prev)}
                                                    aria-pressed={showRegConfirm}
                                                    aria-label={showRegConfirm ? t('comp.common.hidePassword') : t('comp.common.showPassword')}
                                                >
                                                    {showRegConfirm ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                                                </button>
                                            </div>
                                            {regConfirm && regPassword !== regConfirm && (
                                                <p className="field-error">{t('pages.login.passwordMismatch')}</p>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-muted text-xs -mt-1 mb-3">{passwordPolicyHint}</p>
                                    {inviteOnlyEnabled && (
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="register-invite-code">{t('pages.login.inviteCode')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineShieldCheck className="input-icon" aria-hidden="true" />
                                                <input
                                                    id="register-invite-code"
                                                    type="text"
                                                    className="form-input input-with-icon"
                                                    placeholder={t('pages.login.inviteCodePlaceholder')}
                                                    value={inviteCode}
                                                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                                    disabled={loading}
                                                    autoComplete="off"
                                                    autoCapitalize="characters"
                                                    autoCorrect="off"
                                                    spellCheck={false}
                                                />
                                            </div>
                                            <p className="text-muted text-xs mt-1">{t('pages.login.inviteOnlyHint')}</p>
                                        </div>
                                    )}
                                    <button
                                        type="submit"
                                        className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                        disabled={loading || !regUsername.trim() || !regEmail.trim() || !regPassword || !regConfirm || regPassword !== regConfirm || (inviteOnlyEnabled && !inviteCode.trim())}
                                    >
                                        {loading ? <span className="spinner" /> : t('pages.login.registerButton')}
                                    </button>
                                </form>
                            )}

                            {mode === MODE_VERIFY && (
                                <form onSubmit={handleVerify} className="auth-form">
                                    <div className="verify-header">
                                        <HiOutlineShieldCheck className="verify-icon" />
                                        <h1>{t('pages.login.verifyTitle')}</h1>
                                        <p className="text-muted text-sm">
                                            {t('pages.login.verifySentTo', { email: verifyEmail })}
                                        </p>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="verify-email-code">{t('pages.login.verifyCode')}</label>
                                        <input
                                            id="verify-email-code"
                                            type="text"
                                            className="form-input verify-code-input"
                                            placeholder={t('pages.login.verifyCodePlaceholder')}
                                            value={verifyCode}
                                            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            maxLength={6}
                                            autoFocus
                                            disabled={loading}
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

                            {passwordResetEnabled && mode === MODE_FORGOT && (
                                <form onSubmit={handleResetPassword} className="auth-form">
                                    <div className="verify-header">
                                        <HiOutlineShieldCheck className="verify-icon" />
                                        <h1>{t('pages.login.forgotTitle')}</h1>
                                        <p className="text-muted text-sm">
                                            {t('pages.login.forgotSubtitle')}
                                        </p>
                                        <p className="text-muted text-xs">
                                            {t('pages.login.forgotPrivacyHint')}
                                        </p>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label" htmlFor="reset-email">{t('pages.login.email')}</label>
                                        <div className="input-icon-wrapper">
                                            <HiOutlineEnvelope className="input-icon" aria-hidden="true" />
                                            <input
                                                id="reset-email"
                                                type="email"
                                                className="form-input input-with-icon"
                                                placeholder={t('pages.login.resetEmailPlaceholder')}
                                                value={resetEmail}
                                                onChange={(e) => setResetEmail(e.target.value)}
                                                disabled={loading}
                                                autoComplete="email"
                                                autoCapitalize="none"
                                                autoCorrect="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label" htmlFor="reset-verify-code">{t('pages.login.verifyCode')}</label>
                                        <div className="verify-code-row">
                                            <input
                                                id="reset-verify-code"
                                                type="text"
                                                className="form-input verify-code-input"
                                                placeholder={t('pages.login.resetCodePlaceholder')}
                                                value={resetCode}
                                                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                maxLength={6}
                                                disabled={loading}
                                                autoComplete="one-time-code"
                                                inputMode="numeric"
                                            />
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm verify-code-send-btn"
                                                onClick={handleSendResetCode}
                                                disabled={loading || !resetEmail.trim() || resetCooldown > 0}
                                            >
                                                <HiOutlineArrowPath className={resetCooldown > 0 ? '' : 'spin-on-hover'} />
                                                {resetCooldown > 0 ? `${resetCooldown}s` : t('pages.login.sendCode')}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="login-form-grid">
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="reset-new-password">{t('pages.login.newPassword')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineLockClosed className="input-icon" aria-hidden="true" />
                                                <input
                                                    id="reset-new-password"
                                                    type={showResetPassword ? 'text' : 'password'}
                                                    className="form-input input-with-icon input-with-trailing-action"
                                                    placeholder={t('pages.login.resetPasswordPlaceholder')}
                                                    value={resetPassword}
                                                    onChange={(e) => setResetPassword(e.target.value)}
                                                    disabled={loading}
                                                    autoComplete="new-password"
                                                />
                                                <button
                                                    type="button"
                                                    className="input-trailing-action-btn"
                                                    onClick={() => setShowResetPassword((prev) => !prev)}
                                                    aria-pressed={showResetPassword}
                                                    aria-label={showResetPassword ? t('comp.common.hidePassword') : t('comp.common.showPassword')}
                                                >
                                                    {showResetPassword ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                                                </button>
                                            </div>
                                            <PasswordStrengthMeter password={resetPassword} locale={locale} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="reset-confirm-password">{t('pages.login.confirmPassword')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineLockClosed className="input-icon" aria-hidden="true" />
                                                <input
                                                    id="reset-confirm-password"
                                                    type={showResetConfirm ? 'text' : 'password'}
                                                    className="form-input input-with-icon input-with-trailing-action"
                                                    placeholder={t('pages.login.resetConfirmPlaceholder')}
                                                    value={resetConfirm}
                                                    onChange={(e) => setResetConfirm(e.target.value)}
                                                    disabled={loading}
                                                    autoComplete="new-password"
                                                />
                                                <button
                                                    type="button"
                                                    className="input-trailing-action-btn"
                                                    onClick={() => setShowResetConfirm((prev) => !prev)}
                                                    aria-pressed={showResetConfirm}
                                                    aria-label={showResetConfirm ? t('comp.common.hidePassword') : t('comp.common.showPassword')}
                                                >
                                                    {showResetConfirm ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                                                </button>
                                            </div>
                                            {resetConfirm && resetPassword !== resetConfirm && (
                                                <p className="field-error">{t('pages.login.passwordMismatch')}</p>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-muted text-xs -mt-1 mb-3">{passwordPolicyHint}</p>

                                    <button
                                        type="submit"
                                        className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                        disabled={loading || !resetEmail.trim() || resetCode.length !== 6 || !resetPassword || !resetConfirm || resetPassword !== resetConfirm}
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

                            {mode === MODE_TWO_FACTOR && (
                                <form onSubmit={handleTwoFactorLogin} className="auth-form">
                                    <div className="verify-header">
                                        <HiOutlineShieldCheck className="verify-icon" />
                                        <h1>{t('pages.login.twoFactorTitle')}</h1>
                                        <p className="text-muted text-sm">
                                            {twoFactorUseBackup ? t('pages.login.twoFactorBackupSubtitle') : t('pages.login.twoFactorSubtitle')}
                                        </p>
                                    </div>

                                    {!twoFactorUseBackup ? (
                                        <div className="form-group">
                                            <label htmlFor="login-login-two-factor-code" className="form-label">{t('pages.login.twoFactorCode')}</label>
                                            <input id="login-login-two-factor-code" name="loginLoginTwoFactorCode"
                                                type="text"
                                                className="form-input verify-code-input"
                                                placeholder={t('pages.login.twoFactorCodePlaceholder')}
                                                value={twoFactorCode}
                                                onChange={(e) => handleTwoFactorCodeChange(e.target.value)}
                                                maxLength={6}
                                                autoFocus
                                                disabled={loading}
                                                autoComplete="one-time-code"
                                                inputMode="numeric"
                                            />
                                        </div>
                                    ) : (
                                        <div className="form-group">
                                            <label htmlFor="login-login-two-factor-backup-code" className="form-label">{t('pages.login.twoFactorBackupCode')}</label>
                                            <div className="input-icon-wrapper">
                                                <HiOutlineLockClosed className="input-icon" />
                                                <input id="login-login-two-factor-backup-code" name="loginLoginTwoFactorBackupCode"
                                                    type="text"
                                                    className="form-input input-with-icon font-mono"
                                                    placeholder={t('pages.login.twoFactorBackupPlaceholder')}
                                                    value={twoFactorBackupCode}
                                                    onChange={(e) => setTwoFactorBackupCode(e.target.value)}
                                                    autoFocus
                                                    disabled={loading}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                                        disabled={loading || (twoFactorUseBackup ? !twoFactorBackupCode.trim() : twoFactorCode.length !== 6)}
                                    >
                                        {loading ? <span className="spinner" /> : t('pages.login.twoFactorButton')}
                                    </button>

                                    <div className="verify-actions">
                                        <button
                                            type="button"
                                            className="btn-link"
                                            onClick={() => {
                                                setTwoFactorUseBackup(!twoFactorUseBackup);
                                                setError('');
                                            }}
                                        >
                                            {twoFactorUseBackup ? t('pages.login.useTotpCode') : t('pages.login.useBackupCode')}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-link"
                                            onClick={() => {
                                                setMode(MODE_LOGIN);
                                                setTwoFactorChallengeToken('');
                                                setTwoFactorCode('');
                                                setTwoFactorBackupCode('');
                                                setError('');
                                                setSuccess('');
                                            }}
                                        >
                                            {t('pages.login.toLogin')}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
