import React from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';

export default function DnsEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    return (
        <XrayJsonEditor
            locale={locale}
            label="DNS"
            description={
                locale === 'en-US'
                    ? 'Update the DNS block. Submit null to clear the block.'
                    : '更新 dns 段。提交 null 可清空配置。'
            }
            initialValue={value}
            allowNull
            onSave={onSave}
            saving={saving}
            hint={
                locale === 'en-US'
                    ? 'Schema: { servers: [...], hosts?, queryStrategy?, clientIp?, tag?, disableCache?, disableFallback? }'
                    : '结构: { servers: [...], hosts?, queryStrategy?, clientIp?, tag?, disableCache?, disableFallback? }'
            }
        />
    );
}
