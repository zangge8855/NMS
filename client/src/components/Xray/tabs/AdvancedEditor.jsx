import React from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';

export default function AdvancedEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    return (
        <XrayJsonEditor
            locale={locale}
            label={locale === 'en-US' ? 'Advanced Xray Template' : '高级 Xray 完整配置模板'}
            description={
                locale === 'en-US'
                    ? 'Update the entire Xray template configuration JSON block. Be extremely careful when saving.'
                    : '更新完整 Xray 配置模板 JSON 块。保存时请务必谨慎！'
            }
            initialValue={value}
            onSave={onSave}
            saving={saving}
            hint={
                locale === 'en-US'
                    ? 'Schema: { log?, api?, dns?, routing?, policy?, outbounds: [...], inbounds: [...] }'
                    : '结构: { log?, api?, dns?, routing?, policy?, outbounds: [...], inbounds: [...] }'
            }
        />
    );
}
