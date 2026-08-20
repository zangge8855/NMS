import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render';
import Login from './Login';
import api from '../../api/client';

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
    },
}));

const useAuthMock = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => useAuthMock(),
}));

describe('Login', () => {
    beforeEach(() => {
        (api.get as any).mockReset();
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
        (api.get as any).mockResolvedValue({
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

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: '忘记密码' })).not.toBeInTheDocument();
        });
    });

    it('opens the reset-password form only when the server capability is enabled', async () => {
        const user = userEvent.setup();

        (api.get as any).mockResolvedValue({
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

    it('marks decorative login glows as hidden from assistive tech', async () => {
        (api.get as any).mockResolvedValue({
            data: {
                obj: {
                    enabled: true,
                    inviteOnlyEnabled: false,
                    passwordResetEnabled: true,
                },
            },
        });

        const { container } = renderWithRouter(<Login />);

        await screen.findByRole('button', { name: '忘记密码' });
        const glows = container.querySelectorAll('.login-bg-glow');

        expect(glows).toHaveLength(3);
        glows.forEach((glow) => {
            expect(glow).toHaveAttribute('aria-hidden', 'true');
        });
    });

    it('submits the login form with an email identifier', async () => {
        const user = userEvent.setup();
        const loginMock = vi.fn().mockResolvedValue({ success: false, msg: '用户名、邮箱或密码错误' });

        (api.get as any).mockResolvedValue({
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

    it('transitions to 2FA challenge mode when login requires two-factor authentication', async () => {
        const user = userEvent.setup();
        const loginMock = vi.fn().mockResolvedValue({
            success: false,
            needTwoFactor: true,
            challengeToken: 'test-challenge-jwt',
            msg: '请输入 2FA 验证码完成登录',
        });
        const loginTwoFactorMock = vi.fn().mockResolvedValue({ success: true });

        (api.get as any).mockResolvedValue({
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
            loginTwoFactor: loginTwoFactorMock,
            register: vi.fn(),
            verifyEmail: vi.fn(),
            resendCode: vi.fn(),
            requestPasswordReset: vi.fn(),
            resetPassword: vi.fn(),
        });

        renderWithRouter(<Login />);

        await user.type(
            await screen.findByPlaceholderText('请输入用户名或注册邮箱'),
            'admin'
        );
        await user.type(screen.getByPlaceholderText('请输入密码'), 'AdminPass123!');
        await user.click(screen.getByRole('button', { name: '登录' }));

        await waitFor(() => {
            expect(screen.getByText('二步身份验证')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('输入 6 位验证码')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '使用备用码登录' })).toBeInTheDocument();
        });

        // Type 6-digit TOTP code
        await user.type(screen.getByPlaceholderText('输入 6 位验证码'), '123456');

        await waitFor(() => {
            expect(loginTwoFactorMock).toHaveBeenCalledWith('test-challenge-jwt', '123456', false);
        });
    });

    it('allows switching to backup code mode in 2FA and submitting', async () => {
        const user = userEvent.setup();
        const loginMock = vi.fn().mockResolvedValue({
            success: false,
            needTwoFactor: true,
            challengeToken: 'test-challenge-jwt',
        });
        const loginTwoFactorMock = vi.fn().mockResolvedValue({ success: true });

        (api.get as any).mockResolvedValue({
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
            loginTwoFactor: loginTwoFactorMock,
            register: vi.fn(),
            verifyEmail: vi.fn(),
            resendCode: vi.fn(),
            requestPasswordReset: vi.fn(),
            resetPassword: vi.fn(),
        });

        renderWithRouter(<Login />);

        await user.type(
            await screen.findByPlaceholderText('请输入用户名或注册邮箱'),
            'admin'
        );
        await user.type(screen.getByPlaceholderText('请输入密码'), 'AdminPass123!');
        await user.click(screen.getByRole('button', { name: '登录' }));

        await waitFor(() => {
            expect(screen.getByText('二步身份验证')).toBeInTheDocument();
        });

        // Switch to backup code
        await user.click(screen.getByRole('button', { name: '使用备用码登录' }));
        expect(screen.getByPlaceholderText('输入备用恢复码')).toBeInTheDocument();

        await user.type(screen.getByPlaceholderText('输入备用恢复码'), 'BK12-3456-7890');
        await user.click(screen.getByRole('button', { name: '验证并登录' }));

        await waitFor(() => {
            expect(loginTwoFactorMock).toHaveBeenCalledWith('test-challenge-jwt', 'BK12-3456-7890', true);
        });
    });
});
