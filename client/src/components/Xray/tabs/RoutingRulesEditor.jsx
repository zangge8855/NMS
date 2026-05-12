import React from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';

export default function RoutingRulesEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    return (
        <XrayJsonEditor
            locale={locale}
            label={locale === 'en-US' ? 'Routing Rules' : '路由规则'}
            description={
                locale === 'en-US'
                    ? 'Update the routing block (rules, domainStrategy, balancers). The api rule is automatically kept first by the server.'
                    : '更新 routing 段（rules、domainStrategy、balancers）。服务端会确保 api 规则保持在第一条。'
            }
            initialValue={value}
            onSave={onSave}
            saving={saving}
            hint={
                locale === 'en-US'
                    ? 'Schema: { domainStrategy?, domainMatcher?, rules: [...], balancers: [...] }'
                    : '结构: { domainStrategy?, domainMatcher?, rules: [...], balancers: [...] }'
            }
        />
    );
}
