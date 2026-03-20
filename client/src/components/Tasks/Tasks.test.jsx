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

describe('Tasks', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.delete.mockReset();
        api.post.mockReset();
        window.localStorage.clear();
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
});
