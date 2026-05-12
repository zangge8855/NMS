import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applySectionUpdate,
    buildXrayConfigSnapshot,
    ensureApiRuleFirst,
    extractTemplateConfig,
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
