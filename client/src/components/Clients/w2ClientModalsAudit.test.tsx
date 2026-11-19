import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { LanguageProvider } from '../../contexts/LanguageContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { copyToClipboard } from '../../utils/format';
import { writeSessionSnapshot } from '../../utils/sessionSnapshot';
import { invalidateServerPanelDataCache } from '../../utils/serverPanelDataCache';
import Inbounds from '../Inbounds/Inbounds';
import InboundModal, {
    createDefaultSettings,
    createDefaultTransportSettings,
    normalizeStreamForSubmission,
} from '../Inbounds/InboundModal';
import ClientModal from './ClientModal';
import ConflictScannerModal from './ConflictScannerModal';
import Subscriptions from '../Subscriptions/Subscriptions';
import XrayConsole from '../Xray/XrayConsole';
import XrayJsonEditor from '../Xray/XrayJsonEditor';
import RoutingRulesEditor from '../Xray/tabs/RoutingRulesEditor';

const hoisted = vi.hoisted(() => ({
    authUser: { role: 'admin', username: 'admin', subscriptionEmail: '' } as any,
    serverState: {
        servers: [{ id: 's1', name: 'Node A', panelType: '3x-ui' }] as any[],
        activeServerId: undefined as string | undefined,
        panelApi: vi.fn(),
    },
    confirmMock: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
    },
}));

vi.mock('../../utils/riskConfirm', () => ({
    attachBatchRiskToken: vi.fn((payload) => Promise.resolve(payload)),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ user: hoisted.authUser }),
    useOptionalAuth: () => ({ user: hoisted.authUser }),
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: () => hoisted.serverState,
    useOptionalServer: () => hoisted.serverState,
}));

vi.mock('../../contexts/ConfirmContext', () => ({
    useConfirm: () => hoisted.confirmMock,
}));

vi.mock('../Layout/Header', () => ({
    default: ({ title }: { title: React.ReactNode }) => <div>{title}</div>,
}));

vi.mock('../../utils/format', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/format')>();
    return {
        ...actual,
        copyToClipboard: vi.fn(),
    };
});

vi.mock('../../utils/sessionSnapshot', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/sessionSnapshot')>();
    return {
        ...actual,
        writeSessionSnapshot: vi.fn((...args: Parameters<typeof actual.writeSessionSnapshot>) => (
            actual.writeSessionSnapshot(...args)
        )),
    };
});

function deferred<T = any>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function decodeBase64Length(b64: string): number {
    const raw = window.atob(b64);
    return raw.length;
}

function TestProviders({ children }: { children: React.ReactNode }) {
    return (
        <MemoryRouter initialEntries={['/']}>
            <ThemeProvider>
                <LanguageProvider>{children}</LanguageProvider>
            </ThemeProvider>
        </MemoryRouter>
    );
}

function renderWithRouter(ui: React.ReactElement) {
    return render(ui, { wrapper: TestProviders });
}

