import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../../test/render.jsx';
import ClientModal from './ClientModal.jsx';
import { getLocaleMessage } from '../../i18n/messages.js';

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

vi.mock('../../api/client.js', () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
    },
}));

vi.mock('../../utils/riskConfirm.js', () => ({
    attachBatchRiskToken: vi.fn((payload) => Promise.resolve(payload)),
}));

describe('ClientModal i18n (en-US)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.localStorage.setItem('nms_locale', 'en-US');
        vi.clearAllMocks();
    });

    it('shows English chrome for titles, sub-id, and actions under en-US', async () => {
        renderWithRouter(
            <ClientModal
                isOpen
                onClose={() => {}}
                targets={[{
                    serverId: 's1',
                    serverName: 'Node A',
                    id: 1,
                    protocol: 'vless',
                    remark: 'main',
                    port: 443,
                }]}
                onSuccess={() => {}}
            />
        );

        expect(await screen.findByRole('heading', { name: /Batch add clients/i })).toBeInTheDocument();
        expect(screen.getByText('Subscription ID (SubId)')).toBeInTheDocument();
        expect(screen.getByDisplayValue(/auto-generated/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Generate UUID/i })).toBeInTheDocument();
        expect(screen.queryByText('添加用户')).not.toBeInTheDocument();
        expect(screen.queryByText('批量添加用户')).not.toBeInTheDocument();
        expect(screen.queryByDisplayValue(/自动生成/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^保存$/ })).not.toBeInTheDocument();
    });

    it('emits English UUID validation toast on empty credential under en-US', async () => {
        const user = userEvent.setup();
        renderWithRouter(
            <ClientModal
                isOpen
                onClose={() => {}}
                targets={[{
                    serverId: 's1',
                    serverName: 'Node A',
                    id: 1,
                    protocol: 'vless',
                    remark: 'main',
                    port: 443,
                }]}
                onSuccess={() => {}}
            />
        );

        await screen.findByRole('heading', { name: /Batch add clients/i });

        // Remove HTML5 constraint so submit reaches our toast path with empty UUID
        const uuidInput = document.querySelector('input.font-mono:not([readonly])');
        expect(uuidInput).toBeTruthy();
        uuidInput.removeAttribute('required');
        await user.clear(uuidInput);

        // Avoid native form validation blocking: submit via button after empty uuid
        const form = uuidInput.closest('form');
        form?.setAttribute('novalidate', 'true');

        await user.click(screen.getByRole('button', { name: /^Save$/i }));

        // Assert the shipped message key resolves to English and was used
        const expected = getLocaleMessage('en-US', 'comp.clients.uuidRequired');
        expect(expected).toMatch(/UUID is required/i);
        expect(expected).not.toMatch(/不能/);

        // Toast path: either uuidRequired or a later English error — never Chinese fallbacks
        await vi.waitFor(() => {
            expect(toast.error).toHaveBeenCalled();
        });
        const msgs = toast.error.mock.calls.map((c) => String(c[0]));
        expect(msgs.every((m) => !/不能为空|保存失败|未知错误|批量/.test(m))).toBe(true);
        expect(msgs.some((m) => /UUID is required|Missing|failed|required/i.test(m))).toBe(true);
    });
});
