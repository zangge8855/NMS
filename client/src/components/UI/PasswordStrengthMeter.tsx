import React, { useMemo } from 'react';
import { evaluatePasswordPolicy } from '../../utils/passwordPolicy';

const LABELS_ZH = ['弱', '中等', '良好', '强'];
const LABELS_EN = ['Weak', 'Fair', 'Good', 'Strong'];

export interface PasswordStrengthMeterProps {
    password?: string;
    locale?: string;
}

export default function PasswordStrengthMeter({ password = '', locale = 'zh-CN' }: PasswordStrengthMeterProps) {
    const value = String(password || '');

    const { score, label, tone } = useMemo(() => {
        if (!value) {
            return { score: 0, label: '', tone: 'none' };
        }

        const policy = evaluatePasswordPolicy(value);
        let s = 1;
        if (policy.lengthOk && policy.typeCount === 2) {
            s = 2;
        } else if (policy.lengthOk && policy.typeCount === 3) {
            s = 3;
        } else if (policy.lengthOk && (policy.typeCount === 4 || (policy.typeCount >= 3 && value.length >= 12))) {
            s = 4;
        }

        const labels = locale === 'en-US' ? LABELS_EN : LABELS_ZH;
        const tones = ['danger', 'warning', 'info', 'success'];

        return {
            score: s,
            label: labels[s - 1],
            tone: tones[s - 1],
        };
    }, [value, locale]);

    if (!value) return null;

    return (
        <div className="password-strength-meter" data-tone={tone} aria-label={`Password strength: ${label}`}>
            <div className="password-strength-bars">
                {[1, 2, 3, 4].map((step) => (
                    <div
                        key={step}
                        className={`password-strength-bar ${step <= score ? 'active' : ''}`}
                    />
                ))}
            </div>
            {label && (
                <span className="password-strength-label">
                    {label}
                </span>
            )}
        </div>
    );
}
