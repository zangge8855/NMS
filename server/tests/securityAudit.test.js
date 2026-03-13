import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import auditStore from '../store/auditStore.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';

test('appendSecurityAudit forwards explicit outcome to audit store', (t) => {
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'appendFileSync', () => {});
    const appendEventMock = t.mock.method(auditStore, 'appendEvent', () => {});

    appendSecurityAudit(
        'invite_code_revoked',
        {
            user: { username: 'admin', role: 'admin' },
            method: 'DELETE',
            originalUrl: '/api/system/invite-codes/invite-1',
            headers: {},
            socket: { remoteAddress: '127.0.0.1' },
        },
        { inviteId: 'invite-1', preview: 'ABCD-****-WXYZ' },
        { outcome: 'success' }
    );

    assert.equal(appendEventMock.mock.calls.length, 1);
    const [payload] = appendEventMock.mock.calls[0].arguments;
    assert.equal(payload.event, 'invite_code_revoked');
    assert.equal(payload.outcome, 'success');
});
