import crypto from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import userStore from '../store/userStore.js';
import serverStore from '../store/serverStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import {
    DEFAULT_ENV_FILE,
    collectSecurityIssues,
    isWeakAdminPassword,
    isWeakAdminUsername,
    isWeakCredentialsSecret,
    isWeakJwtSecret,
} from './startupPreflight.js';

function normalizeText(value) {
    return String(value || '').trim();
}

function quoteEnvValue(value) {
    const text = String(value ?? '');
    if (!text) return '""';
    return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : JSON.stringify(text);
}

export function writeEnvSecurityOverrides(filePath = DEFAULT_ENV_FILE, updates = {}) {
    const targetPath = String(filePath || DEFAULT_ENV_FILE).trim() || DEFAULT_ENV_FILE;
    const source = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
    const lines = source ? source.split(/\r?\n/) : [];
    const pending = new Map(Object.entries(updates));
    const nextLines = lines.map((line) => {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/);
        if (!match) return line;
        const key = match[1];
        if (!pending.has(key)) return line;
        const nextValue = pending.get(key);
        pending.delete(key);
        return `${key}=${quoteEnvValue(nextValue)}`;
    });

    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== '') {
        nextLines.push('');
    }

    for (const [key, value] of pending.entries()) {
        nextLines.push(`${key}=${quoteEnvValue(value)}`);
    }

    fs.writeFileSync(targetPath, `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`, 'utf8');
    return targetPath;
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

function buildSessionUser(user) {
    return {
        username: String(user?.username || '').trim(),
        role: String(user?.role || 'admin').trim() || 'admin',
        email: String(user?.email || '').trim(),
        subscriptionEmail: String(user?.subscriptionEmail || '').trim(),
        emailVerified: user?.emailVerified === true,
    };
}

function resolveCurrentAdmin(currentUser = {}) {
    const userId = normalizeText(currentUser.userId);
    const username = normalizeText(currentUser.username);
    const admin = (userId ? userStore.getById(userId) : null) || (username ? userStore.getByUsername(username) : null);

    if (!admin || admin.role !== 'admin') {
        throw new Error('当前会话未绑定有效管理员账号');
    }

    return admin;
}

function buildSignedToken(user) {
    return jwt.sign({
        userId: normalizeText(user?.id),
        role: String(user?.role || 'admin').trim() || 'admin',
        username: normalizeText(user?.username),
    }, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
    });
}

function validateBootstrapPayload(payload = {}, currentUser = {}) {
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

function rotateCredentialSecret(nextSecret) {
    const previousSecret = normalizeText(config.credentials?.secret || '');
    const previousLegacySecrets = Array.isArray(config.credentials?.legacySecrets)
        ? config.credentials.legacySecrets.map((item) => normalizeText(item)).filter(Boolean)
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

export function getSecurityBootstrapStatus(currentUser = {}) {
    const currentAdmin = resolveCurrentAdmin(currentUser);
    const issues = collectStrictSecurityIssues();

    return {
        required: issues.length > 0,
        issues,
        admin: {
            username: normalizeText(currentAdmin.username),
        },
        stats: buildBootstrapStats(),
        envFile: DEFAULT_ENV_FILE,
    };
}

export function applySecurityBootstrap(payload = {}, currentUser = {}) {
    const currentAdmin = resolveCurrentAdmin(currentUser);
    const nextValues = validateBootstrapPayload(payload, currentUser);
    const envUpdates = {
        JWT_SECRET: nextValues.jwtSecret,
        ADMIN_USERNAME: nextValues.adminUsername,
        ADMIN_PASSWORD: nextValues.adminPassword,
        CREDENTIALS_SECRET: nextValues.credentialsSecret,
    };

    writeEnvSecurityOverrides(DEFAULT_ENV_FILE, envUpdates);

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

    const credentialRotation = rotateCredentialSecret(nextValues.credentialsSecret);
    process.env.CREDENTIALS_SECRET = config.credentials.secret;

    const remainingIssues = collectStrictSecurityIssues();
    if (remainingIssues.length > 0) {
        throw new Error('安全启动向导仍存在未解决项，请检查输入值');
    }

    writeEnvSecurityOverrides(DEFAULT_ENV_FILE, {
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
        envFile: DEFAULT_ENV_FILE,
    };
}

export function generateBootstrapSecret(length = 48) {
    return crypto.randomBytes(Math.max(24, Number(length) || 48)).toString('base64url');
}
