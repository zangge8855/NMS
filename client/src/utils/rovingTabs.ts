import type React from 'react';

export interface RovingTabItem<T extends string = string> {
    id: T;
}

/**
 * Handle WAI-ARIA horizontal roving tabindex navigation (`ArrowRight`, `ArrowLeft`,
 * `Home`, `End`, wrapping at bounds) on a `role="tablist"` container.
 */
export function handleRovingTabKeyDown<T extends string>(
    e: React.KeyboardEvent<HTMLElement>,
    tabs: readonly RovingTabItem<T>[],
    activeId: T,
    onSelect: (id: T) => void
): void {
    if (!Array.isArray(tabs) || tabs.length === 0) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const currentIndex = tabs.findIndex((item) => item.id === activeId);
    let nextIndex = -1;

    switch (e.key) {
        case 'ArrowRight':
            nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tabs.length : 0;
            break;
        case 'ArrowLeft':
            nextIndex = currentIndex >= 0
                ? (currentIndex - 1 + tabs.length) % tabs.length
                : tabs.length - 1;
            break;
        case 'Home':
            nextIndex = 0;
            break;
        case 'End':
            nextIndex = tabs.length - 1;
            break;
        default:
            return;
    }

    e.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;

    onSelect(nextTab.id);

    const buttons = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
    const nextBtn = buttons[nextIndex];
    nextBtn?.focus();
    nextBtn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
