import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import api from '../../api/client.js';
import { renderWithRouter } from '../../test/render.jsx';
import InboundModal from './InboundModal.jsx';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: () => ({
        panelApi: vi.fn(),
    }),
}));

vi.mock('../../utils/riskConfirm.js', () => ({
    attachBatchRiskToken: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

function InboundModalHarness() {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                添加入站
            </button>
            <InboundModal
                isOpen={open}
                onClose={() => setOpen(false)}
                onSuccess={vi.fn()}
                servers={[{ id: 'server-1', name: 'Review Node', url: 'http://127.0.0.1:20530' }]}
                onBatchResult={vi.fn()}
            />
        </>
    );
}

describe('InboundModal', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        attachBatchRiskToken.mockReset();

        api.get.mockImplementation((url) => {
            if (url === '/protocol-schemas') {
                return Promise.resolve({
                    data: {
                        obj: {
                            protocols: [],
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });
        attachBatchRiskToken.mockImplementation(async (payload) => payload);
    });

    it('stays open after clicking the add inbound trigger', async () => {
        renderWithRouter(<InboundModalHarness />);

        fireEvent.click(screen.getByRole('button', { name: '添加入站' }));

        expect(await screen.findByRole('heading', { name: '批量添加入站' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '保存配置' })).toBeInTheDocument();
    }, 15000);

    it('defaults new inbound protocol to vless', async () => {
        renderWithRouter(<InboundModalHarness />);

        fireEvent.click(screen.getByRole('button', { name: '添加入站' }));

        const selects = await screen.findAllByRole('combobox');
        expect(selects[0]).toHaveValue('vless');
    }, 15000);

    it('passes syncExistingSubscriptions when the checkbox is enabled', async () => {
        api.post.mockResolvedValue({
            data: {
                obj: {
                    summary: {
                        total: 1,
                        success: 1,
                        failed: 0,
                    },
                    results: [],
                    subscriptionSync: {
                        syncedUsers: 2,
                    },
                },
            },
        });

        renderWithRouter(<InboundModalHarness />);

        fireEvent.click(screen.getByRole('button', { name: '添加入站' }));
        fireEvent.click(await screen.findByRole('checkbox', { name: '新增后补齐到已有用户订阅，仅同步策略允许的用户' }));
        fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

        await screen.findByText('添加入站');
        expect(attachBatchRiskToken).toHaveBeenCalledWith(expect.objectContaining({
            action: 'add',
            syncExistingSubscriptions: true,
        }), expect.any(Object));
        expect(api.post).toHaveBeenCalledWith('/batch/inbounds', expect.objectContaining({
            action: 'add',
            syncExistingSubscriptions: true,
        }));
    }, 15000);
});
