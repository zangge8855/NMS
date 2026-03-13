import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, '.invite_code_store_test_data');

function cleanTestData() {
    if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
}

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = 'test';

describe('InviteCodeStore', { concurrency: false }, () => {
    let InviteCodeStore;

    before(async () => {
        cleanTestData();
        const module = await import('../store/inviteCodeStore.js');
        InviteCodeStore = module.InviteCodeStore;
    });

    after(() => {
        cleanTestData();
    });

    it('creates, consumes, and revokes invite codes safely', () => {
        const store = new InviteCodeStore();
        const created = store.create({ createdBy: 'admin' });

        assert.match(created.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        assert.equal(created.invite.status, 'active');

        const consumed = store.consume(created.code, {
            usedByUserId: 'user-1',
            usedByUsername: 'alice',
        });
        assert.equal(consumed.status, 'used');
        assert.equal(consumed.usedByUsername, 'alice');

        assert.throws(() => store.revoke(created.invite.id), /不能撤销/);

        const second = store.create({ createdBy: 'admin' });
        const revoked = store.revoke(second.invite.id, { revokedBy: 'admin' });
        assert.equal(revoked.status, 'revoked');
    });
});
