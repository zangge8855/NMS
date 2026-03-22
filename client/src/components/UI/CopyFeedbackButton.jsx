import React, { useEffect, useRef, useState } from 'react';
import { HiOutlineCheck, HiOutlineClipboardDocument } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { copyToClipboard } from '../../utils/format.js';

const FEEDBACK_RESET_MS = 1400;

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
}) {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef(null);

    useEffect(() => () => {
        window.clearTimeout(timeoutRef.current);
    }, []);

    const handleCopy = async () => {
        if (disabled) return;

        const resolvedText = typeof text === 'function' ? text() : text;
        if (!String(resolvedText || '').trim()) {
            if (errorText) toast.error(errorText);
            onError?.();
            return;
        }

        try {
            await copyToClipboard(String(resolvedText));
            window.clearTimeout(timeoutRef.current);
            setCopied(true);
            timeoutRef.current = window.setTimeout(() => {
                setCopied(false);
            }, FEEDBACK_RESET_MS);
            if (successText) {
                toast.success(successText);
            }
            onCopied?.(String(resolvedText));
        } catch (error) {
            if (errorText) {
                toast.error(errorText);
            }
            onError?.(error);
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
