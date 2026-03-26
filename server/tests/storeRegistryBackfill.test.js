import test from 'node:test';
import assert from 'node:assert/strict';
import {
    listSnapshotPrivacyRedactionStoreKeys,
    shouldApplySnapshotPrivacyRedaction,
} from '../db/snapshots.js';

test('snapshot privacy redaction only applies to explicitly supported stores', () => {
    assert.deepEqual(listSnapshotPrivacyRedactionStoreKeys(), ['traffic']);
    assert.equal(shouldApplySnapshotPrivacyRedaction('traffic', { redact: true }), true);
    assert.equal(shouldApplySnapshotPrivacyRedaction('audit', { redact: true }), false);
    assert.equal(shouldApplySnapshotPrivacyRedaction('audit', { redact: false }), false);
});
