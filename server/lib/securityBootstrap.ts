import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import userStore from '../store/userStore.js';
import serverStore from '../store/serverStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import subscriptionTokenStore from '../store/subscriptionTokenStore.js';
import {
    collectSecurityIssues,
    isWeakAdminPassword,
    isWeakAdminUsername,
    isWeakCredentialsSecret,
    isWeakJwtSecret,
} from './startupPreflight.js';
import { runtimeEnvFilePath, writeEnvFile } from './runtimeEnv.js';

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

/**
 * The wizard persists to ${DATA_DIR}/runtime.env rather than the repo .env:
 * the data directory is writable and persistent in every supported deployment
 * (in Docker the repo root is read-only for the `node` user and not a volume),
 * and runtime.env takes precedence over the repo .env on the next start.
 */
export function resolveSecurityEnvFile(): string {
    return runtimeEnvFilePath(config.dataDir);
}

export function writeEnvSecurityOverrides(filePath: string = resolveSecurityEnvFile(), updates: Record<string, any> = {}): string {
    const targetPath = String(filePath || '').trim() || resolveSecurityEnvFile();
    return writeEnvFile(targetPath, updates);
}

function buildBootstrapStats() {
    const telegram = systemSettingsStore.getTelegram();
    return {
        serverCount: serverStore.getAll().length,
        telegramConfigured: telegram.botTokenConfigured === true,
    };
}

function collectStrictSecurityIssues() {
    return collectSecurityIssues({
        ...process.env,
        ENFORCE_STRICT_SECURITY: 'true',
    });
}

function buildSessionUser(user: any) {
    return {
        username: String(user?.username || '').trim(),
        role: String(user?.role || 'admin').trim() || 'admin',
        email: String(user?.email || '').trim(),
        subscriptionEmail: String(user?.subscriptionEmail || '').trim(),
        emailVerified: user?.emailVerified === true,
    };
}

function resolveCurrentAdmin(currentUser: any = {}) {
    const userId = normalizeText(currentUser.userId);
    const username = normalizeText(currentUser.username);
    const admin = (userId ? userStore.getById(userId) : null) || (username ? userStore.getByUsername(username) : null);

    if (!admin || admin.role !== 'admin') {
        throw new Error('当前会话未绑定有效管理员账号');
    }

    return admin;
}

function buildSignedToken(user: any): string {
    return jwt.sign({
        userId: normalizeText(user?.id),
        role: String(user?.role || 'admin').trim() || 'admin',
        username: normalizeText(user?.username),
        tokenVersion: Number(user?.tokenVersion || 1),
    }, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn as any,
    });
}

function validateBootstrapPayload(payload: any = {}, currentUser: any = {}) {
    const jwtSecret = normalizeText(payload.jwtSecret);
    const adminUsername = normalizeText(payload.adminUsername) || normalizeText(currentUser.username);
    const adminPassword = String(payload.adminPassword || '');
    const credentialsSecret = normalizeText(payload.credentialsSecret);

    if (isWeakJwtSecret(jwtSecret)) {
        throw new Error('JWT_SECRET 强度不足，请使用长度不少于 32 的随机密钥');
    }
    if (isWeakAdminUsername(adminUsername)) {
        throw new Error('管理员用户名过弱，请使用非默认用户名');
    }
    if (isWeakAdminPassword(adminPassword)) {
        throw new Error('管理员密码过弱，请至少使用 8 位并覆盖大小写、数字、符号中的 3 类');
    }
    if (isWeakCredentialsSecret(credentialsSecret, jwtSecret)) {
        throw new Error('CREDENTIALS_SECRET 强度不足，且不能复用 JWT_SECRET');
    }

    return {
        jwtSecret,
        adminUsername,
        adminPassword,
        credentialsSecret,
    };
}

function rotateCredentialSecret(nextSecret: string) {
    const previousSecret = normalizeText(config.credentials?.secret || '');
    const previousLegacySecrets = Array.isArray(config.credentials?.legacySecrets)
        ? config.credentials.legacySecrets.map((item: any) => normalizeText(item)).filter(Boolean)
        : [];

    if (!nextSecret || nextSecret === previousSecret) {
        return {
            changed: false,
            serverRotation: {
                dryRun: false,
                totalServers: serverStore.getAll().length,
                scannedFields: 0,
                rotatedFields: 0,
                migratedPlaintext: 0,
                failedFields: 0,
            },
            telegramRotated: false,
            legacySecrets: previousLegacySecrets,
        };
    }

    config.credentials.secret = nextSecret;
    config.credentials.legacySecrets = Array.from(new Set([previousSecret, ...previousLegacySecrets].filter(Boolean)));
    process.env.CREDENTIALS_SECRET = nextSecret;
    process.env.CREDENTIALS_LEGACY_SECRETS = config.credentials.legacySecrets.join(',');

    const serverRotation = serverStore.rotateCredentials({ dryRun: false });
    const telegram = systemSettingsStore.getTelegram();
    let telegramRotated = false;
    if (telegram.botTokenConfigured && telegram.botToken) {
        systemSettingsStore.update({
            telegram: {
                botToken: telegram.botToken,
            },
        });
        telegramRotated = true;
    }

    config.credentials.legacySecrets = previousLegacySecrets.filter((item) => item && item !== nextSecret);
    process.env.CREDENTIALS_LEGACY_SECRETS = config.credentials.legacySecrets.join(',');

    return {
        changed: true,
        serverRotation,
        telegramRotated,
        legacySecrets: config.credentials.legacySecrets,
    };
}

