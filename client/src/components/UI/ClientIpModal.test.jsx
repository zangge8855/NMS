import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import ClientIpModal from './ClientIpModal.jsx';

vi.mock('./ModalShell.jsx', () => ({
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('./SkeletonTable.jsx', () => ({
    default: () => <div>loading-table</div>,
}));

describe('ClientIpModal', () => {
    it('renders the shared empty state when there are no node access records', () => {
        renderWithRouter(
            <ClientIpModal
                isOpen
                items={[]}
                onClose={() => {}}
                onRefresh={() => {}}
            />
        );

        expect(screen.getByText('暂无节点访问 IP 记录')).toBeInTheDocument();
        expect(screen.getByText('当节点侧产生新的代理访问后，可刷新查看最新记录。')).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'IP' })).not.toBeInTheDocument();
    });

    it('renders the table shell when records exist', () => {
        const { container } = renderWithRouter(
            <ClientIpModal
                isOpen
                items={[
                    {
                        ip: '203.0.113.18',
                        count: 3,
                        lastSeen: '2026-03-20T06:30:00.000Z',
                        source: 'real',
                        note: 'ISP',
                    },
                ]}
                onClose={() => {}}
                onRefresh={() => {}}
            />
        );

        expect(container.querySelector('.client-ip-table')).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'IP' })).toBeInTheDocument();
        expect(screen.getByText('203.0.113.18')).toBeInTheDocument();
    });
});
