import React from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';

export default function BalancersEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    return (
        <XrayJsonEditor
            locale={locale}
            label={locale === 'en-US' ? 'Balancers' : '负载均衡器'}
            description={
                locale === 'en-US'
                    ? 'Submit the full balancers array. Each entry: { tag, selector: [outboundTag...], strategy?, fallbackTag? }.'
                    : '提交完整的 balancers 数组。每条结构: { tag, selector: [outboundTag...], strategy?, fallbackTag? }。'
            }
            initialValue={value}
            expectArray
            onSave={onSave}
            saving={saving}
            hint={
                locale === 'en-US'
                    ? 'Reference balancer tags from routing rules via the balancerTag field.'
                    : '路由规则通过 balancerTag 字段引用此处的 tag。'
            }
        />
    );
}
