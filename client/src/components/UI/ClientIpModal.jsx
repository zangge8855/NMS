import React from 'react';
import { HiOutlineArrowPath, HiOutlineTrash, HiOutlineXMark } from 'react-icons/hi2';
import ModalShell from './ModalShell.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { formatDateTime } from '../../utils/format.js';

const CLIENT_IP_COPY = {
    'zh-CN': {
        title: '节点访问 IP',
        description: '3x-ui 记录的是节点代理访问 IP，不是订阅链接访问 IP。',
        refresh: '刷新',
        clear: '清空记录',
        loadFailed: '加载失败',
        empty: '暂无节点访问 IP 记录',
        ip: 'IP',
        count: '次数',
        lastSeen: '最近时间',
        note: '备注',
        close: '关闭',
    },
    'en-US': {
        title: 'Node Access IPs',
        description: '3x-ui records proxy access IPs from nodes, not subscription-link access IPs.',
        refresh: 'Refresh',
        clear: 'Clear Records',
        loadFailed: 'Load Failed',
        empty: 'No node access IP records',
        ip: 'IP',
        count: 'Count',
        lastSeen: 'Last Seen',
        note: 'Note',
        close: 'Close',
    },
};

function getClientIpCopy(locale = 'zh-CN') {
    return CLIENT_IP_COPY[locale === 'en-US' ? 'en-US' : 'zh-CN'];
}

export default function ClientIpModal({
    isOpen,
    title,
    subtitle = '',
    loading = false,
    clearing = false,
    items = [],
    error = '',
    onClose,
    onRefresh,
    onClear,
}) {
    const { locale } = useI18n();
    const copy = getClientIpCopy(locale);
    if (!isOpen) return null;

    return (
        <ModalShell isOpen={isOpen} onClose={onClose}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3 className="modal-title">{title || copy.title}</h3>
                        {subtitle && <div className="text-sm text-muted mt-1">{subtitle}</div>}
                    </div>
                    <button className="modal-close" onClick={onClose}><HiOutlineXMark /></button>
                </div>
                <div className="modal-body">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
                        <div className="text-sm text-muted">{copy.description}</div>
                        <div className="flex gap-2">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading || clearing}>
                                {loading ? <span className="spinner" /> : <><HiOutlineArrowPath /> {copy.refresh}</>}
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={onClear} disabled={loading || clearing || typeof onClear !== 'function'}>
                                {clearing ? <span className="spinner" /> : <><HiOutlineTrash /> {copy.clear}</>}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="card p-3 mb-4" style={{ borderColor: 'var(--accent-danger)' }}>
                            <div className="text-sm font-medium text-danger">{copy.loadFailed}</div>
                            <div className="text-sm text-muted mt-1">{error}</div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center" style={{ minHeight: '180px' }}>
                            <span className="spinner" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-text">{copy.empty}</div>
                        </div>
                    ) : (
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>{copy.ip}</th>
                                        <th>{copy.count}</th>
                                        <th>{copy.lastSeen}</th>
                                        <th>{copy.note}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => (
                                        <tr key={item.ip}>
                                            <td data-label={copy.ip} className="font-mono" style={{ wordBreak: 'break-all' }}>{item.ip}</td>
                                            <td data-label={copy.count}>{item.count > 0 ? item.count : '-'}</td>
                                            <td data-label={copy.lastSeen}>{formatDateTime(item.lastSeen, locale)}</td>
                                            <td data-label={copy.note} className="text-xs text-muted">
                                                {[item.source, item.note].filter(Boolean).join(' / ') || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>{copy.close}</button>
                </div>
            </div>
        </ModalShell>
    );
}