export function getSecurityBootstrapStatus(currentUser: any = {}) {
    const currentAdmin = resolveCurrentAdmin(currentUser);
    const issues = collectStrictSecurityIssues();

    return {
        required: issues.length > 0,
        issues,
        admin: {
            username: normalizeText(currentAdmin.username),
        },
        stats: buildBootstrapStats(),
        envFile: resolveSecurityEnvFile(),
    };
}

export function applySecurityBootstrap(payload: any = {}, currentUser: any = {}) {
    const currentAdmin = resolveCurrentAdmin(currentUser);
    const nextValues = validateBootstrapPayload(payload, currentUser);
    const previousJwtSecret = normalizeText(config.jwt?.secret || '');
    const previousSubSecret = normalizeText(config.subscription?.tokenSecret || '');
    const existingSubLegacy = Array.isArray(config.subscription?.legacySecrets)
        ? config.subscription.legacySecrets.map((item: any) => normalizeText(item)).filter(Boolean)
        : [];
    const nextSubscriptionSecret = normalizeText(process.env.SUBSCRIPTION_TOKEN_SECRET)
        || (previousSubSecret && previousSubSecret !== previousJwtSecret && !isWeakCredentialsSecret(previousSubSecret, nextValues.jwtSecret)
            ? previousSubSecret
            : nextValues.credentialsSecret);
    const nextSubscriptionLegacySecrets = Array.from(new Set([
        ...existingSubLegacy,
        previousSubSecret,
        previousJwtSecret,
    ].filter((item) => Boolean(item) && item !== nextSubscriptionSecret)));

    const envUpdates = {
        JWT_SECRET: nextValues.jwtSecret,
        ADMIN_USERNAME: nextValues.adminUsername,
        ADMIN_PASSWORD: nextValues.adminPassword,
        CREDENTIALS_SECRET: nextValues.credentialsSecret,
        SUBSCRIPTION_TOKEN_SECRET: nextSubscriptionSecret,
        SUBSCRIPTION_TOKEN_LEGACY_SECRETS: nextSubscriptionLegacySecrets.join(','),
    };

    const envFile = resolveSecurityEnvFile();
    writeEnvSecurityOverrides(envFile, envUpdates);

    const updatedAdmin = userStore.update(currentAdmin.id, {
        username: nextValues.adminUsername,
        password: nextValues.adminPassword,
    });

    config.auth.adminUsername = updatedAdmin.username;
    config.auth.adminPassword = nextValues.adminPassword;
    process.env.ADMIN_USERNAME = updatedAdmin.username;
    process.env.ADMIN_PASSWORD = nextValues.adminPassword;

    config.jwt.secret = nextValues.jwtSecret;
    process.env.JWT_SECRET = nextValues.jwtSecret;

    config.subscription.tokenSecret = nextSubscriptionSecret;
    config.subscription.legacySecrets = nextSubscriptionLegacySecrets;
    process.env.SUBSCRIPTION_TOKEN_SECRET = nextSubscriptionSecret;
    process.env.SUBSCRIPTION_TOKEN_LEGACY_SECRETS = nextSubscriptionLegacySecrets.join(',');

    const credentialRotation = rotateCredentialSecret(nextValues.credentialsSecret);
    process.env.CREDENTIALS_SECRET = config.credentials.secret;
    const subscriptionRotation = subscriptionTokenStore.rotateSecrets();

    const remainingIssues = collectStrictSecurityIssues();
    if (remainingIssues.length > 0) {
        throw new Error('安全启动向导仍存在未解决项，请检查输入值');
    }

    writeEnvSecurityOverrides(envFile, {
        ...envUpdates,
        CREDENTIALS_LEGACY_SECRETS: Array.isArray(config.credentials?.legacySecrets)
            ? config.credentials.legacySecrets.join(',')
            : '',
    });

    const refreshedAdmin = userStore.getById(currentAdmin.id);
    const token = buildSignedToken(refreshedAdmin);

    return {
        token,
        user: buildSessionUser(refreshedAdmin),
        stats: buildBootstrapStats(),
        credentialRotation,
        subscriptionRotation,
        envFile: resolveSecurityEnvFile(),
    };
}

export function generateBootstrapSecret(length: number = 48): string {
    return crypto.randomBytes(Math.max(24, Number(length) || 48)).toString('base64url');
}
