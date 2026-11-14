import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
    parseAcceptLanguageLocale,
    pickLocalizedText,
    resolveRequestLocale,
} from '../lib/requestLocale.js';
import authRouter from '../routes/auth.js';
import clientsRouter from '../routes/clients.js';
import userGroupsRouter from '../routes/userGroups.js';
import usersRouter from '../routes/users.js';
import systemRouter from '../routes/system.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import userStore from '../store/userStore.js';
import { buildExpiryNotification } from '../lib/subscriptionExpiryNotifier.js';
import { createDirectUserSession } from '../services/authSessionService.js';
import notificationService from '../lib/notifications.js';
import { invokeApp } from './helpers/invokeApp.js';

describe('requestLocale & localized API responses', () => {
    it('resolves Accept-Language quality weights and explicit override headers', () => {
        assert.equal(parseAcceptLanguageLocale('zh-CN;q=0.7, en-US;q=0.9'), 'en-US');
        assert.equal(parseAcceptLanguageLocale('fr-FR, zh-TW;q=0.8, en;q=0.5'), 'zh-CN');
        assert.equal(resolveRequestLocale({ headers: { 'x-locale': 'en-US', 'accept-language': 'zh-CN' } }), 'en-US');
        assert.equal(resolveRequestLocale({ query: { lang: 'en' }, headers: { 'accept-language': 'zh-CN' } }), 'en-US');
        assert.equal(resolveRequestLocale({ headers: {} }), 'zh-CN');
        assert.equal(pickLocalizedText('en-US', '中文', 'English'), 'English');
    });

    it('returns English 2FA prompt, user-not-found error, and notifications for en-US requests', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/auth', authRouter);
        app.use('/api/clients', authMiddleware, adminOnly, clientsRouter);
        app.use('/api/user-groups', authMiddleware, adminOnly, userGroupsRouter);
        app.use('/api/users', usersRouter);
        app.use('/api/system', systemRouter);

        const username = `loc_user_${Date.now()}`;
        const password = 'LocaleUser#12345';
        const user = userStore.add({
            username,
            email: `${username}@example.com`,
            password,
            role: 'admin',
            enabled: true,
            emailVerified: true,
        });
        userStore.setTwoFactor(user.id, {
            secret: 'JBSWY3DPEHPK3PXP',
            backupCodeHashes: [],
        });

        const originalScheduleSave = notificationService._scheduleSave;
        notificationService._scheduleSave = () => {};
        let addedNotificationId = '';

        try {
            const loginRes = await invokeApp(app, {
                method: 'POST',
                url: '/api/auth/login',
                headers: { 'accept-language': 'en-US,en;q=0.9' },
                body: { username, password },
            });
            assert.equal(loginRes.statusCode, 200);
            assert.equal(loginRes.json.needTwoFactor, true);
            assert.doesNotMatch(loginRes.json.msg, /[\u4e00-\u9fff]/);
            assert.match(loginRes.json.msg, /2FA/);

            const session = createDirectUserSession(userStore.getById(user.id));
            const notFoundRes = await invokeApp(app, {
                method: 'GET',
                url: '/api/users/nonexistent-user-id/detail',
                headers: {
                    authorization: `Bearer ${session.token}`,
                    'x-locale': 'en-US',
                },
            });
            assert.equal(notFoundRes.statusCode, 404);
            assert.equal(notFoundRes.json.msg, 'User not found');

            const note = notificationService.notify({
                type: 'server_health_unreachable',
                severity: 'critical',
                title: '节点连接失败: Edge-01',
                body: '节点 Edge-01 无法连接到 3x-ui: timeout',
                dedupKey: `test_locale_${Date.now()}`,
                meta: {
                    localized: {
                        'zh-CN': {
                            title: '节点连接失败: Edge-01',
                            body: '节点 Edge-01 无法连接到 3x-ui: timeout',
                        },
                        'en-US': {
                            title: 'Node unreachable: Edge-01',
                            body: 'Node Edge-01 could not reach the panel: timeout',
                        },
                    },
                },
            });
            addedNotificationId = note?.id || '';

            const notifRes = await invokeApp(app, {
                method: 'GET',
                url: '/api/system/notifications',
                headers: {
                    authorization: `Bearer ${session.token}`,
                    'accept-language': 'en-US',
                },
            });
            assert.equal(notifRes.statusCode, 200);
            const matched = notifRes.json.obj.items.find((item) => item.id === note.id);
            assert.equal(matched?.title, 'Node unreachable: Edge-01');
            assert.equal(matched?.body, 'Node Edge-01 could not reach the panel: timeout');

            const expiryNotice = notificationService.notify(buildExpiryNotification({
                username: 'expired-user',
                email: 'expired-user@example.com',
                expiryTime: Date.now() - 60_000,
                remainingDays: 0,
                stage: 'expired',
            }));
            const notifEnRes = await invokeApp(app, {
                method: 'GET',
                url: '/api/system/notifications',
                headers: {
                    authorization: `Bearer ${session.token}`,
                    'x-locale': 'en-US',
                },
            });
            assert.equal(notifEnRes.statusCode, 200);
            const matchedExpiry = notifEnRes.json.obj.items.find((item) => item.id === expiryNotice?.id);
            assert.equal(matchedExpiry?.title, 'User subscription expired');
            assert.match(matchedExpiry?.body || '', /has expired/);
            if (expiryNotice?.id) {
                notificationService.notifications = notificationService.notifications.filter(
                    (item) => item.id !== expiryNotice.id
                );
            }

            const missingAuthUserPutEn = await invokeApp(app, {
                method: 'PUT',
                url: '/api/auth/users/nonexistent-user-id',
                headers: {
                    authorization: `Bearer ${session.token}`,
                    'x-locale': 'en-US',
                },
                body: { username: 'anything' },
            });
            assert.equal(missingAuthUserPutEn.statusCode, 404);
            assert.equal(missingAuthUserPutEn.json.msg, 'User not found');

            const missingAuthUserPutZh = await invokeApp(app, {
                method: 'PUT',
                url: '/api/auth/users/nonexistent-user-id',
                headers: {
                    authorization: `Bearer ${session.token}`,
                    'x-locale': 'zh-CN',
                },
                body: { username: 'anything' },
            });
            assert.equal(missingAuthUserPutZh.statusCode, 404);
            assert.equal(missingAuthUserPutZh.json.msg, '用户不存在');

            const missingEntitlementServerEn = await invokeApp(app, {
                method: 'PUT',
                url: '/api/clients/entitlement',
                headers: {
                    authorization: `Bearer ${session.token}`,
                    'x-locale': 'en-US',
                },
                body: {
                    serverId: 'missing-server-id',
                    inboundId: '1',
                    clientIdentifier: 'missing-client',
                    mode: 'override',
                },
            });
            assert.equal(missingEntitlementServerEn.statusCode, 404);
            assert.equal(missingEntitlementServerEn.json.msg, 'Server not found');

            const missingGroupPutEn = await invokeApp(app, {
                method: 'PUT',
                url: '/api/user-groups/nonexistent-group-id',
                headers: {
                    authorization: `Bearer ${session.token}`,
                    'x-locale': 'en-US',
                },
                body: {
                    name: `temp-group-${Date.now()}`,
                    memberUserIds: ['missing-member-id'],
                },
            });
            assert.equal(missingGroupPutEn.statusCode, 404);
            assert.equal(missingGroupPutEn.json.msg, 'User group not found');

            const originalGetById = userStore.getById.bind(userStore);
            let lookupCount = 0;
            userStore.getById = (id) => {
                lookupCount += 1;
                // First lookup inside authMiddleware succeeds; second inside passkey handler sees missing user.
                return lookupCount % 2 === 1 ? originalGetById(id) : null;
            };
            try {
                const passkeyOptsEn = await invokeApp(app, {
                    method: 'POST',
                    url: '/api/auth/passkey/register-options',
                    headers: {
                        authorization: `Bearer ${session.token}`,
                        'x-locale': 'en-US',
                    },
                });
                assert.equal(passkeyOptsEn.statusCode, 404);
                assert.equal(passkeyOptsEn.json.msg, 'User not found');

                const passkeyVerifyEn = await invokeApp(app, {
                    method: 'POST',
                    url: '/api/auth/passkey/register-verify',
                    headers: {
                        authorization: `Bearer ${session.token}`,
                        'x-locale': 'en-US',
                    },
                    body: {},
                });
                assert.equal(passkeyVerifyEn.statusCode, 404);
                assert.equal(passkeyVerifyEn.json.msg, 'User not found');
            } finally {
                userStore.getById = originalGetById;
            }
        } finally {
            userStore.remove(user.id);
            notificationService._scheduleSave = originalScheduleSave;
            if (addedNotificationId) {
                notificationService.notifications = notificationService.notifications.filter(
                    (item) => item.id !== addedNotificationId
                );
            }
        }
    });
});
