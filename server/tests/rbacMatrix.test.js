import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { invokeApp } from './helpers/invokeApp.js';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-rbac-matrix-'));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = 'test';

const { default: app, createApp } = await import('../index.js');
const { default: config } = await import('../config.js');
const { default: userStore, ROLES } = await import('../store/userStore.js');
const { default: jobStore } = await import('../store/jobStore.js');
const { default: userGroupStore } = await import('../store/userGroupStore.js');
const { default: subscriptionTokenStore } = await import('../store/subscriptionTokenStore.js');
const { default: systemSettingsStore } = await import('../store/systemSettingsStore.js');
const { default: auditStore } = await import('../store/auditStore.js');
const { default: taskQueue } = await import('../lib/taskQueue.js');
const { closeSecurityAuditLog } = await import('../lib/securityAudit.js');

function makeAuthHeader(user) {
    const token = jwt.sign(
        {
            userId: user.id,
            username: user.username,
            role: user.role,
            tokenVersion: user.tokenVersion || 1,
        },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
    return `Bearer ${token}`;
}

function createRoleUsers(prefix) {
    const stamp = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const admin = userStore.getByUsername('admin') || userStore.getAll().find((item) => item.role === ROLES.admin);
    assert.ok(admin, 'default admin user should exist');

    const operator = userStore.add({
        username: `op_${stamp}`,
        email: `op_${stamp}@example.com`,
        password: 'OpMatrix#12345',
        role: ROLES.operator,
        emailVerified: true,
        enabled: true,
    });
    const auditor = userStore.add({
        username: `aud_${stamp}`,
        email: `aud_${stamp}@example.com`,
        password: 'AudMatrix#12345',
        role: ROLES.auditor,
        emailVerified: true,
        enabled: true,
    });
    const regularUser = userStore.add({
        username: `usr_${stamp}`,
        email: `usr_${stamp}@example.com`,
        password: 'UsrMatrix#12345',
        role: ROLES.user,
        emailVerified: true,
        enabled: true,
    });

    return {
        admin,
        operator,
        auditor,
        user: regularUser,
        headers: {
            admin: makeAuthHeader(admin),
            operator: makeAuthHeader(operator),
            auditor: makeAuthHeader(auditor),
            user: makeAuthHeader(regularUser),
        },
    };
}

test.after(async () => {
    await auditStore.flush();
    await closeSecurityAuditLog();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test('4-tier RBAC matrix across batch, jobs, user-policy, user-groups, users, clients, and auth/users', async () => {
    const actors = createRoleUsers('matrix');
    const targetEmail = `target_${Date.now()}@example.com`;
    const targetUser = userStore.add({
        username: `target_${Date.now()}`,
        email: targetEmail,
        password: 'TargetUser#12345',
        role: ROLES.user,
        emailVerified: true,
        enabled: true,
    });

    const seededJob = jobStore.appendBatch({
        type: 'clients',
        action: 'update',
        actor: 'tester',
        output: { summary: { total: 1, success: 1, failed: 0 }, results: [] },
        requestSnapshot: { action: 'update', targets: [] },
    });

    // 1. /api/batch and /api/jobs: reads -> auditorOrAbove; writes -> operatorOrAbove
    for (const role of ['admin', 'operator', 'auditor']) {
        for (const pathUrl of [
            '/api/batch/history',
            `/api/batch/history/${seededJob.id}`,
            '/api/jobs',
            `/api/jobs/${seededJob.id}`,
        ]) {
            const res = await invokeApp(app, {
                method: 'GET',
                url: pathUrl,
                headers: { Authorization: actors.headers[role] },
            });
            assert.equal(res.statusCode, 200, `${role} GET ${pathUrl}`);
        }
    }
    for (const pathUrl of [
        '/api/batch/history',
        `/api/batch/history/${seededJob.id}`,
        '/api/jobs',
        `/api/jobs/${seededJob.id}`,
    ]) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: pathUrl,
            headers: { Authorization: actors.headers.user },
        });
        assert.equal(res.statusCode, 403, `user GET ${pathUrl}`);
    }

    for (const role of ['auditor', 'user']) {
        for (const [method, pathUrl, body] of [
            ['POST', '/api/batch/clients', { action: 'enable', targets: [] }],
            ['POST', '/api/batch/inbounds', { action: 'enable', targets: [] }],
            ['POST', `/api/batch/history/${seededJob.id}/retry`, {}],
            ['POST', `/api/jobs/${seededJob.id}/retry`, {}],
            ['DELETE', '/api/batch/history', undefined],
        ]) {
            const res = await invokeApp(app, {
                method,
                url: pathUrl,
                headers: { Authorization: actors.headers[role] },
                body,
            });
            assert.equal(res.statusCode, 403, `${role} ${method} ${pathUrl}`);
        }
    }
    for (const role of ['operator', 'admin']) {
        for (const [method, pathUrl, body] of [
            ['POST', '/api/batch/clients', { action: 'enable', targets: [] }],
            ['POST', '/api/batch/inbounds', { action: 'enable', targets: [] }],
            ['POST', `/api/batch/history/${seededJob.id}/retry`, {}],
            ['POST', `/api/jobs/${seededJob.id}/retry`, {}],
        ]) {
            const res = await invokeApp(app, {
                method,
                url: pathUrl,
                headers: { Authorization: actors.headers[role] },
                body,
            });
            assert.notEqual(res.statusCode, 403, `${role} ${method} ${pathUrl} should pass RBAC`);
        }
        const clearRes = await invokeApp(app, {
            method: 'DELETE',
            url: '/api/batch/history',
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(clearRes.statusCode, 200, `${role} DELETE /api/batch/history`);
    }

    // 2. /api/user-policy: GET -> auditorOrAbove, PUT -> operatorOrAbove
    for (const role of ['admin', 'operator', 'auditor']) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: `/api/user-policy/${encodeURIComponent(targetEmail)}`,
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(res.statusCode, 200, `${role} GET /api/user-policy/:email`);
    }
    assert.equal(
        (await invokeApp(app, {
            method: 'GET',
            url: `/api/user-policy/${encodeURIComponent(targetEmail)}`,
            headers: { Authorization: actors.headers.user },
        })).statusCode,
        403
    );
    for (const role of ['auditor', 'user']) {
        const res = await invokeApp(app, {
            method: 'PUT',
            url: `/api/user-policy/${encodeURIComponent(targetEmail)}`,
            headers: { Authorization: actors.headers[role] },
            body: { serverScopeMode: 'none', protocolScopeMode: 'none' },
        });
        assert.equal(res.statusCode, 403, `${role} PUT /api/user-policy/:email`);
    }
    for (const role of ['operator', 'admin']) {
        const res = await invokeApp(app, {
            method: 'PUT',
            url: `/api/user-policy/${encodeURIComponent(targetEmail)}`,
            headers: { Authorization: actors.headers[role] },
            body: { serverScopeMode: 'none', protocolScopeMode: 'none' },
        });
        assert.equal(res.statusCode, 200, `${role} PUT /api/user-policy/:email`);
    }

    // 3. /api/user-groups: GET -> auditorOrAbove, POST/PUT/sync/DELETE -> operatorOrAbove
    for (const role of ['admin', 'operator', 'auditor']) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: '/api/user-groups',
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(res.statusCode, 200, `${role} GET /api/user-groups`);
    }
    assert.equal(
        (await invokeApp(app, {
            method: 'GET',
            url: '/api/user-groups',
            headers: { Authorization: actors.headers.user },
        })).statusCode,
        403
    );
    const seedGroup = userGroupStore.add({ name: `seed_grp_${Date.now()}` }, 'tester');
    for (const role of ['auditor', 'user']) {
        for (const [method, pathUrl, body] of [
            ['POST', '/api/user-groups', { name: `denied_grp_${Date.now()}` }],
            ['PUT', `/api/user-groups/${seedGroup.id}`, { name: seedGroup.name }],
            ['POST', `/api/user-groups/${seedGroup.id}/sync`, {}],
            ['DELETE', `/api/user-groups/${seedGroup.id}`, undefined],
        ]) {
            const res = await invokeApp(app, {
                method,
                url: pathUrl,
                headers: { Authorization: actors.headers[role] },
                body,
            });
            assert.equal(res.statusCode, 403, `${role} ${method} ${pathUrl}`);
        }
    }
    for (const role of ['operator', 'admin']) {
        const createRes = await invokeApp(app, {
            method: 'POST',
            url: '/api/user-groups',
            headers: { Authorization: actors.headers[role] },
            body: { name: `grp_${role}_${Date.now()}` },
        });
        assert.equal(createRes.statusCode, 200, `${role} POST /api/user-groups`);
        const createdGroupId = createRes.json?.obj?.group?.id;
        assert.ok(createdGroupId);

        const putRes = await invokeApp(app, {
            method: 'PUT',
            url: `/api/user-groups/${createdGroupId}`,
            headers: { Authorization: actors.headers[role] },
            body: { name: `grp_${role}_upd_${Date.now()}` },
        });
        assert.equal(putRes.statusCode, 200, `${role} PUT /api/user-groups/:id`);

        const syncRes = await invokeApp(app, {
            method: 'POST',
            url: `/api/user-groups/${createdGroupId}/sync`,
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(syncRes.statusCode, 200, `${role} POST /api/user-groups/:id/sync`);

        const delRes = await invokeApp(app, {
            method: 'DELETE',
            url: `/api/user-groups/${createdGroupId}`,
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(delRes.statusCode, 200, `${role} DELETE /api/user-groups/:id`);
    }

    // 4. /api/users: GET /:id/detail, /:id/tokens -> auditorOrAbove; POST/DELETE tokens, POST /guest-pass -> operatorOrAbove
    for (const role of ['admin', 'operator', 'auditor']) {
        for (const pathUrl of [
            `/api/users/${targetUser.id}/detail`,
            `/api/users/${targetUser.id}/tokens`,
        ]) {
            const res = await invokeApp(app, {
                method: 'GET',
                url: pathUrl,
                headers: { Authorization: actors.headers[role] },
            });
            assert.equal(res.statusCode, 200, `${role} GET ${pathUrl}`);
        }
    }
    for (const pathUrl of [
        `/api/users/${targetUser.id}/detail`,
        `/api/users/${targetUser.id}/tokens`,
    ]) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: pathUrl,
            headers: { Authorization: actors.headers.user },
        });
        assert.equal(res.statusCode, 403, `user GET ${pathUrl}`);
    }

    const seedToken = subscriptionTokenStore.issue(targetEmail, { name: 'seed', createdBy: 'tester' });
    for (const role of ['auditor', 'user']) {
        for (const [method, pathUrl, body] of [
            ['POST', `/api/users/${targetUser.id}/tokens`, { name: 'blocked' }],
            ['DELETE', `/api/users/${targetUser.id}/tokens/${seedToken.tokenId}`, undefined],
            ['POST', '/api/users/guest-pass', { durationHours: 1, trafficLimitGb: 1 }],
        ]) {
            const res = await invokeApp(app, {
                method,
                url: pathUrl,
                headers: { Authorization: actors.headers[role] },
                body,
            });
            assert.equal(res.statusCode, 403, `${role} ${method} ${pathUrl}`);
        }
    }
    for (const role of ['operator', 'admin']) {
        const issueRes = await invokeApp(app, {
            method: 'POST',
            url: `/api/users/${targetUser.id}/tokens`,
            headers: { Authorization: actors.headers[role] },
            body: { name: `tok_${role}` },
        });
        assert.equal(issueRes.statusCode, 200, `${role} POST /api/users/:id/tokens`);
        const issuedId = issueRes.json?.obj?.tokenId;
        assert.ok(issuedId);

        const revokeRes = await invokeApp(app, {
            method: 'DELETE',
            url: `/api/users/${targetUser.id}/tokens/${issuedId}`,
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(revokeRes.statusCode, 200, `${role} DELETE /api/users/:id/tokens/:tid`);

        const guestRes = await invokeApp(app, {
            method: 'POST',
            url: '/api/users/guest-pass',
            headers: { Authorization: actors.headers[role] },
            body: { durationHours: 2, trafficLimitGb: 1, note: `guest_${role}` },
        });
        assert.equal(guestRes.statusCode, 200, `${role} POST /api/users/guest-pass`);
    }

    // 5. /api/clients: GET /entitlement-overrides -> auditorOrAbove; PUT /entitlement -> operatorOrAbove
    for (const role of ['admin', 'operator', 'auditor']) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: '/api/clients/entitlement-overrides',
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(res.statusCode, 200, `${role} GET /api/clients/entitlement-overrides`);
    }
    assert.equal(
        (await invokeApp(app, {
            method: 'GET',
            url: '/api/clients/entitlement-overrides',
            headers: { Authorization: actors.headers.user },
        })).statusCode,
        403
    );
    for (const role of ['auditor', 'user']) {
        const res = await invokeApp(app, {
            method: 'PUT',
            url: '/api/clients/entitlement',
            headers: { Authorization: actors.headers[role] },
            body: { serverId: 'missing-srv', inboundId: '1', clientIdentifier: 'c1', mode: 'override' },
        });
        assert.equal(res.statusCode, 403, `${role} PUT /api/clients/entitlement`);
    }
    for (const role of ['operator', 'admin']) {
        const res = await invokeApp(app, {
            method: 'PUT',
            url: '/api/clients/entitlement',
            headers: { Authorization: actors.headers[role] },
            body: { serverId: 'missing-srv', inboundId: '1', clientIdentifier: 'c1', mode: 'override' },
        });
        assert.equal(res.statusCode, 404, `${role} PUT /api/clients/entitlement reaches handler`);
    }

    // 6. /api/auth/users*: GET + export -> auditorOrAbove; user-management writes -> operatorOrAbove (for role === 'user')
    for (const role of ['admin', 'operator', 'auditor']) {
        const listRes = await invokeApp(app, {
            method: 'GET',
            url: '/api/auth/users',
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(listRes.statusCode, 200, `${role} GET /api/auth/users`);

        const exportRes = await invokeApp(app, {
            method: 'GET',
            url: '/api/auth/users/export',
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(exportRes.statusCode, 200, `${role} GET /api/auth/users/export`);
    }
    for (const pathUrl of ['/api/auth/users', '/api/auth/users/export']) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: pathUrl,
            headers: { Authorization: actors.headers.user },
        });
        assert.equal(res.statusCode, 403, `user GET ${pathUrl}`);
    }

    for (const role of ['auditor', 'user']) {
        for (const [method, pathUrl, body] of [
            ['POST', '/api/auth/users', { username: `blk_${role}`, password: 'UserPass#12345', role: 'user' }],
            ['POST', '/api/auth/users/bulk-set-enabled', { userIds: [targetUser.id], enabled: false }],
            ['PUT', `/api/auth/users/${targetUser.id}`, { username: targetUser.username }],
            ['PUT', `/api/auth/users/${targetUser.id}/subscription-binding`, { subscriptionEmail: targetEmail }],
            ['PUT', `/api/auth/users/${targetUser.id}/set-enabled`, { enabled: false }],
            ['PUT', `/api/auth/users/${targetUser.id}/update-expiry`, { expiryTime: Date.now() + 86_400_000 }],
            ['POST', `/api/auth/users/${targetUser.id}/provision-subscription`, { subscriptionEmail: targetEmail }],
            ['PUT', `/api/auth/users/${targetUser.id}/reset-password`, { newPassword: 'ResetUser#12345' }],
            ['DELETE', `/api/auth/users/${targetUser.id}`, undefined],
        ]) {
            const res = await invokeApp(app, {
                method,
                url: pathUrl,
                headers: { Authorization: actors.headers[role] },
                body,
            });
            assert.equal(res.statusCode, 403, `${role} ${method} ${pathUrl}`);
        }
    }

    for (const role of ['operator', 'admin']) {
        const suffix = `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const email = `managed_${suffix}@example.com`;
        const reboundEmail = `rebound_${suffix}@example.com`;

        const createRes = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/users',
            headers: { Authorization: actors.headers[role] },
            body: { username: `managed_${suffix}`, password: 'UserPass#12345', email, role: 'user' },
        });
        assert.equal(createRes.statusCode, 200, `${role} POST /api/auth/users`);
        const createdId = createRes.json?.obj?.id;
        assert.ok(createdId);

        const updateRes = await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${createdId}`,
            headers: { Authorization: actors.headers[role] },
            body: { username: `managed_${suffix}_upd` },
        });
        assert.equal(updateRes.statusCode, 200, `${role} PUT /api/auth/users/:id`);

        const bindingRes = await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${createdId}/subscription-binding`,
            headers: { Authorization: actors.headers[role] },
            body: { subscriptionEmail: reboundEmail },
        });
        assert.equal(bindingRes.statusCode, 200, `${role} PUT /api/auth/users/:id/subscription-binding`);

        const disableRes = await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${createdId}/set-enabled`,
            headers: { Authorization: actors.headers[role] },
            body: { enabled: false },
        });
        assert.equal(disableRes.statusCode, 200, `${role} PUT /api/auth/users/:id/set-enabled`);

        const bulkEnableRes = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/users/bulk-set-enabled',
            headers: { Authorization: actors.headers[role] },
            body: { userIds: [createdId], enabled: true },
        });
        assert.equal(bulkEnableRes.statusCode, 200, `${role} POST /api/auth/users/bulk-set-enabled`);

        const expiryRes = await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${createdId}/update-expiry`,
            headers: { Authorization: actors.headers[role] },
            body: { expiryTime: Date.now() + 86_400_000 },
        });
        assert.equal(expiryRes.statusCode, 200, `${role} PUT /api/auth/users/:id/update-expiry`);

        const provisionRes = await invokeApp(app, {
            method: 'POST',
            url: `/api/auth/users/${createdId}/provision-subscription`,
            headers: { Authorization: actors.headers[role] },
            body: { subscriptionEmail: reboundEmail, allowedServerIds: [] },
        });
        assert.equal(provisionRes.statusCode, 200, `${role} POST /api/auth/users/:id/provision-subscription`);

        const resetPwdRes = await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${createdId}/reset-password`,
            headers: { Authorization: actors.headers[role] },
            body: { newPassword: 'NewUserPass#12345' },
        });
        assert.equal(resetPwdRes.statusCode, 200, `${role} PUT /api/auth/users/:id/reset-password`);

        const deleteRes = await invokeApp(app, {
            method: 'DELETE',
            url: `/api/auth/users/${createdId}`,
            headers: { Authorization: actors.headers[role] },
        });
        assert.equal(deleteRes.statusCode, 200, `${role} DELETE /api/auth/users/:id`);
    }
});

