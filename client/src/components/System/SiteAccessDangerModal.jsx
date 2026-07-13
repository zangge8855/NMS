import React, { useEffect, useMemo, useState } from 'react';
import ModalShell from '../UI/ModalShell.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';

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
    const { t } = useI18n();
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
                        <h3 className="modal-title">{t('comp.siteAccessDanger.title')}</h3>
                    </div>
                    <div className="modal-body">
                        <div className="site-danger-copy">
                            {t('comp.siteAccessDanger.description')}
                        </div>
                        <div className="site-danger-compare-grid">
                            <div className="site-danger-compare-card">
                                <div className="site-danger-compare-label">{t('comp.siteAccessDanger.currentPath')}</div>
                                <div className="site-danger-compare-value font-mono">{previousPath}</div>
                            </div>
                            <div className="site-danger-compare-card site-danger-compare-card--next">
                                <div className="site-danger-compare-label">{t('comp.siteAccessDanger.nextPath')}</div>
                                <div className="site-danger-compare-value font-mono">{nextPath}</div>
                            </div>
                            <div className="site-danger-compare-card">
                                <div className="site-danger-compare-label">{t('comp.siteAccessDanger.currentCamouflage')}</div>
                                <div className="site-danger-compare-value">{t(previousCamouflageEnabled ? 'comp.siteAccessDanger.enabled' : 'comp.siteAccessDanger.disabled')}</div>
                            </div>
                            <div className="site-danger-compare-card site-danger-compare-card--next">
                                <div className="site-danger-compare-label">{t('comp.siteAccessDanger.nextCamouflage')}</div>
                                <div className="site-danger-compare-value">{t(nextCamouflageEnabled ? 'comp.siteAccessDanger.enabled' : 'comp.siteAccessDanger.disabled')}</div>
                            </div>
                        </div>
                        <label className="site-danger-check">
                            <input
                                type="checkbox"
                                checked={acknowledged}
                                onChange={(event) => setAcknowledged(event.target.checked)}
                            />
                            <span>{t('comp.siteAccessDanger.acknowledge', { path: nextPath })}</span>
                        </label>
                        <label className="form-group mb-0">
                            <span className="form-label">{t('comp.siteAccessDanger.typePath')}</span>
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
                            {t('comp.common.cancel')}
                        </button>
                        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={!canConfirm || saving}>
                            {saving ? t('comp.siteAccessDanger.saving') : t('comp.siteAccessDanger.confirm')}
                        </button>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}
