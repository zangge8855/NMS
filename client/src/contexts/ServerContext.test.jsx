import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import api from '../api/client.js';
import { ServerProvider, useServer } from './ServerContext.jsx';
import { writeSessionSnapshot } from '../utils/sessionSnapshot.js';

vi.mock('../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

function ServerContextConsumer() {
    const { activeServerId, servers } = useServer();
    return (
        <div>
            <div data-testid="active-server">{activeServerId || 'none'}</div>
            <div data-testid="server-count">{servers.length}</div>
        </div>
    );
}

describe('ServerContext', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        api.get.mockReset();
        api.post.mockReset();
        api.put.mockReset();
        api.delete.mockReset();
    });

    it('keeps the persisted server selection when the bootstrap snapshot defaults to global', async () => {
        window.localStorage.setItem('nms_active_server', 'server-a');
        api.get.mockReturnValue(new Promise(() => {}));

        render(
            <ServerProvider>
                <ServerContextConsumer />
            </ServerProvider>
        );

        act(() => {
            writeSessionSnapshot('server_context_bootstrap_v1', {
                servers: [
                    { id: 'server-a', name: 'Node A' },
                    { id: 'server-b', name: 'Node B' },
                ],
                activeServerId: 'global',
                issuedAt: '2000-01-01T00:00:00.000Z',
            }, { source: 'app-bootstrap' });
        });

        await waitFor(() => {
            expect(screen.getByTestId('active-server')).toHaveTextContent('server-a');
            expect(screen.getByTestId('server-count')).toHaveTextContent('2');
        });
    });

    it('reuses a fresh bootstrap snapshot without immediately refetching the server list', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:server_context_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                servers: [
                    { id: 'server-a', name: 'Node A' },
                    { id: 'server-b', name: 'Node B' },
                ],
                activeServerId: 'global',
            },
        }));

        render(
            <ServerProvider>
                <ServerContextConsumer />
            </ServerProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('active-server')).toHaveTextContent('global');
            expect(screen.getByTestId('server-count')).toHaveTextContent('2');
        });

        expect(api.get).not.toHaveBeenCalled();
    });
});
