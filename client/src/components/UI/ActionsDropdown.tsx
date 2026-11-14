import React, { useEffect, useRef, useState, useCallback, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import useFloatingPanel, { type ComputePositionParams } from '../../hooks/useFloatingPanel';
import { HiOutlineEllipsisVertical } from 'react-icons/hi2';
import { useI18n } from '../../contexts/LanguageContext';

export interface ActionItem {
    label: string;
    title?: string;
    icon?: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    isDanger?: boolean;
    isSuccess?: boolean;
    disabled?: boolean;
    hidden?: boolean;
}

export interface ActionsDropdownProps {
    trigger?: ReactElement<any>;
    actions?: (ActionItem | null | undefined | false)[];
    align?: 'left' | 'right';
}

export default function ActionsDropdown({
    trigger,
    actions = [],
    align = 'right',
}: ActionsDropdownProps) {
    const { t } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const toggleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen((prev) => !prev);
    };

    const handleActionClick = (e: React.MouseEvent, onClick: () => void, disabled?: boolean) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
        setIsOpen(false);
    };

    const getEnabledMenuItems = useCallback((): HTMLButtonElement[] => {
        if (!panelRef.current) return [];
        return Array.from(
            panelRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
        );
    }, []);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handleOutsideClick = (event: PointerEvent) => {
            if (
                (panelRef.current && panelRef.current.contains(event.target as Node)) ||
                (triggerRef.current && triggerRef.current.contains(event.target as Node))
            ) {
                return;
            }
            setIsOpen(false);
        };

        const handleClosePopovers = () => {
            setIsOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setIsOpen(false);
                triggerRef.current?.focus?.({ preventScroll: true });
                return;
            }
            if (event.key === 'Tab') {
                setIsOpen(false);
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                return;
            }
            const items = getEnabledMenuItems();
            if (items.length === 0) return;
            event.preventDefault();
            const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'Home') {
                items[0].focus();
                return;
            }
            if (event.key === 'End') {
                items[items.length - 1].focus();
                return;
            }
            if (event.key === 'ArrowDown') {
                const nextIdx = activeIdx === -1 ? 0 : (activeIdx + 1) % items.length;
                items[nextIdx].focus();
                return;
            }
            if (event.key === 'ArrowUp') {
                const prevIdx = activeIdx === -1 ? items.length - 1 : (activeIdx - 1 + items.length) % items.length;
                items[prevIdx].focus();
            }
        };

        document.addEventListener('pointerdown', handleOutsideClick);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('nms:close-popovers', handleClosePopovers);
        return () => {
            document.removeEventListener('pointerdown', handleOutsideClick);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('nms:close-popovers', handleClosePopovers);
        };
    }, [getEnabledMenuItems, isOpen]);

    const computePosition = useCallback(({ anchorRect, panelRect, viewport }: ComputePositionParams) => {
        const gap = 6;
        const margin = 12;
        const width = Math.max(140, panelRect.width || 160);
        const height = panelRect.height || 150;

        let left = align === 'right' ? anchorRect.right - width : anchorRect.left;
        
        // Boundaries safety
        if (left < margin) {
            left = margin;
        } else if (left + width > viewport.width - margin) {
            left = viewport.width - width - margin;
        }

        let top = anchorRect.bottom + gap;
        if (top + height > viewport.height - margin) {
            top = anchorRect.top - height - gap;
            if (top < margin) {
                top = margin;
            }
        }

        return {
            top: `${top}px`,
            left: `${left}px`,
            minWidth: `${width}px`,
        };
    }, [align]);

    const { panelStyle, isReady } = useFloatingPanel({
        open: isOpen,
        anchorRef: triggerRef as any,
        panelRef,
        computePosition,
    });

    const visibleActions = (actions.filter((action): action is ActionItem => Boolean(action && action.hidden !== true)));

    if (visibleActions.length === 0) return null;

    const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (isOpen) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const openToEnd = event.key === 'ArrowUp';
            setIsOpen(true);
            window.requestAnimationFrame(() => {
                const items = getEnabledMenuItems();
                if (items.length > 0) {
                    (openToEnd ? items[items.length - 1] : items[0]).focus();
                }
            });
        }
    };

    const renderedTrigger = trigger ? (
        React.cloneElement(trigger, {
            ref: triggerRef,
            onClick: (e: React.MouseEvent) => {
                if (trigger.props.onClick) trigger.props.onClick(e);
                toggleOpen(e);
            },
            onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
                if (trigger.props.onKeyDown) trigger.props.onKeyDown(e);
                handleTriggerKeyDown(e);
            },
            'aria-expanded': isOpen,
            'aria-haspopup': 'true',
        })
    ) : (
        <button
            ref={triggerRef as any}
            type="button"
            className="btn btn-secondary btn-sm btn-icon actions-dropdown-trigger"
            onClick={toggleOpen}
            onKeyDown={handleTriggerKeyDown}
            aria-expanded={isOpen}
            aria-haspopup="true"
            aria-label={t('comp.common.actionsMenu')}
        >
            <HiOutlineEllipsisVertical />
        </button>
    );

    const dropdownMenu = isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={panelRef}
                className={`actions-dropdown-panel glass-panel${isReady ? ' is-ready' : ''}`}
                style={panelStyle}
                role="menu"
            >
                {visibleActions.map((action, index) => {
                    const Icon = action.icon || null;
                    const classes = [
                        'actions-dropdown-item',
                        action.isDanger ? 'is-danger' : '',
                        action.isSuccess ? 'is-success' : '',
                        action.disabled ? 'is-disabled' : '',
                    ].filter(Boolean).join(' ');

                    return (
                        <button
                            key={index}
                            type="button"
                            className={classes}
                            role="menuitem"
                            title={action.title || action.label}
                            disabled={action.disabled}
                            onClick={(e) => handleActionClick(e, action.onClick, action.disabled)}
                        >
                            {Icon && <span className="actions-dropdown-item-icon"><Icon /></span>}
                            <span className="actions-dropdown-item-label">{action.label}</span>
                        </button>
                    );
                })}
            </div>,
            document.body
        )
        : null;

    return (
        <div className="actions-dropdown-wrapper">
            {renderedTrigger}
            {dropdownMenu}
        </div>
    );
}
