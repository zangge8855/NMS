import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { HiOutlineLockClosed, HiOutlineUser, HiOutlineEnvelope, HiOutlineArrowPath, HiOutlineShieldCheck, HiOutlineSun, HiOutlineMoon, HiOutlineComputerDesktop } from 'react-icons/hi2';
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from '../../utils/passwordPolicy.js';

const MODE_LOGIN = 'login';
const MODE_REGISTER = 'register';
const MODE_VERIFY = 'verify';
const MODE_FORGOT = 'forgot';

export default function Login() {
    const [mode, setMode] = useState(MODE_LOGIN);
    const { mode: themeMode, cycleTheme } = useTheme();

    const themeIcons = { dark: HiOutlineMoon, light: HiOutlineSun, auto: HiOutlineComputerDesktop };
    const ThemeIcon = themeIcons[themeMode] || HiOutlineMoon;

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
        setMode(newMode);
        setError('');
        setSuccess('');
    };

    // ── Render ───────────────────────────────────────────────
    return (
        <div className="login-page">
            <div className="login-bg-glow one" />
            <div className="login-bg-glow two" />
            <div className="login-bg-glow three" />

            <button
                className="login-theme-toggle theme-toggle-btn"
                onClick={cycleTheme}
                title={themeMode === 'dark' ? '切换到亮色' : themeMode === 'light' ? '切换到自动' : '切换到暗色'}
            >
                <ThemeIcon />
            </button>

            <div className="login-card">
                <div className="login-card-border" />
                <div className="login-logo">
                    <div className="login-logo-icon">N</div>
                    <h1>NMS</h1>
                    <p>Node Management System</p>
                </div>

                {/* ── Tab Switcher ─── */}
                {(mode === MODE_LOGIN || mode === MODE_REGISTER) && (
                    <div className="auth-tabs">
                        <button
                            type="button"
                            className={`auth-tab ${mode === MODE_LOGIN ? 'active' : ''}`}
                            onClick={() => switchMode(MODE_LOGIN)}
                        >
                            登录
                        </button>
                        <button
                            type="button"
                            className={`auth-tab ${mode === MODE_REGISTER ? 'active' : ''}`}
                            onClick={() => switchMode(MODE_REGISTER)}
                        >
                            注册
                        </button>
                    </div>
                )}

                {/* ── Success / Error ─── */}
                {success && <div className="success-alert">{success}</div>}
                {error && <div className="error-alert">{error}</div>}

                {/* ── Login Form ─── */}
                {mode === MODE_LOGIN && (
                    <form onSubmit={handleLogin} className="auth-form">
                        <div className="form-group">
                            <label className="form-label">用户名</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineUser className="input-icon" />
                                <input
                                    type="text"
                                    className="form-input input-with-icon"
                                    placeholder="请输入用户名"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    autoFocus
                                    autoComplete="username"
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">密码</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineLockClosed className="input-icon" />
                                <input
                                    type="password"
                                    className="form-input input-with-icon"
                                    placeholder="请输入密码"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoComplete="current-password"
                                />
                            </div>
                        </div>
                        <div className="verify-actions">
                            <button
                                type="button"
                                className="btn-link"
                                onClick={() => {
                                    setResetEmail('');
                                    setResetCode('');
                                    setResetPassword('');
                                    setResetConfirm('');
                                    switchMode(MODE_FORGOT);
                                }}
                            >
                                忘记密码？
                            </button>
                        </div>
                        <button
                            type="submit"
                            className="btn btn-primary w-full h-11 text-sm font-bold tracking-wide"
                            disabled={loading || !password}
                        >
                            {loading ? <span className="spinner" /> : '登 录'}
                        </button>
                    </form>
                )}

                {/* ── Register Form ─── */}
                {mode === MODE_REGISTER && (
                    <form onSubmit={handleRegister} className="auth-form">
                        <div className="form-group">
                            <label className="form-label">用户名</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineUser className="input-icon" />
                                <input
                                    type="text"
                                    className="form-input input-with-icon"
                                    placeholder="选择一个用户名"
                                    value={regUsername}
                                    onChange={(e) => setRegUsername(e.target.value)}
                                    autoFocus
                                    autoComplete="username"
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">邮箱</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineEnvelope className="input-icon" />
                                <input
                                    type="email"
                                    className="form-input input-with-icon"
                                    placeholder="你的邮箱地址"
                                    value={regEmail}
                                    onChange={(e) => setRegEmail(e.target.value)}
                                    autoComplete="email"
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">密码</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineLockClosed className="input-icon" />
                                <input
                                    type="password"
                                    className="form-input input-with-icon"
                                    placeholder="至少8位，含3类字符"
                                    value={regPassword}
                                    onChange={(e) => setRegPassword(e.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                            <p className="text-muted text-sm mt-1">{PASSWORD_POLICY_HINT}</p>
                        </div>
                        <div className="form-group">
                            <label className="form-label">确认密码</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineLockClosed className="input-icon" />
                                <input
                                    type="password"
                                    className="form-input input-with-icon"
                                    placeholder="再次输入密码"
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
                            {loading ? <span className="spinner" /> : '注 册'}
                        </button>
                    </form>
                )}

                {/* ── Verify Email Form ─── */}
                {mode === MODE_VERIFY && (
                    <form onSubmit={handleVerify} className="auth-form">
                        <div className="verify-header">
                            <HiOutlineShieldCheck className="verify-icon" />
                            <h2>邮箱验证</h2>
                            <p className="text-muted text-sm">
                                验证码已发送至 <strong>{verifyEmail}</strong>
                            </p>
                        </div>
                        <div className="form-group">
                            <label className="form-label">验证码</label>
                            <input
                                type="text"
                                className="form-input verify-code-input"
                                placeholder="输入 6 位验证码"
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
                            {loading ? <span className="spinner" /> : '验 证'}
                        </button>
                        <div className="verify-actions">
                            <button
                                type="button"
                                className="btn-link"
                                onClick={handleResend}
                                disabled={resendCooldown > 0}
                            >
                                <HiOutlineArrowPath className={resendCooldown > 0 ? '' : 'spin-on-hover'} />
                                {resendCooldown > 0 ? `${resendCooldown}s 后可重发` : '重新发送验证码'}
                            </button>
                            <button
                                type="button"
                                className="btn-link"
                                onClick={() => switchMode(MODE_LOGIN)}
                            >
                                返回登录
                            </button>
                        </div>
                    </form>
                )}

                {/* ── Forgot Password Form ─── */}
                {mode === MODE_FORGOT && (
                    <form onSubmit={handleResetPassword} className="auth-form">
                        <div className="verify-header">
                            <HiOutlineShieldCheck className="verify-icon" />
                            <h2>找回密码</h2>
                            <p className="text-muted text-sm">
                                输入邮箱验证码并设置新密码
                            </p>
                        </div>

                        <div className="form-group">
                            <label className="form-label">邮箱</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineEnvelope className="input-icon" />
                                <input
                                    type="email"
                                    className="form-input input-with-icon"
                                    placeholder="注册邮箱"
                                    value={resetEmail}
                                    onChange={(e) => setResetEmail(e.target.value)}
                                    autoComplete="email"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">验证码</label>
                            <div className="verify-code-row">
                                <input
                                    type="text"
                                    className="form-input verify-code-input"
                                    placeholder="输入 6 位验证码"
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
                                    {resetCooldown > 0 ? `${resetCooldown}s` : '发送验证码'}
                                </button>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">新密码</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineLockClosed className="input-icon" />
                                <input
                                    type="password"
                                    className="form-input input-with-icon"
                                    placeholder="至少8位，含3类字符"
                                    value={resetPassword}
                                    onChange={(e) => setResetPassword(e.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                            <p className="text-muted text-sm mt-1">{PASSWORD_POLICY_HINT}</p>
                        </div>

                        <div className="form-group">
                            <label className="form-label">确认新密码</label>
                            <div className="input-icon-wrapper">
                                <HiOutlineLockClosed className="input-icon" />
                                <input
                                    type="password"
                                    className="form-input input-with-icon"
                                    placeholder="再次输入新密码"
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
                            {loading ? <span className="spinner" /> : '重置密码'}
                        </button>

                        <div className="verify-actions">
                            <button
                                type="button"
                                className="btn-link"
                                onClick={() => switchMode(MODE_LOGIN)}
                            >
                                返回登录
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
