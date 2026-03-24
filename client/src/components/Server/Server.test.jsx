import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithRouter } from '../../test/render.jsx';
import ServerManagement from './Server.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { LanguageProvider } from '../../contexts/LanguageContext.jsx';

const { apiMock } = vi.hoisted(() => {
    const fn = vi.fn();
    fn.get = vi.fn();
    fn.post = vi.fn();
    return { apiMock: fn };
});

vi.mock('../../api/client.js', () => ({
    default: apiMock,
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

function renderServerManagement(ui = <ServerManagement />) {
    return render(
        <MemoryRouter
            future={{
                v7_relativeSplatPath: true,
                v7_startTransition: true,
            }}
            initialEntries={['/']}
        >
            <LanguageProvider>{ui}</LanguageProvider>
        </MemoryRouter>
    );
}

describe('ServerManagement', () => {
    beforeEach(() => {
        apiMock.mockReset();
        apiMock.get.mockReset();
        apiMock.post.mockReset();
        useServer.mockReset();
    });

    it('shows an empty state when no server is selected', () => {
        useServer.mockReturnValue({
            activeServerId: null,
            panelApi: vi.fn(),
            servers: [],
        });

        renderWithRouter(<ServerManagement />);

        expect(screen.getByRole('heading', { name: '节点控制台' })).toBeInTheDocument();
        expect(screen.getByText('请先选择一台服务器')).toBeInTheDocument();
    });

    it('shows the compact toolbar context in global view and probes versions from the first target', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        apiMock.mockImplementation(({ url, method }) => {
            if (method === 'get' && url === '/panel/server-a/panel/api/server/getXrayVersion') {
                return Promise.resolve({ data: { obj: ['1.8.0'] } });
            }
            throw new Error(`Unexpected ${method || 'request'} ${url}`);
        });

        renderWithRouter(<ServerManagement />);

        expect(await screen.findByText('批量控制模式')).toBeInTheDocument();
        expect(screen.getByText('节点控制工作台')).toBeInTheDocument();
        expect(screen.getByText('集中查看当前作用域，并执行 Xray、Geo、备份与节点工具相关操作。')).toBeInTheDocument();
        expect(screen.getByText('当前作用域')).toBeInTheDocument();
        expect(screen.getByText('1 台节点')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '1.8.0' })).toBeInTheDocument();
    });

    it('renders without the standalone header when embedded inside settings', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        apiMock.mockImplementation(({ url, method }) => {
            if (method === 'get' && url === '/panel/server-a/panel/api/server/getXrayVersion') {
                return Promise.resolve({ data: { obj: ['1.8.0'] } });
            }
            throw new Error(`Unexpected ${method || 'request'} ${url}`);
        });

        renderWithRouter(<ServerManagement embedded />);

        expect(await screen.findByText('批量控制模式')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: '节点控制台' })).not.toBeInTheDocument();
    });

    it('ignores stale Xray version results after switching to another node', async () => {
        const serverState = {
            activeServerId: 'server-a',
            panelApi: vi.fn(),
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        };
        let versionCallCount = 0;
        let resolveServerAVersions;

        useServer.mockImplementation(() => serverState);
        serverState.panelApi.mockImplementation((method, path) => {
            if (method === 'get' && path === '/panel/api/server/getXrayVersion') {
                versionCallCount += 1;
                if (versionCallCount === 1) {
                    return new Promise((resolve) => {
                        resolveServerAVersions = resolve;
                    });
                }
                return Promise.resolve({ data: { obj: ['1.9.0'] } });
            }
            throw new Error(`Unexpected panelApi ${method} ${path}`);
        });
        apiMock.get.mockResolvedValue({
            data: {
                obj: {
                    tools: {},
                    systemModules: [],
                },
            },
        });

        const view = renderServerManagement();

        await waitFor(() => {
            expect(serverState.panelApi).toHaveBeenCalledWith('get', '/panel/api/server/getXrayVersion', undefined, undefined);
        });

        serverState.activeServerId = 'server-b';
        view.rerender(
            <MemoryRouter
                future={{
                    v7_relativeSplatPath: true,
                    v7_startTransition: true,
                }}
                initialEntries={['/']}
            >
                <LanguageProvider>
                    <ServerManagement />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(await screen.findByRole('option', { name: '1.9.0' })).toBeInTheDocument();

        resolveServerAVersions({ data: { obj: ['1.8.0'] } });

        await waitFor(() => {
            expect(screen.getByRole('option', { name: '1.9.0' })).toBeInTheDocument();
            expect(screen.queryByRole('option', { name: '1.8.0' })).not.toBeInTheDocument();
        });
    });

    it('ignores stale node tool results after switching to another node', async () => {
        const user = userEvent.setup();
        const serverState = {
            activeServerId: 'server-a',
            panelApi: vi.fn(),
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        };
        let pendingToolResolve;

        useServer.mockImplementation(() => serverState);
        apiMock.get.mockResolvedValue({
            data: {
                obj: {
                    tools: {
                        diag: {
                            key: 'diag',
                            label: '诊断工具',
                            description: '执行节点诊断',
                            uiAction: 'node_console',
                            supportedByNms: true,
                            available: true,
                            path: '/panel/api/tools/diag',
                            method: 'get',
                        },
                    },
                    systemModules: [],
                },
            },
        });
        serverState.panelApi.mockImplementation((method, path) => {
            if (method === 'get' && path === '/panel/api/server/getXrayVersion') {
                return Promise.resolve({ data: { obj: ['1.9.0'] } });
            }
            if (method === 'get' && path === '/panel/api/tools/diag') {
                return new Promise((resolve) => {
                    pendingToolResolve = resolve;
                });
            }
            throw new Error(`Unexpected panelApi ${method} ${path}`);
        });

        const view = renderServerManagement();

        const toolTitle = await screen.findByText('诊断工具');
        const toolCard = toolTitle.closest('.server-console-tool-card');
        if (!toolCard) throw new Error('Missing tool card');
        await user.click(within(toolCard).getByRole('button', { name: '生成' }));

        serverState.activeServerId = 'server-b';
        view.rerender(
            <MemoryRouter
                future={{
                    v7_relativeSplatPath: true,
                    v7_startTransition: true,
                }}
                initialEntries={['/']}
            >
                <LanguageProvider>
                    <ServerManagement />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(await screen.findByText('诊断工具')).toBeInTheDocument();

        pendingToolResolve({
            data: {
                obj: { message: 'stale' },
            },
        });

        await waitFor(() => {
            expect(screen.queryByText(/stale/)).not.toBeInTheDocument();
        });
    });
});
