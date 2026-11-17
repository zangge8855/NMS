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
});
