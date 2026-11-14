import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api, { setStoredToken } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/LanguageContext';
import { getPasswordPolicyError } from '../../utils/passwordPolicy';
import { getErrorMessage } from '../../utils/format';
import { HiOutlineEye, HiOutlineEyeSlash } from 'react-icons/hi2';
import { acquireModalStackSlot } from '../UI/ModalShell';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

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
        loadFailed: '安全状态检测失败',
        applyFailed: '安全启动向导执行失败',
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
        loadFailed: 'Failed to check security status',
        applyFailed: 'Security bootstrap failed',
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
    const { locale, t } = useI18n();
    const copy = useMemo(() => getCopy(locale), [locale]);
    const isMountedRef = useRef(true);
    const statusRequestIdRef = useRef(0);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showAdminPassword, setShowAdminPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            statusRequestIdRef.current += 1;
        };
    }, []);

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
            if (isMountedRef.current) setLoading(false);
            return;
        }

        const requestId = statusRequestIdRef.current + 1;
        statusRequestIdRef.current = requestId;
        setLoading(true);
        try {
            const res = await api.get('/system/security/bootstrap-status');
            if (!isMountedRef.current || requestId !== statusRequestIdRef.current) return;
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
            if (!isMountedRef.current || requestId !== statusRequestIdRef.current) return;
            toast.error(error.response?.data?.msg || error.message || copy.loadFailed);
        } finally {
            if (isMountedRef.current && requestId === statusRequestIdRef.current) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        if (user?.role !== 'admin') return undefined;
        loadStatus();
        return undefined;
    }, [user?.role]);

    const isWizardVisible = user?.role === 'admin' && status.required && !(loading && !status.required);

    useEffect(() => {
        if (!isWizardVisible || typeof document === 'undefined') return undefined;

        const stackSlot = acquireModalStackSlot();
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const container = overlayRef.current;

        if (container && (!document.activeElement || !container.contains(document.activeElement))) {
            const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
            if (focusable.length > 0) {
                focusable[0].focus();
            }
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Tab' || !stackSlot.isTopmost()) return;
            const currentContainer = overlayRef.current;
            if (!currentContainer) return;
            const focusable = Array.from(currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
                .filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey) {
                if (active === first || !currentContainer.contains(active)) {
                    event.preventDefault();
                    last.focus();
                }
            } else if (active === last || !currentContainer.contains(active)) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            stackSlot.release();
            if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
                previousFocus.focus();
            }
        };
    }, [isWizardVisible]);

    if (!isWizardVisible) return null;

    const canSubmit = Boolean(
        draft.adminUsername.trim()
        && draft.adminPassword
        && draft.confirmPassword
        && draft.jwtSecret.trim()
        && draft.credentialsSecret.trim()
    );

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!canSubmit || saving) return;

        if (draft.adminPassword !== draft.confirmPassword) {
            toast.error(copy.confirmMismatch);
            return;
        }

        const policyError = getPasswordPolicyError(draft.adminPassword, locale);
        if (policyError) {
            toast.error(policyError);
            return;
        }

        setSaving(true);
        try {
            const res = await api.post('/system/security/bootstrap', {
                adminUsername: draft.adminUsername.trim(),
                adminPassword: draft.adminPassword,
                jwtSecret: draft.jwtSecret.trim(),
                credentialsSecret: draft.credentialsSecret.trim(),
            });
            if (!isMountedRef.current) return;
            const payload = res.data?.obj || {};
            if (payload.token) {
                setStoredToken(payload.token);
                await refreshAuth();
                if (!isMountedRef.current) return;
            }
            setStatus((current) => ({
                ...current,
                required: false,
                issues: [],
            }));
            toast.success(copy.applySuccess);
        } catch (error) {
            if (!isMountedRef.current) return;
            toast.error(getErrorMessage(error, copy.applyFailed, locale));
        } finally {
            if (isMountedRef.current) {
                setSaving(false);
            }
        }
    };

    return (
        <div ref={overlayRef} className="security-bootstrap-overlay" role="dialog" aria-modal="true" aria-labelledby="security-bootstrap-title">
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
                <form className="security-bootstrap-form" onSubmit={handleSubmit}>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.adminUsername}</span>
                        <input
                            className="form-input"
                            value={draft.adminUsername}
                            onChange={(event) => setDraft((current) => ({ ...current, adminUsername: event.target.value }))}
                            disabled={saving}
                            autoComplete="username"
                        />
                    </label>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.adminPassword}</span>
                        <div className="input-icon-wrapper">
                            <input
                                className="form-input input-with-trailing-action"
                                type={showAdminPassword ? 'text' : 'password'}
                                value={draft.adminPassword}
                                onChange={(event) => setDraft((current) => ({ ...current, adminPassword: event.target.value }))}
                                disabled={saving}
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                className="input-trailing-action-btn"
                                onClick={() => setShowAdminPassword((prev) => !prev)}
                                tabIndex={-1}
                                aria-label={t(showAdminPassword ? 'comp.common.hidePassword' : 'comp.common.showPassword')}
                            >
                                {showAdminPassword ? <HiOutlineEyeSlash /> : <HiOutlineEye />}
                            </button>
                        </div>
                    </label>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.confirmPassword}</span>
                        <div className="input-icon-wrapper">
                            <input
                                className="form-input input-with-trailing-action"
                                type={showConfirmPassword ? 'text' : 'password'}
                                value={draft.confirmPassword}
                                onChange={(event) => setDraft((current) => ({ ...current, confirmPassword: event.target.value }))}
                                disabled={saving}
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                className="input-trailing-action-btn"
                                onClick={() => setShowConfirmPassword((prev) => !prev)}
                                tabIndex={-1}
                                aria-label={t(showConfirmPassword ? 'comp.common.hidePassword' : 'comp.common.showPassword')}
                            >
                                {showConfirmPassword ? <HiOutlineEyeSlash /> : <HiOutlineEye />}
                            </button>
                        </div>
                    </label>
                    <label className="security-bootstrap-field">
                        <span className="security-bootstrap-label">{copy.jwtSecret}</span>
                        <div className="security-bootstrap-inline">
                            <input
                                className="form-input font-mono"
                                value={draft.jwtSecret}
                                onChange={(event) => setDraft((current) => ({ ...current, jwtSecret: event.target.value }))}
                                disabled={saving}
                                spellCheck={false}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setDraft((current) => ({ ...current, jwtSecret: generateSecret(24) }))}
                                disabled={saving}
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
                                disabled={saving}
                                spellCheck={false}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setDraft((current) => ({ ...current, credentialsSecret: generateSecret(24) }))}
                                disabled={saving}
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
                            type="submit"
                            className="btn btn-danger"
                            disabled={!canSubmit || saving}
                        >
                            {saving ? copy.applying : copy.apply}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
