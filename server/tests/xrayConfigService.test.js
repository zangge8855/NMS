import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applySectionUpdate,
    buildXrayConfigSnapshot,
    ensureApiRuleFirst,
    extractTemplateConfig,
    fetchPanelSettings,
    persistTemplate,
} from '../services/xrayConfigService.js';

describe('xrayConfigService.extractTemplateConfig', () => {
    it('extracts xrayTemplateConfig from a panel /setting/all response', () => {
        const payload = {
            obj: {
                xrayTemplateConfig: JSON.stringify({
                    routing: { rules: [{ inboundTag: 'api', outboundTag: 'api' }] },
                    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
                }),
                webPort: 2053,
            },
        };
        const result = extractTemplateConfig(payload);
        assert.equal(result.source, 'xrayTemplateConfig');
        assert.ok(result.template);
        assert.deepEqual(result.template.outbounds[0].tag, 'direct');
        assert.equal(result.rawSettings.webPort, 2053);
    });

    it('extracts a wrapped xrayConfig payload', () => {
        const payload = {
            obj: {
                xrayConfig: { outbounds: [{ tag: 'block', protocol: 'blackhole' }] },
            },
        };
        const result = extractTemplateConfig(payload);
        assert.equal(result.source, 'xrayConfig');
        assert.equal(result.template.outbounds[0].tag, 'block');
    });

    it('extracts v3.3.0 xraySetting from a string obj payload', () => {
        const payload = {
            success: true,
            obj: JSON.stringify({
                xraySetting: {
                    routing: { rules: [] },
                    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
                },
                outboundTestUrl: 'https://www.google.com/generate_204',
            }),
        };
        const result = extractTemplateConfig(payload);
        assert.equal(result.source, 'xraySetting');
        assert.equal(result.template.outbounds[0].tag, 'direct');
        assert.equal(result.rawSettings.outboundTestUrl, 'https://www.google.com/generate_204');
    });

    it('recognizes inline templates without an envelope', () => {
        const payload = { outbounds: [{ tag: 'direct' }], routing: { rules: [] } };
        const result = extractTemplateConfig(payload);
        assert.equal(result.source, 'inline');
        assert.equal(result.template.outbounds[0].tag, 'direct');
        assert.equal(result.rawSettings, null);
    });

    it('returns null template for unknown payloads', () => {
        const result = extractTemplateConfig({ obj: { webPort: 2053 } });
        assert.equal(result.template, null);
    });
});

