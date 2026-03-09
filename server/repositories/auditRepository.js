import auditStore from '../store/auditStore.js';

const auditRepository = {
    querySubscriptionAccess(filters) {
        return auditStore.querySubscriptionAccess(filters);
    },

    summarizeSubscriptionAccess(filters) {
        return auditStore.summarizeSubscriptionAccess(filters);
    },
};

export default auditRepository;
