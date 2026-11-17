import React, { type ReactNode } from 'react';
import { useI18n } from '../../../contexts/LanguageContext';
import type { PanelInboundOption } from './panelRequest';

type InboundPickerProps = {
    id: string;
    label: string;
    hint?: string;
    inbounds: PanelInboundOption[];
    selected: number[];
    onChange: (ids: number[]) => void;
    /** Extra control shown at the end of a selected row (e.g. a weight input). */
    renderExtra?: (inbound: PanelInboundOption) => ReactNode;
};

export default function InboundPicker({ id, label, hint, inbounds, selected, onChange, renderExtra }: InboundPickerProps) {
    const { t } = useI18n();
    const selectedSet = new Set(selected.map(Number));

    const toggle = (inboundId: number, checked: boolean) => {
        if (checked) {
            // Keep the panel's inbound order rather than click order.
            const next = new Set(selectedSet).add(inboundId);
            onChange(inbounds.map((item) => Number(item.id)).filter((value) => next.has(value)));
        } else {
            onChange(selected.map(Number).filter((value) => value !== inboundId));
        }
    };

    return (
        <fieldset className="pf-picker" aria-describedby={hint ? `${id}-hint` : undefined}>
            <legend className="form-label">
                {label}
                <span className="pf-picker-count">{t('pages.panelFeatures.common.selectedCount', { count: selectedSet.size })}</span>
            </legend>
            {hint ? <p className="pf-field-hint" id={`${id}-hint`}>{hint}</p> : null}
            {inbounds.length === 0 ? (
                <p className="pf-muted">{t('pages.panelFeatures.common.noInbounds')}</p>
            ) : (
                <ul className="pf-picker-list">
                    {inbounds.map((inbound) => {
                        const inboundId = Number(inbound.id);
                        const checked = selectedSet.has(inboundId);
                        const inputId = `${id}-${inboundId}`;
                        return (
                            <li key={inboundId} className={`pf-picker-item${checked ? ' is-checked' : ''}`}>
                                <input
                                    id={inputId}
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => toggle(inboundId, event.target.checked)}
                                />
                                <label htmlFor={inputId} className="pf-picker-label">
                                    <span className="pf-picker-name">{inbound.remark || inbound.tag || `#${inboundId}`}</span>
                                    <span className="pf-picker-detail">
                                        {[inbound.protocol, inbound.port].filter((part) => part !== undefined && part !== '').join(' ')}
                                    </span>
                                </label>
                                {checked && renderExtra ? <div className="pf-picker-extra">{renderExtra(inbound)}</div> : null}
                            </li>
                        );
                    })}
                </ul>
            )}
        </fieldset>
    );
}
