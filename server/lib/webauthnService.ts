import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { Request } from 'express';
import userStore from '../store/userStore.js';
import crypto from 'crypto';

// Simple in-memory challenge store for webauthn
const challenges = new Map<string, { challenge: string; userId?: string; expiresAt: number }>();

function cleanupChallenges() {
    const now = Date.now();
    for (const [key, value] of challenges.entries()) {
        if (now > value.expiresAt) {
            challenges.delete(key);
        }
    }
}
setInterval(cleanupChallenges, 60000); // Cleanup every minute

function saveChallenge(id: string, challenge: string, userId?: string) {
    challenges.set(id, { challenge, userId, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 minutes TTL
}

function getChallenge(id: string) {
    const data = challenges.get(id);
    if (!data || Date.now() > data.expiresAt) return null;
    return data;
}

function getRpDetails(req: Request) {
    const rpName = 'NMS';
    const originHeader = req.get('origin') || '';
    const refererHeader = req.get('referer') || '';
    let origin = '';
    if (originHeader) {
        origin = originHeader;
    } else if (refererHeader) {
        try {
            const refUrl = new URL(refererHeader);
            origin = refUrl.origin;
        } catch {
            // ignore
        }
    }

    const hostHeader = req.get('x-forwarded-host') || req.get('host') || 'localhost';
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const fallbackOrigin = `${proto}://${hostHeader}`;

    if (!origin) {
        origin = fallbackOrigin;
    }

    let rpID = 'localhost';
    try {
        rpID = new URL(origin).hostname || req.hostname || 'localhost';
    } catch {
        rpID = req.hostname || hostHeader.split(':')[0] || 'localhost';
    }

    const expectedOrigins = Array.from(new Set([
        origin,
        fallbackOrigin,
        `${proto}://${req.get('host')}`,
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:3000',
    ].filter(Boolean)));

    return { rpName, rpID, origin, expectedOrigins };
}

export async function createPasskeyRegistrationOptions(req: Request, user: any) {
    const { rpName, rpID } = getRpDetails(req);
    const userPasskeys = userStore.getPasskeys(user.id);

    const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new Uint8Array(Buffer.from(user.id)),
        userName: user.username,
        userDisplayName: user.username || 'User',
        attestationType: 'none',
        excludeCredentials: userPasskeys.map((pk: any) => ({
            id: pk.id || pk.credentialID,
            transports: pk.transports || [],
        })),
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
        },
    });

    saveChallenge(user.id, options.challenge, user.id);
    return options;
}

export async function verifyPasskeyRegistration(req: Request, user: any, body: any): Promise<any> {
    const challengeData = getChallenge(user.id);
    if (!challengeData) {
        throw new Error('Challenge not found or expired');
    }

    const { rpID, expectedOrigins } = getRpDetails(req);

    const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        requireUserVerification: false,
    });

    challenges.delete(user.id);

    const { registrationInfo } = verification;
    if (!registrationInfo) {
        throw new Error('Registration info missing');
    }

    const { credential, aaguid } = registrationInfo;

    return {
        id: credential.id,
        credentialID: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: credential.transports || body.response?.transports || [],
        deviceName: body.deviceName || '通行密钥',
        aaguid,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
    };
}

export async function createPasskeyLoginOptions(req: Request, user?: any) {
    const { rpID } = getRpDetails(req);

    let userPasskeys: any[] = [];
    if (user) {
        userPasskeys = userStore.getPasskeys(user.id);
    }

    const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: userPasskeys.length > 0
            ? userPasskeys.map((pk: any) => ({
                id: pk.id || pk.credentialID,
                transports: pk.transports || [],
            }))
            : undefined,
        userVerification: 'preferred',
    });

    const challengeSessionId = crypto.randomUUID();
    saveChallenge(challengeSessionId, options.challenge, user?.id);

    return { options, challengeSessionId };
}

export async function verifyPasskeyLogin(req: Request, challengeSessionId: string, body: any, passkey: any): Promise<{ newCounter: number }> {
    const challengeData = getChallenge(challengeSessionId);
    if (!challengeData) {
        throw new Error('Challenge not found or expired');
    }

    const { rpID, expectedOrigins } = getRpDetails(req);

    const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
            id: passkey.id || passkey.credentialID,
            publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
            counter: passkey.counter || 0,
            transports: passkey.transports,
        },
    });

    challenges.delete(challengeSessionId);

    const { authenticationInfo } = verification;
    return { newCounter: authenticationInfo.newCounter };
}
