import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import api from '../../api/client.js';
import Tasks from './Tasks.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        delete: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('../Batch/BatchResultModal.jsx', () => ({
    default: () => null,
}));

vi.mock('../UI/SkeletonTable.jsx', () => ({
    default: () => <div>loading-table</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function mockMatchMedia(matches = false) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

describe('Tasks', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.delete.mockReset();
        api.post.mockReset();
        window.localStorage.clear();
        mockMatchMedia(false);
    });

    it('renders a standalone loading shell before tasks are loaded', async () => {
        const pending = deferred();
        api.get.mockReturnValueOnce(pending.promise);

        renderWithRouter(<Tasks />);

        expect(screen.getByText('loading-table')).toBeInTheDocument();

        pending.resolve({
            data: {
                obj: {
                    items: [],
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByText('暂无批量任务')).toBeInTheDocument();
        });
    });

    it('renders the shared empty state when there are no batch tasks', async () => {
        api.get.mockResolvedValueOnce({
            data: {
                obj: {
                    items: [],
                },
            },
        });

        renderWithRouter(<Tasks />);

        expect(await screen.findByText('暂无批量任务')).toBeInTheDocument();
        expect(screen.getByText('执行批量操作后将在此显示')).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: '时间' })).not.toBeInTheDocument();
    });

    it('renders compact mobile cards instead of the desktop table on mobile', async () => {
        mockMatchMedia(true);
        api.get.mockResolvedValueOnce({
            data: {
                obj: {
                    items: [
                        {
                            id: 'task-1',
                            createdAt: '2026-03-13T10:00:00.000Z',
                            type: 'clients',
                            action: 'update',
                            summary: {
                                total: 6,
                                success: 4,
                                failed: 2,
                            },
                            results: [
                                { serverName: 'Node A' },
                                { serverName: 'Node B' },
                                { serverName: 'Node C' },
                            ],
                        },
                    ],
                },
            },
        });

        renderWithRouter(<Tasks embedded />);

        expect(await screen.findByText('用户 / 更新')).toBeInTheDocument();
        expect(document.querySelector('.tasks-mobile-card')).toBeTruthy();
        expect(screen.queryByRole('columnheader', { name: '时间' })).not.toBeInTheDocument();
        expect(screen.getByText('Node A, Node B +1')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '重试失败项' })).toBeInTheDocument();
    });
});
