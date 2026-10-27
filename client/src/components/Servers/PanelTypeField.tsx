import React from 'react';
import { useI18n } from '../../contexts/LanguageContext';
import { PANEL_TYPE_3XUI, PANEL_TYPE_SUI, normalizePanelType } from '../../utils/panelType';

interface PanelTypeFieldProps {
    value: unknown;
    onChange: (value: string) => void;
    name: string;
    disabled?: boolean;
}

/** Two radio cards that pick which panel API a node speaks. */
export default function PanelTypeField({ value, onChange, name, disabled = false }: PanelTypeFieldProps) {
    const { t } = useI18n();
    const current = normalizePanelType(value);
    const options = [
        { key: PANEL_TYPE_3XUI, title: '3x-ui', desc: t('comp.servers.panelType3xuiDesc') },
        { key: PANEL_TYPE_SUI, title: 's-ui', desc: t('comp.servers.panelTypeSuiDesc') },
    ];

    return (
        <div className="form-group">
            <span className="form-label" id={`${name}-label`}>{t('comp.servers.panelType')}</span>
            <div className="panel-type-options" role="radiogroup" aria-labelledby={`${name}-label`}>
                {options.map((option) => (
                    <label
                        key={option.key}
                        className={`panel-type-option${current === option.key ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={option.key}
                            checked={current === option.key}
                            disabled={disabled}
                            onChange={() => onChange(option.key)}
                        />
                        <span className="panel-type-option-title">{option.title}</span>
                        <span className="panel-type-option-desc">{option.desc}</span>
                    </label>
                ))}
            </div>
            {current === PANEL_TYPE_SUI ? (
                <div className="text-xs text-muted mt-1">{t('comp.servers.suiUrlHint')}</div>
            ) : null}
        </div>
    );
}