test('critical RBAC security invariants stay enforced', async () => {
    const actors = createRoleUsers('invariants');
    const foreignTask = taskQueue.create({ type: 'batch_action', title: 'Foreign', actor: 'another-op' });
    taskQueue.start(foreignTask.taskId);

    try {
        for (const role of ['operator', 'auditor', 'user']) {
            assert.equal(
                (await invokeApp(app, {
                    method: 'GET',
                    url: '/api/xray/srv-missing/config',
                    headers: { Authorization: actors.headers[role] },
                })).statusCode,
                403,
                `${role} blocked on /api/xray`
            );
            assert.equal(
                (await invokeApp(app, {
                    method: 'GET',
                    url: '/api/system/settings',
                    headers: { Authorization: actors.headers[role] },
                })).statusCode,
                403,
                `${role} blocked on GET /api/system/settings`
            );
            assert.equal(
                (await invokeApp(app, {
                    method: 'PUT',
                    url: '/api/system/settings',
                    headers: { Authorization: actors.headers[role] },
                    body: {},
                })).statusCode,
                403,
                `${role} blocked on PUT /api/system/settings`
            );
            assert.equal(
                (await invokeApp(app, {
                    method: 'DELETE',
                    url: '/api/audit/events',
                    headers: { Authorization: actors.headers[role] },
                })).statusCode,
                403,
                `${role} blocked on DELETE /api/audit/events`
            );
            assert.equal(
                (await invokeApp(app, {
                    method: 'DELETE',
                    url: '/api/audit/subscription-access',
                    headers: { Authorization: actors.headers[role] },
                })).statusCode,
                403,
                `${role} blocked on DELETE /api/audit/subscription-access`
            );
        }

        // Admin reaches admin-only endpoints
        assert.notEqual(
            (await invokeApp(app, {
                method: 'GET',
                url: '/api/xray/srv-missing/config',
                headers: { Authorization: actors.headers.admin },
            })).statusCode,
            403
        );
        assert.equal(
            (await invokeApp(app, {
                method: 'GET',
                url: '/api/system/settings',
                headers: { Authorization: actors.headers.admin },
            })).statusCode,
            200
        );
        assert.equal(
            (await invokeApp(app, {
                method: 'DELETE',
                url: '/api/audit/events',
                headers: { Authorization: actors.headers.admin },
            })).statusCode,
            200
        );

        // Notifications read stays operatorOrAbove; task cancellation respects ownership
        assert.equal(
            (await invokeApp(app, {
                method: 'POST',
                url: '/api/system/notifications/read',
                headers: { Authorization: actors.headers.auditor },
                body: { all: true },
            })).statusCode,
            403
        );
        assert.equal(
            (await invokeApp(app, {
                method: 'POST',
                url: '/api/system/notifications/read',
                headers: { Authorization: actors.headers.operator },
                body: { all: true },
            })).statusCode,
            200
        );
        assert.equal(
            (await invokeApp(app, {
                method: 'DELETE',
                url: `/api/system/tasks/${foreignTask.taskId}`,
                headers: { Authorization: actors.headers.auditor },
            })).statusCode,
            403
        );
        assert.equal(
            (await invokeApp(app, {
                method: 'DELETE',
                url: `/api/system/tasks/${foreignTask.taskId}`,
                headers: { Authorization: actors.headers.operator },
            })).statusCode,
            403
        );
    } finally {
        taskQueue.cancel(foreignTask.taskId);
    }
});

