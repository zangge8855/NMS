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
    const { activeServerId, servers, selectServer } = useServer();
    return (
        <div>
            <div data-testid="active-server">{activeServerId || 'none'}</div>
            <div data-testid="server-count">{servers.length}</div>
            <button type="button" onClick={() => selectServer('server-b')}>select-b</button>
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

    it('preserves a persisted concrete node selection when that node still exists', async () => {
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

    it('lets the caller switch between concrete node scopes', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:server_context_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                servers: [
                    { id: 'server-a', name: 'Node A' },
                    { id: 'server-b', name: 'Node B' },
                ],
                activeServerId: 'server-a',
            },
        }));

        render(
            <ServerProvider>
                <ServerContextConsumer />
            </ServerProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('active-server')).toHaveTextContent('server-a');
        });

        act(() => {
            screen.getByRole('button', { name: 'select-b' }).click();
        });

        expect(screen.getByTestId('active-server')).toHaveTextContent('server-b');
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

    it('does not fetch admin server data when disabled', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:server_context_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                servers: [{ id: 'server-a', name: 'Node A' }],
                activeServerId: 'global',
            },
        }));

        render(
            <ServerProvider enabled={false}>
                <ServerContextConsumer />
            </ServerProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('active-server')).toHaveTextContent('none');
            expect(screen.getByTestId('server-count')).toHaveTextContent('0');
        });
        expect(api.get).not.toHaveBeenCalled();
    });
});
