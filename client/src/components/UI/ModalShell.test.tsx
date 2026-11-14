import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModalShell from './ModalShell';

describe('ModalShell', () => {
    it('traps focus inside the modal and restores focus when closed', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        const { rerender } = render(
            <>
                <button type="button">Open Modal</button>
                <ModalShell isOpen={false} onClose={onClose}>
                    <div className="modal">
                        <button type="button">First Action</button>
                        <button type="button">Second Action</button>
                    </div>
                </ModalShell>
            </>
        );

        const trigger = screen.getByRole('button', { name: 'Open Modal' });
        trigger.focus();

        rerender(
            <>
                <button type="button">Open Modal</button>
                <ModalShell isOpen onClose={onClose}>
                    <div className="modal">
                        <button type="button">First Action</button>
                        <button type="button">Second Action</button>
                    </div>
                </ModalShell>
            </>
        );

        const firstAction = await screen.findByRole('button', { name: 'First Action' });
        const secondAction = screen.getByRole('button', { name: 'Second Action' });

        await waitFor(() => {
            expect(firstAction).toHaveFocus();
        });

        await user.tab();
        expect(secondAction).toHaveFocus();

        await user.tab();
        expect(firstAction).toHaveFocus();

        await user.tab({ shift: true });
        expect(secondAction).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);

        rerender(
            <>
                <button type="button">Open Modal</button>
                <ModalShell isOpen={false} onClose={onClose}>
                    <div className="modal">
                        <button type="button">First Action</button>
                        <button type="button">Second Action</button>
                    </div>
                </ModalShell>
            </>
        );

        await waitFor(() => {
            expect(trigger).toHaveFocus();
        });
    });

    it('closes when the overlay is clicked', async () => {
        const onClose = vi.fn();

        render(
            <ModalShell isOpen onClose={onClose}>
                <div className="modal">
                    <button type="button">Dismissible Content</button>
                </div>
            </ModalShell>
        );

        const overlay = document.body.querySelector('.modal-overlay');
        expect(overlay).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Dismissible Content' })).toHaveFocus();
        });

        fireEvent.pointerDown(overlay!);
        fireEvent.click(overlay!);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('preserves focus inside the modal when ariaLabel changes dynamically while open', async () => {
        const { rerender } = render(
            <>
                <button type="button">Launcher</button>
                <ModalShell isOpen ariaLabel="Initial Title" onClose={() => {}}>
                    <div className="modal">
                        <button type="button">First Button</button>
                        <button type="button">Second Button</button>
                    </div>
                </ModalShell>
            </>
        );

        const firstButton = await screen.findByRole('button', { name: 'First Button' });
        const secondButton = screen.getByRole('button', { name: 'Second Button' });

        await waitFor(() => {
            expect(firstButton).toHaveFocus();
        });

        secondButton.focus();
        expect(secondButton).toHaveFocus();

        rerender(
            <>
                <button type="button">Launcher</button>
                <ModalShell isOpen ariaLabel="Updated Title" onClose={() => {}}>
                    <div className="modal">
                        <button type="button">First Button</button>
                        <button type="button">Second Button</button>
                    </div>
                </ModalShell>
            </>
        );

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Updated Title');
        });
        expect(secondButton).toHaveFocus();
    });

    it('restores focus to the launcher when conditionally unmounted while open', async () => {
        const { rerender } = render(
            <>
                <button type="button">Open Conditional</button>
            </>
        );

        const trigger = screen.getByRole('button', { name: 'Open Conditional' });
        trigger.focus();

        rerender(
            <>
                <button type="button">Open Conditional</button>
                <ModalShell isOpen onClose={() => {}}>
                    <div className="modal">
                        <button type="button">Inside Conditional</button>
                    </div>
                </ModalShell>
            </>
        );

        const insideBtn = await screen.findByRole('button', { name: 'Inside Conditional' });
        await waitFor(() => {
            expect(insideBtn).toHaveFocus();
        });

        rerender(
            <>
                <button type="button">Open Conditional</button>
            </>
        );

        expect(trigger).toHaveFocus();
    });
});
