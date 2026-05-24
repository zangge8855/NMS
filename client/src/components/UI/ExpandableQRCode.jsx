import React, { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createPortal } from 'react-dom';
import { HiOutlineXMark, HiOutlineArrowsPointingOut } from 'react-icons/hi2';

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
}) {
    const [expanded, setExpanded] = useState(false);
    const close = useCallback(() => setExpanded(false), []);
    const onKey = useCallback((event) => {
        if (event.key === 'Escape') close();
    }, [close]);

    if (!value) return null;

    return (
        <>
            <button
                type="button"
                className={['expandable-qr-trigger', className].filter(Boolean).join(' ')}
                onClick={() => setExpanded(true)}
                aria-label={ariaLabel || `放大显示二维码${label ? ' · ' + label : ''}`}
            >
                <QRCodeSVG
                    value={value}
                    size={size}
                    level={level}
                    includeMargin={includeMargin}
                />
                <span className="expandable-qr-hint">
                    <HiOutlineArrowsPointingOut aria-hidden /> <span>点击放大</span>
                </span>
            </button>

            {expanded && createPortal(
                <div
                    className="expandable-qr-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="放大显示的二维码"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) close();
                    }}
                    onKeyDown={onKey}
                    tabIndex={-1}
                >
                    <div className="expandable-qr-card">
                        <button
                            type="button"
                            className="expandable-qr-close"
                            onClick={close}
                            aria-label="关闭"
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
                            <span className="text-xs text-muted break-all">{value}</span>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
