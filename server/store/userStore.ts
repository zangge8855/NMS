import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { checkAccountPassword } from '../lib/passwordValidator.js';
import { validateSubscriptionAliasPath } from '../lib/subscriptionAlias.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';
import type { User, SanitizedUser } from '../types/index.js';

const USERS_FILE = path.join(config.dataDir, 'users.json');

/**
 * 用户角色定义
 *   admin    — 全部权限
 *   user     — 普通用户, 仅可查看自己的订阅连接
 */
export const ROLES = {
    admin: 'admin',
    user: 'user',
} as const;

export type RoleType = (typeof ROLES)[keyof typeof ROLES];
const ROLE_LIST = Object.values(ROLES);

function normalizeRole(role: unknown, options: { strict?: boolean } = {}): string {
    const strict = options.strict === true;
    const text = String(role || '').trim().toLowerCase();
    if (text === ROLES.admin) return ROLES.admin;
    if (text === 'operator' || text === 'viewer' || text === ROLES.user) return ROLES.user;
    return strict ? '' : ROLES.user;
}

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_LEGACY_ITERATIONS = 10_000;

function hashPassword(password: string, salt?: string): { hash: string; salt: string; iterations: number } {
    if (!salt) salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
    return { hash, salt, iterations: PBKDF2_ITERATIONS };
}

function verifyPassword(password: string | Buffer, hash: string, salt: string, iterations: number = 0): boolean {
    const iter = Number(iterations) > 0 ? Number(iterations) : PBKDF2_LEGACY_ITERATIONS;
    const result = crypto.pbkdf2Sync(password, salt, iter, 64, 'sha512').toString('hex');
    if (result.length !== hash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(result, 'hex'), Buffer.from(hash, 'hex'));
}

