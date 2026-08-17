import { ensureAuthenticated } from '../lib/panelClient.js';
import type { AxiosInstance } from 'axios';

async function getAuthenticatedPanelClient(serverId: string, options: any = {}): Promise<AxiosInstance> {
    return ensureAuthenticated(serverId, options);
}

async function listPanelInbounds(serverId: string, options: any = {}): Promise<{
    client: AxiosInstance;
    inbounds: any[];
}> {
    const client = await getAuthenticatedPanelClient(serverId, options);
    let listRes: any;
    try {
        listRes = await client.get('/panel/api/inbounds/list');
    } catch (error: any) {
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
