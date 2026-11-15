import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { ListPagination } from './ListToolbar';
import { renderWithRouter } from '../../test/render';

describe('ListPagination', () => {
    it('ignores IME composing Enter keydowns and submits only confirmed Enter', () => {
        const onJump = vi.fn();
        renderWithRouter(
            <ListPagination
                page={1}
                totalPages={5}
                onPrevious={() => {}}
                onNext={() => {}}
                onJump={onJump}
            />
        );

        const jumpInput = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(jumpInput, { target: { value: '3' } });

        // Safari/macOS out-of-order Enter during IME composition (keyCode 229)
        fireEvent.keyDown(jumpInput, { key: 'Enter', keyCode: 229 });
        expect(onJump).not.toHaveBeenCalled();

        // Standard KeyboardEvent with isComposing: true
        act(() => {
            jumpInput.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    isComposing: true,
                    bubbles: true,
                    cancelable: true,
                })
            );
        });
        expect(onJump).not.toHaveBeenCalled();

        // Confirmed Enter outside composition jumps to target page
        fireEvent.keyDown(jumpInput, { key: 'Enter', keyCode: 13 });
        expect(onJump).toHaveBeenCalledWith(3);
    });
});
