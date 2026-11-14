import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithRouter } from '../../test/render';
import Tools from './Tools';
import api from '../../api/client';
import { useServer } from '../../contexts/ServerContext';
import { LanguageProvider } from '../../contexts/LanguageContext';

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: vi.fn(),
}));

vi.mock('../Layout/Header', () => ({
    default: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1>,
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
        (api.get as any).mockReset();
        (api.post as any).mockReset();
        (api.delete as any).mockReset();
        (useServer as any).mockReset();
        window.sessionStorage.clear();
    });

    it('treats global view as no selected node and skips loading node tools', () => {
        (useServer as any).mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
        });

        renderWithRouter(<Tools />);

        expect(screen.getByRole('heading', { name: '节点工具' })).toBeInTheDocument();
        expect(screen.getByText('请先选择一台服务器')).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });

    it('can open a node tool catalog from global view by choosing a server', async () => {
        const user = userEvent.setup();
        (useServer as any).mockReturnValue({
            activeServerId: 'global',
            servers: [{ id: 'server-a', name: '节点 A' }],
            panelApi: vi.fn(),
        });
        (api.get as any).mockResolvedValue({
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

        renderWithRouter(<Tools />);

        const openButton = screen.getByRole('button', { name: '打开节点' });
        await waitFor(() => expect(openButton).not.toBeDisabled());
        await user.click(openButton);

        expect(await screen.findByText('诊断工具')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('/capabilities/server-a');
    });

    it('loads supported tools for a node and can invoke a tool action', async () => {
        const panelApi = vi.fn().mockResolvedValue({
            data: {
                obj: { message: 'ok' },
            },
        });
        (useServer as any).mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
        });
        (api.get as any).mockResolvedValue({
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

    it('keeps unprobed console actions such as core restarts off the tool list', async () => {
        (useServer as any).mockReturnValue({
            activeServerId: 'server-a',
            panelApi: vi.fn(),
        });
        const baseTool = { uiAction: 'node_console', supportedByNms: true, method: 'get' };
        (api.get as any).mockResolvedValue({
            data: {
                obj: {
                    tools: {
                        uuid: { ...baseTool, key: 'uuid', label: 'UUID', available: true, source: 'probed', path: '/panel/api/server/getNewUUID' },
                        xrayRestart: { ...baseTool, key: 'xrayRestart', label: 'Restart Xray Service', available: null, source: 'unprobed', method: 'post', path: '/panel/api/server/restartXray' },
                        xrayInstall: { ...baseTool, key: 'xrayInstall', label: 'Install Xray Core', available: null, path: '/panel/api/server/installXray/:version' },
                    },
                },
            },
        });

        renderWithRouter(<Tools />);

        expect(await screen.findByText('可执行 1 / 1')).toBeInTheDocument();
        expect(screen.getByText('UUID')).toBeInTheDocument();
        expect(screen.queryByText('Restart Xray Service')).not.toBeInTheDocument();
        expect(screen.queryByText('Install Xray Core')).not.toBeInTheDocument();
    });

    it('renders the cached tool catalog before the live request finishes', async () => {
        (useServer as any).mockReturnValue({
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
        (api.get as any).mockImplementation(() => new Promise(() => {}));

        renderWithRouter(<Tools />);

        expect(await screen.findByText('可执行 1 / 1')).toBeInTheDocument();
        expect(screen.getByText('诊断工具')).toBeInTheDocument();
    });

    it('ignores stale tool catalogs after switching to another node', async () => {
        const serverState = {
            activeServerId: 'server-a',
            panelApi: vi.fn(),
        };
        let resolveServerA: any;

        (useServer as any).mockImplementation(() => serverState);
        (api.get as any).mockImplementation((url: string) => {
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

    it('loads managed certificates on SSL tab and can issue, dispatch, and delete a certificate', async () => {
        const user = userEvent.setup();
        (useServer as any).mockReturnValue({
            activeServerId: 'global',
            servers: [{ id: 'srv-1', name: '边缘节点 1' }],
            panelApi: vi.fn(),
        });

        const certList = [
            {
                id: 'cert-1',
                domain: 'edge.example.com',
                sans: ['2001:db8::1'],
                provider: 'selfsigned',
                challengeType: 'manual',
                status: 'valid',
                expiresAt: '2026-12-31T00:00:00.000Z',
                certificate: '-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----',
                hasPrivateKey: true,
                assignedServerIds: ['srv-1'],
            },
        ];

        (api.get as any).mockImplementation((url: string) => {
            if (url === '/certificates') {
                return Promise.resolve({ data: { success: true, obj: certList } });
            }
            return Promise.resolve({ data: { success: true, obj: {} } });
        });
        (api.post as any).mockImplementation((url: string) => {
            if (url === '/certificates') {
                return Promise.resolve({ data: { success: true, obj: certList[0] } });
            }
            if (url === '/certificates/cert-1/dispatch') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: { dispatchedServers: ['边缘节点 1'], failedServers: [], updatedInboundCount: 1 },
                    },
                });
            }
            return Promise.resolve({ data: { success: true, obj: {} } });
        });
        (api.delete as any).mockResolvedValue({ data: { success: true } });

        renderWithRouter(<Tools />);

        await user.click(screen.getByRole('button', { name: /SSL & ACME/i }));

        expect(await screen.findByText('edge.example.com')).toBeInTheDocument();
        expect(screen.getByText(/2001:db8::1/)).toBeInTheDocument();

        const domainInput = screen.getByPlaceholderText('例如 node.example.com 或 *.example.com');
        const sansInput = screen.getByPlaceholderText('例如 *.example.com, 2001:db8::1');
        await user.type(domainInput, 'new.example.com');
        await user.type(sansInput, '2001:db8::2');

        await user.click(screen.getByRole('button', { name: /签发托管证书/ }));
        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith(
                '/certificates',
                expect.objectContaining({
                    domain: 'new.example.com',
                    sans: ['2001:db8::2'],
                })
            );
        });

        await user.click(screen.getByRole('button', { name: /下发至节点/ }));
        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/certificates/cert-1/dispatch', {
                serverIds: ['srv-1'],
            });
        });

        await user.click(screen.getByRole('button', { name: /删除/ }));
        expect(api.delete).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: '取消' }));
        expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /删除/ }));
        await user.click(screen.getByRole('button', { name: '确认删除' }));
        await waitFor(() => {
            expect(api.delete).toHaveBeenCalledWith('/certificates/cert-1');
            expect(screen.queryByText('edge.example.com')).not.toBeInTheDocument();
        });
    });

    it('normalizes bracketed IPv6 and falls back to backend /audit/ip-lookup in IP diagnostics tab', async () => {
        const user = userEvent.setup();
        (useServer as any).mockReturnValue({
            activeServerId: 'global',
            servers: [],
            panelApi: vi.fn(),
        });

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
        (api.post as any).mockResolvedValue({
            data: {
                success: true,
                obj: {
                    ip: '::1',
                    ipLocation: '内网/本地',
                    ipCarrier: '',
                },
            },
        });

        try {
            renderWithRouter(<Tools />);

            await user.click(screen.getByRole('button', { name: /IP 归属地与网络诊断/ }));
            const ipInput = screen.getByPlaceholderText(/输入 IP 地址或主机名/);
            fireEvent.change(ipInput, { target: { value: '[::1]:443' } });
            await user.click(screen.getByRole('button', { name: /诊断查询/ }));

            await waitFor(() => {
                expect(api.post).toHaveBeenCalledWith('/audit/ip-lookup', { ip: '::1' });
                expect(screen.getByText('::1')).toBeInTheDocument();
                expect(screen.getByText('内网/本地')).toBeInTheDocument();
            });
        } finally {
            fetchSpy.mockRestore();
        }
    });
});
