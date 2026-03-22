import React, { useEffect, useMemo, useState } from 'react';
import ModalShell from '../UI/ModalShell.jsx';

function statusLabel(enabled) {
    return enabled ? '开启' : '关闭';
}

export default function SiteAccessDangerModal({
    open = false,
    previousPath = '/',
    nextPath = '/',
    previousCamouflageEnabled = false,
    nextCamouflageEnabled = false,
    onClose,
    onConfirm,
    saving = false,
}) {
    const [acknowledged, setAcknowledged] = useState(false);
    const [typedPath, setTypedPath] = useState('');

    useEffect(() => {
        if (!open) return;
        setAcknowledged(false);
        setTypedPath('');
    }, [open, nextPath, nextCamouflageEnabled]);

    const canConfirm = useMemo(() => {
        return acknowledged && String(typedPath || '').trim() === String(nextPath || '').trim();
    }, [acknowledged, nextPath, typedPath]);

    return (
        <ModalShell isOpen={open} onClose={saving ? undefined : onClose}>
            {open ? (
                <div className="modal site-danger-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-header">
                        <h3 className="modal-title">高危访问路径变更确认</h3>
                    </div>
                    <div className="modal-body">
                        <div className="site-danger-copy">
                            修改真实入口路径或伪装站开关后，旧地址可能立即失效。请确认你已经备份新路径，并且具备恢复访问的备用方式。
                        </div>
                        <div className="site-danger-compare-grid">
                            <div className="site-danger-compare-card">
                                <div className="site-danger-compare-label">当前真实入口</div>
                                <div className="site-danger-compare-value font-mono">{previousPath}</div>
                            </div>
                            <div className="site-danger-compare-card site-danger-compare-card--next">
                                <div className="site-danger-compare-label">保存后真实入口</div>
                                <div className="site-danger-compare-value font-mono">{nextPath}</div>
                            </div>
                            <div className="site-danger-compare-card">
                                <div className="site-danger-compare-label">当前伪装首页</div>
                                <div className="site-danger-compare-value">{statusLabel(previousCamouflageEnabled)}</div>
                            </div>
                            <div className="site-danger-compare-card site-danger-compare-card--next">
                                <div className="site-danger-compare-label">保存后伪装首页</div>
                                <div className="site-danger-compare-value">{statusLabel(nextCamouflageEnabled)}</div>
                            </div>
                        </div>
                        <label className="site-danger-check">
                            <input
                                type="checkbox"
                                checked={acknowledged}
                                onChange={(event) => setAcknowledged(event.target.checked)}
                            />
                            <span>我已备份新路径，并确认能够从 {nextPath} 重新进入管理面板</span>
                        </label>
                        <label className="form-group mb-0">
                            <span className="form-label">请输入新的真实入口路径以继续保存</span>
                            <input
                                className="form-input font-mono"
                                value={typedPath}
                                onChange={(event) => setTypedPath(event.target.value)}
                                placeholder={nextPath}
                            />
                        </label>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
                            取消
                        </button>
                        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={!canConfirm || saving}>
                            {saving ? '正在保存' : '确认保存高危变更'}
                        </button>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}
