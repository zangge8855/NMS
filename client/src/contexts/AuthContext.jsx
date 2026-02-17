import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { getStoredToken, setStoredToken, clearStoredToken } from '../api/client.js';

const AuthContext = createContext(null);

function decodeJwtPayload(token) {
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

export function AuthProvider({ children }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = useCallback(async () => {
        const token = getStoredToken();
        if (!token) {
            setIsAuthenticated(false);
            setUser(null);
            setLoading(false);
            return;
        }
        try {
            const res = await api.get('/auth/check');
            setIsAuthenticated(true);
            setUser(res.data?.user || null);
        } catch (error) {
            const status = Number(error?.response?.status || 0);
            if (status === 401 || status === 403) {
                clearStoredToken();
                setIsAuthenticated(false);
                setUser(null);
            } else {
                const decoded = decodeJwtPayload(token);
                setIsAuthenticated(true);
                setUser((prev) => prev || {
                    username: String(decoded?.username || ''),
                    role: String(decoded?.role || ''),
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

    /** 登录 (username + password) */
    const login = async (username, password) => {
        try {
            const res = await api.post('/auth/login', { username, password });
            if (res.data.success) {
                setStoredToken(res.data.token);
                setIsAuthenticated(true);
                setUser(res.data.user || null);
                return { success: true };
            }
            return { success: false, msg: res.data.msg };
        } catch (err) {
            const data = err.response?.data;
            if (data?.needVerify) {
                return { success: false, msg: data.msg, needVerify: true, email: data.email };
            }
            return { success: false, msg: data?.msg || '连接失败' };
        }
    };

    /** 注册 */
    const register = async (username, email, password) => {
        try {
            const res = await api.post('/auth/register', { username, email, password });
            return res.data;
        } catch (err) {
            return err.response?.data || { success: false, msg: '注册失败' };
        }
    };

    /** 邮箱验证 */
    const verifyEmail = async (email, code) => {
        try {
            const res = await api.post('/auth/verify-email', { email, code });
            return res.data;
        } catch (err) {
            return err.response?.data || { success: false, msg: '验证失败' };
        }
    };

    /** 重发验证码 */
    const resendCode = async (email) => {
        try {
            const res = await api.post('/auth/resend-code', { email });
            return res.data;
        } catch (err) {
            return err.response?.data || { success: false, msg: '发送失败' };
        }
    };

    /** 请求找回密码验证码 */
    const requestPasswordReset = async (email) => {
        try {
            const res = await api.post('/auth/forgot-password', { email });
            return res.data;
        } catch (err) {
            return err.response?.data || { success: false, msg: '发送失败' };
        }
    };

    /** 通过验证码重置密码 */
    const resetPassword = async (email, code, newPassword) => {
        try {
            const res = await api.post('/auth/reset-password', { email, code, newPassword });
            return res.data;
        } catch (err) {
            return err.response?.data || { success: false, msg: '重置失败' };
        }
    };

    const logout = () => {
        clearStoredToken();
        setIsAuthenticated(false);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{
            isAuthenticated, loading,
            login, logout,
            register, verifyEmail, resendCode,
            requestPasswordReset, resetPassword,
            user,
            token: getStoredToken(),
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