test('operator staff-account escalation and mutation protection blocks non-user targets while admin remains permitted', async () => {
    const actors = createRoleUsers('staff_guard');
    const regularTarget = userStore.add({
        username: `reg_guard_${Date.now()}`,
        email: `reg_guard_${Date.now()}@example.com`,
        password: 'RegGuard#12345',
        role: ROLES.user,
        emailVerified: true,
        enabled: true,
    });
    const staffOperatorTarget = userStore.add({
        username: `staff_op_${Date.now()}`,
        email: `staff_op_${Date.now()}@example.com`,
        password: 'StaffOp#12345',
        role: ROLES.operator,
        emailVerified: true,
        enabled: true,
    });
    const staffAuditorTarget = userStore.add({
        username: `staff_aud_${Date.now()}`,
        email: `staff_aud_${Date.now()}@example.com`,
        password: 'StaffAud#12345',
        role: ROLES.auditor,
        emailVerified: true,
        enabled: true,
    });

    // (a) Creating staff accounts via POST /api/auth/users is denied for operator (zh-CN and en-US)
    for (const forbiddenRole of ['admin', 'operator', 'auditor', 'viewer']) {
        const resEn = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/users',
            headers: { Authorization: actors.headers.operator, 'Accept-Language': 'en-US' },
            body: {
                username: `esc_${forbiddenRole}_${Date.now()}`,
                password: 'EscUser#12345',
                role: forbiddenRole,
            },
        });
        assert.equal(resEn.statusCode, 403, `operator creating ${forbiddenRole}`);
        assert.match(String(resEn.json?.msg || ''), /Only administrators/i);

        const resZh = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/users',
            headers: { Authorization: actors.headers.operator, 'Accept-Language': 'zh-CN' },
            body: {
                username: `esc_zh_${forbiddenRole}_${Date.now()}`,
                password: 'EscUser#12345',
                role: forbiddenRole,
            },
        });
        assert.equal(resZh.statusCode, 403);
        assert.match(String(resZh.json?.msg || ''), /仅超级管理员/);
    }

    // (a) Escalating a regular user's role via PUT /api/auth/users/:id is denied for operator
    for (const forbiddenRole of ['admin', 'operator', 'auditor', 'viewer']) {
        const escalateRes = await invokeApp(app, {
            method: 'PUT',
            url: `/api/auth/users/${regularTarget.id}`,
            headers: { Authorization: actors.headers.operator, 'Accept-Language': 'en-US' },
            body: { role: forbiddenRole },
        });
        assert.equal(escalateRes.statusCode, 403, `operator escalating user to ${forbiddenRole}`);
        assert.equal(userStore.getById(regularTarget.id)?.role, 'user');
    }

    // (b) Mutating any existing staff account (admin / operator / auditor) is denied for operator
    for (const staffTarget of [actors.admin, staffOperatorTarget, staffAuditorTarget]) {
        for (const [method, pathUrl, body] of [
            ['PUT', `/api/auth/users/${staffTarget.id}`, { username: `${staffTarget.username}_hack` }],
            ['PUT', `/api/auth/users/${staffTarget.id}/subscription-binding`, { subscriptionEmail: `hack_${Date.now()}@example.com` }],
            ['PUT', `/api/auth/users/${staffTarget.id}/set-enabled`, { enabled: false }],
            ['PUT', `/api/auth/users/${staffTarget.id}/update-expiry`, { expiryTime: Date.now() + 86_400_000 }],
            ['POST', `/api/auth/users/${staffTarget.id}/provision-subscription`, { subscriptionEmail: `prov_${Date.now()}@example.com` }],
            ['PUT', `/api/auth/users/${staffTarget.id}/reset-password`, { newPassword: 'HackedPass#12345' }],
            ['DELETE', `/api/auth/users/${staffTarget.id}`, undefined],
        ]) {
            const res = await invokeApp(app, {
                method,
                url: pathUrl,
                headers: { Authorization: actors.headers.operator, 'Accept-Language': 'en-US' },
                body,
            });
            assert.equal(res.statusCode, 403, `operator ${method} ${pathUrl} on ${staffTarget.role}`);
            assert.match(String(res.json?.msg || ''), /Only administrators/i);
        }

        // Mixed bulk-set-enabled with regular user + staff target must reject atomically with 403
        const mixedBulkZh = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/users/bulk-set-enabled',
            headers: { Authorization: actors.headers.operator, 'Accept-Language': 'zh-CN' },
            body: { userIds: [regularTarget.id, staffTarget.id], enabled: false },
        });
        assert.equal(mixedBulkZh.statusCode, 403, `operator bulk-set-enabled including ${staffTarget.role}`);
        assert.match(String(mixedBulkZh.json?.msg || ''), /仅超级管理员/);
        assert.equal(userStore.getById(regularTarget.id)?.enabled, true, 'regular user must remain untouched when bulk rejected');
    }

    // Admin CAN create and manage staff accounts
    const adminCreateOp = await invokeApp(app, {
        method: 'POST',
        url: '/api/auth/users',
        headers: { Authorization: actors.headers.admin },
        body: {
            username: `admin_made_op_${Date.now()}`,
            email: `admin_made_op_${Date.now()}@example.com`,
            password: 'AdminMadeOp#12345',
            role: 'operator',
        },
    });
    assert.equal(adminCreateOp.statusCode, 200);
    const createdStaffId = adminCreateOp.json?.obj?.id;
    assert.equal(adminCreateOp.json?.obj?.role, 'operator');

    const adminUpdateStaff = await invokeApp(app, {
        method: 'PUT',
        url: `/api/auth/users/${createdStaffId}`,
        headers: { Authorization: actors.headers.admin },
        body: { role: 'auditor' },
    });
    assert.equal(adminUpdateStaff.statusCode, 200);
    assert.equal(adminUpdateStaff.json?.obj?.role, 'auditor');

    const adminResetStaffPwd = await invokeApp(app, {
        method: 'PUT',
        url: `/api/auth/users/${createdStaffId}/reset-password`,
        headers: { Authorization: actors.headers.admin },
        body: { newPassword: 'StaffReset#12345' },
    });
    assert.equal(adminResetStaffPwd.statusCode, 200);

    const adminDeleteStaff = await invokeApp(app, {
        method: 'DELETE',
        url: `/api/auth/users/${createdStaffId}`,
        headers: { Authorization: actors.headers.admin },
    });
    assert.equal(adminDeleteStaff.statusCode, 200);
});

