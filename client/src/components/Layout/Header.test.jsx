import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import Header from './Header.jsx';

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: () => ({
        activeServer: null,
        activeServerId: 'global',
    }),
}));

vi.mock('../../contexts/ThemeContext.jsx', () => ({
    useTheme: () => ({
        mode: 'dark',
        cycleTheme: vi.fn(),
    }),
}));

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => ({
        user: { role: 'admin', username: 'review-admin' },
    }),
}));

vi.mock('./NotificationBell.jsx', () => ({
    default: () => <div data-testid="notification-bell" />,
}));

describe('Header', () => {
    it('renders eyebrow, title, and subtitle when provided', () => {
        renderWithRouter(
            <Header
                title="集群仪表盘"
                eyebrow="Operations Overview"
                subtitle="跨节点观察在线态、容量与异常分布"
            />
        );

        expect(screen.getByText('Operations Overview')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: '集群仪表盘' })).toBeInTheDocument();
        expect(screen.getByText('跨节点观察在线态、容量与异常分布')).toBeInTheDocument();
    });

    it('omits optional eyebrow and subtitle when not provided', () => {
        const { container } = renderWithRouter(<Header title="订阅中心" />);

        expect(screen.getByRole('heading', { name: '订阅中心' })).toBeInTheDocument();
        expect(container.querySelector('.header-eyebrow')).toBeNull();
        expect(container.querySelector('.header-subtitle')).toBeNull();
    });
});
