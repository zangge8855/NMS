import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countryCodeToFlag,
    extractFlagEmoji,
    flagEmojiToCountryCode,
    formatFlaggedLabel,
    inferCountryCodeFromText,
    normalizeCountryCode,
    resolveServerCountryCode,
    resolveServerFlag,
} from '../lib/countryFlag.js';
import { getTag } from '../routes/subscriptions.js';

test('countryFlag normalizes ISO-2 codes and converts to regional indicator flags', () => {
    assert.equal(normalizeCountryCode('jp'), 'JP');
    assert.equal(normalizeCountryCode(' us '), 'US');
    assert.equal(normalizeCountryCode('XX'), '');
    assert.equal(normalizeCountryCode('ZZ'), '');
    assert.equal(normalizeCountryCode('JPN'), '');

    assert.equal(countryCodeToFlag('jp'), '🇯🇵');
    assert.equal(countryCodeToFlag('HK'), '🇭🇰');
    assert.equal(countryCodeToFlag('US'), '🇺🇸');
    assert.equal(countryCodeToFlag('XX'), '');

    assert.equal(extractFlagEmoji('🇯🇵 Tokyo 01'), '🇯🇵');
    assert.equal(extractFlagEmoji('Tokyo 01'), '');
    assert.equal(flagEmojiToCountryCode('🇸🇬 Singapore'), 'SG');
});

test('inferCountryCodeFromText matches CJK, cities, and bounded codes without false positives', () => {
    assert.equal(inferCountryCodeFromText('香港 CN2 节点'), 'HK');
    assert.equal(inferCountryCodeFromText('东京线路 01'), 'JP');
    assert.equal(inferCountryCodeFromText('Frankfurt Edge'), 'DE');
    assert.equal(inferCountryCodeFromText('US-LAX-01'), 'US');
    assert.equal(inferCountryCodeFromText('HK02-VLESS'), 'HK');
    assert.equal(inferCountryCodeFromText('🇸🇬 Edge'), 'SG');
    assert.equal(inferCountryCodeFromText('IN-Mumbai-01'), 'IN');
    assert.equal(inferCountryCodeFromText('MY-KUL-01'), 'MY');

    // Ordinary English infrastructure words must never false-match 2-letter country codes
    assert.equal(inferCountryCodeFromText('Node A'), '');
    assert.equal(inferCountryCodeFromText('dev-cluster-01'), '');
    assert.equal(inferCountryCodeFromText('status-backup-local'), '');
    assert.equal(inferCountryCodeFromText('My VPS in Cloud'), '');
    assert.equal(inferCountryCodeFromText('traffic-relay-01'), '');
});

test('resolveServerFlag and formatFlaggedLabel prioritize explicit countryCode and avoid duplicates', () => {
    assert.equal(resolveServerCountryCode({ name: 'Edge 01', countryCode: 'jp' }), 'JP');
    assert.equal(resolveServerFlag({ name: 'Edge 01', countryCode: 'jp' }), '🇯🇵');
    assert.equal(resolveServerFlag({ name: '新加坡主节点' }), '🇸🇬');
    assert.equal(resolveServerFlag({ name: 'Edge 01', group: '日本集群' }), '🇯🇵');
    assert.equal(resolveServerFlag({ name: 'Edge 01', tags: ['frankfurt'] }), '🇩🇪');
    assert.equal(resolveServerFlag({ name: 'Node A' }), '');

    assert.equal(formatFlaggedLabel('Tokyo-443', '🇯🇵'), '🇯🇵 Tokyo-443');
    assert.equal(formatFlaggedLabel('🇯🇵 Tokyo-443', '🇯🇵'), '🇯🇵 Tokyo-443');
    assert.equal(formatFlaggedLabel('Tokyo-443', ''), 'Tokyo-443');
});

test('subscription getTag appends cloned node label and only prefixes explicit server countryCode', () => {
    // No explicit countryCode -> keep exact existing format (preserves compatibility)
    assert.equal(
        getTag({ name: '香港节点' }, { remark: '香港-IPv4', protocol: 'vless' }),
        '香港-IPv4'
    );

    // Explicit countryCode with inbound remark -> prepends flag emoji
    assert.equal(
        getTag({ name: 'Tokyo 1', countryCode: 'JP' }, { remark: 'VLESS-443', protocol: 'vless' }),
        '🇯🇵 VLESS-443'
    );

    // Explicit countryCode without remark -> falls back to protocol with flag
    assert.equal(
        getTag({ name: 'Tokyo 1', countryCode: 'JP' }, { remark: '', protocol: 'vless' }),
        '🇯🇵 VLESS'
    );

    // Explicit countryCode + cloned extraBinding -> appends nodeLabel
    assert.equal(
        getTag(
            { name: 'Tokyo 1', countryCode: 'JP' },
            { remark: 'VLESS-443', protocol: 'vless' },
            'alice@example.com-ip',
            { nodeLabel: '纯净IP' }
        ),
        '🇯🇵 VLESS-443 - 纯净IP'
    );

    // Already contains a flag emoji -> no duplicate flag
    assert.equal(
        getTag(
            { name: '🇯🇵 Tokyo 1', countryCode: 'JP' },
            { remark: '🇯🇵 东京原生', protocol: 'vless' },
            'alice@example.com-home',
            { nodeLabel: '家宽IP' }
        ),
        '🇯🇵 东京原生 - 家宽IP'
    );
});
