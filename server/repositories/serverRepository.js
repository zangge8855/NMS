import serverStore from '../store/serverStore.js';

const serverRepository = {
    list() {
        return serverStore.getAll();
    },

    getById(id) {
        return serverStore.getById(id);
    },

    add(payload) {
        return serverStore.add(payload);
    },

    update(id, payload) {
        return serverStore.update(id, payload);
    },

    remove(id) {
        return serverStore.remove(id);
    },
};

export default serverRepository;
