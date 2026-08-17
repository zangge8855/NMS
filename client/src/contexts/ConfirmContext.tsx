import React, { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import ModalShell from '../components/UI/ModalShell';
import { useI18n } from './LanguageContext';

export interface ConfirmOptions {
    title?: string;
    message?: string;
    details?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: 'danger' | 'primary' | 'success' | 'secondary' | 'warning' | string;
    requireTypeText?: string;
}

export type ConfirmFunction = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFunction | null>(null);

function toneToButtonClass(tone: string = 'danger'): string {
    const normalized = String(tone || '').toLowerCase();
    if (normalized === 'primary') return 'btn-primary';
    if (normalized === 'success') return 'btn-success';
    if (normalized === 'secondary') return 'btn-secondary';
    if (normalized === 'warning') return 'btn-warning';
    return 'btn-danger';
}

interface DialogState {
    title: string;
    message: string;
    details: string;
    confirmText: string;
    cancelText: string;
    tone: string;
    requireTypeText: string;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const { t } = useI18n();
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const [typedText, setTypedText] = useState<string>('');
    const resolverRef = useRef<((value: boolean) => void) | null>(null);

    const closeDialog = useCallback((result: boolean) => {
        if (resolverRef.current) {
            resolverRef.current(Boolean(result));
            resolverRef.current = null;
        }
        setDialog(null);
        setTypedText('');
    }, []);

    const confirm: ConfirmFunction = useCallback((options: ConfirmOptions = {}) => {
        if (resolverRef.current) {
            resolverRef.current(false);
            resolverRef.current = null;
        }

        return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            setTypedText('');
            setDialog({
                title: String(options.title || t('comp.common.confirmActionTitle')),
                message: String(options.message || ''),
                details: String(options.details || ''),
                confirmText: String(options.confirmText || t('comp.common.confirm')),
                cancelText: String(options.cancelText || t('comp.common.cancel')),
                tone: String(options.tone || 'danger'),
                requireTypeText: options.requireTypeText ? String(options.requireTypeText) : '',
            });
        });
    }, [t]);

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
                                        {t('comp.common.typeToConfirmBefore')} <code className="confirm-modal-type-target">{requireText}</code> {t('comp.common.typeToConfirmAfter')}
                                    </label>
                                    <input
                                        autoFocus
                                        className="form-input"
                                        value={typedText}
                                        onChange={(e) => setTypedText(e.target.value)}
                                        placeholder={requireText}
                                        aria-label={t('comp.common.typeConfirmAria')}
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

export function useConfirm(): ConfirmFunction {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirm must be used within ConfirmProvider');
    }
    return ctx;
}
