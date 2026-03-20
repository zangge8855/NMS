import userPolicyStore from '../store/userPolicyStore.js';

const userPolicyRepository = {
    get(email) {
        return userPolicyStore.get(email);
    },

    upsert(email, payload, actor) {
        return userPolicyStore.upsert(email, payload, actor);
    },

    reassignEmail(sourceEmail, targetEmail, actor) {
        return userPolicyStore.reassignEmail(sourceEmail, targetEmail, actor);
    },

    remove(email) {
        return userPolicyStore.remove(email);
    },

    removeServerId(serverId, actor) {
        return userPolicyStore.removeServerId(serverId, actor);
    },
};

export default userPolicyRepository;
