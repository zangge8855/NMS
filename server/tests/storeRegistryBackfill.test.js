import test from 'node:test';
import assert from 'node:assert/strict';
import {
    listSnapshotPrivacyRedactionStoreKeys,
    shouldApplySnapshotPrivacyRedaction,
} from '../db/snapshots.js';
import { buildStoreSnapshotComparison } from '../store/storeRegistry.js';

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
