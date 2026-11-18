import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render';
import Dashboard from './Dashboard';
import { useServer } from '../../contexts/ServerContext';
import api from '../../api/client';
import toast from 'react-hot-toast';

const mockAuthState = vi.hoisted(() => ({
    token: 'jwt-token',
    user: { username: 'alice', role: 'admin' } as { username?: string; role?: string } | null,
}));

const mockWebSocketState = vi.hoisted(() => ({
    status: 'disconnected',
    lastMessage: null as any,
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        token: mockAuthState.token,
        user: mockAuthState.user,
    }),
}));

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../../hooks/useWebSocket', () => ({
    default: () => mockWebSocketState,
}));

vi.mock('react-hot-toast', () => ({
    default: Object.assign(vi.fn(), {
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock('../Layout/Header', () => ({
    default: ({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) => (
        <div>
            <h1>{title}</h1>
            {children}
        </div>
    ),
}));

vi.mock('./CpuHistoryChart', () => ({
    default: () => <div data-testid="cpu-history-chart" />,
}));

function buildGlobalSnapshotPayload() {
    return {
        serverStatuses: {
            'server-a': {
                serverId: 'server-a',
                name: 'Tokyo Edge',
                online: true,
                inboundCount: 2,
                activeInbounds: 2,
                managedOnlineCount: 3,
                managedTrafficTotal: 2048,
                managedTrafficReady: true,
                nodeRemarks: ['Tokyo Premium'],
                nodeRemarkPreview: ['Tokyo Premium'],
                nodeRemarkCount: 1,
                status: {
                    cpu: 24.5,
                    mem: { current: 512, total: 2048 },
                    uptime: 7200,
                    netTraffic: { sent: 1000, recv: 2000 },
                },
            },
        },
        globalStats: {
            totalUp: 1024,
            totalDown: 2048,
            totalOnline: 3,
            totalInbounds: 2,
            activeInbounds: 2,
            serverCount: 1,
            onlineServers: 1,
        },
        globalOnlineUsers: [
            {
                userId: 'user-1',
                username: 'bob',
                email: 'bob@example.com',
                displayName: 'Bob',
                label: 'bob@example.com',
                sessions: 2,
                clientCount: 1,
                enabled: true,
                servers: ['Tokyo Edge'],
                nodeLabels: ['Tokyo Premium'],
            },
        ],
        globalManagedOnlineCount: 3,
        globalOnlineSessionCount: 2,
        globalAccountSummary: {
            totalUsers: 5,
            pendingUsers: 1,
        },
        throughputSummary: {
            ready: true,
            upPerSecond: 256,
            downPerSecond: 512,
            totalPerSecond: 768,
        },
        trafficWindowTotals: {
            day: { totalUp: 100, totalDown: 200, ready: true, attributionComplete: true, unattributedUp: 0, unattributedDown: 0, unattributedTotal: 0 },
            week: { totalUp: 400, totalDown: 800, ready: true, attributionComplete: true, unattributedUp: 0, unattributedDown: 0, unattributedTotal: 0 },
            month: { totalUp: 1000, totalDown: 2000, ready: true, attributionComplete: true, unattributedUp: 0, unattributedDown: 0, unattributedTotal: 0 },
        },
        globalPresenceReady: true,
    };
}

describe('Dashboard customization and snapshot export', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        mockAuthState.token = 'jwt-token';
        mockAuthState.user = { username: 'alice', role: 'admin' };
        mockWebSocketState.status = 'disconnected';
        mockWebSocketState.lastMessage = null;
        (api.get as any).mockReset();
        (api.post as any).mockReset().mockResolvedValue({ data: { obj: { ticket: 'ws-ticket' } } });
        (toast.success as any).mockReset();
        (toast.error as any).mockReset();

        (useServer as any).mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [{ id: 'server-a', name: 'Tokyo Edge' }],
            loading: false,
        });

        (api.get as any).mockImplementation((url: string) => {
            if (url === '/servers/dashboard/snapshot') {
                return Promise.resolve({ data: { obj: buildGlobalSnapshotPayload() } });
            }
            if (url === '/servers/server-a/dashboard/snapshot') {
                return Promise.resolve({
                    data: {
                        obj: {
                            status: { cpu: 15, mem: { current: 256, total: 1024 }, uptime: 3600 },
                            cpuHistory: [{ time: 0, cpu: 10 }, { time: 1, cpu: 15 }],
                            inbounds: [{ id: 'ib-1', protocol: 'vless', port: 443, enable: true, remark: 'Edge Link', up: 100, down: 200 }],
                            onlineUsers: [{ userId: 'u1', displayName: 'Bob', email: 'bob@example.com', sessions: 1 }],
                            onlineCount: 1,
                            onlineSessionCount: 1,
                            singleServerTrafficTotals: { totalUp: 100, totalDown: 200 },
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });
    });

    it('toggles dashboard section visibility, persists per user in localStorage, and resets defaults', async () => {
        const user = userEvent.setup();
        const firstRender = renderWithRouter(<Dashboard />, { route: '/' });

        expect(await screen.findByText('Tokyo Edge')).toBeInTheDocument();
        expect(screen.getByText('系统趋势')).toBeInTheDocument();
        expect(screen.getByText('今日用户流量')).toBeInTheDocument();

        // Expand online detail so we can verify onlineSessions visibility toggle too
        const onlineKpi = screen.getByText('在线用户', { selector: '.dashboard-hero-kpi-label' }).closest('button');
        expect(onlineKpi).not.toBeNull();
        await user.click(onlineKpi!);
        expect(await screen.findByText('在线用户明细')).toBeInTheDocument();

        const customizeBtn = screen.getByRole('button', { name: '定制仪表盘卡片' });
        expect(customizeBtn).toHaveAttribute('aria-expanded', 'false');
        await user.click(customizeBtn);
        expect(customizeBtn).toHaveAttribute('aria-expanded', 'true');

        const trafficCheckbox = screen.getByRole('checkbox', { name: '流量周期统计' });
        const trendsCheckbox = screen.getByRole('checkbox', { name: '系统资源趋势' });
        const onlineCheckbox = screen.getByRole('checkbox', { name: '在线会话明细' });

        await user.click(trafficCheckbox);
        await user.click(trendsCheckbox);
        await user.click(onlineCheckbox);

        expect(screen.queryByText('今日用户流量')).not.toBeInTheDocument();
        expect(screen.queryByText('系统趋势')).not.toBeInTheDocument();
        expect(screen.queryByText('在线用户明细')).not.toBeInTheDocument();
        expect(screen.getByText('Tokyo Edge')).toBeInTheDocument();

        const stored = JSON.parse(localStorage.getItem('nms_dashboard_sections_v1:alice') || '{}');
        expect(stored).toEqual({
            kpis: true,
            trafficWindows: false,
            systemTrends: false,
            nodeHealth: true,
            onlineSessions: false,
        });

        // Re-mounting under the same user preserves customization
        firstRender.unmount();
        renderWithRouter(<Dashboard />, { route: '/' });
        await waitFor(() => {
            expect(screen.getByText('Tokyo Edge')).toBeInTheDocument();
        });
        expect(screen.queryByText('今日用户流量')).not.toBeInTheDocument();
        expect(screen.queryByText('系统趋势')).not.toBeInTheDocument();

        // Hide remaining sections -> shows all-hidden empty state with reset action
        await user.click(screen.getByRole('button', { name: '定制仪表盘卡片' }));
        await user.click(screen.getByRole('checkbox', { name: '核心指标 KPI' }));
        await user.click(screen.getByRole('checkbox', { name: '节点健康状态' }));

        expect(screen.getByText('当前已隐藏所有仪表盘区块')).toBeInTheDocument();
        expect(screen.queryByText('Tokyo Edge')).not.toBeInTheDocument();

        // Reset default via customize panel restores everything
        const customizePanel = screen.getByRole('region', { name: '视图定制' });
        await user.click(within(customizePanel).getByRole('button', { name: '恢复默认' }));

        expect(screen.getByText('今日用户流量')).toBeInTheDocument();
        expect(screen.getByText('系统趋势')).toBeInTheDocument();
        expect(screen.getByText('Tokyo Edge')).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('nms_dashboard_sections_v1:alice') || '{}')).toEqual({
            kpis: true,
            trafficWindows: true,
            systemTrends: true,
            nodeHealth: true,
            onlineSessions: true,
        });
        expect(screen.getByRole('checkbox', { name: '核心指标 KPI' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: '节点健康状态' })).toBeChecked();
    });

    it('falls back to default storage namespace when username is missing and supports single-server section toggles', async () => {
        const user = userEvent.setup();
        mockAuthState.user = null;
        (useServer as any).mockReturnValue({
            activeServerId: 'server-a',
            panelApi: vi.fn(),
            activeServer: { id: 'server-a', name: 'Tokyo Edge' },
            servers: [{ id: 'server-a', name: 'Tokyo Edge' }],
            loading: false,
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        expect(await screen.findByText('Edge Link')).toBeInTheDocument();
        expect(screen.getByText('CPU 使用率趋势')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '定制仪表盘卡片' }));
        await user.click(screen.getByRole('checkbox', { name: '系统资源趋势' }));

        expect(screen.queryByText('CPU 使用率趋势')).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('nms_dashboard_sections_v1:default') || '{}')).toMatchObject({
            systemTrends: false,
        });

        await user.click(screen.getByRole('button', { name: '完成仪表盘视图定制' }));
        expect(screen.queryByRole('region', { name: '视图定制' })).not.toBeInTheDocument();
    });

    it('exports a UTF-8 BOM CSV snapshot of cluster KPIs, traffic windows, and node health', async () => {
        localStorage.setItem('nms_locale', 'en-US');
        const user = userEvent.setup();
        let capturedBlob: Blob | null = null;
        const originalCreateObjectURL = window.URL.createObjectURL;
        const originalRevokeObjectURL = window.URL.revokeObjectURL;
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        window.URL.createObjectURL = vi.fn((blob: Blob) => {
            capturedBlob = blob;
            return 'blob:dashboard-snapshot';
        });
        window.URL.revokeObjectURL = vi.fn();

        try {
            renderWithRouter(<Dashboard />, { route: '/' });

            expect(await screen.findByText('Tokyo Edge')).toBeInTheDocument();

            const exportBtn = screen.getByRole('button', { name: 'Export dashboard snapshot CSV' });
            await user.click(exportBtn);

            expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
            expect(clickSpy).toHaveBeenCalledTimes(1);
            expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:dashboard-snapshot');
            expect(toast.success).toHaveBeenCalledWith('Dashboard snapshot exported as CSV');

            expect(capturedBlob).not.toBeNull();
            const rawText = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error);
                reader.readAsText(capturedBlob!, 'utf-8');
            });

            // Note: FileReader.readAsText strips or preserves BOM depending on decoder; verify blob bytes directly too
            const bytes = await new Promise<Uint8Array>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(capturedBlob!);
            });
            expect(bytes[0]).toBe(0xEF);
            expect(bytes[1]).toBe(0xBB);
            expect(bytes[2]).toBe(0xBF);

            expect(rawText).toContain('Cluster KPIs');
            expect(rawText).toContain('Traffic Windows');
            expect(rawText).toContain('Node Health & Throughput');
            expect(rawText).toContain('Tokyo Edge');
            expect(rawText).toContain('CPU 24.5%');
            expect(rawText).toContain('Online 3');
        } finally {
            window.URL.createObjectURL = originalCreateObjectURL;
            window.URL.revokeObjectURL = originalRevokeObjectURL;
            clickSpy.mockRestore();
        }
    });
});
