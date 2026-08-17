import userStore from '../store/userStore.js';
import type { User, SanitizedUser } from '../types/index.js';

const userRepository = {
    list(): SanitizedUser[] {
        return userStore.getAll();
    },

    add(payload: any): SanitizedUser {
        return userStore.add(payload);
    },

    getById(id: string): SanitizedUser | undefined {
        return userStore.getById(id);
    },

    getByUsername(username: string): User | undefined {
        return userStore.getByUsername(username);
    },

    getByEmail(email: string): User | undefined {
        return userStore.getByEmail(email);
    },

    getByLoginIdentifier(identifier: string): User | undefined {
        return userStore.getByLoginIdentifier(identifier);
    },

    getBySubscriptionEmail(email: string): User | undefined {
        return userStore.getBySubscriptionEmail(email);
    },

    getBySubscriptionAliasPath(path: string): User | undefined {
        return userStore.getBySubscriptionAliasPath(path);
    },

    authenticate(identifier: string, password: string): any {
        return userStore.authenticate(identifier, password);
    },

    setSubscriptionEmail(id: string, email: string): SanitizedUser {
        return userStore.setSubscriptionEmail(id, email);
    },

    setEnabled(id: string, enabled: boolean): SanitizedUser {
        return userStore.setEnabled(id, enabled);
    },

    update(id: string, data: any): SanitizedUser {
        return userStore.update(id, data);
    },

    remove(id: string): boolean {
        return userStore.remove(id);
    },

    clearPasswordResetCode(id: string): boolean {
        return userStore.clearPasswordResetCode(id);
    },

    setVerifyCode(id: string, code: string, expiresAt: number): boolean {
        return userStore.setVerifyCode(id, code, expiresAt);
    },

    setEmailVerified(id: string): boolean {
        return userStore.setEmailVerified(id);
    },

    setProfileUpdateVerification(id: string, payload: any): boolean {
        return userStore.setProfileUpdateVerification(id, payload);
    },

    clearProfileUpdateVerification(id: string): boolean {
        return userStore.clearProfileUpdateVerification(id);
    },

    setPasswordResetCode(id: string, code: string, expiresAt: number): boolean {
        return userStore.setPasswordResetCode(id, code, expiresAt);
    },

    setTwoFactor(id: string, payload: any): boolean {
        return userStore.setTwoFactor(id, payload);
    },

    clearTwoFactor(id: string): boolean {
        return userStore.clearTwoFactor(id);
    },

    getTwoFactor(id: string): any {
        return userStore.getTwoFactor(id);
    },

    consumeTwoFactorBackupCode(id: string, remainingHashes: string[]): boolean {
        return userStore.consumeTwoFactorBackupCode(id, remainingHashes);
    },
};

export default userRepository;
