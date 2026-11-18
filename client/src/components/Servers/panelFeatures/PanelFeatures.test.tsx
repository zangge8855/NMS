import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../../api/client';
import { renderWithRouter } from '../../../test/render';
import ClientDirectoryPanel from './ClientDirectoryPanel';
import ClientHwidSection from './ClientHwidSection';
import OutboundSubsPanel from './OutboundSubsPanel';
import PanelFeatures from './PanelFeatures';
import PanelNodesPanel from './PanelNodesPanel';
import SubBalancersPanel from './SubBalancersPanel';

const auth = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../../contexts/AuthContext', () => ({
    useOptionalAuth: () => ({ user: { role: auth.role } }),
}));

vi.mock('../../../contexts/ConfirmContext', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

const mockedApi = api as unknown as Record<'get' | 'post' | 'delete', ReturnType<typeof vi.fn>>;
const ok = (obj: unknown) => ({ data: { success: true, obj } });
const INBOUNDS = [
    { id: 1, remark: 'hk-reality', protocol: 'vless', port: 443, tag: 'inbound-443' },
    { id: 2, remark: 'jp-ws', protocol: 'vmess', port: 8443, tag: 'inbound-8443' },
];

describe('PanelFeatures workspace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.role = 'admin';
        mockedApi.get.mockResolvedValue(ok([]));
    });

    it('shows every section to admins', async () => {
        renderWithRouter(<PanelFeatures serverId="s1" inbounds={INBOUNDS} />);
        const nav = screen.getByRole('navigation', { name: '面板功能分区' });
        expect(within(nav).getAllByRole('button').map((item) => item.textContent)).toEqual([
            '客户端分组', '客户端目录', '订阅主机', '订阅均衡器', '出站订阅', '面板节点',
        ]);
        await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/panel/s1/panel/api/clients/groups'));
    });

    it('hides outbound subscriptions and nodes from auditors, even when linked directly', async () => {
        auth.role = 'auditor';
        renderWithRouter(<PanelFeatures serverId="s1" inbounds={INBOUNDS} />, { route: '/?section=nodes' });
        const nav = screen.getByRole('navigation', { name: '面板功能分区' });
        expect(within(nav).getAllByRole('button').map((item) => item.textContent)).toEqual([
            '客户端分组', '客户端目录', '订阅主机', '订阅均衡器',
        ]);
        expect(within(nav).getByRole('button', { name: '客户端分组' })).toHaveAttribute('aria-current', 'page');
        await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/panel/s1/panel/api/clients/groups'));
        expect(mockedApi.get).not.toHaveBeenCalledWith('/panel/s1/panel/api/nodes/list');
    });

    it('lets auditors open the client directory section', async () => {
        auth.role = 'auditor';
        mockedApi.get.mockResolvedValue(ok({ items: [], total: 0, page: 1, pageSize: 20 }));
        renderWithRouter(<PanelFeatures serverId="s1" inbounds={INBOUNDS} />, { route: '/?section=clients' });
        const nav = screen.getByRole('navigation', { name: '面板功能分区' });
        expect(within(nav).getByRole('button', { name: '客户端目录' })).toHaveAttribute('aria-current', 'page');
        await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/panel/s1/panel/api/clients/list/paged?page=1&pageSize=20'));
    });

    it('lets operators open outbound subscriptions but not nodes', () => {
        auth.role = 'operator';
        renderWithRouter(<PanelFeatures serverId="s1" inbounds={INBOUNDS} />, { route: '/?section=outboundSubs' });
        const nav = screen.getByRole('navigation', { name: '面板功能分区' });
        expect(within(nav).queryByRole('button', { name: '面板节点' })).not.toBeInTheDocument();
        expect(within(nav).getByRole('button', { name: '出站订阅' })).toHaveAttribute('aria-current', 'page');
    });

    it('explains when the panel is too old for a section', async () => {
        mockedApi.get.mockRejectedValue({ response: { status: 404 } });
        renderWithRouter(<PanelFeatures serverId="s1" inbounds={INBOUNDS} />, { route: '/?section=hosts' });
        expect(await screen.findByText('这台面板不支持此功能')).toBeInTheDocument();
    });
});

