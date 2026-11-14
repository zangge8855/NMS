import React, { useState, useCallback, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createPortal } from 'react-dom';
import { HiOutlineXMark, HiOutlineArrowsPointingOut, HiOutlineClipboard } from 'react-icons/hi2';
import { copyToClipboard } from '../../utils/format';
import toast from 'react-hot-toast';
import { useI18n } from '../../contexts/LanguageContext';
import { acquireModalStackSlot } from './ModalShell';

export interface ExpandableQRCodeProps {
    value?: string;
    size?: number;
    label?: string;
    level?: 'L' | 'M' | 'Q' | 'H';
    includeMargin?: boolean;
    enlargedSize?: number;
    className?: string;
    ariaLabel?: string;
    maxQrValueLength?: number;
}

/**
 * Subscription QR with click-to-enlarge: tap/click the QR to open a large
 * fullscreen overlay so users can scan from across the room or on a phone screen.
 */
export default function ExpandableQRCode({
    value = '',
    size = 136,
    label = '',
    level = 'M',
    includeMargin = true,
    enlargedSize = 320,
    className = '',
    ariaLabel = '',
    maxQrValueLength = 1800,
}: ExpandableQRCodeProps) {
    const { t } = useI18n();
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<number | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const close = useCallback(() => setExpanded(false), []);

    // The enlarged overlay joins the shared modal stack while open, so an
    // underlying ModalShell no longer counts itself topmost — one Escape then
    // collapses only the QR layer instead of also dismissing the host modal.
    useEffect(() => {
        if (!expanded) return undefined;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : triggerRef.current;

        const slot = acquireModalStackSlot();
        const getOverlayFocusable = (): HTMLElement[] => {
            const overlay = overlayRef.current;
            if (!overlay) return [];
            return Array.from(
                overlay.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
            );
        };

        const animationFrame = window.requestAnimationFrame(() => {
            (closeButtonRef.current || overlayRef.current)?.focus?.({ preventScroll: true });
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!slot.isTopmost()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
            }
            if (event.key === 'Tab') {
                const focusable = getOverlayFocusable();
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        const handleFocusIn = (event: FocusEvent) => {
            if (!slot.isTopmost()) return;
            const overlay = overlayRef.current;
            if (!overlay || overlay.contains(event.target as Node)) return;
            const focusable = getOverlayFocusable();
            (focusable[0] || closeButtonRef.current || overlay)?.focus?.({ preventScroll: true });
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('focusin', handleFocusIn);
        return () => {
            window.cancelAnimationFrame(animationFrame);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('focusin', handleFocusIn);
            slot.release();
            const restoreTarget = previousFocusRef.current || triggerRef.current;
            previousFocusRef.current = null;
            if (restoreTarget && restoreTarget.isConnected) {
                restoreTarget.focus?.({ preventScroll: true });
            }
        };
    }, [expanded, close]);

    if (!value) return null;
    const isTooLong = String(value || '').length > maxQrValueLength;
    const copyLink = async () => {
        try {
            const ok = await copyToClipboard(value);
            if (ok) {
                setCopied(true);
                if (timeoutRef.current) {
                    window.clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
            } else {
                toast.error(t('comp.common.copyFailed'));
            }
        } catch {
            setCopied(false);
            toast.error(t('comp.common.copyFailed'));
        }
    };

    if (isTooLong) {
        return (
            <div className={['expandable-qr-fallback', className].filter(Boolean).join(' ')}>
                <div className="expandable-qr-fallback-title">{t('comp.common.qrTooLongTitle')}</div>
                <div className="expandable-qr-fallback-text">{t('comp.common.qrTooLongText')}</div>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={copyLink}
                >
                    <HiOutlineClipboard />
                    {copied ? t('comp.common.copied') : t('comp.common.copyLink')}
                </button>
            </div>
        );
    }

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={['expandable-qr-trigger', className].filter(Boolean).join(' ')}
                onClick={() => setExpanded(true)}
                aria-label={ariaLabel || `${t('comp.common.expandQr')}${label ? ' · ' + label : ''}`}
            >
                <QRCodeSVG
                    value={value}
                    size={size}
                    level={level}
                    includeMargin={includeMargin}
                />
                <span className="expandable-qr-hint">
                    <HiOutlineArrowsPointingOut aria-hidden /> <span>{t('comp.common.clickToEnlarge')}</span>
                </span>
            </button>

            {expanded && createPortal(
                <div
                    ref={overlayRef}
                    className="expandable-qr-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('comp.common.enlargedQr')}
                    onClick={(event) => {
                        if (event.target === event.currentTarget) close();
                    }}
                    tabIndex={-1}
                >
                    <div className="expandable-qr-card">
                        <button
                            ref={closeButtonRef}
                            type="button"
                            className="expandable-qr-close"
                            onClick={close}
                            aria-label={t('comp.common.close')}
                            autoFocus
                        >
                            <HiOutlineXMark />
                        </button>
                        {label ? <div className="expandable-qr-label">{label}</div> : null}
                        <div className="expandable-qr-canvas">
                            <QRCodeSVG
                                value={value}
                                size={enlargedSize}
                                level={level}
                                includeMargin
                            />
                        </div>
                        <div className="expandable-qr-foot">
                            <span className="text-xs text-muted break-all select-all">{value}</span>
                            <div className="mt-3 flex justify-center">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={copyLink}
                                >
                                    <HiOutlineClipboard />
                                    <span>{copied ? t('comp.common.copied') : t('comp.common.copyLink')}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
