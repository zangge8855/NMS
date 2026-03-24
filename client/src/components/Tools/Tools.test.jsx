import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithRouter } from '../../test/render.jsx';
import Tools from './Tools.jsx';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { LanguageProvider } from '../../contexts/LanguageContext.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

function renderTools() {
    return render(
        <MemoryRouter
            future={{
                v7_relativeSplatPath: true,
                v7_startTransition: true,
            }}
            initialEntries={['/']}
        >
            <LanguageProvider>
                <Tools />
            </LanguageProvider>
        </MemoryRouter>
    );
}

describe('Tools', () => {
    beforeEach(() => {
        api.get.mockReset();
        useServer.mockReset();
        window.sessionStorage.clear();
    });

    it('treats global view as no selected node and skips loading node tools', () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
        });

        renderWithRouter(<Tools />);

        expect(screen.getByRole('heading', { name: '节点工具' })).toBeInTheDocument();
        expect(screen.getByText('请先选择一台服务器')).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });

    it('loads supported tools for a node and can invoke a tool action', async () => {
        const panelApi = vi.fn().mockResolvedValue({
            data: {
                obj: { message: 'ok' },
            },
        });
        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
        });
        api.get.mockResolvedValue({
            data: {
                obj: {
                    tools: {
                        diag: {
                            key: 'diag',
                            label: '诊断工具',
                            description: '执行节点诊断',
                            uiAction: 'node_tools',
                            supportedByNms: true,
                            available: true,
                            path: '/panel/api/tools/diag',
                            method: 'get',
                        },
                    },
                },
            },
        });

        const user = userEvent.setup();
        renderWithRouter(<Tools />);

        expect(await screen.findByText('可执行 1 / 1')).toBeInTheDocument();
        expect(screen.getByText('节点工具集')).toBeInTheDocument();
        expect(screen.getByText('执行当前节点暴露的辅助工具接口，并支持直接复制结果。')).toBeInTheDocument();
        expect(screen.getByText('诊断工具')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /生成/ }));

        expect(panelApi).toHaveBeenCalledWith('get', '/panel/api/tools/diag');
        expect(await screen.findByText(/message/)).toBeInTheDocument();
    });

    it('renders the cached tool catalog before the live request finishes', async () => {
        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi: vi.fn(),
        });
        window.sessionStorage.setItem('nms_session_snapshot:tools_view_v1:server-a', JSON.stringify({
            savedAt: Date.now(),
            value: {
                tools: [
                    {
                        key: 'diag',
                        label: '诊断工具',
                        description: '执行节点诊断',
                        uiAction: 'node_tools',
                        supportedByNms: true,
                        available: true,
                        path: '/panel/api/tools/diag',
                        method: 'get',
                    },
                ],
                results: {},
            },
        }));
        api.get.mockImplementation(() => new Promise(() => {}));

        renderWithRouter(<Tools />);

        expect(await screen.findByText('可执行 1 / 1')).toBeInTheDocument();
        expect(screen.getByText('诊断工具')).toBeInTheDocument();
    });

    it('ignores stale tool catalogs after switching to another node', async () => {
        const serverState = {
            activeServerId: 'server-a',
            panelApi: vi.fn(),
        };
        let resolveServerA;

        useServer.mockImplementation(() => serverState);
        api.get.mockImplementation((url) => {
            if (url === '/capabilities/server-a') {
                return new Promise((resolve) => {
                    resolveServerA = resolve;
                });
            }
            if (url === '/capabilities/server-b') {
                return Promise.resolve({
                    data: {
                        obj: {
                            tools: {
                                trace: {
                                    key: 'trace',
                                    label: '链路追踪',
                                    description: '查看节点链路',
                                    uiAction: 'node_tools',
                                    supportedByNms: true,
                                    available: true,
                                    path: '/panel/api/tools/trace',
                                    method: 'get',
                                },
                            },
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        const view = renderTools();

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/capabilities/server-a');
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
                    <Tools />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(await screen.findByText('链路追踪')).toBeInTheDocument();
        expect(screen.getByText('可执行 1 / 1')).toBeInTheDocument();

        resolveServerA({
            data: {
                obj: {
                    tools: {
                        diag: {
                            key: 'diag',
                            label: '诊断工具',
                            description: '执行节点诊断',
                            uiAction: 'node_tools',
                            supportedByNms: true,
                            available: true,
                            path: '/panel/api/tools/diag',
                            method: 'get',
                        },
                    },
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByText('链路追踪')).toBeInTheDocument();
            expect(screen.queryByText('诊断工具')).not.toBeInTheDocument();
        });
    });
});
