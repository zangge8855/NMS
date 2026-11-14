import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { Request } from 'express';
import config from '../config.js';
import userStore from '../store/userStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import { isPrivateOrLocalIp, normalizeIpAddress } from './ipGeoResolver.js';
import crypto from 'crypto';

// Simple in-memory challenge store for webauthn
const MAX_CHALLENGES = 1000;
const challenges = new Map<string, { challenge: string; userId?: string; expiresAt: number }>();

function cleanupChallenges() {
    const now = Date.now();
    for (const [key, value] of challenges.entries()) {
        if (now > value.expiresAt) {
            challenges.delete(key);
        }
    }
}

const challengeCleanupTimer = setInterval(cleanupChallenges, 60000);
if (typeof challengeCleanupTimer?.unref === 'function') {
    challengeCleanupTimer.unref();
}

function saveChallenge(id: string, challenge: string, userId?: string) {
    if (challenges.size >= MAX_CHALLENGES) {
        cleanupChallenges();
        if (challenges.size >= MAX_CHALLENGES) {
            const oldestKey = challenges.keys().next().value;
            if (oldestKey) challenges.delete(oldestKey);
        }
    }
    challenges.set(id, { challenge, userId, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 minutes TTL
}

function getChallenge(id: string) {
    const data = challenges.get(id);
    if (!data || Date.now() > data.expiresAt) {
        if (data) challenges.delete(id);
        return null;
    }
    return data;
}

function parseExpectedOriginsList(value: unknown): string[] {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
            try {
                return new URL(item).origin;
            } catch {
                return '';
            }
        })
        .filter(Boolean);
}

function isTrustedProxyForWebauthn(req: any): boolean {
    const trustProxy = config.security?.trustProxy;
    if (trustProxy === true) return true;
    if (trustProxy === false) return false;
    const socketIp = normalizeIpAddress(req?.socket?.remoteAddress || '');
    const upstreamIp = socketIp || normalizeIpAddress(req?.ip || '');
    if (!upstreamIp) return true;
    return isPrivateOrLocalIp(upstreamIp) || (Array.isArray(req?.ips) && req.ips.length > 0);
}

function getRpDetails(req: Request, options: { nodeEnv?: string } = {}) {
    const rpName = 'NMS';
    const effectiveEnv = String(options.nodeEnv || process.env.NODE_ENV || config.nodeEnv || 'development').trim().toLowerCase();
    const allowDevOrigins = effectiveEnv === 'development' || effectiveEnv === 'test';
    const trustForwarded = isTrustedProxyForWebauthn(req);

    const requestHost = typeof req.get === 'function' ? (req.get('host') || '') : '';
    const forwardedHost = trustForwarded && typeof req.get === 'function' ? (req.get('x-forwarded-host') || '') : '';
    const forwardedProto = trustForwarded && typeof req.get === 'function' ? (req.get('x-forwarded-proto') || '') : '';
    const hostHeader = forwardedHost || requestHost || 'localhost';
    const proto = String(forwardedProto || req.protocol || 'http').split(',')[0].trim() || 'http';
    const fallbackOrigin = `${proto}://${hostHeader}`;

    const configuredBase = String(
        systemSettingsStore.getSubscription()?.publicBaseUrl
        || config.subscription?.publicBaseUrl
        || ''
    ).trim();
    let configuredOrigin = '';
    if (configuredBase) {
        try {
            configuredOrigin = new URL(configuredBase).origin;
        } catch {
            configuredOrigin = '';
        }
    }
    const configuredOrigins = parseExpectedOriginsList(process.env.WEBAUTHN_EXPECTED_ORIGINS);

    let origin = '';
    if (allowDevOrigins) {
        const originHeader = typeof req.get === 'function' ? (req.get('origin') || '') : '';
        const refererHeader = typeof req.get === 'function' ? (req.get('referer') || '') : '';
        if (originHeader) {
            origin = originHeader;
        } else if (refererHeader) {
            try {
                origin = new URL(refererHeader).origin;
            } catch {
                // ignore
            }
        }
    }
    if (!origin) {
        origin = configuredOrigin || configuredOrigins[0] || fallbackOrigin;
    }

    const extractHostname = (originLike: string, hostLike: string): string => {
        try {
            const urlHost = new URL(originLike).hostname;
            if (urlHost) return urlHost;
        } catch {
            // fallback below
        }
        try {
            const hostParsed = new URL(`${proto}://${hostLike}`).hostname;
            if (hostParsed) return hostParsed;
        } catch {
            // fallback below
        }
        return hostLike.startsWith('[')
            ? hostLike.slice(1, hostLike.indexOf(']') > 0 ? hostLike.indexOf(']') : undefined)
            : hostLike.split(':')[0];
    };

    const configuredRpId = String(process.env.WEBAUTHN_RP_ID || '').trim();
    const rpID = (!allowDevOrigins && configuredRpId)
        ? configuredRpId
        : (extractHostname(origin, hostHeader) || req.hostname || 'localhost');

    const devOrigins = allowDevOrigins
        ? [
            'http://localhost:5173',
            'http://localhost:3000',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:3000',
            'http://[::1]:5173',
            'http://[::1]:3000',
        ]
        : [];

    const expectedOrigins = Array.from(new Set([
        origin,
        configuredOrigin,
        ...configuredOrigins,
        fallbackOrigin,
        requestHost ? `${proto}://${requestHost}` : '',
        ...devOrigins,
    ].filter(Boolean)));

    return { rpName, rpID, origin, expectedOrigins };
}

export { getRpDetails };

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

    if (!verification.verified || !verification.registrationInfo) {
        throw new Error('Passkey registration verification failed');
    }

    const { registrationInfo } = verification;
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

export async function verifyPasskeyLogin(req: Request, challengeSessionId: string, body: any, passkey: any, expectedUserId?: string): Promise<{ newCounter: number }> {
    const challengeData = getChallenge(challengeSessionId);
    if (!challengeData) {
        throw new Error('Challenge not found or expired');
    }

    if (challengeData.userId && expectedUserId && String(challengeData.userId) !== String(expectedUserId)) {
        challenges.delete(challengeSessionId);
        throw new Error('Passkey user mismatch');
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

    if (!verification.verified || !verification.authenticationInfo) {
        throw new Error('Passkey authentication verification failed');
    }

    const { authenticationInfo } = verification;
    return { newCounter: authenticationInfo.newCounter };
}