test('global error handler produces bilingual 400, 413, 4xx, and production-safe 500 responses', async (t) => {
    const prevNodeEnv = process.env.NODE_ENV;
    try {
        process.env.NODE_ENV = 'production';
        const prodApp = createApp({ serveClientBuild: false });

        // 400 invalid JSON syntax error (zh-CN & en-US)
        const badJsonZh = await invokeApp(prodApp, {
            method: 'POST',
            url: '/api/auth/login',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': 'zh-CN' },
            body: '{bad-json',
        });
        assert.equal(badJsonZh.statusCode, 400);
        assert.equal(badJsonZh.json?.success, false);
        assert.equal(badJsonZh.json?.msg, '请求 JSON 格式无效');

        const badJsonEn = await invokeApp(prodApp, {
            method: 'POST',
            url: '/api/auth/login',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US' },
            body: '{bad-json',
        });
        assert.equal(badJsonEn.statusCode, 400);
        assert.equal(badJsonEn.json?.success, false);
        assert.equal(badJsonEn.json?.msg, 'Invalid JSON payload');

        // 413 payload too large (zh-CN & en-US)
        const oversizedBody = `{"data":"${'x'.repeat(1024 * 1024 + 512)}"}`;
        const tooLargeZh = await invokeApp(prodApp, {
            method: 'POST',
            url: '/api/auth/login',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': 'zh-CN' },
            body: oversizedBody,
        });
        assert.equal(tooLargeZh.statusCode, 413);
        assert.equal(tooLargeZh.json?.success, false);
        assert.equal(tooLargeZh.json?.msg, '请求体过大');

        const tooLargeEn = await invokeApp(prodApp, {
            method: 'POST',
            url: '/api/auth/login',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US' },
            body: oversizedBody,
        });
        assert.equal(tooLargeEn.statusCode, 413);
        assert.equal(tooLargeEn.json?.success, false);
        assert.equal(tooLargeEn.json?.msg, 'Request payload too large');

        // 500 error in production hides internal error details and returns bilingual message
        const mock500 = t.mock.method(systemSettingsStore, 'getSite', () => {
            throw new Error('Secret SQL connection failure');
        });
        try {
            const err500Zh = await invokeApp(prodApp, {
                method: 'GET',
                url: '/error-probe',
                headers: { 'Accept-Language': 'zh-CN' },
            });
            assert.equal(err500Zh.statusCode, 500);
            assert.equal(err500Zh.json?.success, false);
            assert.equal(err500Zh.json?.msg, '服务器内部错误');

            const err500En = await invokeApp(prodApp, {
                method: 'GET',
                url: '/error-probe',
                headers: { 'Accept-Language': 'en-US' },
            });
            assert.equal(err500En.statusCode, 500);
            assert.equal(err500En.json?.success, false);
            assert.equal(err500En.json?.msg, 'Internal server error');
        } finally {
            mock500.mock.restore();
        }

        // 4xx error preserves non-empty message and falls back when empty
        const mock422 = t.mock.method(systemSettingsStore, 'getSite', () => {
            const err = new Error('Explicit client validation message');
            err.status = 422;
            throw err;
        });
        try {
            const err422 = await invokeApp(prodApp, {
                method: 'GET',
                url: '/error-probe',
                headers: { 'Accept-Language': 'en-US' },
            });
            assert.equal(err422.statusCode, 422);
            assert.equal(err422.json?.msg, 'Explicit client validation message');
        } finally {
            mock422.mock.restore();
        }

        const mock400Empty = t.mock.method(systemSettingsStore, 'getSite', () => {
            const err = new Error('   ');
            err.status = 400;
            throw err;
        });
        try {
            const err400Zh = await invokeApp(prodApp, {
                method: 'GET',
                url: '/error-probe',
                headers: { 'Accept-Language': 'zh-CN' },
            });
            assert.equal(err400Zh.statusCode, 400);
            assert.equal(err400Zh.json?.msg, '请求无效');

            const err400En = await invokeApp(prodApp, {
                method: 'GET',
                url: '/error-probe',
                headers: { 'Accept-Language': 'en-US' },
            });
            assert.equal(err400En.statusCode, 400);
            assert.equal(err400En.json?.msg, 'Bad request');
        } finally {
            mock400Empty.mock.restore();
        }

        // Non-production preserves 500 error message
        process.env.NODE_ENV = 'test';
        const devApp = createApp({ serveClientBuild: false });
        const mockDev500 = t.mock.method(systemSettingsStore, 'getSite', () => {
            throw new Error('Detailed dev failure');
        });
        try {
            const errDev500 = await invokeApp(devApp, {
                method: 'GET',
                url: '/error-probe',
                headers: { 'Accept-Language': 'en-US' },
            });
            assert.equal(errDev500.statusCode, 500);
            assert.equal(errDev500.json?.msg, 'Detailed dev failure');
        } finally {
            mockDev500.mock.restore();
        }
    } finally {
        process.env.NODE_ENV = prevNodeEnv;
    }
});
