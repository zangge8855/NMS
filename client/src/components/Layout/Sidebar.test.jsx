import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import Sidebar from './Sidebar.jsx';

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: () => ({
        servers: [
            { id: 'server-1', name: 'Review Node', url: 'http://127.0.0.1:20530' },
        ],
        activeServer: null,
        activeServerId: 'global',
        selectServer: vi.fn(),
    }),
}));

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => ({
        logout: vi.fn(),
        user: { role: 'admin', username: 'review-admin' },
    }),
}));

vi.mock('../../contexts/NotificationContext.jsx', () => ({
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
    it('expands again after being collapsed', async () => {
        renderWithRouter(<SidebarHarness />, { route: '/' });

        const sidebar = document.querySelector('.sidebar');
        expect(sidebar).toHaveClass('collapsed');

        fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));

        expect(sidebar).not.toHaveClass('collapsed');
        expect(screen.getByRole('button', { name: '收起侧边栏' })).toBeInTheDocument();
    }, 15000);
});
