import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAppBootstrapPayload } from '../lib/appBootstrapService.js';

describe('app bootstrap service', () => {
    it('returns a minimal payload for non-admin users', async () => {
        const payload = await buildAppBootstrapPayload({
            role: 'user',
            userId: 'user-1',
        });

        assert.equal(typeof payload.issuedAt, 'string');
        assert.equal(Object.prototype.hasOwnProperty.call(payload, 'serverContext'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload, 'dashboard'), false);
    });

    it('returns cached admin summaries for admin users', async () => {
        const payload = await buildAppBootstrapPayload({
            role: 'admin',
            userId: 'admin-1',
        });

        assert.equal(typeof payload.issuedAt, 'string');
        assert.ok(payload.serverContext);
        assert.ok(Array.isArray(payload.serverContext.servers));
        assert.equal(payload.serverContext.activeServerId, 'global');
        assert.ok(payload.notifications);
        assert.equal(typeof payload.notifications.unreadCount, 'number');
        assert.ok(Array.isArray(payload.managedUsers));
        assert.ok(payload.telemetryOverview);
        assert.ok(Array.isArray(payload.telemetryOverview.items));
        assert.ok(payload.dashboard);
        assert.equal(typeof payload.dashboard.globalPresenceReady, 'boolean');
        assert.ok(payload.audit);
        assert.ok(payload.audit.events);
        assert.ok(payload.audit.traffic);
        assert.ok(payload.audit.access);
        assert.ok(Array.isArray(payload.audit.events.eventsData.items));
        assert.equal(typeof payload.audit.access.accessSummary.total, 'number');
        assert.ok(payload.systemSettings);
        assert.ok(payload.tasks);
        assert.ok(Array.isArray(payload.systemSettings.inviteCodes));
        assert.ok(Array.isArray(payload.tasks.tasks));
    });
});
