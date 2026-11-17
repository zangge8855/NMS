import React, { type ReactNode } from 'react';
import { HiOutlineArrowPath, HiOutlineXMark } from 'react-icons/hi2';
import { useI18n } from '../../../contexts/LanguageContext';
import ModalShell from '../../UI/ModalShell';

type PanelFeatureFrameProps = {
    title: string;
    description: string;
    loading: boolean;
    error?: string;
    unsupported?: boolean;
    onRefresh: () => void;
    actions?: ReactNode;
    children: ReactNode;
};

/**
 * One feature section: a heading that says what the section is for, the section's
 * actions, then either the content, the load error, or a note that this panel build
 * does not have the feature.
 */
export function PanelFeatureFrame({
    title,
    description,
    loading,
    error = '',
    unsupported = false,
    onRefresh,
    actions,
    children,
}: PanelFeatureFrameProps) {
    const { t } = useI18n();
    return (
        <section className="pf-section" aria-label={title} aria-busy={loading}>
            <header className="pf-section-head">
                <div className="pf-section-heading">
                    <h3 className="pf-section-title">{title}</h3>
                    <p className="pf-section-desc">{description}</p>
                </div>
                <div className="pf-section-actions">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={onRefresh}
                        disabled={loading}
                        aria-label={t('pages.panelFeatures.common.refresh')}
                        title={t('pages.panelFeatures.common.refresh')}
                    >
                        <HiOutlineArrowPath className={loading ? 'pf-spin' : undefined} />
                    </button>
                    {!unsupported && actions}
                </div>
            </header>

            {unsupported ? (
                <div className="pf-note" role="status">
                    <p className="pf-note-title">{t('pages.panelFeatures.common.unsupportedTitle')}</p>
                    <p className="pf-note-body">{t('pages.panelFeatures.common.unsupportedHint')}</p>
                </div>
            ) : (
                <>
                    {error && (
                        <div className="pf-alert" role="alert">
                            <span>{error}</span>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
                                {t('pages.panelFeatures.common.retry')}
                            </button>
                        </div>
                    )}
                    {children}
                </>
            )}
        </section>
    );
}

type PanelEmptyProps = {
    title: string;
    hint: string;
    action?: ReactNode;
};

export function PanelEmpty({ title, hint, action }: PanelEmptyProps) {
    return (
        <div className="pf-empty">
            <p className="pf-empty-title">{title}</p>
            <p className="pf-empty-hint">{hint}</p>
            {action ? <div className="pf-empty-action">{action}</div> : null}
        </div>
    );
}

export function PanelListSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <div className="pf-list" aria-hidden="true">
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="pf-row pf-row--skeleton">
                    <span className="pf-skeleton-line" />
                    <span className="pf-skeleton-line pf-skeleton-line--short" />
                </div>
            ))}
        </div>
    );
}

type PanelFormModalProps = {
    isOpen: boolean;
    title: string;
    description?: string;
    submitLabel: string;
    saving: boolean;
    wide?: boolean;
    onClose: () => void;
    onSubmit: () => void;
    children: ReactNode;
};

export function PanelFormModal({
    isOpen,
    title,
    description,
    submitLabel,
    saving,
    wide = false,
    onClose,
    onSubmit,
    children,
}: PanelFormModalProps) {
    const { t } = useI18n();
    if (!isOpen) return null;
    return (
        <ModalShell isOpen={isOpen} onClose={saving ? undefined : onClose}>
            <div className={`modal ${wide ? 'modal-lg' : ''} pf-modal`} onClick={(event) => event.stopPropagation()}>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!saving) onSubmit();
                    }}
                    noValidate
                >
                    <div className="modal-header">
                        <div>
                            <h3 className="modal-title">{title}</h3>
                            {description ? <p className="pf-modal-desc">{description}</p> : null}
                        </div>
                        <button
                            type="button"
                            className="modal-close"
                            onClick={onClose}
                            disabled={saving}
                            aria-label={t('pages.panelFeatures.common.close')}
                            title={t('pages.panelFeatures.common.close')}
                        >
                            <HiOutlineXMark />
                        </button>
                    </div>
                    <div className="modal-body pf-form">{children}</div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
                            {t('pages.panelFeatures.common.cancel')}
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? <span className="spinner" /> : submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </ModalShell>
    );
}

type FieldProps = {
    id: string;
    label: string;
    hint?: string;
    children: ReactNode;
    wide?: boolean;
};

export function PanelField({ id, label, hint, children, wide = false }: FieldProps) {
    return (
        <div className={`form-group pf-field${wide ? ' pf-field--wide' : ''}`}>
            <label htmlFor={id} className="form-label">{label}</label>
            {children}
            {hint ? <p className="pf-field-hint" id={`${id}-hint`}>{hint}</p> : null}
        </div>
    );
}

type ToggleFieldProps = {
    id: string;
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
};

export function PanelToggle({ id, label, hint, checked, onChange }: ToggleFieldProps) {
    return (
        <label className="pf-toggle" htmlFor={id}>
            <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
            <span className="pf-toggle-text">
                <span className="pf-toggle-label">{label}</span>
                {hint ? <span className="pf-toggle-hint">{hint}</span> : null}
            </span>
        </label>
    );
}