describe('SubBalancersPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.role = 'admin';
    });

    it('draws leastLoad members as weight bars', async () => {
        mockedApi.get.mockResolvedValue(ok([
            { id: 9, remark: 'auto', strategy: 'leastLoad', inboundIds: [1, 2], memberWeights: { 2: 2 }, sortOrder: 3, enabled: true },
        ]));
        renderWithRouter(<SubBalancersPanel serverId="s1" canManage inbounds={INBOUNDS} />);
        expect(await screen.findByText('auto')).toBeInTheDocument();
        expect(screen.getByText('最小负载')).toBeInTheDocument();
        expect(screen.getByText('第 3 位')).toBeInTheDocument();
        expect(screen.getByText('权重 1')).toBeInTheDocument();
        expect(screen.getByText('权重 2')).toBeInTheDocument();
    });

    it('creates a weighted balancer with repeated inbound ids', async () => {
        const user = userEvent.setup();
        mockedApi.get.mockResolvedValue(ok([]));
        mockedApi.post.mockResolvedValue(ok(null));
        renderWithRouter(<SubBalancersPanel serverId="s1" canManage inbounds={INBOUNDS} />);
        await screen.findByText('还没有均衡器');

        await user.click(screen.getAllByRole('button', { name: '添加均衡器' })[0]);
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('备注'), 'auto');
        await user.selectOptions(within(dialog).getByLabelText('策略'), 'leastLoad');
        await user.click(within(dialog).getByLabelText(/hk-reality/));
        await user.click(within(dialog).getByLabelText(/jp-ws/));
        await user.type(within(dialog).getByLabelText('jp-ws 的权重'), '2');
        await user.click(within(dialog).getByRole('button', { name: '添加均衡器' }));

        await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
        const [url, body, config] = mockedApi.post.mock.calls[0];
        expect(url).toBe('/panel/s1/panel/api/sub-balancers');
        expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(body.getAll('inboundIds')).toEqual(['1', '2']);
        expect(body.get('strategy')).toBe('leastLoad');
        expect(JSON.parse(body.get('memberWeights'))).toEqual({ 2: 2 });
    });

    it('refuses to save without members', async () => {
        const user = userEvent.setup();
        mockedApi.get.mockResolvedValue(ok([]));
        renderWithRouter(<SubBalancersPanel serverId="s1" canManage inbounds={INBOUNDS} />);
        await screen.findByText('还没有均衡器');
        await user.click(screen.getAllByRole('button', { name: '添加均衡器' })[0]);
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('备注'), 'auto');
        await user.click(within(dialog).getByRole('button', { name: '添加均衡器' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('请至少选择一个入站');
        expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it('is read-only for auditors', async () => {
        auth.role = 'auditor';
        mockedApi.get.mockResolvedValue(ok([{ id: 9, remark: 'auto', strategy: 'random', inboundIds: [1] }]));
        renderWithRouter(<SubBalancersPanel serverId="s1" canManage={false} inbounds={INBOUNDS} />);
        expect(await screen.findByText('auto')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '添加均衡器' })).not.toBeInTheDocument();
    });
});

describe('OutboundSubsPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.role = 'operator';
    });

    it('shows the source host instead of the tokenised link and refreshes on demand', async () => {
        const user = userEvent.setup();
        mockedApi.get.mockResolvedValue(ok([
            { id: 7, remark: '', url: 'https://sub.example.com/api?token=very-secret', tagPrefix: 'hk-', enabled: true, outboundCount: 12, lastUpdated: 1_760_000_000 },
        ]));
        mockedApi.post.mockResolvedValue(ok({ count: 12 }));
        renderWithRouter(<OutboundSubsPanel serverId="s1" canManage />);
        expect((await screen.findAllByText('sub.example.com')).length).toBeGreaterThan(0);
        expect(screen.queryByText(/very-secret/)).not.toBeInTheDocument();
        expect(screen.getByText('前缀 hk-')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '立即更新' }));
        await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith(
            '/panel/s1/panel/api/xray/outbound-subs/7/refresh',
            expect.any(URLSearchParams),
            expect.anything(),
        ));
    });
});

