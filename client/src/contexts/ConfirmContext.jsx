import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ConfirmContext = createContext(null);

function toneToButtonClass(tone = 'danger') {
    const normalized = String(tone || '').toLowerCase();
    if (normalized === 'primary') return 'btn-primary';
    if (normalized === 'success') return 'btn-success';
    if (normalized === 'secondary') return 'btn-secondary';
    return 'btn-danger';
}

export function ConfirmProvider({ children }) {
    const [dialog, setDialog] = useState(null);
    const resolverRef = useRef(null);

    const closeDialog = useCallback((result) => {
        if (resolverRef.current) {
            resolverRef.current(Boolean(result));
            resolverRef.current = null;
        }
        setDialog(null);
    }, []);

    const confirm = useCallback((options = {}) => {
        if (resolverRef.current) {
            resolverRef.current(false);
            resolverRef.current = null;
        }

        return new Promise((resolve) => {
            resolverRef.current = resolve;
            setDialog({
                title: String(options.title || '请确认操作'),
                message: String(options.message || ''),
                details: String(options.details || ''),
                confirmText: String(options.confirmText || '确认'),
                cancelText: String(options.cancelText || '取消'),
                tone: String(options.tone || 'danger'),
            });
        });
    }, []);

    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && dialog) {
                closeDialog(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [dialog, closeDialog]);

    useEffect(() => () => {
        if (resolverRef.current) {
            resolverRef.current(false);
            resolverRef.current = null;
        }
    }, []);

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {dialog && (
                <div className="modal-overlay" onClick={() => closeDialog(false)}>
                    <div className="modal" style={{ maxWidth: '440px' }} onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{dialog.title}</h3>
                        </div>
                        <div className="modal-body">
                            {dialog.message && (
                                <p style={{ marginBottom: dialog.details ? '12px' : 0, color: 'var(--text-secondary)' }}>
                                    {dialog.message}
                                </p>
                            )}
                            {dialog.details && (
                                <div
                                    style={{
                                        whiteSpace: 'pre-wrap',
                                        fontSize: '12px',
                                        color: 'var(--text-muted)',
                                        background: 'var(--surface-soft)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '10px',
                                    }}
                                >
                                    {dialog.details}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => closeDialog(false)} autoFocus>
                                {dialog.cancelText}
                            </button>
                            <button
                                type="button"
                                className={`btn ${toneToButtonClass(dialog.tone)}`}
                                onClick={() => closeDialog(true)}
                            >
                                {dialog.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
