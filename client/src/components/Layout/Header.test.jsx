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
    it('renders title and subtitle while ignoring the optional eyebrow', () => {
        const { container } = renderWithRouter(
            <Header
                title="集群仪表盘"
                eyebrow="Operations Overview"
                subtitle="跨节点观察在线态、容量与异常分布"
            />
        );

        expect(screen.getByRole('heading', { name: '集群仪表盘' })).toBeInTheDocument();
        expect(screen.getByText('跨节点观察在线态、容量与异常分布')).toBeInTheDocument();
        expect(screen.queryByText('Operations Overview')).not.toBeInTheDocument();
        expect(container.querySelector('.header-eyebrow')).toBeNull();
    });

    it('omits optional eyebrow and subtitle when not provided', () => {
        const { container } = renderWithRouter(<Header title="订阅中心" />);

        expect(screen.getByRole('heading', { name: '订阅中心' })).toBeInTheDocument();
        expect(container.querySelector('.header-eyebrow')).toBeNull();
        expect(container.querySelector('.header-subtitle')).toBeNull();
    });

    it('hides the scope context when showContext is false', () => {
        const { container } = renderWithRouter(<Header title="订阅中心" showContext={false} />);

        expect(screen.getByRole('heading', { name: '订阅中心' })).toBeInTheDocument();
        expect(container.querySelector('.header-context')).toBeNull();
    });
});
