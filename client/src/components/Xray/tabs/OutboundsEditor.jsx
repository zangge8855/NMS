import React from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';

export default function OutboundsEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    return (
        <XrayJsonEditor
            locale={locale}
            label={locale === 'en-US' ? 'Outbounds' : '出站'}
            description={
                locale === 'en-US'
                    ? 'Submit the full outbounds array. Common protocols: freedom (with finalRules / ipsBlocked), blackhole, wireguard (WARP), vless, vmess, trojan, hysteria2, dns.'
                    : '提交完整的 outbounds 数组。常见协议: freedom（含 finalRules / ipsBlocked）、blackhole、wireguard (WARP)、vless、vmess、trojan、hysteria2、dns。'
            }
            initialValue={value}
            expectArray
            onSave={onSave}
            saving={saving}
            hint={
                locale === 'en-US'
                    ? 'Each entry must have a unique tag and a protocol field.'
                    : '每条 outbound 必须有唯一的 tag 和 protocol 字段。'
            }
        />
    );
}
