import React from 'react';
import { HiOutlineArrowPath, HiOutlineTrash, HiOutlineXMark } from 'react-icons/hi2';
import ModalShell from './ModalShell.jsx';

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function ClientIpModal({
    isOpen,
    title = '节点访问 IP',
    subtitle = '',
    loading = false,
    clearing = false,
    items = [],
    error = '',
    onClose,
    onRefresh,
    onClear,
}) {
    if (!isOpen) return null;

    return (
        <ModalShell isOpen={isOpen} onClose={onClose}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3 className="modal-title">{title}</h3>
                        {subtitle && <div className="text-sm text-muted mt-1">{subtitle}</div>}
                    </div>
                    <button className="modal-close" onClick={onClose}><HiOutlineXMark /></button>
                </div>
                <div className="modal-body">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
                        <div className="text-sm text-muted">3x-ui 记录的是节点代理访问 IP，不是订阅链接访问 IP。</div>
                        <div className="flex gap-2">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading || clearing}>
                                {loading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 刷新</>}
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={onClear} disabled={loading || clearing || typeof onClear !== 'function'}>
                                {clearing ? <span className="spinner" /> : <><HiOutlineTrash /> 清空记录</>}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="card p-3 mb-4" style={{ borderColor: 'var(--accent-danger)' }}>
                            <div className="text-sm font-medium text-danger">加载失败</div>
                            <div className="text-sm text-muted mt-1">{error}</div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center" style={{ minHeight: '180px' }}>
                            <span className="spinner" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-text">暂无节点访问 IP 记录</div>
                        </div>
                    ) : (
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>IP</th>
                                        <th>次数</th>
                                        <th>最近时间</th>
                                        <th>备注</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => (
                                        <tr key={item.ip}>
                                            <td data-label="IP" className="font-mono" style={{ wordBreak: 'break-all' }}>{item.ip}</td>
                                            <td data-label="次数">{item.count > 0 ? item.count : '-'}</td>
                                            <td data-label="最近时间">{formatDateTime(item.lastSeen)}</td>
                                            <td data-label="备注" className="text-xs text-muted">
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
                    <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
                </div>
            </div>
        </ModalShell>
    );
}
