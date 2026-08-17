import subscriptionTokenStore from '../store/subscriptionTokenStore.js';
import type { SubscriptionToken } from '../types/index.js';

const subscriptionTokenRepository = {
    listByEmail(email: string, options?: any): SubscriptionToken[] {
        return subscriptionTokenStore.listByEmail(email, options);
    },

    countActiveByEmail(email: string): number {
        return subscriptionTokenStore.countActiveByEmail(email);
    },

    issue(email: string, options?: any): SubscriptionToken {
        return subscriptionTokenStore.issue(email, options);
    },

    revoke(email: string, tokenId: string, reason?: string): boolean {
        return subscriptionTokenStore.revoke(email, tokenId, reason);
    },

    revokeAllByEmail(email: string, reason?: string): number {
        return subscriptionTokenStore.revokeAllByEmail(email, reason);
    },

    reassignEmail(sourceEmail: string, targetEmail: string, options?: any): number {
        return subscriptionTokenStore.reassignEmail(sourceEmail, targetEmail, options);
    },

    getFirstActiveTokenByName(email: string, name: string): any {
        return subscriptionTokenStore.getFirstActiveTokenByName(email, name);
    },
};

export default subscriptionTokenRepository;
