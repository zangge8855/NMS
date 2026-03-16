import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render.jsx';
import AccountCenter from './AccountCenter.jsx';
import api from '../../api/client.js';

vi.mock('../../api/client.js', () => ({
    default: {
        put: vi.fn(),
    },
}));

const patchUserMock = vi.fn();

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => ({
        user: {
            role: 'user',
            username: 'alice',
            email: 'alice@example.com',
            subscriptionEmail: 'alice-sub@example.com',
            emailVerified: true,
        },
        patchUser: patchUserMock,
    }),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

describe('AccountCenter', () => {
    beforeEach(() => {
        patchUserMock.mockReset();
        api.put.mockReset();
    });

    it('lets the user edit username and email without showing subscription email', async () => {
        const user = userEvent.setup();
        api.put.mockResolvedValue({
            data: {
                obj: {
                    username: 'alice-next',
                    email: 'alice.next@example.com',
                },
            },
        });

        renderWithRouter(<AccountCenter />);

        expect(screen.queryByLabelText('订阅邮箱')).not.toBeInTheDocument();

        const usernameInput = screen.getByLabelText('用户名');
        const emailInput = screen.getByLabelText('登录邮箱');
        expect(usernameInput).toHaveValue('alice');
        expect(emailInput).toHaveValue('alice@example.com');

        await user.clear(usernameInput);
        await user.type(usernameInput, 'alice-next');
        await user.clear(emailInput);
        await user.type(emailInput, 'alice.next@example.com');
        await user.click(screen.getByRole('button', { name: '保存账号' }));

        expect(api.put).toHaveBeenCalledWith('/auth/profile', {
            username: 'alice-next',
            email: 'alice.next@example.com',
        });
        expect(patchUserMock).toHaveBeenCalledWith({
            username: 'alice-next',
            email: 'alice.next@example.com',
        });
    });
});
