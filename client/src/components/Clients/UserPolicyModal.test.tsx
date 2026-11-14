import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../test/render';
import UserPolicyModal from './UserPolicyModal';

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

import api from '../../api/client';

describe('UserPolicyModal', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.clearAllMocks();
        api.get.mockResolvedValue({
            data: {
                obj: {
                    serverScopeMode: 'all',
                    protocolScopeMode: 'all',
                    allowedServerIds: [],
                    allowedProtocols: [],
                    limitIp: 0,
                    trafficLimitBytes: 0,
                    speedLimitUp: 0,
                    speedLimitDown: 0,
                },
            },
        });
    });

    it('renders Chinese copy by default', async () => {
        renderWithRouter(
            <UserPolicyModal
                isOpen
                email="user@example.com"
                servers={[{ id: 's1', name: 'Node A' }]}
                onClose={() => {}}
            />
        );

        expect(await screen.findByRole('heading', { name: '订阅权限策略' })).toBeInTheDocument();
        expect(await screen.findByText('可访问服务器')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /保存策略/ })).toBeInTheDocument();
    });

    it('renders English copy when locale is en-US', async () => {
        window.localStorage.setItem('nms_locale', 'en-US');

        renderWithRouter(
            <UserPolicyModal
                isOpen
                email="user@example.com"
                servers={[{ id: 's1', name: 'Node A' }]}
                onClose={() => {}}
            />
        );

        expect(await screen.findByRole('heading', { name: 'Subscription policy' })).toBeInTheDocument();
        expect(screen.getByText('Allowed servers')).toBeInTheDocument();
        expect(screen.getByText('Allowed protocols')).toBeInTheDocument();
        expect(screen.getByText('Unified quotas')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Save policy/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
        expect(screen.queryByText('订阅权限策略')).not.toBeInTheDocument();
        expect(screen.queryByText('可访问服务器')).not.toBeInTheDocument();

        await waitFor(() => {
            expect(api.get).toHaveBeenCalled();
        });
    });

    it('keeps save disabled on load failure, allows retry, and preserves edits across server list refreshes', async () => {
        const user = userEvent.setup();
        window.localStorage.setItem('nms_locale', 'en-US');
        api.get
            .mockRejectedValueOnce(new Error('Policy network error'))
            .mockResolvedValueOnce({
                data: {
                    obj: {
                        serverScopeMode: 'all',
                        protocolScopeMode: 'all',
                        allowedServerIds: [],
                        allowedProtocols: [],
                        limitIp: 2,
                        trafficLimitBytes: 0,
                        speedLimitUp: 0,
                        speedLimitDown: 0,
                    },
                },
            });

        const serversA = [{ id: 's1', name: 'Node A' }];
        const serversB = [{ id: 's1', name: 'Node A' }, { id: 's2', name: 'Node B' }];
        function PolicyTestHarness() {
            const [servers, setServers] = React.useState(serversA);
            return (
                <>
                    <button type="button" onClick={() => setServers(serversB)}>refresh-servers</button>
                    <UserPolicyModal
                        isOpen
                        email="user@example.com"
                        servers={servers}
                        onClose={() => {}}
                    />
                </>
            );
        }

        renderWithRouter(<PolicyTestHarness />);

        expect(await screen.findByText('Policy network error')).toBeInTheDocument();
        const saveBtn = screen.getByRole('button', { name: /Save policy/i });
        expect(saveBtn).toBeDisabled();

        await user.click(screen.getByRole('button', { name: /Retry/i }));
        expect(await screen.findByText('Allowed servers')).toBeInTheDocument();
        expect(saveBtn).not.toBeDisabled();

        const [ipInput] = screen.getAllByRole('spinbutton');
        await user.clear(ipInput);
        await user.type(ipInput, '9');
        expect(ipInput).toHaveValue(9);

        await user.click(screen.getByRole('button', { name: 'refresh-servers' }));

        expect(ipInput).toHaveValue(9);
        expect(screen.getByText('Node B')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledTimes(2);
    });
});
