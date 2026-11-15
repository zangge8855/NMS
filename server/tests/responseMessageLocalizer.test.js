import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createResponseMessageLocalizer, localizeServerMessage } from '../lib/responseMessageLocalizer.js';
import { pickRequestText } from '../lib/requestLocale.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runLocalizer(headers, body) {
    let sent;
    const res = { json: (payload) => { sent = payload; return res; } };
    createResponseMessageLocalizer()({ headers, query: {} }, res, () => {});
    res.json(body);
    return sent;
}

test('localizeServerMessage translates known store errors for en-US only', () => {
    assert.equal(localizeServerMessage('邀请码无效', 'en-US'), 'Invalid invite code');
    assert.equal(localizeServerMessage('邀请码无效', 'zh-CN'), '邀请码无效');
    assert.equal(localizeServerMessage('用户分组 "ops" 已存在', 'en-US'), 'User group "ops" already exists');
    assert.equal(localizeServerMessage('Already English', 'en-US'), 'Already English');
    assert.equal(localizeServerMessage('完全未知的消息', 'en-US'), '完全未知的消息');
});

test('response localizer rewrites msg for English requests and leaves others untouched', () => {
    const english = runLocalizer({ 'accept-language': 'en-US,en;q=0.9' }, { success: false, msg: '备份文件名无效', extra: 1 });
    assert.deepEqual(english, { success: false, msg: 'Invalid backup file name', extra: 1 });

    const chinese = runLocalizer({ 'accept-language': 'zh-CN' }, { success: false, msg: '备份文件名无效' });
    assert.equal(chinese.msg, '备份文件名无效');

    const list = runLocalizer({ 'accept-language': 'en-US' }, ['邀请码无效']);
    assert.deepEqual(list, ['邀请码无效'], 'non-object bodies pass through');
});

test('pickRequestText follows the request locale', () => {
    assert.equal(pickRequestText({ headers: { 'accept-language': 'en-US' }, query: {} }, '中文', 'English'), 'English');
    assert.equal(pickRequestText({ headers: {}, query: {} }, '中文', 'English'), '中文');
});

test('every thrown Chinese Error message in stores/libs has an English translation', () => {
    const files = [
        'lib/systemBackup.ts',
        'lib/securityBootstrap.ts',
        'store/inviteCodeStore.ts',
        'store/userGroupStore.ts',
        'services/registeredUserNoticeService.ts',
        'lib/mailer.ts',
        'lib/telegramAlertService.ts',
        'store/userPolicyStore.ts',
    ];
    const missing = [];
    for (const rel of files) {
        const source = fs.readFileSync(path.join(serverRoot, rel), 'utf8');
        for (const match of source.matchAll(/new Error\(\s*(['`])([^'`]*[一-鿿][^'`]*)\1/g)) {
            // Fill template placeholders with a sample value before translating.
            const sample = match[2].replace(/\$\{[^}]+\}/g, 'sample');
            if (localizeServerMessage(sample, 'en-US') === sample) missing.push(`${rel}: ${match[2]}`);
        }
    }
    assert.deepEqual(missing, []);
});
