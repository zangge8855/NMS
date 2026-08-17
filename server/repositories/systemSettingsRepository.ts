import systemSettingsStore from '../store/systemSettingsStore.js';

const systemSettingsRepository = {
    getRegistration(): any {
        return systemSettingsStore.getRegistration();
    },

    getAuditIpGeo(): any {
        return systemSettingsStore.getAuditIpGeo();
    },

    sortInboundList(serverId: string, inbounds: any[]): any[] {
        return systemSettingsStore.sortInboundList(serverId, inbounds);
    },
};

export default systemSettingsRepository;
