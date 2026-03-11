import React from 'react';

export default function SubscriptionClientLinks({ bundle }) {
    const quickActions = Array.isArray(bundle?.importActions) ? bundle.importActions.filter((item) => String(item?.href || '').trim()) : [];
    const toolSites = Array.isArray(bundle?.toolSites) ? bundle.toolSites.filter((item) => String(item?.url || '').trim()) : [];
    if (quickActions.length === 0 && toolSites.length === 0) return null;

    return (
        <div className="subscription-client-links mt-3">
            {quickActions.length > 0 && (
                <div className="subscription-client-links-section">
                    <div className="text-xs text-muted mb-2">
                        快捷导入：若设备已安装客户端，可直接点开导入订阅。
                    </div>
                    <div className="subscription-quick-actions">
                        {quickActions.map((item) => (
                            <div key={item.key} className="subscription-quick-card">
                                <div className="subscription-quick-card-copy">
                                    <div className="subscription-quick-card-title">{item.label}</div>
                                    <div className="subscription-quick-card-meta">{item.platform}</div>
                                    <div className="subscription-quick-card-hint">{item.hint}</div>
                                </div>
                                <div className="subscription-quick-card-actions">
                                    <a href={item.href} className="btn btn-primary btn-sm">
                                        快捷导入
                                    </a>
                                    {item.siteUrl && (
                                        <a
                                            href={item.siteUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="btn btn-ghost btn-sm"
                                        >
                                            官网
                                        </a>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {toolSites.length > 0 && (
                <div className="subscription-client-links-section">
                    <div className="text-xs text-muted mb-2">
                        常见客户端网址：未安装时可先下载客户端，再使用上方快捷导入或复制订阅地址。
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
            )}
        </div>
    );
}
