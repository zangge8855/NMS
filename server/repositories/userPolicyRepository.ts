import userPolicyStore from '../store/userPolicyStore.js';
import type { UserPolicy } from '../types/index.js';

const userPolicyRepository = {
    get(email: string): UserPolicy | undefined {
        return userPolicyStore.get(email);
    },

    upsert(email: string, payload: any, actor?: string): UserPolicy {
        return userPolicyStore.upsert(email, payload, actor);
    },

    reassignEmail(sourceEmail: string, targetEmail: string, actor?: string): UserPolicy | null {
        return userPolicyStore.reassignEmail(sourceEmail, targetEmail, actor);
    },

    remove(email: string): boolean {
        return userPolicyStore.remove(email);
    },

    removeServerId(serverId: string, actor?: string): any {
        return userPolicyStore.removeServerId(serverId, actor);
    },
};

export default userPolicyRepository;
