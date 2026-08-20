import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import userStore from '../store/userStore.js';
import app from '../index.js';
import { invokeApp } from './helpers/invokeApp.js';

describe('Passkey Authentication Endpoints', () => {
    let testUser;
    let userToken;

    before(() => {
        const username = `passkey_user_${Date.now()}`;
        const email = `${username}@example.com`;
        testUser = userStore.add({
            username,
            email,
            password: 'Password123!',
            role: 'user',
            enabled: true,
            emailVerified: true,
        });
        userToken = jwt.sign(
            { userId: testUser.id, role: testUser.role, username: testUser.username },
            config.jwt.secret,
            { expiresIn: '1h' }
        );
    });

    after(() => {
        if (testUser?.id) {
            userStore.remove(testUser.id);
        }
    });

    it('GET /api/auth/passkey/list returns empty list initially', async () => {
        const res = await invokeApp(app, {
            method: 'GET',
            url: '/api/auth/passkey/list',
            headers: {
                Authorization: `Bearer ${userToken}`,
            },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.success, true);
        assert.deepEqual(res.json.obj, []);
    });

    it('POST /api/auth/passkey/register-options generates valid registration challenge', async () => {
        const res = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/passkey/register-options',
            headers: {
                Authorization: `Bearer ${userToken}`,
                Origin: 'http://localhost:5173',
            },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.success, true);
        assert.ok(res.json.obj.challenge);
        assert.equal(res.json.obj.rp.name, 'NMS');
        assert.equal(res.json.obj.rp.id, 'localhost');
        assert.equal(res.json.obj.user.name, testUser.username);
    });

    it('POST /api/auth/passkey/login-options generates valid login challenge without user identifier', async () => {
        const res = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/passkey/login-options',
            headers: {
                Origin: 'http://localhost:5173',
            },
            body: {},
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.success, true);
        assert.ok(res.json.obj.options.challenge);
        assert.ok(res.json.obj.challengeSessionId);
    });

    it('POST /api/auth/passkey/login-options generates valid login challenge with user identifier', async () => {
        const res = await invokeApp(app, {
            method: 'POST',
            url: '/api/auth/passkey/login-options',
            headers: {
                Origin: 'http://localhost:5173',
            },
            body: {
                identifier: testUser.username,
            },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.success, true);
        assert.ok(res.json.obj.options.challenge);
        assert.ok(res.json.obj.challengeSessionId);
    });

    it('can rename and delete a passkey via store and routes', async () => {
        const fakePasskey = {
            id: 'mock-passkey-id-12345',
            credentialID: 'mock-passkey-id-12345',
            publicKey: Buffer.from('mock-pubkey').toString('base64'),
            counter: 0,
            transports: ['internal'],
            deviceName: 'My MacBook',
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
        };

        userStore.addPasskey(testUser.id, fakePasskey);

        // List
        const listRes = await invokeApp(app, {
            method: 'GET',
            url: '/api/auth/passkey/list',
            headers: {
                Authorization: `Bearer ${userToken}`,
            },
        });
        assert.equal(listRes.statusCode, 200);
        assert.equal(listRes.json.obj.length, 1);
        assert.equal(listRes.json.obj[0].deviceName, 'My MacBook');

        // Rename
        const renameRes = await invokeApp(app, {
            method: 'PATCH',
            url: `/api/auth/passkey/${fakePasskey.id}`,
            headers: {
                Authorization: `Bearer ${userToken}`,
            },
            body: {
                deviceName: 'Updated MacBook Pro',
            },
        });
        assert.equal(renameRes.statusCode, 200);
        assert.equal(renameRes.json.success, true);

        // Verify renamed
        const passkeysAfterRename = userStore.getPasskeys(testUser.id);
        assert.equal(passkeysAfterRename[0].deviceName, 'Updated MacBook Pro');

        // Delete
        const delRes = await invokeApp(app, {
            method: 'DELETE',
            url: `/api/auth/passkey/${fakePasskey.id}`,
            headers: {
                Authorization: `Bearer ${userToken}`,
            },
        });
        assert.equal(delRes.statusCode, 200);
        assert.equal(delRes.json.success, true);

        // Verify deleted
        const passkeysAfterDel = userStore.getPasskeys(testUser.id);
        assert.equal(passkeysAfterDel.length, 0);
    });
});
