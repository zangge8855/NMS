import React from 'react';
import { render, screen } from '@testing-library/react';
import BatchResultModal from './BatchResultModal.jsx';

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div data-testid="modal-shell">{children}</div>,
}));

describe('BatchResultModal', () => {
    it('renders user sync rows with stage, inbound remark, and target identity fallbacks', () => {
        render(
            <BatchResultModal
                isOpen
                onClose={() => {}}
                title="任务详情"
                data={{
                    summary: { total: 1, success: 0, failed: 1 },
                    results: [
                        {
                            success: false,
                            stage: 'client_toggle',
                            serverName: 'Node A',
                            inboundId: 101,
                            inboundRemark: 'Inbound A',
                            username: 'review-user',
                            subscriptionEmail: 'review-user@example.com',
                            msg: 'Auth failed',
                        },
                    ],
                }}
            />
        );

        expect(screen.getByText('启停同步')).toBeInTheDocument();
        expect(screen.getByText('101 · Inbound A')).toBeInTheDocument();
        expect(screen.getByText('review-user (review-user@example.com)')).toBeInTheDocument();
        expect(screen.getByText('Auth failed')).toBeInTheDocument();
    });
});
