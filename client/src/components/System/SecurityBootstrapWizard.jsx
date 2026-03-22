import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api, { setStoredToken } from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';

const SECURITY_BOOTSTRAP_COPY = {
    'zh-CN': {
        title: '首次部署安全向导',
        subtitle: '检测到当前环境仍在使用弱凭据或默认密钥。完成修复前，主面板将保持锁定。',
        issueTitle: '待修复项',
        envFile: '环境文件',
        adminUsername: '管理员用户名',
        adminPassword: '管理员密码',
        confirmPassword: '确认新密码',
        jwtSecret: 'JWT 密钥',
        credentialsSecret: '凭据加密密钥',
        statsTitle: '现有运行数据',
        serverCount: '已登记节点',
        telegramConfigured: 'Telegram 密钥',
        telegramReady: '已配置',
        telegramEmpty: '未配置',
        autoGenerate: '生成随机值',
        apply: '应用并解锁面板',
        applying: '正在加固配置',
        retry: '重新检测',
        confirmMismatch: '两次输入的管理员密码不一致',
        applySuccess: '安全启动向导已完成，面板已解锁',
        rotateHint: '若系统中已保存节点凭据或 Telegram Token，向导会同步完成重加密。',
    },
    'en-US': {
        title: 'First-Run Security Wizard',
        subtitle: 'Weak credentials or default secrets were detected. The admin console stays locked until they are fixed.',
        issueTitle: 'Required Fixes',
        envFile: 'Environment File',
        adminUsername: 'Admin Username',
        adminPassword: 'Admin Password',
        confirmPassword: 'Confirm Password',
        jwtSecret: 'JWT Secret',
        credentialsSecret: 'Credential Encryption Secret',
        statsTitle: 'Runtime Inventory',
        serverCount: 'Registered Nodes',
        telegramConfigured: 'Telegram Secret',
        telegramReady: 'Configured',
        telegramEmpty: 'Not configured',
        autoGenerate: 'Generate',
        apply: 'Apply and Unlock',
        applying: 'Hardening configuration',
        retry: 'Retry Check',
        confirmMismatch: 'The admin passwords do not match',
        applySuccess: 'Security bootstrap completed. The console is now unlocked.',
        rotateHint: 'Stored node credentials and Telegram tokens will be re-encrypted during the wizard when needed.',
    },
};

function generateSecret(length = 48) {
    const size = Math.max(24, Number(length) || 48);
    const bytes = new Uint8Array(size);
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < size; index += 1) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function getCopy(locale = 'zh-CN') {
    return SECURITY_BOOTSTRAP_COPY[locale === 'en-US' ? 'en-US' : 'zh-CN'];
}

