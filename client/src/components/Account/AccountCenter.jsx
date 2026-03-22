import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, Typography, Button, Input, Space, Row, Col, Tag, Divider } from 'antd';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy.js';

const { Title, Text, Paragraph } = Typography;

function getAccountCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Account',
            profileTitle: 'Account Info',
            profileSubtitle: 'Review the current login identity and confirm any change from the existing mailbox first.',
            passwordTitle: 'Password',
            passwordSubtitle: 'Rotate the login password here and keep it aligned with the active password policy.',
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
            profileVerifyCode: 'Verification Code',
            profileVerifyHint: 'Any username or email change must be confirmed through the current login email first.',
            profileVerifySent: 'The code was sent to {email}',
            profileVerifySend: 'Send Code',
            profileVerifyResend: 'Resend Code',
            profileVerifySending: 'Sending',
            profileVerifySendFailed: 'Failed to send verification code',
            profileVerifyRequired: 'Send the verification code to the current login email first',
            profileVerifyCodeRequired: 'Enter the verification code from the current login email',
            profileVerifyPlaceholder: 'Enter the 6-digit code',
            profileNoChanges: 'No account changes to save',
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
        profileSubtitle: '检查当前登录身份，并在修改前先通过旧邮箱完成验证码确认。',
        passwordTitle: '登录密码',
        passwordSubtitle: '在这里更新登录密码，并确保新密码符合当前密码策略。',
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
        profileVerifyCode: '邮箱验证码',
        profileVerifyHint: '修改用户名或登录邮箱前，必须先通过当前旧邮箱验证码确认。',
        profileVerifySent: '验证码已发送到 {email}',
        profileVerifySend: '发送验证码',
        profileVerifyResend: '重新发送',
        profileVerifySending: '发送中',
        profileVerifySendFailed: '发送验证码失败',
        profileVerifyRequired: '请先向当前旧邮箱发送验证码',
        profileVerifyCodeRequired: '请输入当前旧邮箱收到的 6 位验证码',
        profileVerifyPlaceholder: '输入 6 位验证码',
        profileNoChanges: '账户信息没有变化',
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
    const [profileCode, setProfileCode] = useState('');
    const [profileCodeSending, setProfileCodeSending] = useState(false);
    const [profileCodeSentTo, setProfileCodeSentTo] = useState('');
    const [profileCodeSentDraftKey, setProfileCodeSentDraftKey] = useState('');
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);

    const loginEmail = normalizeEmail(user?.email);
    const loginUsername = normalizeUsername(user?.username);
    const roleLabel = user?.role === 'admin' ? copy.adminRole : copy.userRole;
    const profileChanged = normalizeUsername(username) !== loginUsername || normalizeEmail(email) !== loginEmail;
    const profileDraftKey = `${normalizeUsername(username)}\n${normalizeEmail(email)}`;

    useEffect(() => {
        setUsername(loginUsername);
        setEmail(loginEmail);
        setProfileCode('');
        setProfileCodeSentTo('');
        setProfileCodeSentDraftKey('');
    }, [loginEmail, loginUsername]);

    useEffect(() => {
        if (!profileCodeSentDraftKey) return;
        if (profileCodeSentDraftKey === profileDraftKey) return;
        setProfileCode('');
        setProfileCodeSentTo('');
        setProfileCodeSentDraftKey('');
    }, [profileCodeSentDraftKey, profileDraftKey]);

    const validateProfileDraft = () => {
        const nextUsername = normalizeUsername(username);
        const nextEmail = normalizeEmail(email);
        if (!nextUsername) {
            toast.error(copy.usernameRequired);
            return null;
        }
        if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
            toast.error(copy.emailInvalid);
            return null;
        }
        if (nextUsername === loginUsername && nextEmail === loginEmail) {
            toast.error(copy.profileNoChanges);
            return null;
        }
        return {
            nextUsername,
            nextEmail,
            draftKey: `${nextUsername}\n${nextEmail}`,
        };
    };

    const handleSendProfileCode = async () => {
        const draft = validateProfileDraft();
        if (!draft) return;

        setProfileCodeSending(true);
        try {
            const res = await api.post('/auth/profile/send-code', {
                username: draft.nextUsername,
                email: draft.nextEmail,
            });
            const sentTo = String(res.data?.obj?.email || loginEmail || '').trim();
            setProfileCode('');
            setProfileCodeSentTo(sentTo);
            setProfileCodeSentDraftKey(draft.draftKey);
            toast.success(res.data?.msg || copy.profileVerifySent.replace('{email}', sentTo));
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || copy.profileVerifySendFailed);
        }
        setProfileCodeSending(false);
    };

    const handleSaveProfile = async () => {
        const draft = validateProfileDraft();
        if (!draft) return;
        const code = String(profileCode || '').trim();
        if (!profileCodeSentTo || profileCodeSentDraftKey !== draft.draftKey) {
            toast.error(copy.profileVerifyRequired);
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            toast.error(copy.profileVerifyCodeRequired);
            return;
        }

        setProfileSaving(true);
        try {
            const res = await api.put('/auth/profile', {
                username: draft.nextUsername,
                email: draft.nextEmail,
                code,
            });
            patchUser?.(res.data?.obj || { username: draft.nextUsername, email: draft.nextEmail });
            setProfileCode('');
            setProfileCodeSentTo('');
            setProfileCodeSentDraftKey('');
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
            <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={12}>
                        <Card 
                            title={<Title level={4} style={{ margin: 0 }}>{copy.profileTitle}</Title>}
                            extra={
                                <Button 
                                    type="primary" 
                                    onClick={handleSaveProfile}
                                    loading={profileSaving}
                                    disabled={!profileChanged || !/^\d{6}$/.test(String(profileCode || '').trim())}
                                >
                                    {copy.saveProfile}
                                </Button>
                            }
                        >
                            <Paragraph type="secondary">{copy.profileSubtitle}</Paragraph>
                            <Space direction="vertical" style={{ width: '100%' }} size="large">
                                <div>
                                    <Text strong block style={{ marginBottom: 8 }}>{copy.username}</Text>
                                    <Input 
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        autoComplete="username"
                                    />
                                </div>
                                <div>
                                    <Text strong block style={{ marginBottom: 8 }}>{copy.role}</Text>
                                    <Space>
                                        <Tag color={user?.role === 'admin' ? 'orange' : 'default'}>{roleLabel}</Tag>
                                        <Tag color={user?.emailVerified ? 'success' : 'default'}>
                                            {user?.emailVerified ? copy.verified : copy.unverified}
                                        </Tag>
                                    </Space>
                                </div>
                                <div>
                                    <Text strong block style={{ marginBottom: 8 }}>{copy.email}</Text>
                                    <Input 
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="email"
                                        placeholder="user@example.com"
                                    />
                                </div>
                                <div>
                                    <Text strong block style={{ marginBottom: 8 }}>{copy.profileVerifyCode}</Text>
                                    <Space.Compact style={{ width: '100%' }}>
                                        <Input 
                                            inputMode="numeric"
                                            autoComplete="one-time-code"
                                            value={profileCode}
                                            onChange={(e) => setProfileCode(e.target.value.replace(/\D+/g, '').slice(0, 6))}
                                            placeholder={copy.profileVerifyPlaceholder}
                                        />
                                        <Button 
                                            type="default" 
                                            onClick={handleSendProfileCode}
                                            loading={profileCodeSending}
                                            disabled={!profileChanged}
                                        >
                                            {profileCodeSentTo ? copy.profileVerifyResend : copy.profileVerifySend}
                                        </Button>
                                    </Space.Compact>
                                    <Text type="secondary" style={{ fontSize: '12px', marginTop: '4px', display: 'block' }}>
                                        {profileCodeSentTo
                                            ? copy.profileVerifySent.replace('{email}', profileCodeSentTo)
                                            : copy.profileVerifyHint}
                                    </Text>
                                </div>
                            </Space>
                        </Card>
                    </Col>

                    <Col xs={24} lg={12}>
                        <Card title={<Title level={4} style={{ margin: 0 }}>{copy.passwordTitle}</Title>}>
                            <Paragraph type="secondary">{copy.passwordSubtitle}</Paragraph>
                            <Space direction="vertical" style={{ width: '100%' }} size="large">
                                <div>
                                    <Text strong block style={{ marginBottom: 8 }}>{copy.currentPassword}</Text>
                                    <Input.Password 
                                        value={oldPassword}
                                        onChange={(e) => setOldPassword(e.target.value)}
                                        autoComplete="current-password"
                                    />
                                </div>
                                <div>
                                    <Text strong block style={{ marginBottom: 8 }}>{copy.newPassword}</Text>
                                    <Input.Password 
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <div>
                                    <Text strong block style={{ marginBottom: 8 }}>{copy.confirmPassword}</Text>
                                    <Input.Password 
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <Button 
                                    type="primary" 
                                    block 
                                    onClick={handleChangePassword}
                                    loading={passwordSaving}
                                    disabled={!oldPassword || !newPassword || !confirmPassword}
                                >
                                    {copy.changePassword}
                                </Button>
                                <Divider />
                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                    {getPasswordPolicyHint(locale)}
                                </Text>
                            </Space>
                        </Card>
                    </Col>
                </Row>
            </div>
        </>
    );
}
