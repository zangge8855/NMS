import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const BODY_MODAL_COUNT_KEY = 'nmsModalOpenCount';
const BODY_MODAL_OVERFLOW_KEY = 'nmsModalOverflow';
const BODY_MODAL_PADDING_KEY = 'nmsModalPaddingRight';
const BODY_MODAL_POSITION_KEY = 'nmsModalPosition';
const BODY_MODAL_TOP_KEY = 'nmsModalTop';
const BODY_MODAL_WIDTH_KEY = 'nmsModalWidth';
const BODY_MODAL_LEFT_KEY = 'nmsModalLeft';
const BODY_MODAL_RIGHT_KEY = 'nmsModalRight';
const BODY_MODAL_TOUCH_ACTION_KEY = 'nmsModalTouchAction';
const BODY_MODAL_SCROLL_Y_KEY = 'nmsModalScrollY';
const APP_ROOT_MODAL_INERT_COUNT_KEY = 'nmsModalInertCount';
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
    const scrollY = window.scrollY || window.pageYOffset || 0;

    if (currentCount === 0) {
        body.dataset[BODY_MODAL_OVERFLOW_KEY] = body.style.overflow || '';
        body.dataset[BODY_MODAL_PADDING_KEY] = body.style.paddingRight || '';
        body.dataset[BODY_MODAL_POSITION_KEY] = body.style.position || '';
        body.dataset[BODY_MODAL_TOP_KEY] = body.style.top || '';
        body.dataset[BODY_MODAL_WIDTH_KEY] = body.style.width || '';
        body.dataset[BODY_MODAL_LEFT_KEY] = body.style.left || '';
        body.dataset[BODY_MODAL_RIGHT_KEY] = body.style.right || '';
        body.dataset[BODY_MODAL_TOUCH_ACTION_KEY] = body.style.touchAction || '';
        body.dataset[BODY_MODAL_SCROLL_Y_KEY] = String(scrollY);

        const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        const computedPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight || '0') || 0;
        if (scrollbarWidth > 0) {
            body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
        }

        body.style.overflow = 'hidden';
        body.style.touchAction = 'none';

        if (isIosLike()) {
            body.style.position = 'fixed';
            body.style.top = `-${scrollY}px`;
            body.style.left = '0';
            body.style.right = '0';
            body.style.width = '100%';
        }
    }

    body.dataset[BODY_MODAL_COUNT_KEY] = String(currentCount + 1);

    return () => {
        const nextCount = Math.max(0, Number(body.dataset[BODY_MODAL_COUNT_KEY] || '1') - 1);
        if (nextCount === 0) {
            body.style.overflow = body.dataset[BODY_MODAL_OVERFLOW_KEY] || '';
            body.style.paddingRight = body.dataset[BODY_MODAL_PADDING_KEY] || '';
            body.style.position = body.dataset[BODY_MODAL_POSITION_KEY] || '';
            body.style.top = body.dataset[BODY_MODAL_TOP_KEY] || '';
            body.style.width = body.dataset[BODY_MODAL_WIDTH_KEY] || '';
            body.style.left = body.dataset[BODY_MODAL_LEFT_KEY] || '';
            body.style.right = body.dataset[BODY_MODAL_RIGHT_KEY] || '';
            body.style.touchAction = body.dataset[BODY_MODAL_TOUCH_ACTION_KEY] || '';
            if (isIosLike()) {
                const restoreScrollY = Number.parseInt(body.dataset[BODY_MODAL_SCROLL_Y_KEY] || '0', 10);
                window.scrollTo(0, Number.isFinite(restoreScrollY) ? restoreScrollY : 0);
            }
            delete body.dataset[BODY_MODAL_COUNT_KEY];
            delete body.dataset[BODY_MODAL_OVERFLOW_KEY];
            delete body.dataset[BODY_MODAL_PADDING_KEY];
            delete body.dataset[BODY_MODAL_POSITION_KEY];
            delete body.dataset[BODY_MODAL_TOP_KEY];
            delete body.dataset[BODY_MODAL_WIDTH_KEY];
            delete body.dataset[BODY_MODAL_LEFT_KEY];
            delete body.dataset[BODY_MODAL_RIGHT_KEY];
            delete body.dataset[BODY_MODAL_TOUCH_ACTION_KEY];
            delete body.dataset[BODY_MODAL_SCROLL_Y_KEY];
            return;
        }
        body.dataset[BODY_MODAL_COUNT_KEY] = String(nextCount);
    };
}

function getAppRoot() {
    if (typeof document === 'undefined') return null;
    return document.getElementById('root') || document.querySelector('[data-app-root]') || null;
}

function isolateAppRoot() {
    const appRoot = getAppRoot();
    if (!appRoot) return () => {};

    const currentCount = Number(appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY] || '0');
    if (currentCount === 0) {
        appRoot.dataset.nmsModalAriaHidden = appRoot.getAttribute('aria-hidden') || '';
        appRoot.inert = true;
        appRoot.setAttribute('aria-hidden', 'true');
    }
    appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY] = String(currentCount + 1);

    return () => {
        const nextCount = Math.max(0, Number(appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY] || '1') - 1);
        if (nextCount === 0) {
            appRoot.inert = false;
            const previousAriaHidden = appRoot.dataset.nmsModalAriaHidden || '';
            if (previousAriaHidden) {
                appRoot.setAttribute('aria-hidden', previousAriaHidden);
            } else {
                appRoot.removeAttribute('aria-hidden');
            }
            delete appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY];
            delete appRoot.dataset.nmsModalAriaHidden;
            return;
        }
        appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY] = String(nextCount);
    };
}

function isIosLike() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/.test(ua)
        || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
    const startSentinelRef = useRef(null);
    const endSentinelRef = useRef(null);

    const focusDialogBoundary = (direction) => {
        const dialog = getDialogElement(overlayRef.current);
        if (!dialog) return;
        const focusable = getFocusableElements(dialog);
        if (focusable.length === 0) {
            dialog.focus?.({ preventScroll: true });
            return;
        }
        const target = direction === 'end' ? focusable[focusable.length - 1] : focusable[0];
        target?.focus?.({ preventScroll: true });
    };

    useEffect(() => {
        if (!isOpen) return undefined;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const unlockScroll = lockBodyScroll();
        const restoreAppRootIsolation = isolateAppRoot();
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
            restoreAppRootIsolation();
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
            }
        };
        const handleFocusIn = (event) => {
            const overlay = overlayRef.current;
            if (!overlay || overlay.contains(event.target)) return;
            focusDialogBoundary('start');
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
            onTouchMove={(event) => {
                if (event.target === event.currentTarget) {
                    event.preventDefault();
                }
            }}
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
            <div
                ref={startSentinelRef}
                className="modal-sentinel"
                tabIndex={0}
                aria-hidden="true"
                onFocus={() => focusDialogBoundary('end')}
            />
            {children}
            <div
                ref={endSentinelRef}
                className="modal-sentinel"
                tabIndex={0}
                aria-hidden="true"
                onFocus={() => focusDialogBoundary('start')}
            />
        </div>,
        document.body
    );
}
