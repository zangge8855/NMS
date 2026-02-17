import React from 'react';
import { HiOutlineXMark } from 'react-icons/hi2';

function labelByAction(action) {
    const map = {
        add: '新增',
        update: '更新',
        enable: '启用',
        disable: '停用',
        delete: '删除',
        resetTraffic: '重置流量',
    };
    return map[action] || action || '-';
}

export default function BatchResultModal({ isOpen, onClose, title = '批量执行结果', data = null }) {
    if (!isOpen || !data) return null;

    const summary = data.summary || { total: 0, success: 0, failed: 0 };
    const results = Array.isArray(data.results) ? data.results : [];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    <button className="modal-close" onClick={onClose}>
                        <HiOutlineXMark />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="card" style={{ marginBottom: '12px', padding: '12px' }}>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '13px' }}>
                            <span className="badge badge-neutral">总计 {summary.total}</span>
                            <span className="badge badge-success">成功 {summary.success}</span>
                            <span className="badge badge-danger">失败 {summary.failed}</span>
                        </div>
                    </div>

                    <div className="table-container" style={{ maxHeight: '420px', overflow: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>状态</th>
                                    <th>动作</th>
                                    <th>节点</th>
                                    <th>入站</th>
                                    <th>对象</th>
                                    <th>结果</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-center" style={{ padding: '24px' }}>
                                            暂无执行结果
                                        </td>
                                    </tr>
                                ) : (
                                    results.map((item, idx) => (
                                        <tr key={`${idx}-${item.serverId || 'x'}-${item.inboundId || 'x'}`}>
                                            <td>
                                                <span className={`badge ${item.success ? 'badge-success' : 'badge-danger'}`}>
                                                    {item.success ? '成功' : '失败'}
                                                </span>
                                            </td>
                                            <td>{labelByAction(item.action)}</td>
                                            <td>{item.serverName || item.serverId || '-'}</td>
                                            <td>{item.inboundId || '-'}</td>
                                            <td>{item.email || item.remark || item.clientIdentifier || '-'}</td>
                                            <td style={{ maxWidth: '320px', wordBreak: 'break-word' }}>
                                                {item.msg || '-'}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
