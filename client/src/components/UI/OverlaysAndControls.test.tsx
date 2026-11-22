import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render';
import ActionsDropdown from './ActionsDropdown';
import CopyFeedbackButton from './CopyFeedbackButton';
import ExpandableQRCode from './ExpandableQRCode';
import { ListPagination } from './ListToolbar';
import ModalShell from './ModalShell';
import PageServerSelector from './PageServerSelector';
import CommandPalette from './CommandPalette';
import * as formatUtils from '../../utils/format';

vi.mock('react-hot-toast', () => ({
    default: Object.assign(vi.fn(), {
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: () => ({
        servers: [{ id: 'srv-1', name: 'Node One' }],
        activeServerId: 'global',
    }),
}));

const mockOverlayState = vi.hoisted(() => ({
    user: { role: 'admin', username: 'admin' },
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        user: mockOverlayState.user,
        logout: vi.fn(),
    }),
}));

import toast from 'react-hot-toast';

describe('CopyFeedbackButton', () => {
    beforeEach(() => {
        (toast.success as any).mockReset?.();
        (toast.error as any).mockReset?.();
    });

    it('surfaces an error and does not enter copied state when copyToClipboard returns false', async () => {
        const spy = vi.spyOn(formatUtils, 'copyToClipboard').mockResolvedValueOnce(false);
        const onCopied = vi.fn();
        const onError = vi.fn();

        renderWithRouter(
            <CopyFeedbackButton
                text="vless://test"
                successText="Copied!"
                errorText="Copy blocked"
                ariaLabel="Copy URI"
                onCopied={onCopied}
                onError={onError}
            />
        );

        const btn = screen.getByRole('button', { name: 'Copy URI' });
        fireEvent.click(btn);

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Copy blocked');
        });
        expect(btn).toHaveAttribute('data-copied', 'false');
        expect(onCopied).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('ActionsDropdown', () => {
    it('supports arrow navigation, Escape focus restoration, and nms:close-popovers', async () => {
        const user = userEvent.setup();
        const action1 = vi.fn();
        const action2 = vi.fn();

        renderWithRouter(
            <ActionsDropdown
                actions={[
                    { label: 'First', onClick: action1 },
                    { label: 'Disabled', onClick: () => {}, disabled: true },
                    { label: 'Last', onClick: action2 },
                ]}
            />
        );

        const trigger = screen.getByRole('button', { name: '操作菜单' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        expect(trigger).not.toHaveAttribute('aria-controls');
        await user.click(trigger);

        const menu = await screen.findByRole('menu', { name: '操作菜单' });
        expect(trigger).toHaveAttribute('aria-controls', menu.id);
        const firstItem = await screen.findByRole('menuitem', { name: 'First' });
        const lastItem = screen.getByRole('menuitem', { name: 'Last' });

        fireEvent.keyDown(document, { key: 'ArrowDown' });
        expect(firstItem).toHaveFocus();

        fireEvent.keyDown(document, { key: 'End' });
        expect(lastItem).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Home' });
        expect(firstItem).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });
        expect(trigger).toHaveFocus();

        // Reopen and test nms:close-popovers event.
        await user.click(trigger);
        expect(await screen.findByRole('menu')).toBeInTheDocument();
        act(() => {
            window.dispatchEvent(new CustomEvent('nms:close-popovers'));
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('dispatches nms:close-popovers on open and lets a menuitem open ModalShell without stealing focus back', async () => {
        const user = userEvent.setup();
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

        function ModalMenuHarness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <ActionsDropdown
                        actions={[
                            { label: 'Edit item', onClick: () => setOpen(true) },
                        ]}
                    />
                    <ModalShell isOpen={open} onClose={() => setOpen(false)}>
                        <div className="modal">
                            <input aria-label="Modal field" data-modal-initial-focus="" />
                        </div>
                    </ModalShell>
                </>
            );
        }

        renderWithRouter(<ModalMenuHarness />);

        const trigger = screen.getByRole('button', { name: '操作菜单' });
        await user.click(trigger);

        expect(dispatchSpy.mock.calls.some(([ev]) => (
            ev instanceof CustomEvent && ev.type === 'nms:close-popovers'
        ))).toBe(true);

        const editItem = await screen.findByRole('menuitem', { name: 'Edit item' });
        await user.click(editItem);

        const modalInput = await screen.findByLabelText('Modal field');
        await waitFor(() => {
            expect(modalInput).toHaveFocus();
        });
        dispatchSpy.mockRestore();
    });
});

describe('ExpandableQRCode', () => {
    it('traps Tab inside the enlarged dialog, closes only the QR layer on Escape, and restores focus', async () => {
        const user = userEvent.setup();
        const onModalClose = vi.fn();

        renderWithRouter(
            <ModalShell isOpen onClose={onModalClose}>
                <div className="modal">
                    <ExpandableQRCode value="vless://qr-value" label="QR Demo" />
                </div>
            </ModalShell>
        );

        const qrTrigger = await screen.findByRole('button', { name: /QR Demo/ });
        await user.click(qrTrigger);

        const closeQrBtn = await screen.findByRole('button', { name: '关闭' });
        const copyLinkBtn = screen.getByRole('button', { name: '复制链接' });
        await waitFor(() => {
            expect(closeQrBtn).toHaveFocus();
        });

        await user.tab();
        expect(copyLinkBtn).toHaveFocus();

        await user.tab();
        expect(closeQrBtn).toHaveFocus();

        await user.keyboard('{Escape}');
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '放大后的二维码' })).not.toBeInTheDocument();
        });
        expect(onModalClose).not.toHaveBeenCalled();
        expect(qrTrigger).toHaveFocus();
    });
});

