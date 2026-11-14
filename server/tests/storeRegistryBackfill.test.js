import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-store-registry-test-'));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = 'test';

const {
    isSnapshotQueuePaused,
    listSnapshotPrivacyRedactionStoreKeys,
    pauseSnapshotQueue,
    resumeSnapshotQueue,
    shouldApplySnapshotPrivacyRedaction,
} = await import('../db/snapshots.js');
const { buildStoreSnapshotComparison, restoreStoreSnapshots } = await import('../store/storeRegistry.js');
const userStore = (await import('../store/userStore.js')).default;
const userPolicyStore = (await import('../store/userPolicyStore.js')).default;

test.after(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test('snapshot privacy redaction only applies to explicitly supported stores', () => {
    assert.deepEqual(listSnapshotPrivacyRedactionStoreKeys(), ['traffic']);
    assert.equal(shouldApplySnapshotPrivacyRedaction('traffic', { redact: true }), true);
    assert.equal(shouldApplySnapshotPrivacyRedaction('audit', { redact: true }), false);
    assert.equal(shouldApplySnapshotPrivacyRedaction('audit', { redact: false }), false);
});

test('buildStoreSnapshotComparison reports matches, mismatches, and redacted skips', () => {
    const match = buildStoreSnapshotComparison('users', { users: [{ id: 1 }] }, { users: [{ id: 1 }] });
    assert.equal(match.ok, true);
    assert.equal(match.status, 'match');
    assert.equal(match.fileHash, match.dbHash);

    const mismatch = buildStoreSnapshotComparison('users', { users: [] }, { users: [{ id: 1 }] });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.status, 'mismatch');

    const redacted = buildStoreSnapshotComparison('traffic', { samples: [{ email: 'a@example.com' }] }, { samples: [{ email: 'masked' }] }, { redact: true });
    assert.equal(redacted.ok, true);
    assert.equal(redacted.status, 'comparison-skipped-redacted');
});

test('snapshot queue pause toggles cleanly and restoreStoreSnapshots rolls back mutated stores on partial failure', async () => {
    assert.equal(isSnapshotQueuePaused(), false);
    pauseSnapshotQueue();
    assert.equal(isSnapshotQueuePaused(), true);
    resumeSnapshotQueue();
    assert.equal(isSnapshotQueuePaused(), false);

    const origUsers = userStore.exportState();
    const origPolicies = userPolicyStore.exportState();
    const modifiedUsers = {
        ...origUsers,
        users: [
            ...(Array.isArray(origUsers?.users) ? origUsers.users : []),
            {
                id: 'temp-rollback-user',
                username: 'temp_rollback_user',
                passwordHash: 'x',
                role: 'user',
                enabled: true,
                subscriptionEmail: 'rollback@example.com',
                emailVerified: true,
                createdAt: new Date().toISOString(),
            },
        ],
    };
    try {
        const result = await restoreStoreSnapshots({
            users: modifiedUsers,
            user_policies: { invalidShape: true },
        }, {
            keys: ['users', 'user_policies'],
        });

        assert.equal(result.rolledBack, true);
        assert.equal(result.restored, 0);
        assert.equal(result.failed, 2);
        assert.deepEqual(userStore.exportState(), origUsers);
        assert.deepEqual(userPolicyStore.exportState(), origPolicies);
    } finally {
        userStore.importState(origUsers);
        userPolicyStore.importState(origPolicies);
    }
});
