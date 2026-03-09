import { ensureAuthenticated } from '../lib/panelClient.js';

async function getAuthenticatedPanelClient(serverId, options = {}) {
    return ensureAuthenticated(serverId, options);
}

async function listPanelInbounds(serverId, options = {}) {
    const client = await getAuthenticatedPanelClient(serverId, options);
    let listRes;
    try {
        listRes = await client.get('/panel/api/inbounds/list');
    } catch (error) {
        error.code = error.code || 'PANEL_INBOUND_LIST_FAILED';
        throw error;
    }
    const inbounds = Array.isArray(listRes.data?.obj) ? listRes.data.obj : [];
    return {
        client,
        inbounds,
    };
}

export { getAuthenticatedPanelClient, listPanelInbounds };
