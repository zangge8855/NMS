import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import useFloatingPanel from '../../hooks/useFloatingPanel.js';
import { HiOutlineEllipsisVertical } from 'react-icons/hi2';

export default function ActionsDropdown({
    trigger,
    actions = [], // list of { label, title, icon: Icon, onClick, isDanger, isSuccess, disabled, hidden }
    align = 'right',
}) {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);

    const toggleOpen = (e) => {
        e.stopPropagation();
        setIsOpen((prev) => !prev);
    };

    const handleActionClick = (e, onClick, disabled) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
        setIsOpen(false);
    };

    useEffect(() => {
        if (!isOpen) return undefined;

        const handleOutsideClick = (event) => {
            if (
                (panelRef.current && panelRef.current.contains(event.target)) ||
                (triggerRef.current && triggerRef.current.contains(event.target))
            ) {
                return;
            }
            setIsOpen(false);
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('pointerdown', handleOutsideClick);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handleOutsideClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const computePosition = useCallback(({ anchorRect, panelRect, viewport }) => {
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
        anchorRef: triggerRef,
        panelRef,
        computePosition,
    });

    const visibleActions = actions.filter((action) => action && action.hidden !== true);

    if (visibleActions.length === 0) return null;

    const renderedTrigger = trigger ? (
        React.cloneElement(trigger, {
            ref: triggerRef,
            onClick: (e) => {
                if (trigger.props.onClick) trigger.props.onClick(e);
                toggleOpen(e);
            },
            'aria-expanded': isOpen,
            'aria-haspopup': 'true',
        })
    ) : (
        <button
            ref={triggerRef}
            type="button"
            className="btn btn-secondary btn-sm btn-icon actions-dropdown-trigger"
            onClick={toggleOpen}
            aria-expanded={isOpen}
            aria-haspopup="true"
            aria-label="操作菜单"
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
