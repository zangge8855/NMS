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
            subscriptionEmail: 'Subscription Email',
            verified: 'Verified',
            unverified: 'Unverified',
            unset: 'Not set',
            userRole: 'User',
            adminRole: 'Admin',
            saveProfile: 'Save Account',
            savingProfile: 'Saving',
            profileSaved: 'Account updated',
            profileSaveFailed: 'Failed to update account',
            emailInvalid: 'Invalid email address',
            followsLogin: 'The subscription email currently follows the login email and will be updated together.',
            separateBinding: 'The subscription email is bound separately and will stay unchanged.',
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
        title: '账号',
        profileTitle: '账号信息',
        passwordTitle: '登录密码',
        username: '用户名',
        role: '角色',
        email: '登录邮箱',
        subscriptionEmail: '订阅邮箱',
        verified: '已验证',
        unverified: '未验证',
        unset: '未设置',
        userRole: '用户',
        adminRole: '管理员',
        saveProfile: '保存账号',
        savingProfile: '正在保存',
        profileSaved: '账号信息已更新',
        profileSaveFailed: '更新账号信息失败',
        emailInvalid: '邮箱格式不正确',
        followsLogin: '当前订阅邮箱跟随登录邮箱，保存后会一起同步。',
        separateBinding: '当前订阅邮箱已单独绑定，不会随登录邮箱一起变化。',
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

export default function AccountCenter() {
    const { user, patchUser } = useAuth();
    const { locale } = useI18n();
    const copy = useMemo(() => getAccountCopy(locale), [locale]);
    const [email, setEmail] = useState('');
    const [profileSaving, setProfileSaving] = useState(false);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);

    const loginEmail = normalizeEmail(user?.email);
    const subscriptionEmail = normalizeEmail(user?.subscriptionEmail);
    const roleLabel = user?.role === 'admin' ? copy.adminRole : copy.userRole;
    const profileChanged = normalizeEmail(email) !== loginEmail;

    useEffect(() => {
        setEmail(loginEmail);
    }, [loginEmail]);

    const handleSaveProfile = async () => {
        const nextEmail = normalizeEmail(email);
        if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
            toast.error(copy.emailInvalid);
            return;
        }

        setProfileSaving(true);
        try {
            const res = await api.put('/auth/profile', { email: nextEmail });
            patchUser?.(res.data?.obj || { email: nextEmail });
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
                            meta={(
                                <span className="text-xs text-muted">
                                    {String(user?.username || '-').trim() || '-'}
                                </span>
                            )}
                        />
                        <div className="account-profile-grid">
                            <div className="form-group mb-0">
                                <label className="form-label">{copy.username}</label>
                                <input className="form-input" value={String(user?.username || '')} readOnly />
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
                                <label className="form-label">{copy.email}</label>
                                <input
                                    type="email"
                                    className="form-input"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    autoComplete="email"
                                    placeholder="user@example.com"
                                />
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">{copy.subscriptionEmail}</label>
                                <input className="form-input" value={subscriptionEmail || copy.unset} readOnly />
                            </div>
                        </div>
                        <div className="account-profile-note">
                            {copy.separateBinding}
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
                                <label className="form-label">{copy.currentPassword}</label>
                                <input
                                    type="password"
                                    className="form-input"
                                    value={oldPassword}
                                    onChange={(event) => setOldPassword(event.target.value)}
                                    autoComplete="current-password"
                                />
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">{copy.newPassword}</label>
                                <input
                                    type="password"
                                    className="form-input"
                                    value={newPassword}
                                    onChange={(event) => setNewPassword(event.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">{copy.confirmPassword}</label>
                                <input
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
