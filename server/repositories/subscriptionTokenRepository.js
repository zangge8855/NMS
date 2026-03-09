import subscriptionTokenStore from '../store/subscriptionTokenStore.js';

const subscriptionTokenRepository = {
    listByEmail(email, options) {
        return subscriptionTokenStore.listByEmail(email, options);
    },

    countActiveByEmail(email) {
        return subscriptionTokenStore.countActiveByEmail(email);
    },

    issue(email, options) {
        return subscriptionTokenStore.issue(email, options);
    },

    revoke(email, tokenId, reason) {
        return subscriptionTokenStore.revoke(email, tokenId, reason);
    },

    revokeAllByEmail(email, reason) {
        return subscriptionTokenStore.revokeAllByEmail(email, reason);
    },

    getFirstActiveTokenByName(email, name) {
        return subscriptionTokenStore.getFirstActiveTokenByName(email, name);
    },
};

export default subscriptionTokenRepository;
