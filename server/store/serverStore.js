import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { mirrorStoreSnapshot, shouldWriteFile } from './dbMirror.js';

const SERVERS_FILE = path.join(config.dataDir, 'servers.json');
const PASSWORD_ENC_PREFIX = 'enc:v1';
const PASSWORD_ENC_ALGO = 'aes-256-gcm';
const BUILTIN_LEGACY_CREDENTIAL_SECRETS = [
    // Backward compatibility for very early local installs.
    'default-secret-change-me',
];
const ALLOWED_ENVIRONMENTS = new Set([
    'production',
    'staging',
    'development',
    'testing',
    'dr',
    'sandbox',
    'unknown',
]);
const ALLOWED_HEALTH = new Set([
    'unknown',
    'healthy',
    'degraded',
    'unreachable',
    'maintenance',
]);

/**
 * Server Registry — manages multiple 3x-ui panel connections.
 * Stores server configs in a JSON file.
 */
class ServerStore {
    constructor() {
        this._ensureDataDir();
        this.servers = this._load();
        this.decryptWarningCache = new Set();
        this._migrateLegacyPasswords();
        this._migrateGovernanceFields();
        // In-memory session cookies keyed by server ID
        this.sessions = new Map();
    }

    _ensureDataDir() {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    _load() {
        try {
            if (fs.existsSync(SERVERS_FILE)) {
                return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf-8'));
            }
        } catch (e) {
            console.error('Failed to load servers.json:', e.message);
        }
        return [];
    }

    _save() {
        if (shouldWriteFile()) {
            fs.writeFileSync(SERVERS_FILE, JSON.stringify(this.servers, null, 2), 'utf-8');
        }
        mirrorStoreSnapshot('servers', this.exportState());
    }

    _credentialKeyFromSecret(secret) {
        return crypto.createHash('sha256').update(String(secret || '')).digest();
    }

    _credentialSecrets() {
        const primary = String(config.credentials?.secret || '').trim();
        const legacy = Array.isArray(config.credentials?.legacySecrets)
            ? config.credentials.legacySecrets
            : [];
        const jwtSecret = String(config.jwt?.secret || '').trim();
        const all = [primary, ...legacy, jwtSecret, ...BUILTIN_LEGACY_CREDENTIAL_SECRETS]
            .map((item) => String(item || '').trim())
            .filter(Boolean);
        return Array.from(new Set(all));
    }

    _credentialKey() {
        const [primary] = this._credentialSecrets();
        return this._credentialKeyFromSecret(primary || config.jwt.secret);
    }

    _credentialKeys() {
        const secrets = this._credentialSecrets();
        if (secrets.length === 0) {
            return [this._credentialKeyFromSecret(config.jwt.secret)];
        }
        return secrets.map((secret) => this._credentialKeyFromSecret(secret));
    }

    _isEncryptedPassword(value) {
        return typeof value === 'string' && value.startsWith(`${PASSWORD_ENC_PREFIX}:`);
    }

    _encryptPassword(password) {
        if (!password) return password;
        if (this._isEncryptedPassword(password)) return password;

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(PASSWORD_ENC_ALGO, this._credentialKey(), iv);
        const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${PASSWORD_ENC_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    _decryptPasswordDetailed(password) {
        if (password === undefined || password === null || password === '') {
            return {
                value: '',
                status: 'missing',
            };
        }
        if (!this._isEncryptedPassword(password)) {
            return {
                value: String(password),
                status: 'plaintext',
            };
        }
        const parts = password.split(':');
        if (parts.length < 5) {
            this._warnDecryptFailure(password, 'Invalid encrypted password format');
            return {
                value: '',
                status: 'unreadable',
            };
        }
        const prefix = `${parts[0]}:${parts[1]}`;
        if (prefix !== PASSWORD_ENC_PREFIX) {
            this._warnDecryptFailure(password, 'Unsupported encrypted password prefix');
            return {
                value: '',
                status: 'unreadable',
            };
        }
        const ivHex = parts[2];
        const tagHex = parts[3];
        const encHex = parts.slice(4).join(':');
        for (const key of this._credentialKeys()) {
            try {
                const decipher = crypto.createDecipheriv(
                    PASSWORD_ENC_ALGO,
                    key,
                    Buffer.from(ivHex, 'hex')
                );
                decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
                const decrypted = Buffer.concat([
                    decipher.update(Buffer.from(encHex, 'hex')),
                    decipher.final(),
                ]);
                return {
                    value: decrypted.toString('utf8'),
                    status: 'ok',
                };
            } catch {
                // Try next key.
            }
        }
        this._warnDecryptFailure(password, 'no matching credential key');
        return {
            value: '',
            status: 'unreadable',
        };
    }

    _decryptPassword(password) {
        return this._decryptPasswordDetailed(password).value;
    }

    _migrateLegacyPasswords() {
        let changed = false;
        this.servers = this.servers.map((server) => {
            let updated = { ...server };
            if (server.password && !this._isEncryptedPassword(server.password)) {
                changed = true;
                updated.password = this._encryptPassword(server.password);
            }
            if (server.sshPassword && !this._isEncryptedPassword(server.sshPassword)) {
                changed = true;
                updated.sshPassword = this._encryptPassword(server.sshPassword);
            }
            if (server.sshPrivateKey && !this._isEncryptedPassword(server.sshPrivateKey)) {
                changed = true;
                updated.sshPrivateKey = this._encryptPassword(server.sshPrivateKey);
            }
            return updated;
        });

        if (changed) {
            this._save();
            console.log('Migrated legacy plaintext server passwords to encrypted format.');
        }
    }

    _normalizeSshPort(value, fallback = 22) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
        return parsed;
    }

    _normalizeSshAuthMethod(value) {
        const method = String(value || '').trim().toLowerCase();
        return method === 'key' ? 'key' : 'password';
    }

    _normalizeSshUsername(value) {
        const username = String(value || '').trim();
        return username || 'root';
    }

    _normalizeGovernanceGroup(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        return text.slice(0, 64);
    }

    _normalizeGovernanceEnvironment(value) {
        const text = String(value || '').trim().toLowerCase();
        if (!text) return 'unknown';
        if (text === 'prod') return 'production';
        if (text === 'dev') return 'development';
        if (text === 'test') return 'testing';
        return ALLOWED_ENVIRONMENTS.has(text) ? text : 'unknown';
    }

    _normalizeGovernanceHealth(value) {
        const text = String(value || '').trim().toLowerCase();
        if (!text) return 'unknown';
        if (text === 'offline' || text === 'down') return 'unreachable';
        if (text === 'ok') return 'healthy';
        return ALLOWED_HEALTH.has(text) ? text : 'unknown';
    }

    _normalizeGovernanceTags(value) {
        let candidates = [];
        if (Array.isArray(value)) {
            candidates = value;
        } else if (typeof value === 'string') {
            candidates = value.split(',');
        } else if (value !== undefined && value !== null) {
            candidates = [value];
        }
        const seen = new Set();
        const tags = [];
        candidates.forEach((item) => {
            const tag = String(item || '').trim();
            if (!tag) return;
            const limited = tag.slice(0, 32);
            const dedupeKey = limited.toLowerCase();
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            tags.push(limited);
        });
        return tags.slice(0, 20);
    }

    _normalizeGovernanceFields(input = {}) {
        return {
            group: this._normalizeGovernanceGroup(input.group),
            tags: this._normalizeGovernanceTags(input.tags),
            environment: this._normalizeGovernanceEnvironment(input.environment),
            health: this._normalizeGovernanceHealth(input.health),
        };
    }

    _migrateGovernanceFields() {
        let changed = false;
        this.servers = this.servers.map((server) => {
            const normalized = this._normalizeGovernanceFields(server);
            const merged = {
                ...server,
                ...normalized,
            };
            if (
                merged.group !== server.group
                || JSON.stringify(merged.tags || []) !== JSON.stringify(server.tags || [])
                || merged.environment !== server.environment
                || merged.health !== server.health
            ) {
                changed = true;
            }
            return merged;
        });

        if (changed) {
            this._save();
        }
    }

    _hasSshCredentials(server) {
        return Boolean(server?.sshPassword || server?.sshPrivateKey);
    }

    _warnDecryptFailure(rawValue, reason) {
        const value = String(rawValue || '');
        const fingerprint = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
        const key = `${reason}:${fingerprint}`;
        if (this.decryptWarningCache.has(key)) return;
        this.decryptWarningCache.add(key);
        console.error(`Failed to decrypt server password: ${reason}`);
    }

    _resolveCredentialStatus(rawPassword) {
        const decrypted = this._decryptPasswordDetailed(rawPassword);
        if (decrypted.status === 'unreadable') return 'unreadable';
        if (!decrypted.value) return 'missing';
        return 'configured';
    }

    _publicServer(server) {
        return {
            id: server.id,
            name: server.name,
            url: server.url,
            basePath: server.basePath,
            username: server.username,
            sshPort: this._normalizeSshPort(server.sshPort, 22),
            sshUsername: this._normalizeSshUsername(server.sshUsername),
            sshAuthMethod: this._normalizeSshAuthMethod(server.sshAuthMethod),
            sshConfigured: this._hasSshCredentials(server),
            group: this._normalizeGovernanceGroup(server.group),
            tags: this._normalizeGovernanceTags(server.tags),
            environment: this._normalizeGovernanceEnvironment(server.environment),
            health: this._normalizeGovernanceHealth(server.health),
            credentialStatus: this._resolveCredentialStatus(server.password),
            createdAt: server.createdAt,
        };
    }

    getAll() {
        // Return without passwords for safety
        return this.servers.map((server) => this._publicServer(server));
    }

    getById(id) {
        const server = this.servers.find(s => s.id === id);
        if (!server) return null;
        const panelPassword = this._decryptPasswordDetailed(server.password);
        const credentialStatus = panelPassword.status === 'unreadable'
            ? 'unreadable'
            : (panelPassword.value ? 'configured' : 'missing');
        return {
            ...server,
            group: this._normalizeGovernanceGroup(server.group),
            tags: this._normalizeGovernanceTags(server.tags),
            environment: this._normalizeGovernanceEnvironment(server.environment),
            health: this._normalizeGovernanceHealth(server.health),
            password: panelPassword.value,
            credentialStatus,
            credentialUnreadable: panelPassword.status === 'unreadable',
            sshPort: this._normalizeSshPort(server.sshPort, 22),
            sshUsername: this._normalizeSshUsername(server.sshUsername),
            sshAuthMethod: this._normalizeSshAuthMethod(server.sshAuthMethod),
            sshPassword: this._decryptPassword(server.sshPassword),
            sshPrivateKey: this._decryptPassword(server.sshPrivateKey),
        };
    }

    _normalizeBasePath(basePath) {
        if (!basePath || basePath === '/') return '/';
        let normalized = String(basePath).trim();
        if (!normalized.startsWith('/')) {
            normalized = `/${normalized}`;
        }
        normalized = normalized.replace(/\/+$/, '');
        return normalized || '/';
    }

    add({
        name,
        url,
        basePath,
        username,
        password,
        group,
        tags,
        environment,
        health,
        sshPort,
        sshUsername,
        sshPassword,
        sshPrivateKey,
        sshAuthMethod,
    }) {
        const governance = this._normalizeGovernanceFields({
            group,
            tags,
            environment,
            health,
        });
        const server = {
            id: crypto.randomUUID(),
            name: name || 'Unnamed Server',
            url: url.replace(/\/+$/, ''),   // trim trailing slash
            basePath: this._normalizeBasePath(basePath),
            username,
            ...governance,
            password: this._encryptPassword(password),
            sshPort: this._normalizeSshPort(sshPort, 22),
            sshUsername: this._normalizeSshUsername(sshUsername),
            sshAuthMethod: this._normalizeSshAuthMethod(sshAuthMethod),
            sshPassword: this._encryptPassword(sshPassword || ''),
            sshPrivateKey: this._encryptPassword(sshPrivateKey || ''),
            createdAt: new Date().toISOString(),
        };
        this.servers.push(server);
        this._save();
        return this._publicServer(server);
    }

    update(id, data) {
        const idx = this.servers.findIndex(s => s.id === id);
        if (idx === -1) return null;
        const encryptedFields = new Set(['password', 'sshPassword', 'sshPrivateKey']);
        const allowed = [
            'name',
            'url',
            'basePath',
            'username',
            'group',
            'tags',
            'environment',
            'health',
            'password',
            'sshPort',
            'sshUsername',
            'sshPassword',
            'sshPrivateKey',
            'sshAuthMethod',
        ];
        for (const key of allowed) {
            if (data[key] !== undefined) {
                if (encryptedFields.has(key) && data[key] === '') {
                    continue;
                }
                if (encryptedFields.has(key)) {
                    this.servers[idx][key] = this._encryptPassword(data[key]);
                    continue;
                }
                if (key === 'sshPort') {
                    this.servers[idx][key] = this._normalizeSshPort(data[key], this._normalizeSshPort(this.servers[idx].sshPort, 22));
                    continue;
                }
                if (key === 'sshUsername') {
                    this.servers[idx][key] = this._normalizeSshUsername(data[key]);
                    continue;
                }
                if (key === 'sshAuthMethod') {
                    this.servers[idx][key] = this._normalizeSshAuthMethod(data[key]);
                    continue;
                }
                if (key === 'group') {
                    this.servers[idx][key] = this._normalizeGovernanceGroup(data[key]);
                    continue;
                }
                if (key === 'tags') {
                    this.servers[idx][key] = this._normalizeGovernanceTags(data[key]);
                    continue;
                }
                if (key === 'environment') {
                    this.servers[idx][key] = this._normalizeGovernanceEnvironment(data[key]);
                    continue;
                }
                if (key === 'health') {
                    this.servers[idx][key] = this._normalizeGovernanceHealth(data[key]);
                    continue;
                }
                this.servers[idx][key] = data[key];
            }
        }
        if (data.url) {
            this.servers[idx].url = data.url.replace(/\/+$/, '');
        }
        if (data.basePath !== undefined) {
            this.servers[idx].basePath = this._normalizeBasePath(data.basePath);
        }
        this._save();
        // Clear cached session since credentials may have changed
        this.sessions.delete(id);
        const s = this.servers[idx];
        return this._publicServer(s);
    }

    remove(id) {
        const idx = this.servers.findIndex(s => s.id === id);
        if (idx === -1) return false;
        this.servers.splice(idx, 1);
        this._save();
        this.sessions.delete(id);
        return true;
    }

    // Session management
    getSession(id) {
        return this.sessions.get(id) || null;
    }

    setSession(id, cookie) {
        this.sessions.set(id, cookie);
    }

    clearSession(id) {
        this.sessions.delete(id);
    }

    rotateCredentials(options = {}) {
        const dryRun = options?.dryRun === true;
        const encryptedFields = ['password', 'sshPassword', 'sshPrivateKey'];
        let scannedFields = 0;
        let rotatedFields = 0;
        let failedFields = 0;
        let migratedPlaintext = 0;

        const nextServers = this.servers.map((server) => {
            const updated = { ...server };

            for (const field of encryptedFields) {
                const rawValue = updated[field];
                if (rawValue === undefined || rawValue === null || rawValue === '') continue;
                scannedFields += 1;

                if (!this._isEncryptedPassword(rawValue)) {
                    updated[field] = this._encryptPassword(rawValue);
                    rotatedFields += 1;
                    migratedPlaintext += 1;
                    continue;
                }

                const plaintext = this._decryptPassword(rawValue);
                if (!plaintext) {
                    failedFields += 1;
                    continue;
                }
                const reEncrypted = this._encryptPassword(plaintext);
                if (reEncrypted !== rawValue) {
                    updated[field] = reEncrypted;
                    rotatedFields += 1;
                }
            }

            return updated;
        });

        if (!dryRun && rotatedFields > 0) {
            this.servers = nextServers;
            this._save();
        }

        return {
            dryRun,
            totalServers: this.servers.length,
            scannedFields,
            rotatedFields,
            migratedPlaintext,
            failedFields,
        };
    }

    exportState() {
        return {
            servers: this.servers,
        };
    }

    importState(snapshot = {}) {
        const nextServers = Array.isArray(snapshot?.servers) ? snapshot.servers : [];
        this.servers = nextServers;
        this._migrateLegacyPasswords();
        this._migrateGovernanceFields();
    }
}

// Singleton
const serverStore = new ServerStore();
export default serverStore;
