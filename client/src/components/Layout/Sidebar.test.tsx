import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/render';
import Sidebar from './Sidebar';

const mockSidebarState = vi.hoisted(() => ({
    user: { role: 'admin', username: 'review-admin' },
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: () => ({
        servers: [
            { id: 'server-1', name: 'Review Node', url: 'http://127.0.0.1:20530' },
        ],
        activeServer: null,
        activeServerId: 'global',
        selectServer: vi.fn(),
    }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        logout: vi.fn(),
        user: mockSidebarState.user,
    }),
}));

vi.mock('../../contexts/NotificationContext', () => ({
    useNotifications: () => ({
        unreadCount: 0,
    }),
}));

function SidebarHarness() {
    const [collapsed, setCollapsed] = useState(true);

    return (
        <Sidebar
            collapsed={collapsed}
            open={false}
            onClose={vi.fn()}
            onToggle={() => setCollapsed((value) => !value)}
        />
    );
}

describe('Sidebar', () => {
    beforeEach(() => {
        mockSidebarState.user = { role: 'admin', username: 'review-admin' };
    });

    it('expands again after being collapsed', async () => {
        renderWithRouter(<SidebarHarness />, { route: '/' });

        const sidebar = document.querySelector('.sidebar');
        expect(sidebar).toHaveClass('collapsed');

        fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));

        expect(sidebar).not.toHaveClass('collapsed');
        expect(screen.getByRole('button', { name: '收起侧边栏' })).toBeInTheDocument();
    }, 15000);

    it('renders collapsed nav flyout in a portal without clipping or duplicate native title tooltips', async () => {
        const { container } = renderWithRouter(<SidebarHarness />, { route: '/' });

        const navItem = container.querySelector('.nav-item');
        expect(navItem).not.toBeNull();
        expect(navItem).not.toHaveAttribute('title');
        expect(navItem).toHaveAttribute('aria-label', '仪表盘');

        fireEvent.mouseEnter(navItem!);

        await waitFor(() => {
            const flyout = document.body.querySelector('.sidebar-nav-flyout');
            expect(flyout).toBeInTheDocument();
            expect(flyout).toHaveAttribute('aria-hidden', 'true');
            expect(flyout).toHaveTextContent('仪表盘');
        });
    });

    it('does not render the old bottom-left account card anymore', () => {
        const { container } = renderWithRouter(<SidebarHarness />, { route: '/' });

        expect(container.querySelector('.sidebar-user')).toBeNull();
    });

    it('renders logout in a dedicated utility footer outside the scrollable nav', () => {
        const { container } = renderWithRouter(<SidebarHarness />, { route: '/' });

        expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
        expect(container.querySelector('.sidebar-utility .sidebar-account-chip')).toBeNull();
        expect(container.querySelector('.sidebar-utility .sidebar-logout')).not.toBeNull();
        expect(container.querySelector('.sidebar-nav .sidebar-logout')).toBeNull();
        expect(container.querySelector('.sidebar-footer-nav .sidebar-logout')).toBeNull();
    });

    it('groups dashboard under manage instead of rendering a separate monitor section', () => {
        renderWithRouter(<Sidebar collapsed={false} open={false} onClose={vi.fn()} onToggle={vi.fn()} />, { route: '/' });

        expect(screen.getByText('管理')).toBeInTheDocument();
        expect(screen.queryByText('监控')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /仪表盘/i })).toBeInTheDocument();
    });

    it('keeps expanded navigation labels in a flexible content region', () => {
        const { container } = renderWithRouter(<Sidebar collapsed={false} open={false} onClose={vi.fn()} onToggle={vi.fn()} />, { route: '/' });

        const items = Array.from(container.querySelectorAll('.sidebar .nav-item'));
        expect(items.length).toBeGreaterThan(0);
        items.forEach((item) => {
            const label = item.querySelector('.nav-label');
            expect(label).not.toBeNull();
            expect(label!.textContent!.trim().length).toBeGreaterThan(0);
        });
    });

    it('does not render the old bottom server selector anymore', () => {
        const { container } = renderWithRouter(<Sidebar collapsed={false} open={false} onClose={vi.fn()} onToggle={vi.fn()} />, { route: '/' });

        expect(container.querySelector('.server-selector')).toBeNull();
        expect(document.body.querySelector('.server-dropdown-menu')).toBeNull();
    });

    it('renders with open class on mobile when open is true and triggers onClose on link click', () => {
        const onCloseMock = vi.fn();
        const { container } = renderWithRouter(
            <Sidebar collapsed={false} open={true} isMobile={true} onClose={onCloseMock} onToggle={vi.fn()} />,
            { route: '/' }
        );

        const sidebar = container.querySelector('.sidebar');
        expect(sidebar).toHaveClass('open');

        const navLink = screen.getByRole('link', { name: /仪表盘/i });
        fireEvent.click(navLink);

        expect(onCloseMock).toHaveBeenCalled();
    });

    it('closes the mobile navigation drawer on Escape', () => {
        const onCloseMock = vi.fn();
        renderWithRouter(
            <Sidebar collapsed={false} open={true} isMobile={true} onClose={onCloseMock} onToggle={vi.fn()} />,
            { route: '/' }
        );

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('does not render duplicate /account navigation links for regular users', () => {
        mockSidebarState.user = { role: 'user', username: 'alice' };
        const { container } = renderWithRouter(
            <Sidebar collapsed={false} open={false} onClose={vi.fn()} onToggle={vi.fn()} />,
            { route: '/account' }
        );

        expect(container.querySelectorAll('.sidebar-nav a[href="/account"]')).toHaveLength(0);
        expect(container.querySelectorAll('.sidebar-utility a[href="/account"]')).toHaveLength(1);
    });
});
