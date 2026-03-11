import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModalShell from './ModalShell.jsx';

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
});
