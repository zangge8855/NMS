import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import BatchResultModal from './BatchResultModal.jsx';

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div data-testid="modal-shell">{children}</div>,
}));

describe('BatchResultModal', () => {
    it('renders user sync rows with stage, inbound remark, and target identity fallbacks', () => {
        renderWithRouter(
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

    it('switches summary and empty-state copy with the selected locale', () => {
        window.localStorage.setItem('nms_locale', 'en-US');

        renderWithRouter(
            <BatchResultModal
                isOpen
                onClose={() => {}}
                data={{
                    summary: { total: 2, success: 1, failed: 1 },
                    results: [],
                }}
            />
        );

        expect(screen.getByText('Batch Results')).toBeInTheDocument();
        expect(screen.getByText('Total 2')).toBeInTheDocument();
        expect(screen.getByText('Success 1')).toBeInTheDocument();
        expect(screen.getByText('Failed 1')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
        expect(screen.getByText('No execution results yet')).toBeInTheDocument();
    });
});
