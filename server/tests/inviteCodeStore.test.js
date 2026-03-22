import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, '.invite_code_store_test_data');
const BOOTSTRAP_DATA_DIR = path.join(TEST_DATA_DIR, '__bootstrap__');
const TEST_CASES_DIR = path.join(TEST_DATA_DIR, 'cases');

function cleanTestData(target = TEST_DATA_DIR) {
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
    }
}

process.env.NODE_ENV = 'test';

describe('InviteCodeStore', { concurrency: false }, () => {
    let InviteCodeStore;

    function getCaseDataDir(name) {
        return path.join(TEST_CASES_DIR, name);
    }

    function createStore(name) {
        return new InviteCodeStore({ dataDir: getCaseDataDir(name) });
    }

    before(async () => {
        cleanTestData();
        const previousDataDir = process.env.DATA_DIR;
        process.env.DATA_DIR = BOOTSTRAP_DATA_DIR;
        try {
            const module = await import('../store/inviteCodeStore.js');
            InviteCodeStore = module.InviteCodeStore;
        } finally {
            if (previousDataDir === undefined) {
                delete process.env.DATA_DIR;
            } else {
                process.env.DATA_DIR = previousDataDir;
            }
        }
    });

    after(() => {
        cleanTestData();
    });

    beforeEach(() => {
        cleanTestData(TEST_CASES_DIR);
    });

    it('creates single-use invite codes compatibly with the existing flow', () => {
        const store = createStore('single-use');
        const created = store.create({ createdBy: 'admin' });

        assert.match(created.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        assert.equal(created.invite.status, 'active');
        assert.equal(created.invite.usageLimit, 1);
        assert.equal(created.invite.subscriptionDays, 0);
        assert.equal(created.invite.usedCount, 0);

        const consumed = store.consume(created.code, {
            usedByUserId: 'user-1',
            usedByUsername: 'alice',
        });
        assert.equal(consumed.status, 'used');
        assert.equal(consumed.usedCount, 1);
        assert.equal(consumed.usedByUsername, 'alice');

        assert.throws(() => store.revoke(created.invite.id), /不能撤销/);
    });

    it('supports multi-use batch invite generation without breaking old records', () => {
        const store = createStore('multi-use');
        const created = store.create({
            createdBy: 'admin',
            count: 2,
            usageLimit: 3,
            subscriptionDays: 90,
        });

        assert.equal(created.codes.length, 2);
        assert.equal(created.invites.length, 2);
        assert.equal(created.usageLimit, 3);
        assert.equal(created.subscriptionDays, 90);
        assert.equal(created.invites[0].usageLimit, 3);
        assert.equal(created.invites[0].remainingUses, 3);
        assert.equal(created.invites[0].subscriptionDays, 90);

        const firstCode = created.codes[0];
        const usableAfterOne = store.consume(firstCode, {
            usedByUserId: 'user-1',
            usedByUsername: 'alice',
        });
        assert.equal(usableAfterOne.status, 'active');
        assert.equal(usableAfterOne.usedCount, 1);
        assert.equal(usableAfterOne.remainingUses, 2);

        const secondUse = store.consume(firstCode, {
            usedByUserId: 'user-2',
            usedByUsername: 'bob',
        });
        assert.equal(secondUse.status, 'active');
        assert.equal(secondUse.usedCount, 2);

        const revoked = store.revoke(created.invites[1].id, { revokedBy: 'admin' });
        assert.equal(revoked.status, 'revoked');

        const exhausted = store.consume(firstCode, {
            usedByUserId: 'user-3',
            usedByUsername: 'charlie',
        });
        assert.equal(exhausted.status, 'used');
        assert.equal(exhausted.usedCount, 3);
        assert.equal(exhausted.remainingUses, 0);

        assert.throws(() => store.assertUsable(firstCode), /用完/);
    });

    it('persists a bound target email for email-delivered invites', () => {
        const store = createStore('bound-email');
        const created = store.create({
            createdBy: 'admin',
            targetEmail: ' Invitee@Example.com ',
            subscriptionDays: 45,
        });

        assert.equal(created.invite.targetEmail, 'invitee@example.com');
        assert.equal(store.assertUsable(created.code).targetEmail, 'invitee@example.com');
        assert.equal(store.list()[0].targetEmail, 'invitee@example.com');
    });

    it('hydrates legacy single-use invite records from disk', () => {
        const legacyDataDir = getCaseDataDir('legacy-hydrate');
        const legacyFile = path.join(legacyDataDir, 'invite_codes.json');
        fs.mkdirSync(legacyDataDir, { recursive: true });
        fs.writeFileSync(legacyFile, JSON.stringify([
            {
                id: 'legacy-1',
                codeHash: 'abc123',
                preview: 'ABCD-****-IJKL',
                createdAt: '2026-03-01T00:00:00.000Z',
                usedAt: '2026-03-02T00:00:00.000Z',
                usedByUserId: 'user-9',
                usedByUsername: 'legacy-user',
            },
        ], null, 2));

        const store = createStore('legacy-hydrate');
        const [legacyInvite] = store.list();

        assert.equal(legacyInvite.id, 'legacy-1');
        assert.equal(legacyInvite.usageLimit, 1);
        assert.equal(legacyInvite.subscriptionDays, 0);
        assert.equal(legacyInvite.usedCount, 1);
        assert.equal(legacyInvite.remainingUses, 0);
        assert.equal(legacyInvite.status, 'used');
    });
});
