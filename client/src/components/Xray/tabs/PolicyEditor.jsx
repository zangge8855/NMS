import React from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';

export default function PolicyEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    return (
        <XrayJsonEditor
            locale={locale}
            label={locale === 'en-US' ? 'System Policy' : '系统策略'}
            description={
                locale === 'en-US'
                    ? 'Update the system policy configuration block. Submit null to clear the block.'
                    : '更新 policy 策略段。提交 null 可清空配置。'
            }
            initialValue={value}
            allowNull
            onSave={onSave}
            saving={saving}
            hint={
                locale === 'en-US'
                    ? 'Schema: { levels?, system? }'
                    : '结构: { levels?, system? }'
            }
        />
    );
}
