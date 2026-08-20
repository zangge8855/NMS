import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getStoredToken, setStoredToken, clearStoredToken } from '../api/client';
import { DEFAULT_LOCALE, getLocaleMessage, VALID_LOCALES } from '../i18n/messages';
import { clearAppSessionState } from '../utils/appBootstrap';
import type { User } from '../types/index.ts';

function resolveUiLocale(): string {
    if (typeof document !== 'undefined') {
        const lang = String(document.documentElement.lang || '').trim();
        if (VALID_LOCALES.includes(lang)) return lang;
    }
    return DEFAULT_LOCALE;
}

export interface AuthContextType {
    isAuthenticated: boolean;
    loading: boolean;
    user: (User & Record<string, any>) | null;
    token: string | null;
    login: (identifier: string, password: string) => Promise<{ success: boolean; msg?: string; needVerify?: boolean; email?: string; needTwoFactor?: boolean; challengeToken?: string }>;
    loginTwoFactor: (challengeToken: string, code: string, useBackupCode?: boolean) => Promise<{ success: boolean; msg?: string; user?: any }>;
    logout: () => void;
    register: (username: string, email: string, password: string, inviteCode?: string) => Promise<any>;
    verifyEmail: (email: string, code: string) => Promise<any>;
    resendCode: (email: string) => Promise<any>;
    requestPasswordReset: (email: string) => Promise<any>;
    resetPassword: (email: string, code: string, newPassword: string) => Promise<any>;
    refreshAuth: () => Promise<void>;
    patchUser: (nextUser: Partial<User & Record<string, any>>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function decodeJwtPayload(token?: string | null): Record<string, any> | null {
    try {
        const text = String(token || '').trim();
        if (!text.includes('.')) return null;
        const payloadSeg = text.split('.')[1] || '';
        const normalized = payloadSeg.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        const json = atob(padded);
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [user, setUser] = useState<(User & Record<string, any>) | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [token, setToken] = useState<string | null>(getStoredToken);
    const navigate = useNavigate();

    // Listen for session-expired events from the API interceptor
    // to handle 401 redirects via React Router instead of full page reload.
    useEffect(() => {
        const handler = () => {
            clearStoredToken();
            clearAppSessionState();
            setToken(null);
            setIsAuthenticated(false);
            setUser(null);
            navigate('/login', { replace: true });
        };
        window.addEventListener('nms:session-expired', handler);
        return () => window.removeEventListener('nms:session-expired', handler);
    }, [navigate]);

    const checkAuth = useCallback(async () => {
        const storedToken = getStoredToken();
        if (!storedToken) {
            setIsAuthenticated(false);
            setUser(null);
            setLoading(false);
            return;
        }
        try {
            const res = await api.get('/auth/check');
            setIsAuthenticated(true);
            setUser(res.data?.user || null);
        } catch (error: any) {
            const status = Number(error?.response?.status || 0);
            if (status === 401 || status === 403) {
                clearStoredToken();
                setIsAuthenticated(false);
                setUser(null);
            } else {
                const decoded = decodeJwtPayload(storedToken);
                setIsAuthenticated(true);
                setUser((prev) => prev || {
                    id: '',
                    createdAt: Date.now(),
                    username: String(decoded?.username || ''),
                    role: (decoded?.role === 'admin' ? 'admin' : 'user'),
                    email: '',
                    subscriptionEmail: '',
                });
            }
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    /** 登录 (username/email + password) */
    const login = async (identifier: string, password: string) => {
        try {
            const res = await api.post('/auth/login', { identifier, username: identifier, password });
            if (res.data.success) {
                setStoredToken(res.data.token);
                setToken(res.data.token);
                setIsAuthenticated(true);
                setUser(res.data.user || null);
                return { success: true };
            }
            if (res.data.needTwoFactor) {
                return {
                    success: false,
                    needTwoFactor: true,
                    challengeToken: res.data.challengeToken,
                    msg: res.data.msg,
                };
            }
            return { success: false, msg: res.data.msg };
        } catch (err: any) {
            const data = err.response?.data;
            if (data?.needVerify) {
                return { success: false, msg: data.msg, needVerify: true, email: data.email };
            }
            if (data?.needTwoFactor) {
                return {
                    success: false,
                    msg: data.msg,
                    needTwoFactor: true,
                    challengeToken: data.challengeToken,
                };
            }
            return {
                success: false,
                msg: data?.msg || getLocaleMessage(resolveUiLocale(), 'comp.common.connectFailed'),
            };
        }
    };

    /** 完成 2FA 二次验证登录 */
    const loginTwoFactor = async (challengeToken: string, code: string, useBackupCode: boolean = false) => {
        try {
            const res = await api.post('/auth/login/2fa', { challengeToken, code, useBackupCode });
            if (res.data.success) {
                setStoredToken(res.data.token);
                setToken(res.data.token);
                setIsAuthenticated(true);
                setUser(res.data.user || null);
                return { success: true, user: res.data.user };
            }
            return { success: false, msg: res.data.msg || getLocaleMessage(resolveUiLocale(), 'pages.login.twoFactorFailed') };
        } catch (err: any) {
            const data = err.response?.data;
            return {
                success: false,
                msg: data?.msg || getLocaleMessage(resolveUiLocale(), 'comp.common.operationFailed'),
            };
        }
    };

    /** 注册 */
    const register = async (username: string, email: string, password: string, inviteCode: string = '') => {
        try {
            const res = await api.post('/auth/register', { username, email, password, inviteCode });
            return res.data;
        } catch (err: any) {
            return err.response?.data || {
                success: false,
                msg: getLocaleMessage(resolveUiLocale(), 'comp.common.createFailed'),
            };
        }
    };

    /** 邮箱验证 */
    const verifyEmail = async (email: string, code: string) => {
        try {
            const res = await api.post('/auth/verify-email', { email, code });
            return res.data;
        } catch (err: any) {
            return err.response?.data || { success: false, msg: '验证失败' };
        }
    };

    /** 重发验证码 */
    const resendCode = async (email: string) => {
        try {
            const res = await api.post('/auth/resend-code', { email });
            return res.data;
        } catch (err: any) {
            return err.response?.data || { success: false, msg: '发送失败' };
        }
    };

    /** 请求找回密码验证码 */
    const requestPasswordReset = async (email: string) => {
        try {
            const res = await api.post('/auth/forgot-password', { email });
            return res.data;
        } catch (err: any) {
            return err.response?.data || { success: false, msg: '发送失败' };
        }
    };

    /** 通过验证码重置密码 */
    const resetPassword = async (email: string, code: string, newPassword: string) => {
        try {
            const res = await api.post('/auth/reset-password', { email, code, newPassword });
            return res.data;
        } catch (err: any) {
            return err.response?.data || { success: false, msg: '重置失败' };
        }
    };

    const logout = () => {
        clearStoredToken();
        clearAppSessionState();
        setToken(null);
        setIsAuthenticated(false);
        setUser(null);
    };

    const patchUser = useCallback((nextUser: Partial<User & Record<string, any>>) => {
        setUser((current) => ({
            ...(current || ({} as User)),
            ...(nextUser || {}),
        }));
    }, []);

    return (
        <AuthContext.Provider value={{
            isAuthenticated, loading,
            login, loginTwoFactor, logout,
            register, verifyEmail, resendCode,
            requestPasswordReset, resetPassword,
            user,
            token,
            refreshAuth: checkAuth,
            patchUser,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextType {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
