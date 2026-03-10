import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const BODY_MODAL_COUNT_KEY = 'nmsModalOpenCount';
const BODY_MODAL_OVERFLOW_KEY = 'nmsModalOverflow';

function lockBodyScroll() {
    if (typeof document === 'undefined') return () => {};
    const { body } = document;
    const currentCount = Number(body.dataset[BODY_MODAL_COUNT_KEY] || '0');

    if (currentCount === 0) {
        body.dataset[BODY_MODAL_OVERFLOW_KEY] = body.style.overflow || '';
        body.style.overflow = 'hidden';
    }

    body.dataset[BODY_MODAL_COUNT_KEY] = String(currentCount + 1);

    return () => {
        const nextCount = Math.max(0, Number(body.dataset[BODY_MODAL_COUNT_KEY] || '1') - 1);
        if (nextCount === 0) {
            body.style.overflow = body.dataset[BODY_MODAL_OVERFLOW_KEY] || '';
            delete body.dataset[BODY_MODAL_COUNT_KEY];
            delete body.dataset[BODY_MODAL_OVERFLOW_KEY];
            return;
        }
        body.dataset[BODY_MODAL_COUNT_KEY] = String(nextCount);
    };
}

export default function ModalShell({
    isOpen,
    onClose,
    children,
    closeOnOverlayClick = true,
}) {
    const overlayPressedRef = useRef(false);
    const overlayInteractiveRef = useRef(false);

    useEffect(() => {
        if (!isOpen) return undefined;
        const unlockScroll = lockBodyScroll();
        const animationFrame = window.requestAnimationFrame(() => {
            overlayInteractiveRef.current = true;
        });
        return () => {
            window.cancelAnimationFrame(animationFrame);
            overlayPressedRef.current = false;
            overlayInteractiveRef.current = false;
            unlockScroll();
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose?.();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="modal-overlay"
            onPointerDown={(event) => {
                overlayPressedRef.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
                const shouldClose = closeOnOverlayClick
                    && overlayInteractiveRef.current
                    && overlayPressedRef.current
                    && event.target === event.currentTarget;
                overlayPressedRef.current = false;
                if (shouldClose) {
                    onClose?.();
                }
            }}
        >
            {children}
        </div>,
        document.body
    );
}