describe('PanelNodesPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.role = 'admin';
    });

    it('shows latency only for reachable nodes and errors only for enabled ones', async () => {
        mockedApi.get.mockResolvedValue(ok([
            { id: 1, name: 'fra-1', address: 'fra.example.com', port: 2053, enable: true, status: 'online', latencyMs: 38, cpuPct: 20, memPct: 40, clientCount: 10, onlineCount: 3, inboundCount: 2 },
            { id: 2, name: 'sg-1', address: '198.51.100.40', port: 54321, enable: true, status: 'offline', lastError: 'connection refused', latencyMs: 0 },
            { id: 3, name: 'us-2', address: '10.0.0.2', port: 2053, enable: false, status: 'offline', lastError: 'stale error' },
        ]));
        renderWithRouter(<PanelNodesPanel serverId="s1" />);
        const rows = await screen.findAllByRole('listitem');
        expect(within(rows[0]).getByText('38')).toBeInTheDocument();
        expect(within(rows[0]).getByText('在线 3/10，入站 2')).toBeInTheDocument();
        expect(within(rows[0]).queryByText('心跳')).not.toBeInTheDocument();
        expect(within(rows[1]).queryByText('ms')).not.toBeInTheDocument();
        expect(within(rows[1]).getByText('connection refused')).toBeInTheDocument();
        expect(within(rows[1]).getByText('心跳')).toBeInTheDocument();
        expect(within(rows[2]).getByText('已停用')).toBeInTheDocument();
        expect(within(rows[2]).queryByText('stale error')).not.toBeInTheDocument();
    });
});

describe('ClientHwidSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.role = 'admin';
        mockedApi.post.mockImplementation((url: string) => (url.includes('/clients/hwids/')
            ? Promise.resolve(ok([
                { id: 5, deviceModel: 'Pixel 9', deviceOs: 'Android', osVersion: '16', userAgent: 'v2rayNG/1.10', lastSeen: 1_760_000_000 },
            ]))
            : Promise.resolve(ok(null))));
        mockedApi.get.mockResolvedValue(ok({ client: { email: 'a@b.com', limitHwid: 2 } }));
        mockedApi.delete.mockResolvedValue(ok(null));
    });

    it('lists devices against the limit and removes one', async () => {
        const user = userEvent.setup();
        renderWithRouter(<ClientHwidSection serverId="s1" email="a@b.com" />);
        expect(await screen.findByText('Pixel 9')).toBeInTheDocument();
        expect(screen.getByText('已登记 1 台，上限 2 台')).toBeInTheDocument();
        expect(screen.getByText('Android 16')).toBeInTheDocument();
        expect(mockedApi.post).toHaveBeenCalledWith('/panel/s1/panel/api/clients/hwids/a%40b.com');

        await user.click(screen.getByRole('button', { name: '移除 Pixel 9' }));
        await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith('/panel/s1/panel/api/clients/hwids/a%40b.com/5'));
        expect(await screen.findByText(/还没有设备登记/)).toBeInTheDocument();
    });

    it('saves a new device limit', async () => {
        const user = userEvent.setup();
        renderWithRouter(<ClientHwidSection serverId="s1" email="a@b.com" />);
        const input = await screen.findByLabelText('设备上限');
        expect(input).toHaveValue('2');
        await user.clear(input);
        await user.type(input, '3');
        await user.click(screen.getByRole('button', { name: '保存' }));
        await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/panel/s1/panel/api/clients/bulkAdjust', { emails: ['a@b.com'], limitHwid: 3 }));
    });

    it('notes when the panel does not track devices', async () => {
        mockedApi.post.mockRejectedValue({ response: { status: 404 } });
        renderWithRouter(<ClientHwidSection serverId="s1" email="a@b.com" />);
        expect(await screen.findByText('这台面板的版本不记录设备（HWID）。')).toBeInTheDocument();
    });

    it('hides management controls from auditors', async () => {
        auth.role = 'auditor';
        renderWithRouter(<ClientHwidSection serverId="s1" email="a@b.com" />);
        expect(await screen.findByText('Pixel 9')).toBeInTheDocument();
        expect(screen.queryByLabelText('设备上限')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '移除 Pixel 9' })).not.toBeInTheDocument();
    });
});

