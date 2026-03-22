import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Button,
    Card,
    Col,
    Form,
    Input,
    Modal,
    Row,
    Space,
    Typography,
} from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import toast from 'react-hot-toast';
import api, { setStoredToken } from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';

const { Title, Text, Paragraph } = Typography;

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
        <Modal
            open={true}
            footer={null}
            closable={false}
            maskClosable={false}
            centered
            width={1000}
            styles={{ body: { padding: 0, overflow: 'hidden' } }}
        >
            <Row gutter={0}>
                <Col xs={24} md={10} style={{ padding: '32px', backgroundColor: '#f8fafc', borderRight: '1px solid #e2e8f0' }}>
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                        <div>
                            <Text strong type="secondary" style={{ textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.05em' }}>
                                NMS Security
                            </Text>
                            <Title level={3} style={{ marginTop: '8px' }}>{copy.title}</Title>
                            <Paragraph type="secondary">{copy.subtitle}</Paragraph>
                        </div>

                        {status.issues.length > 0 && (
                            <Alert
                                message={copy.issueTitle}
                                description={
                                    <ul style={{ paddingLeft: '1.25rem', marginBottom: 0, marginTop: '8px' }}>
                                        {status.issues.map((item, idx) => (
                                            <li key={idx}>
                                                <Text type="danger" style={{ fontWeight: 500 }}>{item.code}</Text>
                                                <Text size="small" style={{ marginLeft: '8px' }}>{item.message}</Text>
                                            </li>
                                        ))}
                                    </ul>
                                }
                                type="error"
                                showIcon
                            />
                        )}

                        <Row gutter={[16, 16]}>
                            <Col span={24}>
                                <Card size="small" title={copy.envFile} bordered={false} styles={{ header: { padding: '8px 12px', borderBottom: 0 }, body: { padding: '0 12px 8px' } }}>
                                    <Text code style={{ fontSize: '12px' }}>{status.envFile || '-'}</Text>
                                </Card>
                            </Col>
                            <Col span={24}>
                                <Card size="small" title={copy.statsTitle} bordered={false} styles={{ header: { padding: '8px 12px', borderBottom: 0 }, body: { padding: '0 12px 8px' } }}>
                                    <Space direction="vertical" size={0}>
                                        <Text size="small">{copy.serverCount}: {status.stats?.serverCount || 0}</Text>
                                        <Text size="small" type="secondary">
                                            {copy.telegramConfigured}: {status.stats?.telegramConfigured ? copy.telegramReady : copy.telegramEmpty}
                                        </Text>
                                    </Space>
                                </Card>
                            </Col>
                        </Row>

                        <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: 'auto' }}>
                            {copy.rotateHint}
                        </Text>
                    </Space>
                </Col>
                <Col xs={24} md={14} style={{ padding: '32px' }}>
                    <Form layout="vertical" onFinish={handleSubmit}>
                        <Form.Item label={copy.adminUsername} required>
                            <Input
                                size="large"
                                value={draft.adminUsername}
                                onChange={(event) => setDraft((current) => ({ ...current, adminUsername: event.target.value }))}
                                autoComplete="username"
                            />
                        </Form.Item>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item label={copy.adminPassword} required>
                                    <Input.Password
                                        size="large"
                                        value={draft.adminPassword}
                                        onChange={(event) => setDraft((current) => ({ ...current, adminPassword: event.target.value }))}
                                        autoComplete="new-password"
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label={copy.confirmPassword} required>
                                    <Input.Password
                                        size="large"
                                        value={draft.confirmPassword}
                                        onChange={(event) => setDraft((current) => ({ ...current, confirmPassword: event.target.value }))}
                                        autoComplete="new-password"
                                    />
                                </Form.Item>
                            </Col>
                        </Row>
                        <Form.Item label={copy.jwtSecret} required>
                            <Input
                                size="large"
                                className="font-mono"
                                value={draft.jwtSecret}
                                onChange={(event) => setDraft((current) => ({ ...current, jwtSecret: event.target.value }))}
                                addonAfter={
                                    <Button type="link" size="small" onClick={() => setDraft((current) => ({ ...current, jwtSecret: generateSecret(24) }))}>
                                        {copy.autoGenerate}
                                    </Button>
                                }
                                spellCheck={false}
                            />
                        </Form.Item>
                        <Form.Item label={copy.credentialsSecret} required>
                            <Input
                                size="large"
                                className="font-mono"
                                value={draft.credentialsSecret}
                                onChange={(event) => setDraft((current) => ({ ...current, credentialsSecret: event.target.value }))}
                                addonAfter={
                                    <Button type="link" size="small" onClick={() => setDraft((current) => ({ ...current, credentialsSecret: generateSecret(24) }))}>
                                        {copy.autoGenerate}
                                    </Button>
                                }
                                spellCheck={false}
                            />
                        </Form.Item>
                        <div style={{ marginTop: '32px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <Button
                                size="large"
                                icon={<ReloadOutlined />}
                                onClick={() => loadStatus({ preserveDraft: true })}
                                disabled={saving}
                            >
                                {copy.retry}
                            </Button>
                            <Button
                                size="large"
                                type="primary"
                                danger
                                icon={<SafetyCertificateOutlined />}
                                onClick={handleSubmit}
                                loading={saving}
                                disabled={!canSubmit}
                            >
                                {saving ? copy.applying : copy.apply}
                            </Button>
                        </div>
                    </Form>
                </Col>
            </Row>
        </Modal>
    );
}
