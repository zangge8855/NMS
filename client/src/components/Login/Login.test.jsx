import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render.jsx';
import Login from './Login.jsx';
import api from '../../api/client.js';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
    },
}));

const useAuthMock = vi.fn();
vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => useAuthMock(),
}));

vi.mock('../../contexts/ThemeContext.jsx', () => ({
    useTheme: () => ({
        mode: 'dark',
        cycleTheme: vi.fn(),
    }),
}));

describe('Login', () => {
    beforeEach(() => {
        api.get.mockReset();
        useAuthMock.mockReset();
        useAuthMock.mockReturnValue({
            login: vi.fn(),
            register: vi.fn(),
            verifyEmail: vi.fn(),
            resendCode: vi.fn(),
            requestPasswordReset: vi.fn(),
            resetPassword: vi.fn(),
        });
    });

    it('hides the self-service password reset entry when the server disables it', async () => {
        api.get.mockResolvedValue({
            data: {
                obj: {
                    enabled: true,
                    inviteOnlyEnabled: false,
                    passwordResetEnabled: false,
                },
            },
        });

        renderWithRouter(<Login />);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/auth/registration-status');
        });

        expect(screen.queryByRole('button', { name: '忘记密码' })).not.toBeInTheDocument();
    });

    it('opens the reset-password form only when the server capability is enabled', async () => {
        const user = userEvent.setup();

        api.get.mockResolvedValue({
            data: {
                obj: {
                    enabled: true,
                    inviteOnlyEnabled: false,
                    passwordResetEnabled: true,
                },
            },
        });

        renderWithRouter(<Login />);

        const forgotButton = await screen.findByRole('button', { name: '忘记密码' });
        await user.click(forgotButton);

        expect(screen.getAllByRole('heading', { name: '找回密码' }).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: '发送验证码' })).toBeInTheDocument();
    });

    it('submits the login form with an email identifier', async () => {
        const user = userEvent.setup();
        const loginMock = vi.fn().mockResolvedValue({ success: false, msg: '用户名、邮箱或密码错误' });

        api.get.mockResolvedValue({
            data: {
                obj: {
                    enabled: true,
                    inviteOnlyEnabled: false,
                    passwordResetEnabled: true,
                },
            },
        });
        useAuthMock.mockReturnValue({
            login: loginMock,
            register: vi.fn(),
            verifyEmail: vi.fn(),
            resendCode: vi.fn(),
            requestPasswordReset: vi.fn(),
            resetPassword: vi.fn(),
        });

        renderWithRouter(<Login />);

        await user.type(
            await screen.findByPlaceholderText('请输入用户名或注册邮箱'),
            ' alice@example.com '
        );
        await user.type(screen.getByPlaceholderText('请输入密码'), 'Pass1234!');
        await user.click(screen.getByRole('button', { name: '登录' }));

        await waitFor(() => {
            expect(loginMock).toHaveBeenCalledWith('alice@example.com', 'Pass1234!');
        });
    });
});
