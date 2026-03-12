import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import SystemSettings from './SystemSettings.jsx';

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => ({
        user: { role: 'user' },
    }),
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('../Tasks/TaskProgressModal.jsx', () => ({
    default: () => null,
}));

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('SystemSettings', () => {
    it('shows the access restriction empty state for non-admin users', () => {
        renderWithRouter(<SystemSettings />);

        expect(screen.getByRole('heading', { name: '系统设置' })).toBeInTheDocument();
        expect(screen.getByText('仅管理员可访问系统设置')).toBeInTheDocument();
    });
});