describe('Wave 2 Frontend Modals, Scanner, Subscriptions & Xray Fixes', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        invalidateServerPanelDataCache();
        vi.clearAllMocks();

        hoisted.authUser = { role: 'admin', username: 'admin', subscriptionEmail: '' };
        hoisted.serverState = {
            servers: [{ id: 's1', name: 'Node A', panelType: '3x-ui' }],
            activeServerId: undefined,
            panelApi: vi.fn(),
        };
        hoisted.confirmMock.mockResolvedValue(true);
        (copyToClipboard as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);

        window.matchMedia.mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    describe('1. Inbounds.tsx', () => {
        function setupInboundsApi({
            inboundList = [
                {
                    id: 1,
                    remark: 'Main Inbound',
                    protocol: 'vless',
                    listen: '0.0.0.0',
                    port: 443,
                    enable: true,
                    up: 100,
                    down: 200,
                    settings: JSON.stringify({
                        clients: [{ email: 'alice@example.com', id: 'alice-uuid', enable: true }],
                    }),
                },
            ],
            snapshotDelay,
        }: { inboundList?: any[]; snapshotDelay?: Promise<any> } = {}) {
            (api.get as any).mockImplementation((url: string) => {
                if (url === '/system/inbounds/order') return Promise.resolve({ data: { obj: {} } });
                if (url === '/system/servers/order') return Promise.resolve({ data: { obj: [] } });
                if (url === '/clients/entitlement-overrides') return Promise.resolve({ data: { obj: [] } });
                if (url.startsWith('/system/panel/snapshot')) {
                    if (snapshotDelay) return snapshotDelay;
                    return Promise.resolve({
                        data: {
                            obj: {
                                items: [{
                                    server: { id: 's1', name: 'Node A', panelType: '3x-ui' },
                                    inbounds: inboundList,
                                    onlines: ['alice@example.com'],
                                }],
                            },
                        },
                    });
                }
                throw new Error(`Unexpected GET ${url}`);
            });
        }

        it('guards writeSessionSnapshot on mount until live data hydrates, handles nms:page-refresh preventDefault, and checks copyToClipboard', async () => {
            window.localStorage.setItem('nms_locale', 'en-US');
            const pendingSnapshot = deferred();
            setupInboundsApi({ snapshotDelay: pendingSnapshot.promise });

            renderWithRouter(<Inbounds />);

            await waitFor(() => {
                expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/system/panel/snapshot'));
            });
            expect(writeSessionSnapshot).not.toHaveBeenCalled();

            pendingSnapshot.resolve({
                data: {
                    obj: {
                        items: [{
                            server: { id: 's1', name: 'Node A', panelType: '3x-ui' },
                            inbounds: [{
                                id: 1,
                                remark: 'Main Inbound',
                                protocol: 'vless',
                                listen: '0.0.0.0',
                                port: 443,
                                enable: true,
                                up: 100,
                                down: 200,
                                settings: JSON.stringify({
                                    clients: [{ email: 'alice@example.com', id: 'alice-uuid', enable: true }],
                                }),
                            }],
                            onlines: ['alice@example.com'],
                        }],
                    },
                },
            });

            expect(await screen.findByText('Main Inbound')).toBeInTheDocument();
            await waitFor(() => {
                expect(writeSessionSnapshot).toHaveBeenCalled();
            });

            const refreshEvent = new CustomEvent('nms:page-refresh', { cancelable: true });
            const notCanceled = window.dispatchEvent(refreshEvent);
            expect(notCanceled).toBe(false);
            expect(refreshEvent.defaultPrevented).toBe(true);

            await waitFor(() => {
                expect(api.get).toHaveBeenCalledWith(expect.stringContaining('refresh=true'));
            });

            const user = userEvent.setup();
            await user.click(screen.getByText('Main Inbound').closest('tr')!);
            const copyBtn = await screen.findByTitle('Copy full ID / password');

            (copyToClipboard as any).mockResolvedValueOnce(false);
            await user.click(copyBtn);
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalled();
            });
            expect(toast.success).not.toHaveBeenCalled();

            (copyToClipboard as any).mockResolvedValueOnce(true);
            await user.click(copyBtn);
            await waitFor(() => {
                expect(toast.success).toHaveBeenCalled();
            });
        });

        it('surfaces res.data.success === false errors in handleDelete and handleCleanupDepletedClients and passes force: true on mutations', async () => {
            window.localStorage.setItem('nms_locale', 'en-US');
            setupInboundsApi();
            (api.post as any).mockImplementation((url: string) => {
                if (url.includes('/del/1')) {
                    return Promise.resolve({ data: { success: false, msg: 'Cannot delete active inbound' } });
                }
                if (url.includes('/delDepletedClients/1')) {
                    return Promise.resolve({ data: { success: false, msg: 'Depleted cleanup rejected' } });
                }
                return Promise.resolve({ data: { success: true, obj: { summary: { success: 1, total: 1, failed: 0 } } } });
            });

            const user = userEvent.setup();
            renderWithRouter(<Inbounds />);
            const row = (await screen.findByText('Main Inbound')).closest('tr')!;

            // Trigger Delete Inbound -> success: false should toast.error, not toast.success
            await user.click(within(row).getByRole('button', { name: 'Actions Menu' }));
            await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Cannot delete active inbound');
            });
            expect(toast.success).not.toHaveBeenCalled();

            // Trigger Cleanup Depleted -> success: false should toast.error, not toast.success
            await user.click(within(row).getByRole('button', { name: 'Actions Menu' }));
            await user.click(await screen.findByRole('menuitem', { name: 'Delete Depleted Clients' }));
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Depleted cleanup rejected');
            });

            // Trigger Toggle Inbound -> succeeds and refreshes with force: true (refresh=true)
            const beforeForceCalls = (api.get as any).mock.calls.filter(
                ([u]: [string]) => u.includes('refresh=true')
            ).length;
            await user.click(within(row).getByRole('button', { name: 'Actions Menu' }));
            await user.click(await screen.findByRole('menuitem', { name: 'Disable' }));
            await waitFor(() => {
                const afterForceCalls = (api.get as any).mock.calls.filter(
                    ([u]: [string]) => u.includes('refresh=true')
                ).length;
                expect(afterForceCalls).toBe(beforeForceCalls + 1);
            });
        });
    });

    describe('2. InboundModal.tsx', () => {
        it('generates two distinct SS-2022 passwords for server and primary client', () => {
            const ss = createDefaultSettings('shadowsocks') as any;
            expect(ss.method).toBe('2022-blake3-aes-256-gcm');
            expect(ss.password).toBeTruthy();
            expect(ss.clients[0].password).toBeTruthy();
            expect(ss.clients[0].password).not.toBe(ss.password);
            expect(decodeBase64Length(ss.password)).toBe(32);
            expect(decodeBase64Length(ss.clients[0].password)).toBe(32);
        });

        it('preserves httpSettings (http/h2) and quicSettings (quic) without injecting tcpSettings', () => {
            expect(createDefaultTransportSettings('http')).toEqual({ httpSettings: { host: [], path: '/' } });
            expect(createDefaultTransportSettings('h2')).toEqual({ httpSettings: { host: [], path: '/' } });
            expect(createDefaultTransportSettings('quic')).toEqual({
                quicSettings: { security: 'none', key: '', header: { type: 'none' } },
            });

            const h2Stream = normalizeStreamForSubmission({
                network: 'h2',
                security: 'tls',
                httpSettings: { path: '/h2', host: ['cdn.example.com'] },
            }, 'vless') as any;
            expect(h2Stream.httpSettings).toEqual({ path: '/h2', host: ['cdn.example.com'] });
            expect(h2Stream.tcpSettings).toBeUndefined();

            const httpStream = normalizeStreamForSubmission({
                network: 'http',
                security: 'none',
                httpSettings: { path: '/http', host: ['a.example.com'] },
            }, 'vmess') as any;
            expect(httpStream.httpSettings).toEqual({ path: '/http', host: ['a.example.com'] });
            expect(httpStream.tcpSettings).toBeUndefined();

            const quicStream = normalizeStreamForSubmission({
                network: 'quic',
                security: 'tls',
                quicSettings: { security: 'aes-128-gcm', key: 'k', header: { type: 'srtp' } },
            }, 'vless') as any;
            expect(quicStream.quicSettings).toEqual({ security: 'aes-128-gcm', key: 'k', header: { type: 'srtp' } });
            expect(quicStream.tcpSettings).toBeUndefined();
        });

        it('hides transport/security selects for non-stream protocols, supports hysteria2 auth/network, and has unique checkbox ids', async () => {
            window.localStorage.setItem('nms_locale', 'en-US');
            (api.get as any).mockImplementation((url: string) => {
                if (url === '/protocol-schemas') {
                    return Promise.resolve({
                        data: {
                            obj: {
                                protocols: [
                                    { key: 'vless', label: 'VLESS', supports: { transports: ['tcp', 'ws'], securities: ['none', 'tls', 'reality'] } },
                                    { key: 'wireguard', label: 'WireGuard', supports: { transports: [], securities: [] } },
                                    { key: 'hysteria2', label: 'Hysteria2', supports: { transports: [], securities: ['tls'] } },
                                ],
                            },
                        },
                    });
                }
                throw new Error(`Unexpected GET ${url}`);
            });

            const user = userEvent.setup();
            renderWithRouter(
                <InboundModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    servers={[{ id: 's1', name: 'Node A' }]}
                />
            );

            // Initially VLESS -> Transport & Security visible, no duplicate DOM ids
            expect(await screen.findByLabelText('Transport (Network)')).toBeInTheDocument();
            expect(screen.getByLabelText('Security')).toBeInTheDocument();

            await user.click(screen.getByLabelText('Enable Sockopt'));
            const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.getAttribute('id'));
            expect(new Set(ids).size).toBe(ids.length);

            // Switch to WireGuard -> Transport & Security hidden
            await user.selectOptions(screen.getByLabelText('Protocol'), 'wireguard');
            expect(screen.queryByLabelText('Transport (Network)')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Security')).not.toBeInTheDocument();
        });

        it('edits existing Hysteria2 inbound with network=hysteria & auth, checks success:false & global serverId', async () => {
            window.localStorage.setItem('nms_locale', 'en-US');
            (api.get as any).mockImplementation((url: string) => {
                if (url === '/protocol-schemas') {
                    return Promise.resolve({
                        data: {
                            obj: {
                                protocols: [
                                    { key: 'hysteria2', label: 'Hysteria2', supports: { transports: ['udp'], securities: ['tls'] } },
                                ],
                            },
                        },
                    });
                }
                if (url.includes('getNewX25519Cert')) {
                    return Promise.resolve({ data: { success: false, msg: 'Cert generation blocked' } });
                }
                throw new Error(`Unexpected GET ${url}`);
            });
            (api.post as any).mockResolvedValueOnce({
                data: { success: false, msg: 'Upstream update rejected' },
            }).mockResolvedValueOnce({
                data: { success: true },
            });

            const onSuccess = vi.fn();
            const user = userEvent.setup();
            renderWithRouter(
                <InboundModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={onSuccess}
                    servers={[{ id: 's1', name: 'Node A' }]}
                    editingInbound={{
                        id: 9,
                        serverId: 's1',
                        remark: 'Hy2',
                        protocol: 'hysteria2',
                        port: 8443,
                        listen: '',
                        enable: true,
                        settings: JSON.stringify({
                            up_mbps: 100,
                            down_mbps: 100,
                            clients: [{ auth: 'hy2-auth-secret', email: 'hy@example.com' }],
                        }),
                        streamSettings: JSON.stringify({
                            network: 'hysteria',
                            security: 'tls',
                            tlsSettings: { serverName: 'hy2.example.com' },
                        }),
                        sniffing: JSON.stringify({ enabled: false, destOverride: ['http'] }),
                    }}
                />
            );

            const pwInput = await screen.findByLabelText(/Client password/i) as HTMLInputElement;
            expect(pwInput.value).toBe('hy2-auth-secret');

            await user.clear(pwInput);
            await user.type(pwInput, 'hy2-auth-new');

            // Toggle Expert mode and submit -> first submit returns success: false
            await user.click(screen.getByLabelText(/Expert Mode/i));
            await user.click(screen.getByRole('button', { name: 'Save configuration' }));

            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Upstream update rejected'));
            });
            expect(onSuccess).not.toHaveBeenCalled();

            // Second submit succeeds with synced auth + password and preserved network=hysteria
            await user.click(screen.getByRole('button', { name: 'Save configuration' }));
            await waitFor(() => {
                expect(onSuccess).toHaveBeenCalledTimes(1);
            });
            const lastPost = (api.post as any).mock.calls[1];
            const sentParams = lastPost[1] as URLSearchParams;
            const sentSettings = JSON.parse(sentParams.get('settings') || '{}');
            const sentStream = JSON.parse(sentParams.get('streamSettings') || '{}');
            expect(sentSettings.clients[0].auth).toBe('hy2-auth-new');
            expect(sentSettings.clients[0].password).toBe('hy2-auth-new');
            expect(sentStream.network).toBe('hysteria');
        });

        it('preserves explicit [""] shortIds when editing an existing REALITY inbound and rejects global serverId', async () => {
            window.localStorage.setItem('nms_locale', 'en-US');
            (api.get as any).mockImplementation((url: string) => {
                if (url === '/protocol-schemas') {
                    return Promise.resolve({ data: { obj: { protocols: [] } } });
                }
                if (url.includes('getNewX25519Cert')) {
                    return Promise.resolve({ data: { success: false, msg: 'Cert denied' } });
                }
                throw new Error(`Unexpected GET ${url}`);
            });
            (api.post as any).mockResolvedValue({ data: { success: true } });
            (api.put as any).mockResolvedValue({ data: { success: true, obj: { remark: 'Reality Updated' } } });

            const user = userEvent.setup();
            const onSuccess = vi.fn();
            const { rerender } = renderWithRouter(
                <InboundModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={onSuccess}
                    servers={[{ id: 's1', name: 'Node A' }]}
                    editingInbound={{
                        id: 5,
                        serverId: 's1',
                        remark: 'Reality Empty Sid',
                        protocol: 'vless',
                        port: 443,
                        listen: '',
                        enable: true,
                        settings: JSON.stringify({ clients: [{ id: 'u1', email: 'a@b.com' }], decryption: 'none' }),
                        streamSettings: JSON.stringify({
                            network: 'tcp',
                            security: 'reality',
                            realitySettings: {
                                target: 'www.apple.com:443',
                                serverNames: ['www.apple.com'],
                                privateKey: 'priv-key',
                                shortIds: [''],
                                settings: { publicKey: 'pub-key', fingerprint: 'chrome', spiderX: '/' },
                            },
                        }),
                        sniffing: JSON.stringify({ enabled: false, destOverride: ['http'] }),
                    }}
                />
            );

            // Cert generation returning success: false surfaces error
            await user.click(await screen.findByRole('button', { name: 'Generate keys' }));
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Cert denied');
            });

            // Editing Remark in Simple mode preserves shortIds: ['']
            const remarkInput = screen.getByLabelText('Remark');
            await user.clear(remarkInput);
            await user.type(remarkInput, 'Reality Updated');
            await user.click(screen.getByRole('button', { name: 'Save configuration' }));

            await waitFor(() => {
                expect(onSuccess).toHaveBeenCalledTimes(1);
            });
            const sentParams = (api.post as any).mock.calls[0][1] as URLSearchParams;
            expect(sentParams.get('remark')).toBe('Reality Empty Sid');
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/remarks', {
                serverId: 's1',
                inboundId: 5,
                remark: 'Reality Updated',
            });
            const sentStream = JSON.parse(sentParams.get('streamSettings') || '{}');
            expect(sentStream.realitySettings.shortIds).toEqual(['']);

            // Reject global serverId on edit
            (api.post as any).mockClear();
            rerender(
                <InboundModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={onSuccess}
                    servers={[{ id: 's1', name: 'Node A' }]}
                    editingInbound={{
                        id: 6,
                        serverId: 'global',
                        remark: 'Global Invalid',
                        protocol: 'vless',
                        port: 443,
                        settings: '{}',
                        streamSettings: '{}',
                    }}
                />
            );
            await user.click(await screen.findByRole('button', { name: 'Save configuration' }));
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalled();
            });
            expect(api.post).not.toHaveBeenCalled();
        });
    });

    describe('3. ClientModal.tsx', () => {
        beforeEach(() => {
            window.localStorage.setItem('nms_locale', 'en-US');
            (api.get as any).mockResolvedValue({
                data: { obj: { clientFlowOptions: ['', 'xtls-rprx-vision'], clientFlowProtocols: ['vless'] } },
            });
            (api.post as any).mockResolvedValue({
                data: { success: true, obj: { summary: { success: 2, total: 2, failed: 0 } } },
            });
        });

        it('applies changed email, uuid, and password in batch edit mergedClient instead of discarding them', async () => {
            const user = userEvent.setup();
            renderWithRouter(
                <ClientModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    editingClient={{
                        serverId: 's1',
                        inboundId: 1,
                        protocol: 'vless',
                        id: 'old-uuid',
                        password: 'old-password',
                        email: 'old@example.com',
                        editTargets: [
                            { serverId: 's1', serverName: 'A', inboundId: 1, protocol: 'vless', id: 'old-uuid', email: 'old@example.com' },
                            { serverId: 's2', serverName: 'B', inboundId: 2, protocol: 'trojan', password: 'old-password', email: 'old@example.com' },
                        ],
                    }}
                />
            );

            await screen.findByRole('heading', { name: /Batch edit clients/i });
            await user.clear(screen.getByLabelText('Email'));
            await user.type(screen.getByLabelText('Email'), 'new@example.com');
            await user.clear(screen.getByLabelText('UUID'));
            await user.type(screen.getByLabelText('UUID'), 'new-uuid');
            await user.clear(screen.getByLabelText('Password'));
            await user.type(screen.getByLabelText('Password'), 'new-password');

            await user.click(screen.getByRole('button', { name: /^Save$/i }));
            await waitFor(() => {
                expect(api.post).toHaveBeenCalledWith('/batch/clients', expect.anything());
            });
            const batchBody = (api.post as any).mock.calls[0][1];
            expect(batchBody.targets[0].client).toMatchObject({ email: 'new@example.com', id: 'new-uuid' });
            expect(batchBody.targets[1].client).toMatchObject({ email: 'new@example.com', password: 'new-password' });
        });

        it('supports Hysteria2 auth, Hysteria v1 auth_str, and TUIC uuid credentials', async () => {
            const user = userEvent.setup();

            const { rerender } = renderWithRouter(
                <ClientModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    serverId="s1"
                    inboundId={10}
                    inboundProtocol="hysteria2"
                    editingClient={{ protocol: 'hysteria2', auth: 'hy2-secret-1', email: 'hy2@example.com' }}
                />
            );
            const hy2Pw = await screen.findByLabelText('Password') as HTMLInputElement;
            expect(hy2Pw.value).toBe('hy2-secret-1');
            await user.clear(hy2Pw);
            await user.type(hy2Pw, 'hy2-secret-2');
            await user.click(screen.getByRole('button', { name: /^Save$/i }));
            await waitFor(() => {
                expect(api.post).toHaveBeenCalledWith(
                    '/panel/s1/panel/api/inbounds/updateClient/hy2-secret-1',
                    expect.anything(),
                    expect.anything()
                );
            });
            const hy2Params = (api.post as any).mock.calls[0][1] as URLSearchParams;
            const hy2Payload = JSON.parse(hy2Params.get('settings') || '{}').clients[0];
            expect(hy2Payload.auth).toBe('hy2-secret-2');

            (api.post as any).mockClear();
            rerender(
                <ClientModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    serverId="s1"
                    inboundId={11}
                    inboundProtocol="hysteria"
                    editingClient={{ protocol: 'hysteria', auth_str: 'hy1-secret', email: 'hy1@example.com' }}
                />
            );
            const hy1Pw = await screen.findByLabelText('Password') as HTMLInputElement;
            expect(hy1Pw.value).toBe('hy1-secret');
            await user.click(screen.getByRole('button', { name: /^Save$/i }));
            await waitFor(() => {
                expect(api.post).toHaveBeenCalledWith(
                    '/panel/s1/panel/api/inbounds/updateClient/hy1-secret',
                    expect.anything(),
                    expect.anything()
                );
            });
            const hy1Params = (api.post as any).mock.calls[0][1] as URLSearchParams;
            const hy1Payload = JSON.parse(hy1Params.get('settings') || '{}').clients[0];
            expect(hy1Payload.auth_str).toBe('hy1-secret');
            expect(hy1Payload.auth).toBe('hy1-secret');

            (api.post as any).mockClear();
            rerender(
                <ClientModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    serverId="s1"
                    inboundId={12}
                    inboundProtocol="tuic"
                    editingClient={{ protocol: 'tuic', uuid: 'tuic-uuid-1', email: 'tuic@example.com' }}
                />
            );
            const tuicUuid = await screen.findByLabelText('UUID') as HTMLInputElement;
            expect(tuicUuid.value).toBe('tuic-uuid-1');
            await user.click(screen.getByRole('button', { name: /^Save$/i }));
            await waitFor(() => {
                expect(api.post).toHaveBeenCalledWith(
                    '/panel/s1/panel/api/inbounds/updateClient/tuic-uuid-1',
                    expect.anything(),
                    expect.anything()
                );
            });
            const tuicParams = (api.post as any).mock.calls[0][1] as URLSearchParams;
            const tuicPayload = JSON.parse(tuicParams.get('settings') || '{}').clients[0];
            expect(tuicPayload.uuid).toBe('tuic-uuid-1');
        });

        it('generates compliant Base64 keys for Shadowsocks-2022 targets (16B for aes-128, 32B for aes-256)', async () => {
            const user = userEvent.setup();
            const { rerender } = renderWithRouter(
                <ClientModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    targets={[{
                        serverId: 's1',
                        serverName: 'Node A',
                        id: 1,
                        protocol: 'shadowsocks',
                        remark: 'ss128',
                        port: 8388,
                        settings: JSON.stringify({ method: '2022-blake3-aes-128-gcm' }),
                    }]}
                />
            );

            const pw128 = await screen.findByLabelText('Password') as HTMLInputElement;
            expect(decodeBase64Length(pw128.value)).toBe(16);
            await user.click(screen.getByRole('button', { name: /Generate random password/i }));
            expect(decodeBase64Length(pw128.value)).toBe(16);

            rerender(
                <ClientModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    targets={[{
                        serverId: 's1',
                        serverName: 'Node A',
                        id: 2,
                        protocol: 'shadowsocks',
                        remark: 'ss256',
                        port: 8389,
                        settings: JSON.stringify({ method: '2022-blake3-aes-256-gcm' }),
                    }]}
                />
            );
            const pw256 = await screen.findByLabelText('Password') as HTMLInputElement;
            expect(decodeBase64Length(pw256.value)).toBe(32);
        });

        it('preserves negative expiryTime (after first use), initializes controlled email, and keeps <details> open when clearing inputs', async () => {
            const user = userEvent.setup();
            renderWithRouter(
                <ClientModal
                    isOpen
                    onClose={() => {}}
                    onSuccess={() => {}}
                    serverId="s1"
                    inboundId={1}
                    inboundProtocol="vless"
                    editingClient={{
                        id: 'u-neg',
                        email: undefined,
                        expiryTime: -7 * 86400000,
                        resetDay: 0,
                        resetMax: 0,
                    }}
                />
            );

            const emailInput = await screen.findByLabelText('Email') as HTMLInputElement;
            expect(emailInput.value).toBe('');
            await user.type(emailInput, 'neg@example.com');

            const expirySelect = screen.getByLabelText('Expiry policy') as HTMLSelectElement;
            expect(expirySelect.value).toBe('after_first_use');
            const daysInput = document.querySelector('input[name="clientModalExpiryAfterDays"]') as HTMLInputElement;
            expect(daysInput.value).toBe('7');
            await user.clear(daysInput);
            await user.type(daysInput, '14');

            // Expand details and clear watched resetMax input without slamming details shut
            const summary = screen.getByText('3x-ui v3 renewal and traffic cycle');
            const detailsEl = summary.closest('details')!;
            await user.click(summary);
            expect(detailsEl.open).toBe(true);
            const resetMaxInput = screen.getByLabelText(/Max auto-renewals/i) as HTMLInputElement;
            await user.type(resetMaxInput, '5');
            await user.clear(resetMaxInput);
            expect(detailsEl.open).toBe(true);

            await user.click(screen.getByRole('button', { name: /^Save$/i }));
            await waitFor(() => {
                expect(api.post).toHaveBeenCalled();
            });
            const params = (api.post as any).mock.calls[0][1] as URLSearchParams;
            const sentClient = JSON.parse(params.get('settings') || '{}').clients[0];
            expect(sentClient.expiryTime).toBe(-14 * 86400000);
        });
    });

    describe('4. ConflictScannerModal.tsx', () => {
        it('passes locale to conflict report & type labels and localizes diffFields', async () => {
            window.localStorage.setItem('nms_locale', 'en-US');
            renderWithRouter(
                <ConflictScannerModal
                    isOpen
                    onClose={() => {}}
                    clients={[
                        {
                            serverId: 's1',
                            serverName: 'Node A',
                            inboundId: 1,
                            inboundRemark: 'Hy2 A',
                            protocol: 'hysteria2',
                            email: 'user@example.com',
                            auth: 'same-secret',
                            totalGB: 10 * 1024 * 1024 * 1024,
                            limitIp: 2,
                        },
                        {
                            serverId: 's2',
                            serverName: 'Node B',
                            inboundId: 2,
                            inboundRemark: 'Hy2 B',
                            protocol: 'hysteria2',
                            email: 'user@example.com',
                            auth: 'same-secret',
                            totalGB: 20 * 1024 * 1024 * 1024,
                            limitIp: 5,
                        },
                    ]}
                />
            );

            expect(await screen.findByText('Traffic Quota Mismatch')).toBeInTheDocument();
            expect(screen.getByText('IP Limit Mismatch')).toBeInTheDocument();
            expect(screen.getByText(/Total Traffic, IP Limit/)).toBeInTheDocument();
            expect(screen.queryByText(/totalGB/)).not.toBeInTheDocument();
        });
    });

    describe('5. Subscriptions.tsx', () => {
        it('guards snapshot before live hydration, calls preventDefault on refresh, supports operator/auditor roles, and drops role="img" from QR wrappers', async () => {
            const pendingUsers = deferred();
            hoisted.authUser = { role: 'auditor', username: 'auditor1', subscriptionEmail: '' };
            (api.get as any).mockImplementation((url: string) => {
                if (url === '/subscriptions/users') return pendingUsers.promise;
                if (url === '/subscriptions/user%40example.com') {
                    return Promise.resolve({
                        data: {
                            obj: {
                                email: 'user@example.com',
                                total: 1,
                                subscriptionActive: true,
                                subscriptionUrl: 'https://sub.example.com/abc',
                            },
                        },
                    });
                }
                throw new Error(`Unexpected GET ${url}`);
            });

            const { container, rerender } = renderWithRouter(<Subscriptions />);

            await waitFor(() => {
                expect(api.get).toHaveBeenCalledWith('/subscriptions/users');
            });
            expect(writeSessionSnapshot).not.toHaveBeenCalled();
            // Auditor is NOT misclassified as isUserOnly (sees staff toolbar, no user workbench, and NO Reset Link button)
            expect(screen.queryByText('导入你的订阅')).not.toBeInTheDocument();

            pendingUsers.resolve({
                data: { obj: { users: ['user@example.com'], warnings: [] } },
            });

            expect(await screen.findByDisplayValue('https://sub.example.com/abc')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: '重置订阅链接' })).not.toBeInTheDocument();
            await waitFor(() => {
                expect(writeSessionSnapshot).toHaveBeenCalled();
            });

            // QR wrapper must NOT have role="img" or aria-label around ExpandableQRCode
            const qrSurface = container.querySelector('.qr-surface');
            expect(qrSurface).toBeTruthy();
            expect(qrSurface?.getAttribute('role')).toBeNull();
            expect(qrSurface?.getAttribute('aria-label')).toBeNull();

            // nms:page-refresh must call preventDefault()
            const ev = new CustomEvent('nms:page-refresh', { cancelable: true });
            expect(window.dispatchEvent(ev)).toBe(false);
            expect(ev.defaultPrevented).toBe(true);

            // Operator role sees staff workbench AND Reset Subscription Link button
            hoisted.authUser = { role: 'operator', username: 'op1', subscriptionEmail: '' };
            rerender(<Subscriptions />);
            expect(await screen.findByRole('button', { name: '重置订阅链接' })).toBeInTheDocument();

            // End-user inline QR & modal QR wrappers also omit role="img" and aria-label
            hoisted.authUser = { role: 'user', username: 'u1', subscriptionEmail: 'user@example.com' };
            rerender(<Subscriptions />);
            await screen.findByDisplayValue('https://sub.example.com/abc');
            document.querySelectorAll('.qr-surface').forEach((wrapper) => {
                expect(wrapper.getAttribute('role')).toBeNull();
                expect(wrapper.getAttribute('aria-label')).toBeNull();
            });
        });
    });

    describe('6. XrayConsole, XrayJsonEditor & RoutingRulesEditor', () => {
        it('XrayConsole prevents default on nms:page-refresh and ignores stale PUT responses after switching servers', async () => {
            window.localStorage.setItem('nms_locale', 'en-US');
            hoisted.serverState = {
                servers: [
                    { id: 's1', name: 'Node 1', panelType: '3x-ui' },
                    { id: 's2', name: 'Node 2', panelType: '3x-ui' },
                ],
                activeServerId: 's1',
                panelApi: vi.fn(),
            };
            (api.get as any).mockImplementation((url: string) => {
                if (url === '/xray/s1/config') {
                    return Promise.resolve({
                        data: {
                            obj: {
                                source: 'xrayTemplateConfig',
                                snapshot: { routing: { domainStrategy: 'AsIs', rules: [] } },
                                template: { log: { loglevel: 'warning' } },
                            },
                        },
                    });
                }
                if (url === '/xray/s2/config') {
                    return Promise.resolve({
                        data: {
                            obj: {
                                source: 'xrayTemplateConfig',
                                snapshot: { routing: { domainStrategy: 'IPOnDemand', rules: [] } },
                                template: { log: { loglevel: 'debug' } },
                            },
                        },
                    });
                }
                throw new Error(`Unexpected GET ${url}`);
            });

            const putDeferred = deferred();
            (api.put as any).mockReturnValue(putDeferred.promise);

            const user = userEvent.setup();
            const { rerender } = renderWithRouter(<XrayConsole />);

            const domainSelect = await screen.findByLabelText('Domain Strategy') as HTMLSelectElement;
            expect(domainSelect.value).toBe('AsIs');

            const refreshEvent = new CustomEvent('nms:page-refresh', { cancelable: true });
            expect(window.dispatchEvent(refreshEvent)).toBe(false);
            expect(refreshEvent.defaultPrevented).toBe(true);

            // Start PUT on s1, then switch to s2 before PUT resolves
            await user.click(screen.getByRole('button', { name: 'Save Changes' }));
            expect(api.put).toHaveBeenCalledWith('/xray/s1/routing', expect.anything(), expect.anything());

            hoisted.serverState = {
                ...hoisted.serverState,
                activeServerId: 's2',
            };
            rerender(<XrayConsole />);

            await waitFor(() => {
                expect((screen.getByLabelText('Domain Strategy') as HTMLSelectElement).value).toBe('IPOnDemand');
            });

            // Stale s1 PUT resolves with AsIs; s2's IPOnDemand must NOT be overwritten
            putDeferred.resolve({
                data: {
                    obj: {
                        source: 'xrayTemplateConfig',
                        snapshot: { routing: { domainStrategy: 'AsIs', rules: [] } },
                        template: { log: { loglevel: 'warning' } },
                    },
                },
            });

            await waitFor(() => {
                expect((screen.getByLabelText('Domain Strategy') as HTMLSelectElement).value).toBe('IPOnDemand');
            });
        });

        it('RoutingRulesEditor omits empty domain/ip arrays on addRule and strips empty arrays on save', async () => {
            const user = userEvent.setup();
            const onSave = vi.fn();
            renderWithRouter(
                <RoutingRulesEditor
                    locale="en-US"
                    value={{
                        domainStrategy: 'AsIs',
                        rules: [{ type: 'field', outboundTag: 'proxy', domain: [], ip: ['1.1.1.1'] }],
                    }}
                    onSave={onSave}
                />
            );

            await user.click(screen.getByRole('button', { name: /Add Rule/i }));
            await user.click(screen.getByRole('button', { name: /Save Changes/i }));

            expect(onSave).toHaveBeenCalledWith({
                domainStrategy: 'AsIs',
                rules: [
                    { type: 'field', outboundTag: 'proxy', ip: ['1.1.1.1'] },
                    { type: 'field', outboundTag: 'direct' },
                ],
            });
        });

        it('XrayJsonEditor renders <h3> only when label is non-empty', () => {
            const { container, rerender } = renderWithRouter(
                <XrayJsonEditor locale="en-US" label="" initialValue={{ a: 1 }} />
            );
            expect(container.querySelector('h3')).toBeNull();

            rerender(<XrayJsonEditor locale="en-US" label="   " initialValue={{ a: 1 }} />);
            expect(container.querySelector('h3')).toBeNull();

            rerender(<XrayJsonEditor locale="en-US" label="Log Settings" initialValue={{ a: 1 }} />);
            expect(container.querySelector('h3')?.textContent).toBe('Log Settings');
        });
    });
});
