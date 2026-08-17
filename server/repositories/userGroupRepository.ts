import userGroupStore from '../store/userGroupStore.js';
import type { UserGroup } from '../types/index.js';

const userGroupRepository = {
    list(): UserGroup[] {
        return userGroupStore.list();
    },

    getById(id: string): UserGroup | undefined {
        return userGroupStore.getById(id);
    },

    getByName(name: string): UserGroup | undefined {
        return userGroupStore.getByName(name);
    },

    add(payload: any, actor?: string): UserGroup {
        return userGroupStore.add(payload, actor);
    },

    update(id: string, payload: any, actor?: string): UserGroup | null {
        return userGroupStore.update(id, payload, actor);
    },

    remove(id: string): boolean {
        return userGroupStore.remove(id);
    },

    removeServerId(serverId: string, actor?: string): any {
        return userGroupStore.removeServerId(serverId, actor);
    },
};

export default userGroupRepository;