describe('ClientDirectoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.role = 'admin';
    });

    it('loads paged clients, shows all client fields, and paginates', async () => {
        const user = userEvent.setup();
        mockedApi.get.mockImplementation((url: string) => {
            if (url.includes('page=2')) {
                return Promise.resolve(ok({
                    clients: [
                        {
                            email: 'bob@example.com',
                            inboundId: 2,
                            group: '',
                            enable: false,
                            up: 0,
                            down: 0,
                            totalGB: 0,
                            expiryTime: -604_800_000,
                            subId: 'sub-bob',
                            tgId: 0,
                        },
                    ],
                    total: 25,
                    page: 2,
                    pageSize: 20,
                }));
            }
            return Promise.resolve(ok({
                items: [
                    {
                        email: 'alice@example.com',
                        inboundId: 1,
                        group: 'vip',
                        enable: true,
                        up: 1024,
                        down: 2048,
                        totalGB: 10 * 1024 * 1024 * 1024,
                        expiryTime: 0,
                        subId: 'sub-alice',
                        tgId: 123456789,
                    },
                ],
                total: 25,
                page: 1,
                pageSize: 20,
            }));
        });

        renderWithRouter(<ClientDirectoryPanel serverId="s1" inbounds={INBOUNDS} />);

        expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
        const list = screen.getByRole('list', { name: '客户端目录列表' });
        expect(within(list).getByText('hk-reality (vless:443)')).toBeInTheDocument();
        expect(within(list).getByText('vless')).toBeInTheDocument();
        expect(within(list).getByText('vip')).toBeInTheDocument();
        expect(within(list).getByText('已启用')).toBeInTheDocument();
        expect(within(list).getByText('3 KB')).toBeInTheDocument();
        expect(within(list).getByText('上限 10 GB')).toBeInTheDocument();
        expect(within(list).getByText('永不过期')).toBeInTheDocument();
        expect(within(list).getByText('sub-alice')).toBeInTheDocument();
        expect(within(list).getByText('123456789')).toBeInTheDocument();
        expect(screen.getByText('共 25 条')).toBeInTheDocument();
        expect(screen.getByText('1 / 2')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '下一页' }));
        expect(await screen.findByText('bob@example.com')).toBeInTheDocument();
        const nextList = screen.getByRole('list', { name: '客户端目录列表' });
        expect(within(nextList).getByText('jp-ws (vmess:8443)')).toBeInTheDocument();
        expect(within(nextList).getByText('已停用')).toBeInTheDocument();
        expect(within(nextList).getByText('首次连接后 7 天')).toBeInTheDocument();
        expect(within(nextList).getByText('不限流量')).toBeInTheDocument();
        expect(screen.getByText('2 / 2')).toBeInTheDocument();
        expect(mockedApi.get).toHaveBeenLastCalledWith('/panel/s1/panel/api/clients/list/paged?page=2&pageSize=20');
    });

    it('applies search, inbound, group, and status filters and resets cleanly', async () => {
        const user = userEvent.setup();
        mockedApi.get.mockResolvedValue(ok([
            {
                email: 'filtered@example.com',
                inboundId: 1,
                group: 'team-a',
                enable: true,
                up: 512,
                down: 512,
                totalGB: 0,
                expiryTime: 1_800_000_000_000,
                subId: 'sub-f',
                tgId: 555,
            },
        ]));

        renderWithRouter(<ClientDirectoryPanel serverId="s1" inbounds={INBOUNDS} />);
        expect(await screen.findByText('filtered@example.com')).toBeInTheDocument();

        await user.type(screen.getByLabelText('搜索'), 'alice');
        await user.type(screen.getByLabelText('分组'), 'team-a');
        await user.click(screen.getByRole('button', { name: '筛选' }));

        await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith(
            '/panel/s1/panel/api/clients/list/paged?page=1&pageSize=20&search=alice&group=team-a',
        ));

        await user.selectOptions(screen.getByLabelText('入站'), '1');
        await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith(
            '/panel/s1/panel/api/clients/list/paged?page=1&pageSize=20&search=alice&inboundId=1&group=team-a',
        ));

        await user.selectOptions(screen.getByLabelText('状态'), 'disabled');
        await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith(
            '/panel/s1/panel/api/clients/list/paged?page=1&pageSize=20&search=alice&inboundId=1&group=team-a&status=disabled',
        ));

        await user.click(screen.getByRole('button', { name: '重置' }));
        await waitFor(() => expect(mockedApi.get).toHaveBeenLastCalledWith(
            '/panel/s1/panel/api/clients/list/paged?page=1&pageSize=20',
        ));
    });

    it('looks up clients by SubID and Telegram ID and resets back to the paged directory', async () => {
        const user = userEvent.setup();
        mockedApi.get.mockImplementation((url: string) => {
            if (url.includes('/clients/get/subId/sub-xyz')) {
                return Promise.resolve(ok({
                    client: {
                        email: 'sub-hit@example.com',
                        group: 'pro',
                        enable: true,
                        totalGB: 5 * 1024 * 1024 * 1024,
                        expiryTime: 0,
                        subId: 'sub-xyz',
                        tgId: 777,
                    },
                    inboundIds: [1],
                    up: 2048,
                    down: 2048,
                }));
            }
            if (url.includes('/clients/get/tgId/998877')) {
                return Promise.resolve(ok([
                    {
                        email: 'tg-hit@example.com',
                        inboundId: 2,
                        group: 'tg-vip',
                        enable: true,
                        up: 0,
                        down: 1024,
                        totalGB: 0,
                        expiryTime: 0,
                        subId: 'sub-tg',
                        tgId: 998877,
                    },
                ]));
            }
            if (url.includes('/clients/get/subId/missing')) {
                return Promise.resolve({ data: { success: false, msg: 'client not found' } });
            }
            return Promise.resolve(ok({
                items: [
                    {
                        email: 'dir-row@example.com',
                        inboundId: 1,
                        enable: true,
                        up: 0,
                        down: 0,
                        totalGB: 0,
                        expiryTime: 0,
                        subId: 'sub-dir',
                        tgId: 0,
                    },
                ],
                total: 1,
                page: 1,
                pageSize: 20,
            }));
        });

        renderWithRouter(<ClientDirectoryPanel serverId="s1" inbounds={INBOUNDS} />);
        expect(await screen.findByText('dir-row@example.com')).toBeInTheDocument();

        const lookupInput = screen.getByLabelText('精确查询');
        await user.type(lookupInput, 'sub-xyz');
        await user.click(screen.getByRole('button', { name: '查询' }));

        expect(await screen.findByText('sub-hit@example.com')).toBeInTheDocument();
        expect(screen.getByText('精确查询：SubID = sub-xyz（1 条结果）')).toBeInTheDocument();
        expect(screen.queryByText('dir-row@example.com')).not.toBeInTheDocument();
        expect(mockedApi.get).toHaveBeenCalledWith('/panel/s1/panel/api/clients/get/subId/sub-xyz');

        await user.selectOptions(screen.getByLabelText('精确查询方式'), 'tgId');
        await user.clear(lookupInput);
        await user.type(lookupInput, '998877');
        await user.click(screen.getByRole('button', { name: '查询' }));

        expect(await screen.findByText('tg-hit@example.com')).toBeInTheDocument();
        expect(screen.getByText('精确查询：Telegram ID = 998877（1 条结果）')).toBeInTheDocument();
        expect(mockedApi.get).toHaveBeenCalledWith('/panel/s1/panel/api/clients/get/tgId/998877');

        await user.selectOptions(screen.getByLabelText('精确查询方式'), 'subId');
        await user.clear(lookupInput);
        await user.type(lookupInput, 'missing');
        await user.click(screen.getByRole('button', { name: '查询' }));

        expect(await screen.findByText('未找到匹配的客户端')).toBeInTheDocument();
        expect(screen.queryByText('这台面板不支持此功能')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '返回分页目录' }));
        expect(await screen.findByText('dir-row@example.com')).toBeInTheDocument();
        expect(screen.queryByText('未找到匹配的客户端')).not.toBeInTheDocument();
    });

    it('shows the standard unsupported note when the panel lacks clients/list/paged', async () => {
        mockedApi.get.mockRejectedValue({ response: { status: 404 } });
        renderWithRouter(<ClientDirectoryPanel serverId="s1" inbounds={INBOUNDS} />);
        expect(await screen.findByText('这台面板不支持此功能')).toBeInTheDocument();
    });
});
