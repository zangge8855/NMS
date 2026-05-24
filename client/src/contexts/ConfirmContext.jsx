import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import ModalShell from '../components/UI/ModalShell.jsx';

const ConfirmContext = createContext(null);

function toneToButtonClass(tone = 'danger') {
    const normalized = String(tone || '').toLowerCase();
    if (normalized === 'primary') return 'btn-primary';
    if (normalized === 'success') return 'btn-success';
    if (normalized === 'secondary') return 'btn-secondary';
    if (normalized === 'warning') return 'btn-warning';
    return 'btn-danger';
}

export function ConfirmProvider({ children }) {
    const [dialog, setDialog] = useState(null);
    const [typedText, setTypedText] = useState('');
    const resolverRef = useRef(null);

    const closeDialog = useCallback((result) => {
        if (resolverRef.current) {
            resolverRef.current(Boolean(result));
            resolverRef.current = null;
        }
        setDialog(null);
        setTypedText('');
    }, []);

    const confirm = useCallback((options = {}) => {
        if (resolverRef.current) {
            resolverRef.current(false);
            resolverRef.current = null;
        }

        return new Promise((resolve) => {
            resolverRef.current = resolve;
            setTypedText('');
            setDialog({
                title: String(options.title || '请确认操作'),
                message: String(options.message || ''),
                details: String(options.details || ''),
                confirmText: String(options.confirmText || '确认'),
                cancelText: String(options.cancelText || '取消'),
                tone: String(options.tone || 'danger'),
                requireTypeText: options.requireTypeText ? String(options.requireTypeText) : '',
            });
        });
    }, []);

    const requireText = dialog?.requireTypeText || '';
    const confirmDisabled = requireText !== '' && typedText.trim() !== requireText.trim();

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <ModalShell isOpen={!!dialog} onClose={() => closeDialog(false)}>
                {dialog && (
                    <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{dialog.title}</h3>
                        </div>
                        <div className="modal-body">
                            {dialog.message && (
                                <p className="confirm-modal-message">{dialog.message}</p>
                            )}
                            {dialog.details && (
                                <div className="confirm-modal-details">{dialog.details}</div>
                            )}
                            {requireText && (
                                <div className="confirm-modal-type-gate">
                                    <label className="form-label">
                                        请输入 <code className="confirm-modal-type-target">{requireText}</code> 以确认此高危操作
                                    </label>
                                    <input
                                        autoFocus
                                        className="form-input"
                                        value={typedText}
                                        onChange={(e) => setTypedText(e.target.value)}
                                        placeholder={requireText}
                                        aria-label="键入确认字符串"
                                    />
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => closeDialog(false)}
                                autoFocus={!requireText}
                            >
                                {dialog.cancelText}
                            </button>
                            <button
                                type="button"
                                className={`btn ${toneToButtonClass(dialog.tone)}`}
                                onClick={() => closeDialog(true)}
                                disabled={confirmDisabled}
                            >
                                {dialog.confirmText}
                            </button>
                        </div>
                    </div>
                )}
            </ModalShell>
        </ConfirmContext.Provider>
    );
}

export function useConfirm() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirm must be used within ConfirmProvider');
    }
    return ctx;
}
