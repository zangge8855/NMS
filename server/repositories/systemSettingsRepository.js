import systemSettingsStore from '../store/systemSettingsStore.js';

const systemSettingsRepository = {
    getAuditIpGeo() {
        return systemSettingsStore.getAuditIpGeo();
    },

    sortInboundList(serverId, inbounds) {
        return systemSettingsStore.sortInboundList(serverId, inbounds);
    },
};

export default systemSettingsRepository;
