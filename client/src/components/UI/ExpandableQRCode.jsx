import React, { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createPortal } from 'react-dom';
import { HiOutlineXMark, HiOutlineArrowsPointingOut, HiOutlineClipboard } from 'react-icons/hi2';

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
}) {
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const close = useCallback(() => setExpanded(false), []);
    const onKey = useCallback((event) => {
        if (event.key === 'Escape') close();
    }, [close]);

    if (!value) return null;
    const isTooLong = String(value || '').length > maxQrValueLength;
    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    if (isTooLong) {
        return (
            <div className={['expandable-qr-fallback', className].filter(Boolean).join(' ')}>
                <div className="expandable-qr-fallback-title">二维码内容过长</div>
                <div className="expandable-qr-fallback-text">请复制链接导入客户端。</div>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={copyLink}
                >
                    <HiOutlineClipboard />
                    {copied ? '已复制' : '复制链接'}
                </button>
            </div>
        );
    }

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