export default function SecurityBootstrapWizard() {
    const { user, refreshAuth } = useAuth();
    const { locale } = useI18n();
    const copy = useMemo(() => getCopy(locale), [locale]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState({
        required: false,
        issues: [],
        admin: { username: '' },
        stats: { serverCount: 0, telegramConfigured: false },
        envFile: '',
    });
    const [draft, setDraft] = useState({
        adminUsername: '',
        adminPassword: '',
        confirmPassword: '',
        jwtSecret: '',
        credentialsSecret: '',
    });

    const initializeDraft = (nextStatus) => {
        setDraft({
            adminUsername: String(nextStatus?.admin?.username || user?.username || '').trim(),
            adminPassword: '',
            confirmPassword: '',
            jwtSecret: generateSecret(24),
            credentialsSecret: generateSecret(24),
        });
    };

    const loadStatus = async ({ preserveDraft = false } = {}) => {
        if (user?.role !== 'admin') {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const res = await api.get('/system/security/bootstrap-status');
            const payload = res.data?.obj || {};
            setStatus({
                required: payload.required === true,
                issues: Array.isArray(payload.issues) ? payload.issues : [],
                admin: payload.admin || { username: user?.username || '' },
                stats: payload.stats || { serverCount: 0, telegramConfigured: false },
                envFile: String(payload.envFile || '').trim(),
            });
            if (!preserveDraft) {
                initializeDraft(payload);
            }
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '安全状态检测失败');
        }
        setLoading(false);
    };

    useEffect(() => {
        if (user?.role !== 'admin') return undefined;
        loadStatus();
        return undefined;
    }, [user?.role]);

    if (user?.role !== 'admin') return null;
    if (loading && !status.required) return null;
    if (!status.required) return null;

    const canSubmit = Boolean(
        draft.adminUsername.trim()
        && draft.adminPassword
        && draft.confirmPassword
        && draft.jwtSecret.trim()
        && draft.credentialsSecret.trim()
    );

    const handleSubmit = async () => {
        if (draft.adminPassword !== draft.confirmPassword) {
            toast.error(copy.confirmMismatch);
            return;
        }

        setSaving(true);
        try {
            const res = await api.post('/system/security/bootstrap', {
                adminUsername: draft.adminUsername,
                adminPassword: draft.adminPassword,
                jwtSecret: draft.jwtSecret,
                credentialsSecret: draft.credentialsSecret,
            });
            const payload = res.data?.obj || {};
            if (payload.token) {
                setStoredToken(payload.token);
                await refreshAuth();
            }
            setStatus((current) => ({
                ...current,
                required: false,
                issues: [],
            }));
            toast.success(copy.applySuccess);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '安全启动向导执行失败');
        }
        setSaving(false);
    };

    return (
        <div className="security-bootstrap-overlay" role="dialog" aria-modal="true" aria-labelledby="security-bootstrap-title">
            <div className="security-bootstrap-shell">
                <div className="security-bootstrap-copy">
                    <div className="security-bootstrap-kicker">NMS Security</div>
                    <h2 id="security-bootstrap-title" className="security-bootstrap-title">{copy.title}</h2>
                    <p className="security-bootstrap-subtitle">{copy.subtitle}</p>
                    <div className="security-bootstrap-callout">
                        <div className="security-bootstrap-callout-title">{copy.issueTitle}</div>
                        <div className="security-bootstrap-issue-list">
                            {status.issues.map((item) => (
                                <div key={item.code || item.message} className="security-bootstrap-issue">
                                    <span className="security-bootstrap-issue-code">{item.code}</span>
                                    <span className="security-bootstrap-issue-text">{item.message}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="security-bootstrap-meta-grid">
                        <div className="security-bootstrap-meta-card">
                            <div className="security-bootstrap-meta-label">{copy.envFile}</div>
                            <div className="security-bootstrap-meta-value">{status.envFile || '-'}</div>
                        </div>
                        <div className="security-bootstrap-meta-card">
                            <div className="security-bootstrap-meta-label">{copy.statsTitle}</div>
                            <div className="security-bootstrap-meta-value">
                                {copy.serverCount}: {status.stats?.serverCount || 0}
                            </div>
                            <div className="security-bootstrap-meta-detail">
                                {copy.telegramConfigured}: {status.stats?.telegramConfigured ? copy.telegramReady : copy.telegramEmpty}
                            </div>
                        </div>
                    </div>
                    <div className="security-bootstrap-note">{copy.rotateHint}</div>
                </div>
                <div className="security-bootstrap-form">
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.adminUsername}</span>
                        <input
                            className="form-input"
                            value={draft.adminUsername}
                            onChange={(event) => setDraft((current) => ({ ...current, adminUsername: event.target.value }))}
                            autoComplete="username"
                        />
                    </label>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.adminPassword}</span>
                        <input
                            className="form-input"
                            type="password"
                            value={draft.adminPassword}
                            onChange={(event) => setDraft((current) => ({ ...current, adminPassword: event.target.value }))}
                            autoComplete="new-password"
                        />
                    </label>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.confirmPassword}</span>
                        <input
                            className="form-input"
                            type="password"
                            value={draft.confirmPassword}
                            onChange={(event) => setDraft((current) => ({ ...current, confirmPassword: event.target.value }))}
                            autoComplete="new-password"
                        />
                    </label>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.jwtSecret}</span>
                        <div className="security-bootstrap-inline">
                            <input
                                className="form-input font-mono"
                                value={draft.jwtSecret}
                                onChange={(event) => setDraft((current) => ({ ...current, jwtSecret: event.target.value }))}
                                spellCheck={false}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setDraft((current) => ({ ...current, jwtSecret: generateSecret(24) }))}
                            >
                                {copy.autoGenerate}
                            </button>
                        </div>
                    </label>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.credentialsSecret}</span>
                        <div className="security-bootstrap-inline">
                            <input
                                className="form-input font-mono"
                                value={draft.credentialsSecret}
                                onChange={(event) => setDraft((current) => ({ ...current, credentialsSecret: event.target.value }))}
                                spellCheck={false}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setDraft((current) => ({ ...current, credentialsSecret: generateSecret(24) }))}
                            >
                                {copy.autoGenerate}
                            </button>
                        </div>
                    </label>
                    <div className="security-bootstrap-actions">
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => loadStatus({ preserveDraft: true })}
                            disabled={saving}
                        >
                            {copy.retry}
                        </button>
                        <button
                            type="button"
                            className="btn btn-danger"
                            onClick={handleSubmit}
                            disabled={!canSubmit || saving}
                        >
                            {saving ? copy.applying : copy.apply}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
