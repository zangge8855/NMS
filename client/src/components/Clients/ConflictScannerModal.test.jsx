import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render.jsx';
import ConflictScannerModal from './ConflictScannerModal.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        post: vi.fn(),
    },
}));

vi.mock('../../utils/riskConfirm.js', () => ({
    attachBatchRiskToken: vi.fn((payload) => Promise.resolve(payload)),
}));

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div data-testid="modal-shell">{children}</div>,
}));

vi.mock('../UI/EmptyState.jsx', () => ({
    default: ({ title, subtitle }) => (
        <div>
            <div>{title}</div>
            {subtitle && <div>{subtitle}</div>}
        </div>
    ),
}));

vi.mock('../UI/SkeletonTable.jsx', () => ({
    default: () => <div>loading-table</div>,
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

describe('ConflictScannerModal', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('renders a shared empty state when no conflicts are detected', async () => {
        renderWithRouter(
            <ConflictScannerModal
                isOpen
                onClose={() => {}}
                clients={[]}
            />
        );

        expect(await screen.findByText('未检测到可识别冲突')).toBeInTheDocument();
        expect(screen.getByText('同一身份在同协议下未发现参数分歧。')).toBeInTheDocument();
    });

    it('switches to the shared loading shell while refreshing conflicts', async () => {
        const user = userEvent.setup();
        const refreshDeferred = deferred();

        renderWithRouter(
            <ConflictScannerModal
                isOpen
                onClose={() => {}}
                clients={[]}
                onRefreshClients={() => refreshDeferred.promise}
            />
        );

        expect(await screen.findByText('未检测到可识别冲突')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /重新扫描/i }));

        expect(screen.getByText('loading-table')).toBeInTheDocument();

        refreshDeferred.resolve([]);

        await waitFor(() => {
            expect(screen.getByText('未检测到可识别冲突')).toBeInTheDocument();
        });
    });
});