function normalizeEmailValue(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function normalizeUsernameValue(value: unknown): string {
    return String(value || '').trim();
}

function hasSubscriptionBindingField(user: unknown): boolean {
    return !!user && typeof user === 'object' && Object.prototype.hasOwnProperty.call(user, 'subscriptionEmail');
}

function resolveSubscriptionEmail(user: unknown): string {
    if (!user || typeof user !== 'object') return '';
    if (hasSubscriptionBindingField(user)) {
        return normalizeEmailValue((user as any).subscriptionEmail);
    }
    return normalizeEmailValue((user as any).email);
}

function resolveSubscriptionAliasPath(user: unknown): string {
    if (!user || typeof user !== 'object') return '';
    return String((user as any).subscriptionAliasPath || '').trim().toLowerCase();
}

function normalizeOptionalText(value: unknown): string | null {
    const text = String(value || '').trim();
    return text || null;
}

function normalizeGroupId(value: unknown): string {
    return String(value || '').trim();
}

class UserStore {
    users: any[];

    constructor() {
        this._ensureDataDir();
        this.users = this._load();
        this._ensureDefaultAdmin();
    }

    _ensureDataDir(): void {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    _load(): any[] {
        if (!fs.existsSync(USERS_FILE)) return [];
        try {
            const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
            if (!Array.isArray(parsed)) {
                throw new Error('Data in users.json is not a JSON array');
            }
            return parsed.map((item: any) => {
                const email = normalizeEmailValue(item?.email);
                const subscriptionEmail = hasSubscriptionBindingField(item)
                    ? normalizeEmailValue(item?.subscriptionEmail)
                    : email;
                const aliasCheck = validateSubscriptionAliasPath(item?.subscriptionAliasPath);
                const enabled = normalizeRole(item?.role) === ROLES.admin
                    ? true
                    : (item?.enabled !== undefined ? !!item.enabled : true);
                return {
                    ...item,
                    role: normalizeRole(item?.role),
                    email,
                    subscriptionEmail,
                    subscriptionAliasPath: aliasCheck.ok ? aliasCheck.value : '',
                    enabled,
                    profileVerifyCode: normalizeOptionalText(item?.profileVerifyCode),
                    profileVerifyCodeExpiresAt: normalizeOptionalText(item?.profileVerifyCodeExpiresAt),
                    profileVerifyTargetEmail: normalizeEmailValue(item?.profileVerifyTargetEmail),
                    profileVerifyUsername: normalizeUsernameValue(item?.profileVerifyUsername),
                    profileVerifyEmail: normalizeEmailValue(item?.profileVerifyEmail),
                    groupId: normalizeGroupId(item?.groupId),
                    passkeys: Array.isArray(item.passkeys) ? item.passkeys : [],
                };
            });
        } catch (e: any) {
            console.error('CRITICAL: Failed to load users.json:', e.message);
            throw e;
        }
    }

    _save(): void {
        saveObjectAtomic(USERS_FILE, this.users);
        mirrorStoreSnapshot('users', this.exportState());
    }

    /** 确保至少有一个 admin 用户 (使用 config 中的 ADMIN_PASSWORD) */
    _ensureDefaultAdmin(): void {
        const hasAdmin = this.users.some(u => u.role === ROLES.admin);
        if (!hasAdmin) {
            const adminUsername = String(config.auth.adminUsername || 'admin').trim() || 'admin';
            const adminPassword = config.auth.adminPassword;
            const { hash, salt, iterations } = hashPassword(adminPassword);
            this.users.push({
                id: crypto.randomUUID(),
                username: adminUsername,
                passwordHash: hash,
                passwordSalt: salt,
                pbkdf2Iterations: iterations,
                role: ROLES.admin,
                enabled: true,
                subscriptionEmail: '',
                subscriptionAliasPath: '',
                groupId: '',
                profileVerifyCode: null,
                profileVerifyCodeExpiresAt: null,
                profileVerifyTargetEmail: '',
                profileVerifyUsername: '',
                profileVerifyEmail: '',
                createdAt: new Date().toISOString(),
                passkeys: [],
            });
            this._save();
            console.log(`  👤 Default admin user created (username: ${adminUsername})`);
        }
    }

    getAll(): SanitizedUser[] {
        return this.users.map(u => ({
            id: u.id,
            username: u.username,
            email: normalizeEmailValue(u.email),
            subscriptionEmail: resolveSubscriptionEmail(u),
            subscriptionAliasPath: resolveSubscriptionAliasPath(u),
            groupId: normalizeGroupId(u.groupId),
            emailVerified: !!u.emailVerified,
            role: u.role,
            enabled: u.enabled !== false,
            createdAt: u.createdAt,
            lastLoginAt: u.lastLoginAt || null,
        })) as SanitizedUser[];
    }

    getById(id: string): any {
        return this.users.find(u => u.id === id) || null;
    }

    getByUsername(username: string): any {
        const normalized = normalizeUsernameValue(username);
        if (!normalized) return null;
        return this.users.find(u => normalizeUsernameValue(u.username) === normalized) || null;
    }

    getByEmail(email: string): any {
        const normalized = normalizeEmailValue(email);
        if (!normalized) return null;
        return this.users.find(u => normalizeEmailValue(u.email) === normalized) || null;
    }

    getByLoginIdentifier(identifier: string): any {
        const normalizedIdentifier = normalizeUsernameValue(identifier);
        if (!normalizedIdentifier) return null;

        const normalizedEmail = normalizeEmailValue(identifier);
        if (normalizedEmail && normalizedEmail.includes('@')) {
            const userByEmail = this.getByEmail(normalizedEmail);
            if (userByEmail) return userByEmail;
        }

        return this.getByUsername(normalizedIdentifier);
    }

    getBySubscriptionEmail(subscriptionEmail: string): any {
        const normalized = normalizeEmailValue(subscriptionEmail);
        if (!normalized) return null;
        return this.users.find(u => resolveSubscriptionEmail(u) === normalized) || null;
    }

    getBySubscriptionAliasPath(subscriptionAliasPath: string): any {
        const normalized = String(subscriptionAliasPath || '').trim().toLowerCase();
        if (!normalized) return null;
        return this.users.find((user) => resolveSubscriptionAliasPath(user) === normalized) || null;
    }

    /**
     * 验证用户凭据
     * @returns 用户对象 (不含密码) 或 null
     */
    authenticate(identifier: string, password: string): { id: string; username: string; role: string } | null {
        const normalizedIdentifier = normalizeUsernameValue(identifier);
        const hasPassword = typeof password === 'string' || Buffer.isBuffer(password);

        // 兼容旧版单密码登录: 无用户名时用 config.auth.adminPassword
        if (config.auth.allowLegacyPasswordLogin && !normalizedIdentifier && hasPassword && password === config.auth.adminPassword) {
            const admin = this.users.find(u => u.role === ROLES.admin);
            if (admin) {
                admin.lastLoginAt = new Date().toISOString();
                this._save();
                return { id: admin.id, username: admin.username, role: admin.role };
            }
        }

        if (!hasPassword) return null;

        const user = this.getByLoginIdentifier(normalizedIdentifier);
        if (!user) return null;
        if (!verifyPassword(password, user.passwordHash, user.passwordSalt, user.pbkdf2Iterations)) return null;
        user.lastLoginAt = new Date().toISOString();
        // Auto-upgrade hash to current iteration count on successful login
        if (!user.pbkdf2Iterations || user.pbkdf2Iterations < PBKDF2_ITERATIONS) {
            const { hash, salt, iterations } = hashPassword(password);
            user.passwordHash = hash;
            user.passwordSalt = salt;
            user.pbkdf2Iterations = iterations;
        }
        this._save();
        return { id: user.id, username: user.username, role: user.role };
    }

    add(payload: any = {}): any {
        const {
            username,
            password,
            role = ROLES.user,
            email = '',
            emailVerified = false,
            enabled = true,
            groupId = '',
        } = payload;
        const normalizedUsername = normalizeUsernameValue(username);
        if (!normalizedUsername || !password) throw new Error('用户名和密码不能为空');
        const normalizedRole = normalizeRole(role, { strict: true });
        if (!ROLE_LIST.includes(normalizedRole as any)) throw new Error(`无效角色: ${role}`);
        if (this.getByUsername(normalizedUsername)) throw new Error(`用户名 "${normalizedUsername}" 已存在`);
        const normalizedEmail = normalizeEmailValue(email);
        if (normalizedEmail && this.getByEmail(normalizedEmail)) throw new Error(`邮箱 "${normalizedEmail}" 已被注册`);
        const rawSubscriptionEmail = Object.prototype.hasOwnProperty.call(payload, 'subscriptionEmail')
            ? payload.subscriptionEmail
            : normalizedEmail;
        const normalizedSubscriptionEmail = normalizeEmailValue(rawSubscriptionEmail);
        const aliasCheck = validateSubscriptionAliasPath(payload.subscriptionAliasPath, {
            findByPath: (path: string) => this.getBySubscriptionAliasPath(path),
        });
        if (normalizedSubscriptionEmail) {
            const existingBinding = this.getBySubscriptionEmail(normalizedSubscriptionEmail);
            if (existingBinding) throw new Error(`订阅绑定邮箱 "${normalizedSubscriptionEmail}" 已被其他账号占用`);
        }
        if (!aliasCheck.ok) throw new Error(aliasCheck.message);

        const passwordCheck = checkAccountPassword(password);
        if (!passwordCheck.valid) throw new Error(passwordCheck.reason);

        const { hash, salt, iterations } = hashPassword(password);
        const user = {
            id: crypto.randomUUID(),
            username: normalizedUsername,
            email: normalizedEmail,
            subscriptionEmail: normalizedSubscriptionEmail,
            subscriptionAliasPath: aliasCheck.value,
            groupId: normalizeGroupId(groupId),
            emailVerified: !!emailVerified,
            enabled: !!enabled,
            verifyCode: null,
            verifyCodeExpiresAt: null,
            resetCode: null,
            resetCodeExpiresAt: null,
            profileVerifyCode: null,
            profileVerifyCodeExpiresAt: null,
            profileVerifyTargetEmail: '',
            profileVerifyUsername: '',
            profileVerifyEmail: '',
            passwordHash: hash,
            passwordSalt: salt,
            pbkdf2Iterations: iterations,
            role: normalizedRole,
            createdAt: new Date().toISOString(),
            passkeys: [],
        };
        this.users.push(user);
        this._save();
        return {
            id: user.id,
            username: user.username,
            email: user.email,
            subscriptionEmail: resolveSubscriptionEmail(user),
            subscriptionAliasPath: resolveSubscriptionAliasPath(user),
            groupId: normalizeGroupId(user.groupId),
            emailVerified: user.emailVerified,
            enabled: user.enabled !== false,
            role: user.role,
            createdAt: user.createdAt
        };
    }

    update(id: string, data: any): any {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return null;

        if (Object.prototype.hasOwnProperty.call(data, 'username')) {
            const nextUsername = normalizeUsernameValue(data.username);
            if (!nextUsername) throw new Error('用户名不能为空');
            const existing = this.getByUsername(nextUsername);
            if (existing && existing.id !== id) throw new Error(`用户名 "${nextUsername}" 已存在`);
            this.users[idx].username = nextUsername;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'email')) {
            const nextEmail = normalizeEmailValue(data.email);
            if (nextEmail) {
                const existing = this.getByEmail(nextEmail);
                if (existing && existing.id !== id) throw new Error(`邮箱 "${nextEmail}" 已被注册`);
            }
            this.users[idx].email = nextEmail;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'emailVerified')) {
            this.users[idx].emailVerified = data.emailVerified === true;
            if (this.users[idx].emailVerified) {
                this.users[idx].verifyCode = null;
                this.users[idx].verifyCodeExpiresAt = null;
            }
        }
        if (Object.prototype.hasOwnProperty.call(data, 'subscriptionEmail')) {
            const nextBinding = normalizeEmailValue(data.subscriptionEmail);
            if (nextBinding) {
                const existing = this.getBySubscriptionEmail(nextBinding);
                if (existing && existing.id !== id) throw new Error(`订阅绑定邮箱 "${nextBinding}" 已被其他账号占用`);
            }
            this.users[idx].subscriptionEmail = nextBinding;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'subscriptionAliasPath')) {
            const aliasCheck = validateSubscriptionAliasPath(data.subscriptionAliasPath, {
                findByPath: (path: string) => this.getBySubscriptionAliasPath(path),
                excludeUserId: id,
            });
            if (!aliasCheck.ok) throw new Error(aliasCheck.message);
            this.users[idx].subscriptionAliasPath = aliasCheck.value;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'groupId')) {
            this.users[idx].groupId = normalizeGroupId(data.groupId);
        }
        if (data.password) {
            const passwordCheck = checkAccountPassword(data.password);
            if (!passwordCheck.valid) throw new Error(passwordCheck.reason);
            const { hash, salt, iterations } = hashPassword(data.password);
            this.users[idx].passwordHash = hash;
            this.users[idx].passwordSalt = salt;
            this.users[idx].pbkdf2Iterations = iterations;
            this.users[idx].resetCode = null;
            this.users[idx].resetCodeExpiresAt = null;
        }
        if (data.role) {
            const normalizedRole = normalizeRole(data.role, { strict: true });
            if (ROLE_LIST.includes(normalizedRole as any)) {
                this.users[idx].role = normalizedRole;
            } else {
                throw new Error(`无效角色: ${data.role}`);
            }
        }

        this._save();
        return {
            id: this.users[idx].id,
            username: this.users[idx].username,
            email: normalizeEmailValue(this.users[idx].email),
            subscriptionEmail: resolveSubscriptionEmail(this.users[idx]),
            subscriptionAliasPath: resolveSubscriptionAliasPath(this.users[idx]),
            groupId: normalizeGroupId(this.users[idx].groupId),
            emailVerified: !!this.users[idx].emailVerified,
            enabled: this.users[idx].enabled !== false,
            role: this.users[idx].role,
            createdAt: this.users[idx].createdAt,
        };
    }

    setSubscriptionEmail(id: string, subscriptionEmail: string = ''): any {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return null;
        const nextBinding = normalizeEmailValue(subscriptionEmail);
        if (nextBinding) {
            const existing = this.getBySubscriptionEmail(nextBinding);
            if (existing && existing.id !== id) throw new Error(`订阅绑定邮箱 "${nextBinding}" 已被其他账号占用`);
        }
        this.users[idx].subscriptionEmail = nextBinding;
        this._save();
        return {
            id: this.users[idx].id,
            username: this.users[idx].username,
            email: normalizeEmailValue(this.users[idx].email),
            subscriptionEmail: resolveSubscriptionEmail(this.users[idx]),
            subscriptionAliasPath: resolveSubscriptionAliasPath(this.users[idx]),
            groupId: normalizeGroupId(this.users[idx].groupId),
            emailVerified: !!this.users[idx].emailVerified,
            enabled: this.users[idx].enabled !== false,
            role: this.users[idx].role,
            createdAt: this.users[idx].createdAt,
        };
    }

    setProfileUpdateVerification(id: string, payload: any = {}): any {
        const idx = this.users.findIndex((u) => u.id === id);
        if (idx === -1) return null;

        this.users[idx].profileVerifyCode = normalizeOptionalText(payload.code);
        this.users[idx].profileVerifyCodeExpiresAt = normalizeOptionalText(payload.expiresAt);
        this.users[idx].profileVerifyTargetEmail = normalizeEmailValue(payload.targetEmail);
        this.users[idx].profileVerifyUsername = normalizeUsernameValue(payload.username);
        this.users[idx].profileVerifyEmail = normalizeEmailValue(payload.email);
        this._save();
        return {
            id: this.users[idx].id,
            profileVerifyTargetEmail: this.users[idx].profileVerifyTargetEmail,
            profileVerifyUsername: this.users[idx].profileVerifyUsername,
            profileVerifyEmail: this.users[idx].profileVerifyEmail,
        };
    }

    clearProfileUpdateVerification(id: string): any {
        const idx = this.users.findIndex((u) => u.id === id);
        if (idx === -1) return null;

        this.users[idx].profileVerifyCode = null;
        this.users[idx].profileVerifyCodeExpiresAt = null;
        this.users[idx].profileVerifyTargetEmail = '';
        this.users[idx].profileVerifyUsername = '';
        this.users[idx].profileVerifyEmail = '';
        this._save();
        return {
            id: this.users[idx].id,
            username: this.users[idx].username,
            email: normalizeEmailValue(this.users[idx].email),
        };
    }

    setEnabled(id: string, enabled: boolean): any {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return null;
        this.users[idx].enabled = !!enabled;
        this._save();
        return {
            id: this.users[idx].id,
            username: this.users[idx].username,
            email: normalizeEmailValue(this.users[idx].email),
            subscriptionEmail: resolveSubscriptionEmail(this.users[idx]),
            subscriptionAliasPath: resolveSubscriptionAliasPath(this.users[idx]),
            groupId: normalizeGroupId(this.users[idx].groupId),
            emailVerified: !!this.users[idx].emailVerified,
            enabled: this.users[idx].enabled !== false,
            role: this.users[idx].role,
            createdAt: this.users[idx].createdAt,
        };
    }

    /** 设置邮箱验证码 */
    setVerifyCode(id: string, code: string, expiresAt: number | string): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        this.users[idx].verifyCode = code;
        this.users[idx].verifyCodeExpiresAt = expiresAt;
        this._save();
        return true;
    }

    /** 标记邮箱已验证 */
    setEmailVerified(id: string): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        this.users[idx].emailVerified = true;
        this.users[idx].verifyCode = null;
        this.users[idx].verifyCodeExpiresAt = null;
        this._save();
        return true;
    }

    /** 设置密码重置验证码 */
    setPasswordResetCode(id: string, code: string, expiresAt: number | string): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        this.users[idx].resetCode = code;
        this.users[idx].resetCodeExpiresAt = expiresAt;
        this._save();
        return true;
    }

    /** 清除密码重置验证码 */
    clearPasswordResetCode(id: string): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        this.users[idx].resetCode = null;
        this.users[idx].resetCodeExpiresAt = null;
        this._save();
        return true;
    }

    /** 启用/更新二步验证 */
    setTwoFactor(id: string, { secret, backupCodeHashes }: { secret: string; backupCodeHashes?: string[] }): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        const trimmedSecret = String(secret || '').trim();
        if (!trimmedSecret) return false;
        this.users[idx].twoFactor = {
            enabled: true,
            secret: trimmedSecret,
            backupCodeHashes: Array.isArray(backupCodeHashes) ? backupCodeHashes.slice() : [],
            enabledAt: new Date().toISOString(),
        };
        this._save();
        return true;
    }

    /** 关闭二步验证 */
    clearTwoFactor(id: string): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        if (!this.users[idx].twoFactor) return true;
        this.users[idx].twoFactor = null;
        this._save();
        return true;
    }

    /** 读取二步验证状态(含 secret 供登录校验) */
    getTwoFactor(id: string): any {
        const user = this.users.find(u => u.id === id);
        if (!user || !user.twoFactor || user.twoFactor.enabled !== true) return null;
        return {
            enabled: true,
            secret: String(user.twoFactor.secret || ''),
            backupCodeHashes: Array.isArray(user.twoFactor.backupCodeHashes) ? user.twoFactor.backupCodeHashes.slice() : [],
            enabledAt: user.twoFactor.enabledAt || '',
        };
    }

    /** 消耗一个备用码,返回剩余的 hash 列表 */
    consumeTwoFactorBackupCode(id: string, remainingHashes: string[]): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        if (!this.users[idx].twoFactor) return false;
        this.users[idx].twoFactor.backupCodeHashes = Array.isArray(remainingHashes) ? remainingHashes.slice() : [];
        this._save();
        return true;
    }

    /** 获取用户的 Passkey 列表 */
    getPasskeys(id: string): any[] {
        const user = this.users.find(u => u.id === id);
        if (!user || !Array.isArray(user.passkeys)) return [];
        return user.passkeys;
    }

    /** 查找拥有指定 Passkey Credential ID 的用户 */
    findUserByPasskeyId(credentialId: string): any {
        const targetId = String(credentialId || '').trim();
        if (!targetId) return null;
        return this.users.find(u => Array.isArray(u.passkeys) && u.passkeys.some((pk: any) => pk.id === targetId || pk.credentialID === targetId)) || null;
    }

    /** 添加 Passkey */
    addPasskey(id: string, passkey: any): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        if (!Array.isArray(this.users[idx].passkeys)) {
            this.users[idx].passkeys = [];
        }
        const passkeyId = passkey.id || passkey.credentialID;
        // 检查是否已存在相同 ID
        const existingIdx = this.users[idx].passkeys.findIndex((pk: any) => (pk.id && pk.id === passkeyId) || (pk.credentialID && pk.credentialID === passkeyId));
        if (existingIdx !== -1) {
            this.users[idx].passkeys[existingIdx] = passkey;
        } else {
            this.users[idx].passkeys.push(passkey);
        }
        this._save();
        return true;
    }

    /** 移除 Passkey */
    removePasskey(userId: string, passkeyId: string): boolean {
        const idx = this.users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        if (!Array.isArray(this.users[idx].passkeys)) return false;
        const initialLen = this.users[idx].passkeys.length;
        this.users[idx].passkeys = this.users[idx].passkeys.filter((pk: any) => pk.id !== passkeyId && pk.credentialID !== passkeyId);
        if (this.users[idx].passkeys.length !== initialLen) {
            this._save();
            return true;
        }
        return false;
    }

    /** 重命名 Passkey 设备名称 */
    renamePasskey(userId: string, passkeyId: string, deviceName: string): boolean {
        const idx = this.users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        if (!Array.isArray(this.users[idx].passkeys)) return false;
        const pk = this.users[idx].passkeys.find((p: any) => p.id === passkeyId || p.credentialID === passkeyId);
        if (!pk) return false;
        pk.deviceName = String(deviceName || 'Passkey 密钥').trim().slice(0, 50);
        this._save();
        return true;
    }

    /** 更新 Passkey 计数器与最后使用时间 */
    updatePasskeyCounter(userId: string, credentialId: string, newCounter: number): boolean {
        const idx = this.users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        if (!Array.isArray(this.users[idx].passkeys)) return false;
        const pk = this.users[idx].passkeys.find((p: any) => p.id === credentialId || p.credentialID === credentialId);
        if (!pk) return false;
        pk.counter = newCounter;
        pk.lastUsedAt = new Date().toISOString();
        this.users[idx].lastLoginAt = new Date().toISOString();
        this._save();
        return true;
    }

    remove(id: string): boolean {
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        // 不允许删除最后一个 admin
        if (this.users[idx].role === ROLES.admin) {
            const adminCount = this.users.filter(u => u.role === ROLES.admin).length;
            if (adminCount <= 1) throw new Error('不能删除最后一个管理员');
        }
        this.users.splice(idx, 1);
        this._save();
        return true;
    }

    exportState(): any {
        return {
            users: this.users,
        };
    }

    importState(snapshot: any = {}): void {
        if (!snapshot || !Array.isArray(snapshot?.users)) {
            throw new Error('Invalid snapshot format for UserStore: users array is missing');
        }
        this.users = snapshot.users.map((item: any) => {
            const aliasCheck = validateSubscriptionAliasPath(item?.subscriptionAliasPath);
            return {
                ...item,
                email: normalizeEmailValue(item?.email),
                subscriptionEmail: Object.prototype.hasOwnProperty.call(item || {}, 'subscriptionEmail')
                    ? normalizeEmailValue(item?.subscriptionEmail)
                    : normalizeEmailValue(item?.email),
                subscriptionAliasPath: aliasCheck.ok ? aliasCheck.value : '',
                groupId: normalizeGroupId(item?.groupId),
                passkeys: Array.isArray(item.passkeys) ? item.passkeys : [],
            };
        });
        this._ensureDefaultAdmin();
    }
}

const userStore = new UserStore();
export default userStore;
