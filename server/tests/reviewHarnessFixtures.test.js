import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    REVIEW_CREDENTIALS,
    REVIEW_PANEL_PORTS,
    REVIEW_SCENARIOS,
    REVIEW_SERVER_IDS,
    buildReviewHarnessSnapshot,
    buildReviewPanelDefinitions,
} from '../scripts/reviewHarnessFixtures.js';

describe('review harness fixtures', () => {
    it('exposes the supported scenarios', () => {
        assert.deepEqual(REVIEW_SCENARIOS, ['empty', 'review', 'edge']);
    });

    it('builds deterministic fake panel definitions', () => {
        const defs = buildReviewPanelDefinitions({
            host: '127.0.0.1',
            ports: {
                healthy: REVIEW_PANEL_PORTS.healthy,
                legacy: REVIEW_PANEL_PORTS.legacy,
                down: REVIEW_PANEL_PORTS.down,
            },
        });

        assert.equal(defs.length, 2);
        assert.equal(defs[0].key, 'healthy');
        assert.equal(defs[0].url, `http://127.0.0.1:${REVIEW_PANEL_PORTS.healthy}`);
        assert.equal(defs[0].credentials.username, REVIEW_CREDENTIALS.panels.healthy.username);
        assert.equal(defs[1].key, 'legacy');
        assert.equal(defs[1].url, `http://127.0.0.1:${REVIEW_PANEL_PORTS.legacy}`);
    });

    it('builds the review snapshot with mixed servers and seeded data', () => {
        const snapshot = buildReviewHarnessSnapshot({
            scenario: 'review',
            jwtSecret: 'review-test-secret',
            apiBaseUrl: 'http://127.0.0.1:3101',
        });

        const users = snapshot.files['users.json'];
        const servers = snapshot.files['servers.json'];
        const tokens = snapshot.files['subscription_tokens.json'];
        const policies = snapshot.files['user_policies.json'];

        assert.equal(users.length, 4);
        assert.equal(servers.length, 4);
        assert.equal(tokens.length, 3);
        assert.ok(Object.keys(policies).includes(REVIEW_CREDENTIALS.user.subscriptionEmail));
        assert.deepEqual(snapshot.summary.serverIds, [
            REVIEW_SERVER_IDS.healthy,
            REVIEW_SERVER_IDS.legacy,
            REVIEW_SERVER_IDS.authFail,
            REVIEW_SERVER_IDS.down,
        ]);
        assert.equal(snapshot.summary.adminLogin.username, REVIEW_CREDENTIALS.admin.username);
    });

    it('builds the empty snapshot without seeded servers or tokens', () => {
        const snapshot = buildReviewHarnessSnapshot({
            scenario: 'empty',
            jwtSecret: 'review-test-secret',
        });

        assert.equal(snapshot.files['users.json'].length, 1);
        assert.equal(snapshot.files['servers.json'].length, 0);
        assert.equal(snapshot.files['subscription_tokens.json'].length, 0);
        assert.deepEqual(snapshot.summary.serverIds, []);
    });
});
