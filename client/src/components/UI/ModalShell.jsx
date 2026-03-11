import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const BODY_MODAL_COUNT_KEY = 'nmsModalOpenCount';
const BODY_MODAL_OVERFLOW_KEY = 'nmsModalOverflow';
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    'object',
    'embed',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(element) {
    if (!element) return false;
    if (element.hasAttribute('hidden')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function getDialogElement(overlay) {
    if (!overlay) return null;
    return overlay.querySelector('[data-modal-root], .modal, [role="dialog"]') || overlay;
}

function getFocusableElements(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((element) => isVisible(element));
}

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
    const overlayRef = useRef(null);
    const overlayPressedRef = useRef(false);
    const overlayInteractiveRef = useRef(false);
    const previousFocusRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return undefined;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const unlockScroll = lockBodyScroll();
        const animationFrame = window.requestAnimationFrame(() => {
            overlayInteractiveRef.current = true;
            const dialog = getDialogElement(overlayRef.current);
            if (!dialog) return;
            dialog.setAttribute('role', dialog.getAttribute('role') || 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            if (!dialog.hasAttribute('tabindex')) {
                dialog.setAttribute('tabindex', '-1');
            }
            const focusable = getFocusableElements(dialog);
            const preferred = dialog.querySelector('[data-modal-initial-focus]');
            const target = (preferred && isVisible(preferred) ? preferred : focusable[0]) || dialog;
            target.focus?.({ preventScroll: true });
        });
        return () => {
            window.cancelAnimationFrame(animationFrame);
            overlayPressedRef.current = false;
            overlayInteractiveRef.current = false;
            unlockScroll();
            previousFocusRef.current?.focus?.({ preventScroll: true });
            previousFocusRef.current = null;
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose?.();
                return;
            }
            if (event.key !== 'Tab') return;

            const dialog = getDialogElement(overlayRef.current);
            if (!dialog) return;

            const focusable = getFocusableElements(dialog);
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus?.({ preventScroll: true });
                return;
            }

            const currentIndex = focusable.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                : (currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);

            event.preventDefault();
            focusable[nextIndex]?.focus?.({ preventScroll: true });
        };
        const handleFocusIn = (event) => {
            const overlay = overlayRef.current;
            if (!overlay || overlay.contains(event.target)) return;
            const dialog = getDialogElement(overlay);
            const focusable = getFocusableElements(dialog);
            (focusable[0] || dialog)?.focus?.({ preventScroll: true });
        };
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={overlayRef}
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
