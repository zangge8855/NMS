import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildConfirmKeyboard,
    buildHighRiskKeyboard,
    buildPaginationKeyboard,
    buildMenuKeyboard,
    parseCallbackData,
    __testing,
} from '../../lib/telegram/inlineKeyboards.js';

test('buildConfirmKeyboard produces a two-button row with c:/x: callback data', () => {
    const keyboard = buildConfirmKeyboard({ pendingId: 'abc12345' });
    assert.equal(keyboard.inline_keyboard.length, 1);
    const [confirm, cancel] = keyboard.inline_keyboard[0];
    assert.equal(confirm.callback_data, 'c:abc12345');
    assert.equal(cancel.callback_data, 'x:abc12345');
    assert.ok(confirm.text.includes('确认'));
    assert.ok(cancel.text.includes('取消'));
});

test('buildHighRiskKeyboard surfaces the danger styling but keeps short callback data', () => {
    const keyboard = buildHighRiskKeyboard({ pendingId: 'deadbeef' });
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, 'c:deadbeef');
    assert.ok(/执行/.test(keyboard.inline_keyboard[0][0].text));
});

test('buildPaginationKeyboard hides "prev" on first page and "next" on last page', () => {
    const first = buildPaginationKeyboard({ listKey: 'clients', page: 1, totalPages: 3 });
    assert.equal(first.inline_keyboard.at(-1).find((b) => b.callback_data.startsWith('pg:clients:0')), undefined);
    const labels = first.inline_keyboard.at(-1).map((b) => b.text);
    assert.equal(labels[0], '1 / 3');
    assert.ok(labels[1].includes('下一页'));

    const last = buildPaginationKeyboard({ listKey: 'clients', page: 3, totalPages: 3 });
    const lastLabels = last.inline_keyboard.at(-1).map((b) => b.text);
    assert.ok(lastLabels[0].includes('上一页'));
    assert.equal(lastLabels.at(-1), '3 / 3');
});

test('buildMenuKeyboard chunks items into rows of rowSize', () => {
    const keyboard = buildMenuKeyboard([
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
    ]);
    assert.equal(keyboard.inline_keyboard.length, 2);
    assert.equal(keyboard.inline_keyboard[0].length, 2);
    assert.equal(keyboard.inline_keyboard[1].length, 1);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, 'm:a');
});

test('parseCallbackData decodes confirm / cancel / pg / m', () => {
    assert.deepEqual(parseCallbackData('c:abc'), { kind: 'confirm', id: 'abc' });
    assert.deepEqual(parseCallbackData('x:abc'), { kind: 'cancel', id: 'abc' });
    assert.deepEqual(parseCallbackData('pg:clients:2'), { kind: 'paginate', listKey: 'clients', page: 2 });
    assert.deepEqual(parseCallbackData('m:menu'), { kind: 'menu', key: 'menu' });
    assert.equal(parseCallbackData(''), null);
    assert.deepEqual(parseCallbackData('z:weird'), { kind: 'unknown', raw: 'z:weird' });
});

test('assertCallbackData rejects strings exceeding 64 bytes', () => {
    const long = 'x'.repeat(65);
    assert.throws(() => __testing.assertCallbackData(long), /exceeds 64 bytes/);
    assert.doesNotThrow(() => __testing.assertCallbackData('x'.repeat(64)));
});
