import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const BODY_MODAL_COUNT_KEY = 'nmsModalOpenCount';
const BODY_MODAL_OVERFLOW_KEY = 'nmsModalOverflow';
const BODY_MODAL_PADDING_KEY = 'nmsModalPaddingRight';
const APP_ROOT_MODAL_INERT_COUNT_KEY = 'nmsModalInertCount';
const MODAL_EXIT_DURATION_MS = 240;
// Stack of currently-open ModalShell instance ids. Only the topmost entry reacts to Escape
// and enforces the focus trap, so stacking a confirm/QR dialog over another modal doesn't
// close them both at once or make the two focus traps fight each other.
let modalInstanceSeq = 0;
const modalStack: number[] = [];

// Lets non-ModalShell overlays (e.g. the enlarged-QR portal) participate in the
// shared modal stack, so the ModalShell beneath them stops treating itself as
// topmost — otherwise one Escape would close both layers at once.
export function acquireModalStackSlot() {
    const id = ++modalInstanceSeq;
    modalStack.push(id);
    let released = false;
    return {
        isTopmost: () => modalStack.length > 0 && modalStack[modalStack.length - 1] === id,
        release: () => {
            if (released) return;
            released = true;
            const idx = modalStack.indexOf(id);
            if (idx !== -1) modalStack.splice(idx, 1);
        },
    };
}
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

function isVisible(element: Element | null): boolean {
    if (!element) return false;
    if (element.hasAttribute('hidden')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function getDialogElement(overlay: HTMLElement | null): HTMLElement | null {
    if (!overlay) return null;
    return overlay.querySelector('[data-modal-root], .modal, [role="dialog"]') || overlay;
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => isVisible(element));
}

function lockBodyScroll(): () => void {
    if (typeof document === 'undefined') return () => {};
    const { body } = document;
    const currentCount = Number(body.dataset[BODY_MODAL_COUNT_KEY] || '0');

    if (currentCount === 0) {
        body.dataset[BODY_MODAL_OVERFLOW_KEY] = body.style.overflow || '';
        body.dataset[BODY_MODAL_PADDING_KEY] = body.style.paddingRight || '';

        const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        const computedPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight || '0') || 0;
        if (scrollbarWidth > 0) {
            body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
        }

        body.style.overflow = 'hidden';
    }

    body.dataset[BODY_MODAL_COUNT_KEY] = String(currentCount + 1);

    return () => {
        const nextCount = Math.max(0, Number(body.dataset[BODY_MODAL_COUNT_KEY] || '1') - 1);
        if (nextCount === 0) {
            body.style.overflow = body.dataset[BODY_MODAL_OVERFLOW_KEY] || '';
            body.style.paddingRight = body.dataset[BODY_MODAL_PADDING_KEY] || '';
            
            delete body.dataset[BODY_MODAL_COUNT_KEY];
            delete body.dataset[BODY_MODAL_OVERFLOW_KEY];
            delete body.dataset[BODY_MODAL_PADDING_KEY];
            return;
        }
        body.dataset[BODY_MODAL_COUNT_KEY] = String(nextCount);
    };
}

function getAppRoot(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById('root') || document.querySelector('[data-app-root]') || null;
}

function isolateAppRoot(): () => void {
    const appRoot = getAppRoot();
    if (!appRoot) return () => {};

    const currentCount = Number(appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY] || '0');
    if (currentCount === 0) {
        appRoot.dataset.nmsModalAriaHidden = appRoot.getAttribute('aria-hidden') || '';
        (appRoot as any).inert = true;
        appRoot.setAttribute('aria-hidden', 'true');
    }
    appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY] = String(currentCount + 1);

    return () => {
        const nextCount = Math.max(0, Number(appRoot.dataset[APP_ROOT_MODAL_INERT_COUNT_KEY] || '1') - 1);
        if (nextCount === 0) {
            (appRoot as any).inert = false;
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

export interface ModalShellProps {
    isOpen: boolean;
    onClose?: () => void;
    children?: ReactNode;
    closeOnOverlayClick?: boolean;
    ariaLabel?: string;
    ariaLabelledBy?: string;
}

export default function ModalShell({
    isOpen,
    onClose,
    children,
    closeOnOverlayClick = true,
    ariaLabel,
    ariaLabelledBy,
}: ModalShellProps) {
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const overlayPressedRef = useRef(false);
    const overlayInteractiveRef = useRef(false);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const startSentinelRef = useRef<HTMLDivElement | null>(null);
    const endSentinelRef = useRef<HTMLDivElement | null>(null);
    const instanceIdRef = useRef(0);
    const [shouldRender, setShouldRender] = useState(isOpen);

    // Register/unregister this modal on the shared open-modal stack while it is open.
    useEffect(() => {
        if (!isOpen) return undefined;
        const id = ++modalInstanceSeq;
        instanceIdRef.current = id;
        modalStack.push(id);
        return () => {
            const idx = modalStack.indexOf(id);
            if (idx !== -1) modalStack.splice(idx, 1);
        };
    }, [isOpen]);

    const isTopmostModal = () => modalStack.length === 0
        || modalStack[modalStack.length - 1] === instanceIdRef.current;

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            return undefined;
        }

        if (!shouldRender) return undefined;
        const timeoutId = window.setTimeout(() => {
            previousFocusRef.current?.focus?.({ preventScroll: true });
            previousFocusRef.current = null;
            setShouldRender(false);
        }, MODAL_EXIT_DURATION_MS);

        return () => window.clearTimeout(timeoutId);
    }, [isOpen, shouldRender]);

    const focusDialogBoundary = (direction: 'start' | 'end') => {
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
            if (ariaLabelledBy) {
                dialog.setAttribute('aria-labelledby', ariaLabelledBy);
                dialog.removeAttribute('aria-label');
            } else if (ariaLabel) {
                dialog.setAttribute('aria-label', ariaLabel);
                dialog.removeAttribute('aria-labelledby');
            }
            if (!dialog.hasAttribute('tabindex')) {
                dialog.setAttribute('tabindex', '-1');
            }
            const focusable = getFocusableElements(dialog);
            const preferred = dialog.querySelector<HTMLElement>('[data-modal-initial-focus]');
            const target = (preferred && isVisible(preferred) ? preferred : focusable[0]) || dialog;
            target.focus?.({ preventScroll: true });
        });
        return () => {
            window.cancelAnimationFrame(animationFrame);
            overlayPressedRef.current = false;
            overlayInteractiveRef.current = false;
            unlockScroll();
            restoreAppRootIsolation();
        };
    }, [ariaLabel, ariaLabelledBy, isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                // Only the topmost modal should consume Escape, so a stacked dialog closes
                // alone instead of dismissing everything beneath it.
                if (!isTopmostModal()) return;
                event.preventDefault();
                onClose?.();
            }
        };
        const handleFocusIn = (event: FocusEvent) => {
            // Defer to the topmost modal's focus trap; otherwise two stacked traps fight
            // over focus.
            if (!isTopmostModal()) return;
            const overlay = overlayRef.current;
            if (!overlay || overlay.contains(event.target as Node)) return;
            focusDialogBoundary('start');
        };
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!shouldRender || typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={overlayRef}
            className="modal-overlay"
            data-state={isOpen ? 'open' : 'closed'}
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
