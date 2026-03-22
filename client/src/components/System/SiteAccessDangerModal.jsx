import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Checkbox, Input, Button, Row, Col, Card, Typography, Space } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

function statusLabel(enabled) {
    return enabled ? '开启' : '关闭';
}

export default function SiteAccessDangerModal({
    open = false,
    previousPath = '/',
    nextPath = '/',
    previousCamouflageEnabled = false,
    nextCamouflageEnabled = false,
    onClose,
    onConfirm,
    saving = false,
}) {
    const [acknowledged, setAcknowledged] = useState(false);
    const [typedPath, setTypedPath] = useState('');

    useEffect(() => {
        if (!open) return;
        setAcknowledged(false);
        setTypedPath('');
    }, [open, nextPath, nextCamouflageEnabled]);

    const canConfirm = useMemo(() => {
        return acknowledged && String(typedPath || '').trim() === String(nextPath || '').trim();
    }, [acknowledged, nextPath, typedPath]);

    return (
        <Modal
            title={
                <Space>
                    <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                    <span>高危访问路径变更确认</span>
                </Space>
            }
            open={open}
            onCancel={saving ? undefined : onClose}
            footer={[
                <Button key="back" onClick={onClose} disabled={saving}>
                    取消
                </Button>,
                <Button
                    key="submit"
                    type="primary"
                    danger
                    loading={saving}
                    onClick={onConfirm}
                    disabled={!canConfirm}
                >
                    确认保存高危变更
                </Button>,
            ]}
            width={600}
            centered
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <Paragraph type="secondary">
                    修改真实入口路径或伪装站开关后，旧地址可能立即失效。请确认你已经备份新路径，并且具备恢复访问的备用方式。
                </Paragraph>

                <Row gutter={[16, 16]}>
                    <Col span={12}>
                        <Card size="small" title="当前真实入口">
                            <Text code>{previousPath}</Text>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card size="small" title="保存后真实入口" headStyle={{ background: 'rgba(255, 77, 79, 0.1)' }}>
                            <Text code strong type="danger">{nextPath}</Text>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card size="small" title="当前伪装首页">
                            <Text>{statusLabel(previousCamouflageEnabled)}</Text>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card size="small" title="保存后伪装首页" headStyle={{ background: 'rgba(255, 77, 79, 0.1)' }}>
                            <Text strong type="danger">{statusLabel(nextCamouflageEnabled)}</Text>
                        </Card>
                    </Col>
                </Row>

                <Checkbox
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                >
                    我已备份新路径，并确认能够从 {nextPath} 重新进入管理面板
                </Checkbox>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Text>请输入新的真实入口路径以继续保存</Text>
                    <Input
                        value={typedPath}
                        onChange={(event) => setTypedPath(event.target.value)}
                        placeholder={nextPath}
                        className="font-mono"
                    />
                </div>
            </div>
        </Modal>
    );
}
