import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { renderWithRouter } from '../../test/render';
import ClientModal from './ClientModal';

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

vi.mock('../../api/client', () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
    },
}));

vi.mock('../../utils/riskConfirm', () => ({
    attachBatchRiskToken: vi.fn((payload) => Promise.resolve(payload)),
}));

const servers = vi.hoisted(() => ({ list: [] as Array<{ id: string; panelType: string }> }));
vi.mock('../../contexts/ServerContext', () => ({
    useOptionalServer: () => ({ servers: servers.list }),
}));

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function renderBatchAdd(serverId = 's1') {
    return renderWithRouter(
        <ClientModal
            isOpen
            onClose={() => {}}
            targets={[{ serverId, serverName: 'Node A', id: 1, protocol: 'vless', remark: 'main', port: 443 }]}
            onSuccess={() => {}}
        />
    );
}

describe('ClientModal panel-specific client fields', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.localStorage.setItem('nms_locale', 'en-US');
        vi.clearAllMocks();
        servers.list = [{ id: 's1', panelType: '3x-ui' }, { id: 's2', panelType: 's-ui' }];
        mockedPost.mockResolvedValue({ data: { success: true, obj: { summary: { success: 1, total: 1, failed: 0 } } } });
    });

    it('sends group, calendar renewal and the own traffic reset cycle to 3x-ui nodes', async () => {
        const user = userEvent.setup();
        renderBatchAdd('s1');
        await screen.findByRole('heading', { name: /Batch add clients/i });

        await user.type(screen.getByLabelText('Group'), ' vip ');
        await user.click(screen.getByText('3x-ui v3 renewal and traffic cycle'));
        await user.selectOptions(screen.getByLabelText('Monthly renewal day'), '15');
        await user.clear(screen.getByLabelText('Max auto-renewals (0 = unlimited)'));
        await user.type(screen.getByLabelText('Max auto-renewals (0 = unlimited)'), '3');
        await user.selectOptions(screen.getByLabelText('Own traffic reset cycle'), 'monthly');
        await user.selectOptions(screen.getByLabelText('Monthly reset day'), '10');
        await user.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/batch/clients', expect.anything()));
        const payload = mockedPost.mock.calls.find(([url]) => url === '/batch/clients')[1];
        expect(payload.client).toMatchObject({
            group: 'vip',
            resetDay: 15,
            resetMax: 3,
            trafficReset: 'monthly',
            trafficResetDay: 10,
        });
        // Untouched fields stay out so older panels get the same payload as before.
        expect(payload.client).not.toHaveProperty('resetWeekday');
        expect(payload.targets[0].client.resetDay).toBe(15);
    });

    it('blocks weekly renewal combined with a monthly renewal day', async () => {
        const user = userEvent.setup();
        renderBatchAdd('s1');
        await screen.findByRole('heading', { name: /Batch add clients/i });

        await user.click(screen.getByText('3x-ui v3 renewal and traffic cycle'));
        await user.selectOptions(screen.getByLabelText('Monthly renewal day'), '15');
        await user.selectOptions(screen.getByLabelText('Weekly renewal day'), '1');

        expect(screen.getByLabelText('Weekly renewal day')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent(/Weekly renewal cannot be combined/);

        await user.click(screen.getByRole('button', { name: /^Save$/i }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Weekly renewal cannot be combined/)));
        expect(mockedPost).not.toHaveBeenCalledWith('/batch/clients', expect.anything());
    });

    it('hides fields s-ui does not have and leaves 3x-ui-only fields out of the payload', async () => {
        const user = userEvent.setup();
        renderBatchAdd('s2');
        await screen.findByRole('heading', { name: /Batch add clients/i });

        expect(screen.queryByText('3x-ui v3 renewal and traffic cycle')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('IP limit (0 = Unlimited)')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Telegram ID')).not.toBeInTheDocument();
        expect(screen.getByText(/s-ui has no IP limit or Telegram alerts/)).toBeInTheDocument();

        await user.type(screen.getByLabelText('Group'), 'team-a');
        await user.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/batch/clients', expect.anything()));
        const payload = mockedPost.mock.calls.find(([url]) => url === '/batch/clients')[1];
        expect(payload.client.group).toBe('team-a');
        for (const key of ['resetDay', 'resetWeekday', 'resetMax', 'trafficReset', 'trafficResetDay']) {
            expect(payload.client).not.toHaveProperty(key);
        }
    });
});
