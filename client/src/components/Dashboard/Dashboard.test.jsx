import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import Dashboard from './Dashboard.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => ({
        token: '',
    }),
}));

vi.mock('../../hooks/useWebSocket.js', () => ({
    default: () => ({
        status: 'disconnected',
        lastMessage: null,
    }),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title, subtitle }) => (
        <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
        </div>
    ),
}));

describe('Dashboard', () => {
    beforeEach(() => {
        localStorage.clear();
        useServer.mockReturnValue({
            activeServerId: null,
            panelApi: vi.fn(),
            activeServer: null,
            servers: [],
        });
    });

    it('shows the empty-state call to action in Chinese by default', () => {
        renderWithRouter(<Dashboard />);

        expect(screen.getByRole('heading', { name: '仪表盘' })).toBeInTheDocument();
        expect(screen.getByText('请先添加并选择一台服务器')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '前往添加服务器' })).toBeInTheDocument();
    });

    it('renders the empty-state copy in English when locale is switched', () => {
        localStorage.setItem('nms_locale', 'en-US');

        renderWithRouter(<Dashboard />);

        expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
        expect(screen.getByText('Add and select a server first')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go to Servers' })).toBeInTheDocument();
    });
});
