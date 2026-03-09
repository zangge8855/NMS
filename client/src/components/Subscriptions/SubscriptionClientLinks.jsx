import React from 'react';

export default function SubscriptionClientLinks({ bundle }) {
    const toolSites = Array.isArray(bundle?.toolSites) ? bundle.toolSites.filter((item) => String(item?.url || '').trim()) : [];
    if (toolSites.length === 0) return null;

    return (
        <div className="mt-3">
            <div className="text-xs text-muted mb-2">
                常见客户端网址：可先安装客户端，再复制上方对应的专用订阅地址导入。
            </div>
            <div className="flex gap-2 flex-wrap">
                {toolSites.map((item) => (
                    <a
                        key={item.key}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                    >
                        {item.label}
                    </a>
                ))}
            </div>
        </div>
    );
}
