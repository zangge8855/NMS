import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../test/render.jsx';
import UserPolicyModal from './UserPolicyModal.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

import api from '../../api/client.js';

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
        expect(screen.getByText('可访问服务器')).toBeInTheDocument();
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
});
