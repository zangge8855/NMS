import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Header from '../Layout/Header.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy.js';

function getAccountCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Account',
            profileTitle: 'Account Info',
            passwordTitle: 'Password',
            username: 'Username',
            role: 'Role',
            email: 'Login Email',
            verified: 'Verified',
            unverified: 'Unverified',
            userRole: 'User',
            adminRole: 'Admin',
            saveProfile: 'Save Account',
            savingProfile: 'Saving',
            profileSaved: 'Account updated',
            profileSaveFailed: 'Failed to update account',
            usernameRequired: 'Username is required',
            emailInvalid: 'Invalid email address',
            currentPassword: 'Current Password',
            newPassword: 'New Password',
            confirmPassword: 'Confirm New Password',
            changePassword: 'Change Password',
            passwordChanged: 'Password updated',
            passwordChangeFailed: 'Failed to update password',
            passwordMismatch: 'The new passwords do not match',
            fillAllPasswordFields: 'Fill in all password fields',
        };
    }

    return {
        title: '账户',
        profileTitle: '账户信息',
        passwordTitle: '登录密码',
        username: '用户名',
        role: '角色',
        email: '登录邮箱',
        verified: '已验证',
        unverified: '未验证',
        userRole: '用户',
        adminRole: '管理员',
        saveProfile: '保存账户',
        savingProfile: '正在保存',
        profileSaved: '账户信息已更新',
        profileSaveFailed: '更新账户信息失败',
        usernameRequired: '用户名不能为空',
        emailInvalid: '邮箱格式不正确',
        currentPassword: '当前密码',
        newPassword: '新密码',
        confirmPassword: '确认新密码',
        changePassword: '修改密码',
        passwordChanged: '密码修改成功',
        passwordChangeFailed: '修改密码失败',
        passwordMismatch: '两次输入的新密码不一致',
        fillAllPasswordFields: '请填写完整的密码字段',
    };
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
    return String(value || '').trim();
}

export default function AccountCenter() {
    const { user, patchUser } = useAuth();
    const { locale } = useI18n();
    const copy = useMemo(() => getAccountCopy(locale), [locale]);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [profileSaving, setProfileSaving] = useState(false);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);

    const loginEmail = normalizeEmail(user?.email);
    const loginUsername = normalizeUsername(user?.username);
    const roleLabel = user?.role === 'admin' ? copy.adminRole : copy.userRole;
    const profileChanged = normalizeUsername(username) !== loginUsername || normalizeEmail(email) !== loginEmail;

    useEffect(() => {
        setUsername(loginUsername);
        setEmail(loginEmail);
    }, [loginEmail, loginUsername]);

    const handleSaveProfile = async () => {
        const nextUsername = normalizeUsername(username);
        const nextEmail = normalizeEmail(email);
        if (!nextUsername) {
            toast.error(copy.usernameRequired);
            return;
        }
        if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
            toast.error(copy.emailInvalid);
            return;
        }

        setProfileSaving(true);
        try {
            const res = await api.put('/auth/profile', {
                username: nextUsername,
                email: nextEmail,
            });
            patchUser?.(res.data?.obj || { username: nextUsername, email: nextEmail });
            toast.success(res.data?.msg || copy.profileSaved);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || copy.profileSaveFailed);
        }
        setProfileSaving(false);
    };

    const handleChangePassword = async () => {
        const currentPassword = String(oldPassword || '');
        const nextPassword = String(newPassword || '');
        const repeatedPassword = String(confirmPassword || '');

        if (!currentPassword || !nextPassword || !repeatedPassword) {
            toast.error(copy.fillAllPasswordFields);
            return;
        }
        if (nextPassword !== repeatedPassword) {
            toast.error(copy.passwordMismatch);
            return;
        }

        const passwordError = getPasswordPolicyError(nextPassword, locale);
        if (passwordError) {
            toast.error(passwordError);
            return;
        }

        setPasswordSaving(true);
        try {
            await api.put('/auth/change-password', {
                oldPassword: currentPassword,
                newPassword: nextPassword,
            });
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
            toast.success(copy.passwordChanged);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || copy.passwordChangeFailed);
        }
        setPasswordSaving(false);
    };

    return (
        <>
            <Header title={copy.title} />
            <div className="page-content page-content--wide page-enter account-page">
                <div className="account-shell">
                    <div className="card account-profile-card">
                        <SectionHeader
                            className="card-header section-header section-header--compact"
                            title={copy.profileTitle}
                        />
                        <div className="account-profile-grid">
                            <div className="form-group mb-0">
                                <label className="form-label" htmlFor="account-username">{copy.username}</label>
                                <input
                                    id="account-username"
                                    className="form-input"
                                    value={username}
                                    onChange={(event) => setUsername(event.target.value)}
                                    autoComplete="username"
                                />
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">{copy.role}</label>
                                <div className="account-role-row">
                                    <span className={`badge ${user?.role === 'admin' ? 'badge-warning' : 'badge-neutral'}`}>{roleLabel}</span>
                                    <span className={`badge ${user?.emailVerified ? 'badge-success' : 'badge-neutral'}`}>
                                        {user?.emailVerified ? copy.verified : copy.unverified}
                                    </span>
                                </div>
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label" htmlFor="account-email">{copy.email}</label>
                                <input
                                    id="account-email"
                                    type="email"
                                    className="form-input"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    autoComplete="email"
                                    placeholder="user@example.com"
                                />
                            </div>
                        </div>
                        <div className="account-actions">
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleSaveProfile}
                                disabled={profileSaving || !profileChanged}
                            >
                                {profileSaving ? <span className="spinner" /> : copy.saveProfile}
                            </button>
                        </div>
                    </div>

                    <div className="card account-password-card">
                        <SectionHeader
                            className="card-header section-header section-header--compact"
                            title={copy.passwordTitle}
                        />
                        <div className="account-password-grid">
                            <div className="form-group mb-0">
                                <label className="form-label" htmlFor="account-current-password">{copy.currentPassword}</label>
                                <input
                                    id="account-current-password"
                                    type="password"
                                    className="form-input"
                                    value={oldPassword}
                                    onChange={(event) => setOldPassword(event.target.value)}
                                    autoComplete="current-password"
                                />
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label" htmlFor="account-new-password">{copy.newPassword}</label>
                                <input
                                    id="account-new-password"
                                    type="password"
                                    className="form-input"
                                    value={newPassword}
                                    onChange={(event) => setNewPassword(event.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label" htmlFor="account-confirm-password">{copy.confirmPassword}</label>
                                <input
                                    id="account-confirm-password"
                                    type="password"
                                    className="form-input"
                                    value={confirmPassword}
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                            <div className="account-password-submit">
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={handleChangePassword}
                                    disabled={passwordSaving || !oldPassword || !newPassword || !confirmPassword}
                                >
                                    {passwordSaving ? <span className="spinner" /> : copy.changePassword}
                                </button>
                            </div>
                        </div>
                        <div className="text-xs text-muted mt-3">{getPasswordPolicyHint(locale)}</div>
                    </div>
                </div>
            </div>
        </>
    );
}
