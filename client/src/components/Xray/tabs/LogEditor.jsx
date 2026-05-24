import React from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';

export default function LogEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    return (
        <XrayJsonEditor
            locale={locale}
            label={locale === 'en-US' ? 'Log Settings' : '日志配置'}
            description={
                locale === 'en-US'
                    ? 'Update the log configuration block. Submit null to clear the block.'
                    : '更新 log 日志段。提交 null 可清空配置。'
            }
            initialValue={value}
            allowNull
            onSave={onSave}
            saving={saving}
            hint={
                locale === 'en-US'
                    ? 'Schema: { loglevel?, access?, error?, maskAddress?, dnsLog? }'
                    : '结构: { loglevel?, access?, error?, maskAddress?, dnsLog? }'
            }
        />
    );
}
