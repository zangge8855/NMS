import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Tabs, Alert, Space } from 'antd';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { HiOutlineLockClosed, HiOutlineUser, HiOutlineEnvelope, HiOutlineArrowPath, HiOutlineShieldCheck, HiOutlineSun, HiOutlineMoon, HiOutlineComputerDesktop } from 'react-icons/hi2';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy.js';
import { buildSiteAssetPath } from '../../utils/sitePath.js';

const MODE_LOGIN = 'login';
const MODE_REGISTER = 'register';
const MODE_VERIFY = 'verify';
const MODE_FORGOT = 'forgot';

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

    // Login fields
    const [loginIdentifier, setLoginIdentifier] = useState('');
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
        passwordResetEnabled: true,
        loading: true,
    });
    const intervalTimersRef = useRef(new Set());
    const timeoutTimersRef = useRef(new Set());

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

    const startCooldown = (setter, seconds = 60) => {
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

    const scheduleDeferredAction = (callback, delayMs) => {
        const timer = setTimeout(() => {
            timeoutTimersRef.current.delete(timer);
            callback();
        }, delayMs);
        timeoutTimersRef.current.add(timer);
    };

    // ── Login ───────────────────────────────────────────────
    const handleLogin = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            const result = await login(loginIdentifier.trim(), password);
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
        if (e && e.preventDefault) e.preventDefault();
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
        if (e && e.preventDefault) e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            const result = await verifyEmailFn(verifyEmail, verifyCode);
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
        if (!passwordResetEnabled) return;
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
        if (e && e.preventDefault) e.preventDefault();
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

    const switchMode = (newMode) => {
        if (newMode === MODE_REGISTER && !registrationEnabled) {
            setMode(MODE_LOGIN);
        } else {
            setMode(newMode === MODE_FORGOT && !passwordResetEnabled ? MODE_LOGIN : newMode);
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
            : passwordResetEnabled
                ? t('pages.login.forgotTitle')
                : t('pages.login.title');

    // ── Render ───────────────────────────────────────────────
    return (
        <div className="login-page">
            <div className="login-bg-glow one" />
            <div className="login-bg-glow two" />
            <div className="login-bg-glow three" />

            <div className="login-top-actions">
                <Button
                    type="text"
                    className="login-locale-toggle theme-toggle-btn language-toggle-btn"
                    onClick={toggleLocale}
                    title={t('shell.switchLanguage')}
                    aria-label={t('shell.switchLanguage')}
                >
                    <span className="language-toggle-label">{t('shell.langLabel')}</span>
                </Button>
                <Button
                    type="text"
                    className="login-theme-toggle theme-toggle-btn"
                    onClick={cycleTheme}
                    title={themeToggleTitle}
                    aria-label={themeToggleTitle}
                >
                    <ThemeIcon />
                </Button>
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
                            <Tabs
                                activeKey={mode}
                                onChange={(key) => switchMode(key)}
                                centered
                                items={[
                                    { key: MODE_LOGIN, label: t('pages.login.title') },
                                    { key: MODE_REGISTER, label: t('pages.login.registerTitle') }
                                ]}
                            />
                        )}

                        {success && <Alert message={success} type="success" showIcon style={{ marginBottom: 16 }} />}
                        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}
                        {!registrationStatus.loading && !registrationEnabled && mode === MODE_LOGIN && (
                            <div className="text-xs text-muted mb-3">{t('pages.login.registrationClosed')}</div>
                        )}

                        {mode === MODE_LOGIN && (
                            <Form onFinish={handleLogin} layout="vertical" className="auth-form">
                                <Form.Item label={t('pages.login.loginIdentifier')}>
                                    <Input
                                        prefix={<HiOutlineUser />}
                                        placeholder={t('pages.login.loginIdentifierPlaceholder')}
                                        value={loginIdentifier}
                                        onChange={(e) => setLoginIdentifier(e.target.value)}
                                        autoFocus
                                        autoComplete="username"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        size="large"
                                    />
                                </Form.Item>
                                <Form.Item label={t('pages.login.password')}>
                                    <Input.Password
                                        prefix={<HiOutlineLockClosed />}
                                        placeholder={t('pages.login.passwordPlaceholder')}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="current-password"
                                        size="large"
                                    />
                                </Form.Item>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    block
                                    size="large"
                                    loading={loading}
                                    disabled={!loginIdentifier.trim() || !password}
                                >
                                    {t('pages.login.loginButton')}
                                </Button>
                                {passwordResetEnabled && (
                                    <div className="verify-actions" style={{ marginTop: 16, textAlign: 'center' }}>
                                        <Button type="link" onClick={() => switchMode(MODE_FORGOT)}>
                                            {t('pages.login.toForgot')}
                                        </Button>
                                    </div>
                                )}
                            </Form>
                        )}

                        {mode === MODE_REGISTER && (
                            <Form onFinish={handleRegister} layout="vertical" className="auth-form">
                                <Form.Item label={t('pages.login.username')}>
                                    <Input
                                        prefix={<HiOutlineUser />}
                                        placeholder={t('pages.login.registerUsernamePlaceholder')}
                                        value={regUsername}
                                        onChange={(e) => setRegUsername(e.target.value)}
                                        autoFocus
                                        autoComplete="username"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        size="large"
                                    />
                                </Form.Item>
                                <Form.Item label={t('pages.login.email')}>
                                    <Input
                                        type="email"
                                        prefix={<HiOutlineEnvelope />}
                                        placeholder={t('pages.login.registerEmailPlaceholder')}
                                        value={regEmail}
                                        onChange={(e) => setRegEmail(e.target.value)}
                                        autoComplete="email"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        size="large"
                                    />
                                </Form.Item>
                                <Form.Item
                                    label={t('pages.login.password')}
                                    help={<span className="text-muted text-sm">{passwordPolicyHint}</span>}
                                >
                                    <Input.Password
                                        prefix={<HiOutlineLockClosed />}
                                        placeholder={t('pages.login.registerPasswordPlaceholder')}
                                        value={regPassword}
                                        onChange={(e) => setRegPassword(e.target.value)}
                                        autoComplete="new-password"
                                        size="large"
                                    />
                                </Form.Item>
                                <Form.Item
                                    label={t('pages.login.confirmPassword')}
                                    help={regConfirm && regPassword !== regConfirm ? <span className="field-error">{t('pages.login.passwordMismatch')}</span> : null}
                                    validateStatus={regConfirm && regPassword !== regConfirm ? 'error' : ''}
                                >
                                    <Input.Password
                                        prefix={<HiOutlineLockClosed />}
                                        placeholder={t('pages.login.confirmPasswordPlaceholder')}
                                        value={regConfirm}
                                        onChange={(e) => setRegConfirm(e.target.value)}
                                        autoComplete="new-password"
                                        size="large"
                                    />
                                </Form.Item>
                                {inviteOnlyEnabled && (
                                    <Form.Item
                                        label={t('pages.login.inviteCode')}
                                        help={<span className="text-muted text-sm">{t('pages.login.inviteOnlyHint')}</span>}
                                    >
                                        <Input
                                            prefix={<HiOutlineShieldCheck />}
                                            placeholder={t('pages.login.inviteCodePlaceholder')}
                                            value={inviteCode}
                                            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                            autoComplete="off"
                                            autoCapitalize="characters"
                                            autoCorrect="off"
                                            spellCheck={false}
                                            size="large"
                                        />
                                    </Form.Item>
                                )}
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    block
                                    size="large"
                                    loading={loading}
                                    disabled={!regUsername || !regEmail || !regPassword || !regConfirm || regPassword !== regConfirm || (inviteOnlyEnabled && !inviteCode.trim())}
                                >
                                    {t('pages.login.registerButton')}
                                </Button>
                            </Form>
                        )}

                        {mode === MODE_VERIFY && (
                            <Form onFinish={handleVerify} layout="vertical" className="auth-form">
                                <div className="verify-header" style={{ textAlign: 'center', marginBottom: 24 }}>
                                    <HiOutlineShieldCheck className="verify-icon" style={{ fontSize: 48, marginBottom: 16 }} />
                                    <h2>{t('pages.login.verifyTitle')}</h2>
                                    <p className="text-muted text-sm">
                                        {t('pages.login.verifySentTo', { email: verifyEmail })}
                                    </p>
                                </div>
                                <Form.Item label={t('pages.login.verifyCode')}>
                                    <Input
                                        placeholder={t('pages.login.verifyCodePlaceholder')}
                                        value={verifyCode}
                                        onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        maxLength={6}
                                        autoFocus
                                        autoComplete="one-time-code"
                                        inputMode="numeric"
                                        size="large"
                                        style={{ textAlign: 'center', letterSpacing: '0.25em', fontSize: '1.2rem' }}
                                    />
                                </Form.Item>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    block
                                    size="large"
                                    loading={loading}
                                    disabled={verifyCode.length !== 6}
                                >
                                    {t('pages.login.verifyButton')}
                                </Button>
                                <div className="verify-actions" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
                                    <Button
                                        type="link"
                                        onClick={handleResend}
                                        disabled={resendCooldown > 0}
                                        icon={<HiOutlineArrowPath className={resendCooldown > 0 ? '' : 'spin-on-hover'} />}
                                    >
                                        {resendCooldown > 0 ? `${resendCooldown}s` : t('pages.login.resendCode')}
                                    </Button>
                                    <Button type="link" onClick={() => switchMode(MODE_LOGIN)}>
                                        {t('pages.login.toLogin')}
                                    </Button>
                                </div>
                            </Form>
                        )}

                        {passwordResetEnabled && mode === MODE_FORGOT && (
                            <Form onFinish={handleResetPassword} layout="vertical" className="auth-form">
                                <div className="verify-header" style={{ textAlign: 'center', marginBottom: 24 }}>
                                    <HiOutlineShieldCheck className="verify-icon" style={{ fontSize: 48, marginBottom: 16 }} />
                                    <h2>{t('pages.login.forgotTitle')}</h2>
                                    <p className="text-muted text-sm">
                                        {t('pages.login.forgotSubtitle')}
                                    </p>
                                    <p className="text-muted text-xs">
                                        {t('pages.login.forgotPrivacyHint')}
                                    </p>
                                </div>

                                <Form.Item label={t('pages.login.email')}>
                                    <Input
                                        type="email"
                                        prefix={<HiOutlineEnvelope />}
                                        placeholder={t('pages.login.resetEmailPlaceholder')}
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                        autoComplete="email"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        size="large"
                                    />
                                </Form.Item>

                                <Form.Item label={t('pages.login.verifyCode')}>
                                    <Space.Compact style={{ width: '100%' }}>
                                        <Input
                                            placeholder={t('pages.login.resetCodePlaceholder')}
                                            value={resetCode}
                                            onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            maxLength={6}
                                            inputMode="numeric"
                                            size="large"
                                            style={{ textAlign: 'center', letterSpacing: '0.25em' }}
                                        />
                                        <Button
                                            size="large"
                                            onClick={handleSendResetCode}
                                            disabled={loading || !resetEmail || resetCooldown > 0}
                                            icon={<HiOutlineArrowPath className={resetCooldown > 0 ? '' : 'spin-on-hover'} />}
                                        >
                                            {resetCooldown > 0 ? `${resetCooldown}s` : t('pages.login.sendCode')}
                                        </Button>
                                    </Space.Compact>
                                </Form.Item>

                                <Form.Item
                                    label={t('pages.login.newPassword')}
                                    help={<span className="text-muted text-sm">{passwordPolicyHint}</span>}
                                >
                                    <Input.Password
                                        prefix={<HiOutlineLockClosed />}
                                        placeholder={t('pages.login.resetPasswordPlaceholder')}
                                        value={resetPassword}
                                        onChange={(e) => setResetPassword(e.target.value)}
                                        autoComplete="new-password"
                                        size="large"
                                    />
                                </Form.Item>

                                <Form.Item
                                    label={t('pages.login.confirmPassword')}
                                    help={resetConfirm && resetPassword !== resetConfirm ? <span className="field-error">{t('pages.login.passwordMismatch')}</span> : null}
                                    validateStatus={resetConfirm && resetPassword !== resetConfirm ? 'error' : ''}
                                >
                                    <Input.Password
                                        prefix={<HiOutlineLockClosed />}
                                        placeholder={t('pages.login.resetConfirmPlaceholder')}
                                        value={resetConfirm}
                                        onChange={(e) => setResetConfirm(e.target.value)}
                                        autoComplete="new-password"
                                        size="large"
                                    />
                                </Form.Item>

                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    block
                                    size="large"
                                    loading={loading}
                                    disabled={!resetEmail || resetCode.length !== 6 || !resetPassword || !resetConfirm || resetPassword !== resetConfirm}
                                >
                                    {t('pages.login.resetButton')}
                                </Button>

                                <div className="verify-actions" style={{ marginTop: 16, textAlign: 'center' }}>
                                    <Button type="link" onClick={() => switchMode(MODE_LOGIN)}>
                                        {t('pages.login.toLogin')}
                                    </Button>
                                </div>
                            </Form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
