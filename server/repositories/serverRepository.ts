import serverStore from '../store/serverStore.js';
import type { ServerNode } from '../types/index.js';

const serverRepository = {
    list(): ServerNode[] {
        return serverStore.getAll();
    },

    getById(id: string): ServerNode | undefined {
        return serverStore.getById(id);
    },

    add(payload: any): ServerNode {
        return serverStore.add(payload);
    },

    update(id: string, payload: any): ServerNode | null {
        return serverStore.update(id, payload);
    },

    remove(id: string): boolean {
        return serverStore.remove(id);
    },
};

export default serverRepository;
