import auditStore from '../store/auditStore.js';

const auditRepository = {
    querySubscriptionAccess(filters: any): any[] {
        return auditStore.querySubscriptionAccess(filters);
    },

    summarizeSubscriptionAccess(filters: any): any {
        return auditStore.summarizeSubscriptionAccess(filters);
    },
};

export default auditRepository;
