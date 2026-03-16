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
    it('renders title while ignoring the optional eyebrow and hiding subtitle by default', () => {
        const { container } = renderWithRouter(
            <Header
                title="集群仪表盘"
                eyebrow="Operations Overview"
                subtitle="跨节点观察在线态、容量与异常分布"
            />
        );

        expect(screen.getByRole('heading', { name: '集群仪表盘' })).toBeInTheDocument();
        expect(screen.queryByText('跨节点观察在线态、容量与异常分布')).not.toBeInTheDocument();
        expect(screen.queryByText('Operations Overview')).not.toBeInTheDocument();
        expect(container.querySelector('.header-eyebrow')).toBeNull();
        expect(container.querySelector('.header-subtitle')).toBeNull();
    });

    it('omits optional eyebrow and subtitle when not provided', () => {
        const { container } = renderWithRouter(<Header title="订阅中心" />);

        expect(screen.getByRole('heading', { name: '订阅中心' })).toBeInTheDocument();
        expect(container.querySelector('.header-eyebrow')).toBeNull();
        expect(container.querySelector('.header-subtitle')).toBeNull();
    });

    it('does not render the scope context block', () => {
        const { container } = renderWithRouter(<Header title="订阅中心" />);

        expect(screen.getByRole('heading', { name: '订阅中心' })).toBeInTheDocument();
        expect(container.querySelector('.header-context')).toBeNull();
    });

    it('supports wrapped titles for detail pages with long names', () => {
        renderWithRouter(<Header title="服务器 · 华东核心节点-A-超长名称" allowTitleWrap />);

        expect(screen.getByRole('heading', { name: '服务器 · 华东核心节点-A-超长名称' })).toHaveClass('header-title--wrap');
    });

    it('keeps the top-right action area free of the old user identity chip', () => {
        const { container } = renderWithRouter(<Header title="订阅中心" />);

        expect(screen.queryByText('review-admin')).not.toBeInTheDocument();
        expect(container.querySelector('.header-user-chip')).toBeNull();
        expect(container.querySelector('.header-user-symbol')).toBeNull();
    });

    it('reuses the sidebar navigation icon for top-level pages and nested detail pages', () => {
        const { container: auditContainer } = renderWithRouter(<Header title="审计中心" />, { route: '/audit' });
        expect(auditContainer.querySelector('.header-icon')).toBeInTheDocument();

        const { container: detailContainer } = renderWithRouter(<Header title="用户详情 · alice" />, { route: '/clients/user-1' });
        expect(detailContainer.querySelector('.header-icon')).toBeInTheDocument();
    });
});
