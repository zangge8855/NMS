import {
    buildClientDirectoryUrl,
    buildClientLookupUrl,
    isClientLookupNotFound,
    normalizeDirectoryClient,
    normalizeLookupClientsResponse,
    normalizePagedClientsResponse,
} from './ClientDirectoryPanel';
import { describeDevice } from './ClientHwidSection';
import { buildOutboundSubForm, describeSubscriptionSource } from './OutboundSubsPanel';
import { buildNodeRequest } from './PanelNodesPanel';
import { buildBalancerForm, memberShares } from './SubBalancersPanel';
import { buildHostPayload } from './SubscriptionHostsPanel';
import { splitList, toMillis, toPanelForm } from './panelRequest';

const NODE_DRAFT = {
    name: ' fra-1 ',
    remark: '',
    scheme: 'https',
    address: ' node.example.com ',
    port: '2053',
    basePath: '/panel',
    apiToken: '',
    clearApiToken: false,
    enable: true,
    allowPrivateAddress: false,
    tlsVerifyMode: 'verify',
    pinnedCertSha256: 'abc',
    inboundSyncMode: 'all',
    inboundTags: ['in-1'],
    outboundTag: '',
};

describe('panel feature helpers', () => {
    it('normalises second and millisecond timestamps', () => {
        expect(toMillis(1_760_000_000)).toBe(1_760_000_000_000);
        expect(toMillis(1_760_000_000_000)).toBe(1_760_000_000_000);
        expect(toMillis(0)).toBe(0);
        expect(toMillis('nope')).toBe(0);
    });

    it('splits free text into unique entries', () => {
        expect(splitList('a@x.com, b@x.com\nb@x.com；c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    });

    it('encodes arrays as repeated form keys', () => {
        expect(toPanelForm({ inboundIds: [1, 2], remark: 'r', skip: undefined }).toString()).toBe('inboundIds=1&inboundIds=2&remark=r');
    });

    it('builds balancer form fields and only sends weights for leastLoad', () => {
        const draft = { remark: ' lb ', strategy: 'leastLoad', inboundIds: [1, 2, 3], weights: { 1: '2', 3: '' }, sortOrder: '4', enabled: false };
        expect(buildBalancerForm(draft)).toEqual({
            remark: 'lb',
            strategy: 'leastLoad',
            inboundIds: [1, 2, 3],
            enabled: 'false',
            sortOrder: 4,
            memberWeights: '{"1":2}',
        });
        const random = buildBalancerForm({ ...draft, strategy: 'random', sortOrder: '' });
        expect(random).not.toHaveProperty('memberWeights');
        expect(random).not.toHaveProperty('sortOrder');
    });

    it('scales member shares so the favoured inbound has the longest bar', () => {
        const shares = memberShares({ inboundIds: [1, 2, 3], memberWeights: { 1: 1, 2: 2, 3: 0 } });
        expect(shares.map((m) => m.weight)).toEqual([1, 2, 1]);
        expect(shares.map((m) => m.share)).toEqual([1, 0.5, 1]);
        expect(memberShares({ inboundIds: [] })).toEqual([]);
    });

    it('always sends every outbound subscription field', () => {
        const draft = {
            remark: ' hk ',
            url: ' https://sub.example.com/s ',
            tagPrefix: 'hk-',
            userAgent: '',
            intervalMinutes: '15',
            enabled: true,
            prepend: false,
            allowPrivate: false,
            allowInsecure: true,
        };
        expect(buildOutboundSubForm(draft)).toEqual({
            remark: 'hk',
            url: 'https://sub.example.com/s',
            tagPrefix: 'hk-',
            userAgent: '',
            updateInterval: 900,
            enabled: 'true',
            prepend: 'false',
            allowPrivate: 'false',
            allowInsecure: 'true',
        });
        expect(buildOutboundSubForm({ ...draft, intervalMinutes: '' }).updateInterval).toBe(600);
    });

    it('describes a subscription by host so the token stays off screen', () => {
        expect(describeSubscriptionSource('https://sub.example.com/api/v1?token=secret')).toBe('sub.example.com');
        expect(describeSubscriptionSource('not a url but quite long enough to be cut')).toBe('not a url but quite long enough …');
    });

    it('sends the node API token only when typed', () => {
        const body = buildNodeRequest(NODE_DRAFT);
        expect(body).toMatchObject({ name: 'fra-1', address: 'node.example.com', port: 2053, tlsVerifyMode: 'verify', pinnedCertSha256: '', inboundTags: [] });
        expect(body).not.toHaveProperty('apiToken');
        expect(body).not.toHaveProperty('clearApiToken');
        expect(body).not.toHaveProperty('id');

        expect(buildNodeRequest({ ...NODE_DRAFT, apiToken: ' t0k ' }).apiToken).toBe('t0k');
        expect(buildNodeRequest({ ...NODE_DRAFT, clearApiToken: true })).not.toHaveProperty('clearApiToken');
        expect(buildNodeRequest({ ...NODE_DRAFT, id: 4, clearApiToken: true })).toMatchObject({ id: 4, clearApiToken: true });
    });

    it('applies TLS and inbound sync rules to the node request', () => {
        expect(buildNodeRequest({ ...NODE_DRAFT, tlsVerifyMode: 'pin', pinnedCertSha256: ' AA:BB ' }).pinnedCertSha256).toBe('AA:BB');
        expect(buildNodeRequest({ ...NODE_DRAFT, scheme: 'http', tlsVerifyMode: 'skip' }).tlsVerifyMode).toBe('verify');
        expect(buildNodeRequest({ ...NODE_DRAFT, inboundSyncMode: 'selected' }).inboundTags).toEqual(['in-1']);
    });

    it('keeps host fields the form does not edit', () => {
        const original = { groupId: 'g1', remark: 'old', mux: { enabled: true }, sortOrder: 2 };
        const payload = buildHostPayload({
            remark: ' cdn ',
            serverDescription: '',
            inboundIds: [3],
            hosts: 'a.example.com\nb.example.com',
            port: '70000',
            enabled: false,
            isHidden: true,
            security: 'tls',
            sni: ' sni.example.com ',
            hostHeader: '',
            path: '/ws',
            alpn: 'h2, http/1.1',
            fingerprint: 'chrome',
            allowInsecure: false,
            tags: 'CDN, EU',
        }, original);
        expect(payload).toMatchObject({
            groupId: 'g1',
            mux: { enabled: true },
            sortOrder: 2,
            remark: 'cdn',
            hosts: ['a.example.com', 'b.example.com'],
            port: 0,
            isDisabled: true,
            isHidden: true,
            sni: 'sni.example.com',
            alpn: ['h2', 'http/1.1'],
            tags: ['CDN', 'EU'],
        });
    });

    it('names a device by model, then OS, then a fallback', () => {
        expect(describeDevice({ id: 1, deviceModel: 'Pixel 9', deviceOs: 'Android', osVersion: '16' }, 'Unknown')).toEqual({ name: 'Pixel 9', detail: 'Android 16' });
        expect(describeDevice({ id: 2, deviceOs: 'iOS', osVersion: '19.1' }, 'Unknown')).toEqual({ name: 'iOS 19.1', detail: '' });
        expect(describeDevice({ id: 3 }, 'Unknown')).toEqual({ name: 'Unknown', detail: '' });
    });

    it('builds paged directory and exact lookup URLs cleanly', () => {
        expect(buildClientDirectoryUrl('s/1', { page: 2, pageSize: 50, search: ' alice ', inboundId: '3', group: ' vip ', status: 'enabled' }))
            .toBe('/panel/s%2F1/panel/api/clients/list/paged?page=2&pageSize=50&search=alice&inboundId=3&group=vip&status=enabled');
        expect(buildClientDirectoryUrl('s1', { page: 0, pageSize: -5, search: '   ', inboundId: '', group: '', status: '' }))
            .toBe('/panel/s1/panel/api/clients/list/paged?page=1&pageSize=20');
        expect(buildClientLookupUrl('s1', 'subId', ' sub/1 ')).toBe('/panel/s1/panel/api/clients/get/subId/sub%2F1');
        expect(buildClientLookupUrl('s1', 'tgId', ' 12345 ')).toBe('/panel/s1/panel/api/clients/get/tgId/12345');
    });

    it('normalizes paged client directory container variants and direct arrays', () => {
        const inboundMap = new Map([[1, { id: 1, remark: 'hk-reality', protocol: 'vless', port: 443 }]]);
        const sample = { email: 'alice@example.com', inboundId: 1, group: 'vip', enable: true, up: 1024, down: 2048, totalGB: 10240, expiryTime: 0, subId: 'sub-a', tgId: 9988 };

        expect(normalizePagedClientsResponse({ items: [sample], total: 45, page: 2, pageSize: 20 }, 1, 20, inboundMap)).toMatchObject({
            total: 45,
            page: 2,
            pageSize: 20,
            totalPages: 3,
        });
        expect(normalizePagedClientsResponse({ clients: [sample], total: 1 }, 1, 20, inboundMap).items[0]).toMatchObject({
            email: 'alice@example.com',
            inboundLabels: ['hk-reality (vless:443)'],
            protocol: 'vless',
            group: 'vip',
            enable: true,
            trafficUsed: 3072,
            totalGB: 10240,
            subId: 'sub-a',
            tgId: '9988',
        });
        expect(normalizePagedClientsResponse({ records: [sample] }, 1, 10).items).toHaveLength(1);
        expect(normalizePagedClientsResponse({ list: [sample] }, 1, 10).items).toHaveLength(1);

        const direct = normalizePagedClientsResponse([sample], 3, 15, inboundMap);
        expect(direct.total).toBe(1);
        expect(direct.page).toBe(3);
        expect(direct.pageSize).toBe(15);
        expect(direct.totalPages).toBe(1);
    });

    it('normalizes exact lookup payloads and distinguishes not-found from unsupported errors', () => {
        const inboundMap = new Map([[2, { id: 2, remark: 'jp-ws', protocol: 'vmess', port: 8443 }]]);
        const wrapped = normalizeLookupClientsResponse({
            client: { email: 'bob@example.com', enable: 'false', totalGB: 0, expiryTime: -604800000, subID: 'sub-b', tgId: 0 },
            inboundIds: [2],
            up: 500,
            down: 500,
        }, inboundMap);
        expect(wrapped).toHaveLength(1);
        expect(wrapped[0]).toMatchObject({
            email: 'bob@example.com',
            inboundLabels: ['jp-ws (vmess:8443)'],
            protocol: 'vmess',
            enable: false,
            trafficUsed: 1000,
            expiryTime: -604800000,
            subId: 'sub-b',
            tgId: '',
        });

        expect(normalizeLookupClientsResponse([{ email: 'c@x.com' }, { email: 'd@x.com' }])).toHaveLength(2);
        expect(normalizeLookupClientsResponse(null)).toEqual([]);
        expect(normalizeDirectoryClient({ email: 'z@x.com', trafficUsed: 256 }).trafficUsed).toBe(256);

        expect(isClientLookupNotFound({ response: { status: 200, data: { success: false, msg: 'client not found' } } })).toBe(true);
        expect(isClientLookupNotFound({ response: { status: 404, data: { success: false, msg: 'client not found' } } })).toBe(true);
        expect(isClientLookupNotFound({ response: { status: 404 } })).toBe(false);
        expect(isClientLookupNotFound({ response: { status: 405 } })).toBe(false);
    });
});
