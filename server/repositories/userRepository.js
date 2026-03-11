import userStore from '../store/userStore.js';

const userRepository = {
    list() {
        return userStore.getAll();
    },

    add(payload) {
        return userStore.add(payload);
    },

    getById(id) {
        return userStore.getById(id);
    },

    getByUsername(username) {
        return userStore.getByUsername(username);
    },

    getByEmail(email) {
        return userStore.getByEmail(email);
    },

    getBySubscriptionEmail(email) {
        return userStore.getBySubscriptionEmail(email);
    },

    getBySubscriptionAliasPath(path) {
        return userStore.getBySubscriptionAliasPath(path);
    },

    authenticate(username, password) {
        return userStore.authenticate(username, password);
    },

    setSubscriptionEmail(id, email) {
        return userStore.setSubscriptionEmail(id, email);
    },

    setEnabled(id, enabled) {
        return userStore.setEnabled(id, enabled);
    },

    update(id, data) {
        return userStore.update(id, data);
    },

    remove(id) {
        return userStore.remove(id);
    },

    clearPasswordResetCode(id) {
        return userStore.clearPasswordResetCode(id);
    },

    setVerifyCode(id, code, expiresAt) {
        return userStore.setVerifyCode(id, code, expiresAt);
    },

    setEmailVerified(id) {
        return userStore.setEmailVerified(id);
    },

    setPasswordResetCode(id, code, expiresAt) {
        return userStore.setPasswordResetCode(id, code, expiresAt);
    },
};

export default userRepository;
