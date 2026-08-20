import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    VerifiedRegistrationResponse,
    VerifiedAuthenticationResponse
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
    const hostHeader = req.get('x-forwarded-host') || req.get('host') || 'localhost';
    const hostname = hostHeader.split(':')[0];
    const rpID = req.hostname || hostname || 'localhost';
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const origin = `${proto}://${hostHeader}`;
    return { rpName, rpID, origin };
}

export async function createPasskeyRegistrationOptions(req: Request, user: any) {
    const { rpName, rpID } = getRpDetails(req);
    const userPasskeys = userStore.getPasskeys(user.id);

    const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new Uint8Array(Buffer.from(user.id)),
        userName: user.username,
        attestationType: 'none',
        excludeCredentials: userPasskeys.map((pk: any) => ({
            id: pk.id, // from auth.ts
            type: 'public-key',
            transports: pk.transports || [],
        })),
        authenticatorSelection: {
            residentKey: 'required',
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

    const { rpID, origin } = getRpDetails(req);

    const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
    });

    challenges.delete(user.id);

    const { registrationInfo } = verification;
    if (!registrationInfo) {
        throw new Error('Registration info missing');
    }

    return {
        id: registrationInfo.credentialID,
        credentialID: registrationInfo.credentialID, // duplicate just in case
        publicKey: Buffer.from(registrationInfo.credentialPublicKey).toString('base64'),
        counter: registrationInfo.credentialCounter,
        transports: body.response?.transports || [],
        deviceName: body.deviceName || '通行密钥', // We might need to pass this from frontend
        aaguid: registrationInfo.aaguid,
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
        allowCredentials: userPasskeys.map((pk: any) => ({
            id: pk.id || pk.credentialID,
            type: 'public-key',
            transports: pk.transports || [],
        })),
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

    const { rpID, origin } = getRpDetails(req);

    const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
            id: passkey.id || passkey.credentialID,
            publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
            counter: passkey.counter,
            transports: passkey.transports,
        },
    });

    challenges.delete(challengeSessionId);

    const { authenticationInfo } = verification;
    return { newCounter: authenticationInfo.newCounter };
}
