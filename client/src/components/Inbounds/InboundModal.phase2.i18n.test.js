import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getLocaleMessage } from '../../i18n/messages.js';
import { validateInboundPayload } from './InboundModal.jsx';

const inboundModalPath = join(dirname(fileURLToPath(import.meta.url)), 'InboundModal.jsx');
const settingsPath = join(dirname(fileURLToPath(import.meta.url)), '../System/SystemSettings.jsx');
const inboundSource = readFileSync(inboundModalPath, 'utf8');
const settingsSource = readFileSync(settingsPath, 'utf8');

const INBOUND_VALIDATION_KEYS = [
  'comp.inbounds.validationPortRange',
  'comp.inbounds.validationWsPathRequired',
  'comp.inbounds.validationGrpcServiceRequired',
  'comp.inbounds.validationTlsSniRequired',
  'comp.inbounds.validationRealityDestSni',
  'comp.inbounds.validationRealityFpSpx',
  'comp.inbounds.labelRemark',
  'comp.inbounds.labelProtocol',
  'comp.inbounds.labelPort',
  'comp.inbounds.modalEditTitle',
  'comp.inbounds.modalBatchAddTitle',
];

const SETTINGS_KEYS = [
  'pages.settings.durationDays',
  'pages.settings.backfillPartial',
  'pages.settings.inviteBatchSummary',
  'pages.settings.inviteLedgerNote',
  'pages.settings.noticeMailHint',
  'pages.settings.restoreConfirmLabel',
  'pages.settings.telegramTokenHint',
  'pages.settings.jsonAnomalyCount',
];

describe('phase2 InboundModal + Settings i18n', () => {
  it('InboundModal uses validation/label message keys', () => {
    for (const key of INBOUND_VALIDATION_KEYS) {
      expect(inboundSource).toMatch(key.replace('comp.inbounds.', ''));
    }
    expect(inboundSource).toMatch(/validateInboundPayload\([^)]*,\s*t\)/);
    expect(inboundSource).not.toMatch(/端口必须在 1-65535/);
    expect(inboundSource).not.toMatch(/编辑入站/);
  });

  it('resolves inbound validation keys to English without CJK', () => {
    const cjk = /[\u4e00-\u9fff]/;
    for (const key of INBOUND_VALIDATION_KEYS) {
      const en = getLocaleMessage('en-US', key, { protocol: 'VLESS', network: 'ws', security: 'tls', days: 3 });
      const zh = getLocaleMessage('zh-CN', key, { protocol: 'VLESS', network: 'ws', security: 'tls', days: 3 });
      expect(en, key).toBeTruthy();
      expect(en, key).not.toMatch(cjk);
      expect(zh, key).toMatch(cjk);
    }
  });

  it('SystemSettings high-traffic ternaries moved to t()', () => {
    expect(settingsSource).toMatch(/pages\.settings\.inviteBatchSummary/);
    expect(settingsSource).toMatch(/pages\.settings\.restoreConfirmLabel/);
    expect(settingsSource).toMatch(/pages\.settings\.noticeMailHint/);
    // no remaining locale === en-US user-facing ternary for restore confirm
    expect(settingsSource).not.toMatch(/I confirm that this restore will overwrite/);
    expect(settingsSource).not.toMatch(/我已确认本次恢复会覆盖/);
    const ternaryCount = (settingsSource.match(/locale\s*===\s*['"]en-US['"]/g) || []).length;
    expect(ternaryCount).toBe(0);
  });

  it('resolves settings keys to English without CJK', () => {
    const cjk = /[\u4e00-\u9fff]/;
    for (const key of SETTINGS_KEYS) {
      const en = getLocaleMessage('en-US', key, {
        days: 7, ok: 1, total: 2, count: 3, uses: 1, duration: '7 day(s)',
        active: 1, remaining: 2, depleted: 0, revoked: 0, used: 4, preview: 'abc',
      });
      expect(en, key).toBeTruthy();
      expect(en, key).not.toMatch(cjk);
    }
  });

  it('validateInboundPayload returns English messages via getLocaleMessage', () => {
    const t = (key, params = {}) => getLocaleMessage('en-US', key, params);
    const cjk = /[\u4e00-\u9fff]/;
    const badPort = validateInboundPayload('vless', 0, { network: 'tcp', security: 'none' }, null, t);
    expect(badPort.ok).toBe(false);
    expect(badPort.msg).not.toMatch(cjk);
    expect(badPort.msg).toMatch(/Port must be between/i);

    const badWs = validateInboundPayload(
      'vless',
      443,
      { network: 'ws', security: 'none', wsSettings: { path: '' } },
      { supports: { transports: ['tcp', 'ws'], securities: ['none', 'tls'] } },
      t,
    );
    expect(badWs.ok).toBe(false);
    expect(badWs.msg).toMatch(/WS transport requires Path/i);
    expect(badWs.msg).not.toMatch(cjk);

    const ok = validateInboundPayload(
      'vless',
      443,
      { network: 'tcp', security: 'none' },
      { supports: { transports: ['tcp'], securities: ['none'] } },
      t,
    );
    expect(ok.ok).toBe(true);
  });
});
