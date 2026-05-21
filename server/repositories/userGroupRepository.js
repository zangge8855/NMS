import userGroupStore from '../store/userGroupStore.js';

const userGroupRepository = {
    list() {
        return userGroupStore.list();
    },

    getById(id) {
        return userGroupStore.getById(id);
    },

    getByName(name) {
        return userGroupStore.getByName(name);
    },

    add(payload, actor) {
        return userGroupStore.add(payload, actor);
    },

    update(id, payload, actor) {
        return userGroupStore.update(id, payload, actor);
    },

    remove(id) {
        return userGroupStore.remove(id);
    },

    removeServerId(serverId, actor) {
        return userGroupStore.removeServerId(serverId, actor);
    },
};

export default userGroupRepository;
