import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render';
import NodeHealthGrid from './NodeHealthGrid';

function buildNodes(count: number) {
    const servers = Array.from({ length: count }, (_, idx) => ({
        id: `srv-${idx + 1}`,
        name: `node-${String(idx + 1).padStart(2, '0')}`,
    }));
    const serverStatuses = servers.reduce<Record<string, any>>((acc, server) => {
        acc[server.id] = {
            serverId: server.id,
            name: server.name,
            online: true,
            managedOnlineCount: 1,
            managedTrafficTotal: 1024,
            managedTrafficReady: true,
            status: {
                cpu: 10,
                mem: { current: 512, total: 1024 },
            },
        };
        return acc;
    }, {});
    return { servers, serverStatuses };
}

describe('NodeHealthGrid', () => {
    it('separates authentication failures from unreachable nodes', () => {
        renderWithRouter(
            <NodeHealthGrid
                servers={[{ id: 'server-auth', name: 'Auth Node' }]}
                serverStatuses={{
                    'server-auth': {
                        online: false,
                        reasonCode: 'auth_failed',
                        error: 'invalid username or password',
                    },
                }}
            />
        );

        expect(screen.getByText('认证失败')).toBeInTheDocument();
        expect(screen.getByText('凭据无效')).toBeInTheDocument();
        expect(screen.getByText('打开节点详情检查配置并重试。')).toBeInTheDocument();
        expect(screen.queryByText('invalid username or password')).not.toBeInTheDocument();
    });

    it('shows 6 tiles by default in dense/priority mode so 3-col desktop and 2-col tablet rows have no trailing gap', async () => {
        const user = userEvent.setup();
        const { servers, serverStatuses } = buildNodes(19);

        const { container } = renderWithRouter(
            <NodeHealthGrid servers={servers} serverStatuses={serverStatuses} />
        );

        expect(container.querySelectorAll('.node-health-tile')).toHaveLength(6);
        expect(screen.getByText('显示 6/19')).toBeInTheDocument();
        expect(screen.getByText('重点视图')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '展开全部' }));
        expect(container.querySelectorAll('.node-health-tile')).toHaveLength(19);
        expect(screen.getByText('显示 19/19')).toBeInTheDocument();
    });
});
