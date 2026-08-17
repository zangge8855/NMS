import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render';
import AccountCenter from './AccountCenter';
import api from '../../api/client';

vi.mock('../../api/client', () => ({
    default: {
        post: vi.fn(),
        put: vi.fn(),
    },
}));

const patchUserMock = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
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

vi.mock('../Layout/Header', () => ({
    default: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1>,
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
        (api.post as any).mockReset();
        (api.put as any).mockReset();
    });

    it('requires sending a code to the current email before saving profile changes', async () => {
        const user = userEvent.setup();
        (api.post as any).mockResolvedValue({
            data: {
                obj: {
                    email: 'alice@example.com',
                },
            },
        });
        (api.put as any).mockResolvedValue({
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
        expect(screen.getByText('账户信息')).toBeInTheDocument();
        expect(screen.getByText('登录密码')).toBeInTheDocument();
        expect(screen.getByText('修改用户名或登录邮箱前，必须先通过当前旧邮箱验证码确认。')).toBeInTheDocument();
        expect(screen.getByText('密码至少 8 位，且至少包含大写字母、小写字母、数字、特殊字符中的 3 类')).toBeInTheDocument();

        const usernameInput = screen.getByLabelText('用户名');
        const emailInput = screen.getByLabelText('登录邮箱');
        expect(usernameInput).toHaveValue('alice');
        expect(emailInput).toHaveValue('alice@example.com');

        fireEvent.change(usernameInput, { target: { value: 'alice-next' } });
        fireEvent.change(emailInput, { target: { value: 'alice.next@example.com' } });
        await user.click(screen.getByRole('button', { name: '发送验证码' }));
        fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '123456' } });
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