describe('CommandPalette', () => {
    beforeEach(() => {
        window.localStorage.clear();
        mockOverlayState.user = { role: 'admin', username: 'admin' };
    });

    it('blocks opening when a modal overlay is active, renders listbox semantics, and localizes Clear search', async () => {
        window.localStorage.setItem('nms_locale', 'en-US');

        function Harness() {
            const [modalOpen, setModalOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setModalOpen(true)}>Open Host</button>
                    <ModalShell isOpen={modalOpen} onClose={() => setModalOpen(false)}>
                        <div className="modal">
                            <button type="button">Host Action</button>
                        </div>
                    </ModalShell>
                    <CommandPalette />
                </>
            );
        }

        const user = userEvent.setup();
        renderWithRouter(<Harness />);

        const openHostBtn = screen.getByRole('button', { name: 'Open Host' });
        await user.click(openHostBtn);
        expect(await screen.findByRole('button', { name: 'Host Action' })).toBeInTheDocument();

        // Ctrl+K and custom event must NOT open CommandPalette behind active ModalShell.
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        act(() => {
            window.dispatchEvent(new CustomEvent('nms:open-command-palette'));
        });
        expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument();

        // Dismiss host modal and open CommandPalette.
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Host Action' })).not.toBeInTheDocument();
        });

        openHostBtn.focus();
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        const input = await screen.findByRole('combobox', { name: 'Command Palette' });
        expect(screen.getByRole('listbox', { name: 'Command Palette' })).toBeInTheDocument();

        await user.type(input, 'node');
        const clearBtn = screen.getByRole('button', { name: 'Clear search' });
        expect(clearBtn).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument();
        });
        expect(openHostBtn).toHaveFocus();
    });

    it('matches bilingual navConfig keywords and avoids duplicating /subscriptions for regular users', async () => {
        const user = userEvent.setup();
        const adminRender = renderWithRouter(<CommandPalette />);

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        const input = await screen.findByRole('combobox');
        await user.type(input, 'backup');
        expect(screen.getByRole('option', { name: /系统设置/ })).toBeInTheDocument();
        adminRender.unmount();

        mockOverlayState.user = { role: 'user', username: 'alice' };
        renderWithRouter(<CommandPalette />);
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        const options = await screen.findAllByRole('option');
        const subOptions = options.filter((opt) => (opt.textContent || '').includes('订阅中心'));
        expect(subOptions).toHaveLength(1);
    });
});

describe('ListToolbar & PageServerSelector a11y/i18n', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('provides an accessible aria-label on page size select and localizes server selector placeholder', () => {
        window.localStorage.setItem('nms_locale', 'en-US');

        renderWithRouter(
            <>
                <ListPagination
                    page={1}
                    totalPages={2}
                    pageSize={20}
                    onPageSizeChange={() => {}}
                />
                <PageServerSelector
                    servers={[{ id: '1', name: 'Tokyo' }]}
                    value=""
                    onChange={() => {}}
                />
            </>
        );

        expect(screen.getByRole('combobox', { name: 'Page Size' })).toBeInTheDocument();
        const serverSelect = screen.getByRole('combobox', { name: 'Select server' });
        expect(serverSelect).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Select server' })).toBeInTheDocument();
    });
});
