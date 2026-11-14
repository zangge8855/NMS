import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { HiOutlineCheck, HiOutlineClipboardDocument } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { useI18n } from '../../contexts/LanguageContext';
import { copyToClipboard } from '../../utils/format';

const FEEDBACK_RESET_MS = 1400;

export interface CopyFeedbackButtonProps {
    text?: string | (() => string);
    successText?: string;
    errorText?: string;
    className?: string;
    icon?: ReactNode;
    copiedIcon?: ReactNode;
    children?: ReactNode;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    title?: string;
    ariaLabel?: string;
    onCopied?: (copiedText: string) => void;
    onError?: (error?: any) => void;
}

export default function CopyFeedbackButton({
    text = '',
    successText = '',
    errorText = '',
    className = 'btn btn-secondary',
    icon = <HiOutlineClipboardDocument />,
    copiedIcon = <HiOutlineCheck />,
    children = null,
    disabled = false,
    type = 'button',
    title = '',
    ariaLabel = '',
    onCopied,
    onError,
}: CopyFeedbackButtonProps) {
    const { t } = useI18n();
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
        }
    }, []);

    const notifyCopyError = (error?: any) => {
        setCopied(false);
        toast.error(errorText || t('comp.common.copyFailed'));
        onError?.(error);
    };

    const handleCopy = async () => {
        if (disabled) return;

        const resolvedText = typeof text === 'function' ? text() : text;
        if (!String(resolvedText || '').trim()) {
            notifyCopyError();
            return;
        }

        try {
            const copiedOk = await copyToClipboard(String(resolvedText));
            if (!copiedOk) {
                notifyCopyError(new Error('Clipboard copy failed'));
                return;
            }
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
            setCopied(true);
            timeoutRef.current = window.setTimeout(() => {
                setCopied(false);
            }, FEEDBACK_RESET_MS);
            if (successText) {
                toast.success(successText);
            }
            onCopied?.(String(resolvedText));
        } catch (error) {
            notifyCopyError(error);
        }
    };

    return (
        <button
            type={type}
            className={`${className} copy-feedback-btn${copied ? ' is-copied' : ''}`}
            onClick={handleCopy}
            disabled={disabled}
            title={title}
            aria-label={ariaLabel || title}
            data-copied={copied ? 'true' : 'false'}
        >
            <span className="copy-feedback-icon" aria-hidden="true">
                {copied ? copiedIcon : icon}
            </span>
            {children ? <span className="copy-feedback-label">{children}</span> : null}
        </button>
    );
}
