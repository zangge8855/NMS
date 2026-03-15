import React from 'react';
import { HiOutlineXMark } from 'react-icons/hi2';
import ModalShell from '../UI/ModalShell.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { formatTaskActionLabel } from '../../utils/taskLabels.js';

const BATCH_RESULT_COPY = {
    'zh-CN': {
        defaultTitle: '批量执行结果',
        close: '关闭',
        total: '总计',
        success: '成功',
        failed: '失败',
        status: '状态',
        action: '动作',
        node: '节点',
        inbound: '入站',
        target: '对象',
        result: '结果',
        empty: '暂无执行结果',
    },
    'en-US': {
        defaultTitle: 'Batch Results',
        close: 'Close',
        total: 'Total',
        success: 'Success',
        failed: 'Failed',
        status: 'Status',
        action: 'Action',
        node: 'Node',
        inbound: 'Inbound',
        target: 'Target',
        result: 'Result',
        empty: 'No execution results yet',
    },
};

function getBatchResultCopy(locale = 'zh-CN') {
    return BATCH_RESULT_COPY[locale === 'en-US' ? 'en-US' : 'zh-CN'];
}

function formatInboundLabel(item = {}) {
    const inboundId = item.inboundId ?? '';
    const remark = String(item.inboundRemark || '').trim();
    if (inboundId && remark) return `${inboundId} · ${remark}`;
    return inboundId || remark || '-';
}

function formatTargetLabel(item = {}) {
    const username = String(item.username || '').trim();
    const subscriptionEmail = String(item.subscriptionEmail || '').trim();
    if (username && subscriptionEmail) {
        return `${username} (${subscriptionEmail})`;
    }
    return username || subscriptionEmail || item.email || item.remark || item.clientIdentifier || '-';
}

export default function BatchResultModal({ isOpen, onClose, title = null, data = null }) {
    const { locale } = useI18n();
    if (!isOpen || !data) return null;

    const copy = getBatchResultCopy(locale);
    const resolvedTitle = title || copy.defaultTitle;
    const summary = data.summary || { total: 0, success: 0, failed: 0 };
    const results = Array.isArray(data.results) ? data.results : [];

    return (
        <ModalShell isOpen={isOpen} onClose={onClose}>
            <div className="modal modal-lg batch-result-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">{resolvedTitle}</h3>
                    <button className="modal-close" onClick={onClose} aria-label={copy.close} title={copy.close}>
                        <HiOutlineXMark />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="card batch-result-summary" style={{ marginBottom: '12px', padding: '12px' }}>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '13px' }}>
                            <span className="badge badge-neutral">{copy.total} {summary.total}</span>
                            <span className="badge badge-success">{copy.success} {summary.success}</span>
                            <span className="badge badge-danger">{copy.failed} {summary.failed}</span>
                        </div>
                    </div>

                    <div className="table-container batch-result-table" style={{ maxHeight: '420px', overflow: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{copy.status}</th>
                                    <th>{copy.action}</th>
                                    <th>{copy.node}</th>
                                    <th>{copy.inbound}</th>
                                    <th>{copy.target}</th>
                                    <th>{copy.result}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-center" style={{ padding: '24px' }}>
                                            {copy.empty}
                                        </td>
                                    </tr>
                                ) : (
                                    results.map((item, idx) => (
                                        <tr key={`${idx}-${item.serverId || 'x'}-${item.inboundId || 'x'}`}>
                                            <td data-label={copy.result}>
                                                <span className={`badge ${item.success ? 'badge-success' : 'badge-danger'}`}>
                                                    {item.success ? copy.success : copy.failed}
                                                </span>
                                            </td>
                                            <td data-label={copy.action}>{formatTaskActionLabel(item.action || item.stage, locale)}</td>
                                            <td data-label={copy.node}>{item.serverName || item.serverId || '-'}</td>
                                            <td data-label={copy.inbound}>{formatInboundLabel(item)}</td>
                                            <td data-label={copy.target}>{formatTargetLabel(item)}</td>
                                            <td data-label={copy.result} style={{ maxWidth: '320px', wordBreak: 'break-word' }}>
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
        </ModalShell>
    );
}