describe('xrayConfigService panel route compatibility', () => {
    it('reads v3.3.0 xray settings from /panel/api/xray/ before legacy settings paths', async () => {
        const calls = [];
        const client = async (request) => {
            calls.push(request.url);
            assert.equal(request.method, 'post');
            assert.equal(request.url, '/panel/api/xray/');
            return {
                data: {
                    success: true,
                    obj: JSON.stringify({ xraySetting: { outbounds: [{ tag: 'direct' }] } }),
                },
            };
        };

        const payload = await fetchPanelSettings(client);
        assert.deepEqual(calls, ['/panel/api/xray/']);
        assert.equal(extractTemplateConfig(payload).source, 'xraySetting');
    });

    it('falls back to legacy settings reads only when new v3.3.0 routes are unsupported', async () => {
        const calls = [];
        const client = async (request) => {
            calls.push(request.url);
            if (request.url === '/panel/setting/all') {
                return { data: { success: true, obj: { xrayTemplateConfig: '{"outbounds":[]}' } } };
            }
            const error = new Error('not found');
            error.response = { status: 404, data: { msg: 'not found' } };
            throw error;
        };

        const payload = await fetchPanelSettings(client);
        assert.deepEqual(calls, [
            '/panel/api/xray/',
            '/panel/api/setting/all',
            '/panel/xray/getXrayConfig',
            '/panel/setting/all',
        ]);
        assert.equal(extractTemplateConfig(payload).source, 'xrayTemplateConfig');
    });

    it('persists v3.3.0 xraySetting through /panel/api/xray/update', async () => {
        const calls = [];
        const client = async (request) => {
            calls.push(request);
            return { data: { success: true, obj: { updated: true } } };
        };

        await persistTemplate(client, 'xraySetting', {
            outboundTestUrl: 'https://example.test/generate_204',
        }, { outbounds: [{ tag: 'direct' }] });

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/panel/api/xray/update');
        assert.equal(calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
        const body = new URLSearchParams(calls[0].data);
        assert.equal(JSON.parse(body.get('xraySetting')).outbounds[0].tag, 'direct');
        assert.equal(body.get('outboundTestUrl'), 'https://example.test/generate_204');
    });

    it('falls back to the legacy setting update route for older panels', async () => {
        const calls = [];
        const client = async (request) => {
            calls.push(request.url);
            if (request.url === '/panel/api/setting/update') {
                const error = new Error('not found');
                error.response = { status: 404, data: { msg: 'not found' } };
                throw error;
            }
            return { data: { success: true, obj: { updated: true } } };
        };

        await persistTemplate(client, 'xrayTemplateConfig', {
            webPort: 2053,
            xrayTemplateConfig: '{"outbounds":[]}',
        }, { outbounds: [{ tag: 'proxy' }] });

        assert.deepEqual(calls, ['/panel/api/setting/update', '/panel/setting/update']);
    });
});

describe('xrayConfigService.ensureApiRuleFirst', () => {
    it('moves the api rule to the front when present elsewhere', () => {
        const rules = [
            { inboundTag: ['inbound-1'], outboundTag: 'direct' },
            { inboundTag: ['api'], outboundTag: 'api' },
            { domain: ['geosite:cn'], outboundTag: 'block' },
        ];
        const reordered = ensureApiRuleFirst(rules);
        assert.deepEqual(reordered[0].inboundTag, ['api']);
        assert.equal(reordered.length, 3);
    });

    it('leaves rules unchanged when api rule is already first', () => {
        const rules = [
            { inboundTag: ['api'], outboundTag: 'api' },
            { domain: ['geosite:cn'], outboundTag: 'block' },
        ];
        const reordered = ensureApiRuleFirst(rules);
        assert.deepEqual(reordered, rules);
    });

    it('handles missing or non-array rules', () => {
        assert.deepEqual(ensureApiRuleFirst(undefined), []);
        assert.deepEqual(ensureApiRuleFirst(null), []);
    });
});

describe('xrayConfigService.applySectionUpdate', () => {
    const baseTemplate = () => ({
        routing: {
            rules: [
                { inboundTag: ['api'], outboundTag: 'api' },
                { domain: ['geosite:cn'], outboundTag: 'block' },
            ],
            balancers: [],
        },
        outbounds: [
            { tag: 'direct', protocol: 'freedom' },
            { tag: 'block', protocol: 'blackhole' },
        ],
        dns: { servers: ['1.1.1.1', '8.8.8.8'] },
    });

    it('replaces outbounds wholesale and validates array type', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'outbounds', [
            { tag: 'direct', protocol: 'freedom' },
            { tag: 'warp', protocol: 'wireguard', settings: { secretKey: '***' } },
        ]);
        assert.equal(next.outbounds.length, 2);
        assert.equal(next.outbounds[1].tag, 'warp');

        assert.throws(() => applySectionUpdate(template, 'outbounds', { tag: 'direct' }));
    });

    it('forces the api rule to remain first when routing is updated', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'routing', {
            rules: [
                { domain: ['geosite:cn'], outboundTag: 'block' },
                { inboundTag: ['api'], outboundTag: 'api' },
            ],
            balancers: [],
            domainStrategy: 'IPIfNonMatch',
        });
        assert.deepEqual(next.routing.rules[0].inboundTag, ['api']);
        assert.equal(next.routing.domainStrategy, 'IPIfNonMatch');
    });

    it('merges dns settings rather than replacing them outright', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'dns', {
            servers: ['9.9.9.9'],
            queryStrategy: 'UseIP',
        });
        assert.deepEqual(next.dns.servers, ['9.9.9.9']);
        assert.equal(next.dns.queryStrategy, 'UseIP');
    });

    it('clearing dns by passing null leaves the section unset', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'dns', null);
        assert.equal(next.dns, null);
    });

    it('updates balancers under routing instead of a top-level key', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'balancers', [
            { tag: 'pool-a', selector: ['outbound-a', 'outbound-b'] },
        ]);
        assert.equal(next.routing.balancers.length, 1);
        assert.equal(next.routing.balancers[0].tag, 'pool-a');
    });

    it('rejects unsupported sections', () => {
        const template = baseTemplate();
        assert.throws(() => applySectionUpdate(template, 'inbounds', []));
    });

    it('replaces the whole template config when section is template', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'template', { routing: { rules: [] } });
        assert.deepEqual(next, { routing: { rules: [] } });
    });

    it('updates log configuration', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'log', { access: '/var/log/xray/access.log', loglevel: 'debug' });
        assert.deepEqual(next.log, { access: '/var/log/xray/access.log', loglevel: 'debug' });
    });

    it('updates policy configuration', () => {
        const template = baseTemplate();
        const next = applySectionUpdate(template, 'policy', { levels: { 0: { handshake: 4 } } });
        assert.deepEqual(next.policy, { levels: { 0: { handshake: 4 } } });
    });
});

describe('xrayConfigService.buildXrayConfigSnapshot', () => {
    it('exposes a stable summary including balancers under routing', () => {
        const snapshot = buildXrayConfigSnapshot({
            routing: { rules: [{ outboundTag: 'direct' }], balancers: [{ tag: 'pool' }] },
            outbounds: [{ tag: 'direct' }],
            dns: { servers: ['1.1.1.1'] },
        });
        assert.equal(snapshot.outbounds.length, 1);
        assert.equal(snapshot.balancers.length, 1);
        assert.equal(snapshot.dns.servers[0], '1.1.1.1');
    });

    it('fills empty defaults when sections are absent', () => {
        const snapshot = buildXrayConfigSnapshot({});
        assert.deepEqual(snapshot.outbounds, []);
        assert.deepEqual(snapshot.balancers, []);
        assert.equal(snapshot.dns, null);
    });
});
