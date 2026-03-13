import systemSettingsStore from '../store/systemSettingsStore.js';

const systemSettingsRepository = {
    getRegistration() {
        return systemSettingsStore.getRegistration();
    },

    getAuditIpGeo() {
        return systemSettingsStore.getAuditIpGeo();
    },

    sortInboundList(serverId, inbounds) {
        return systemSettingsStore.sortInboundList(serverId, inbounds);
    },
};

export default systemSettingsRepository;
