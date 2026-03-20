import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render.jsx';
import AccountCenter from './AccountCenter.jsx';
import api from '../../api/client.js';

vi.mock('../../api/client.js', () => ({
    default: {
        post: vi.fn(),
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
        api.post.mockReset();
        api.put.mockReset();
    });

    it('requires sending a code to the current email before saving profile changes', async () => {
        const user = userEvent.setup();
        api.post.mockResolvedValue({
            data: {
                obj: {
                    email: 'alice@example.com',
                },
            },
        });
        api.put.mockResolvedValue({
            data: {
                obj: {
                    username: 'alice-next',
                    email: 'alice.next@example.com',
                    emailVerified: true,
                },
            },
        });

        renderWithRouter(<AccountCenter />);

        expect(screen.queryByLabelText('订阅邮箱')).not.toBeInTheDocument();
        expect(screen.getByText('检查当前登录身份，并在修改前先通过旧邮箱完成验证码确认。')).toBeInTheDocument();
        expect(screen.getByText('在这里更新登录密码，并确保新密码符合当前密码策略。')).toBeInTheDocument();

        const usernameInput = screen.getByLabelText('用户名');
        const emailInput = screen.getByLabelText('登录邮箱');
        expect(usernameInput).toHaveValue('alice');
        expect(emailInput).toHaveValue('alice@example.com');

        await user.clear(usernameInput);
        await user.type(usernameInput, 'alice-next');
        await user.clear(emailInput);
        await user.type(emailInput, 'alice.next@example.com');
        await user.click(screen.getByRole('button', { name: '发送验证码' }));
        await user.type(screen.getByLabelText('邮箱验证码'), '123456');
        await user.click(screen.getByRole('button', { name: '保存账户' }));

        expect(api.post).toHaveBeenCalledWith('/auth/profile/send-code', {
            username: 'alice-next',
            email: 'alice.next@example.com',
        });

        expect(api.put).toHaveBeenCalledWith('/auth/profile', {
            username: 'alice-next',
            email: 'alice.next@example.com',
            code: '123456',
        });
        expect(patchUserMock).toHaveBeenCalledWith({
            username: 'alice-next',
            email: 'alice.next@example.com',
            emailVerified: true,
        });
    });
});
