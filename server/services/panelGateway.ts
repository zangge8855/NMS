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
    const data = listRes?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        const error: any = new Error('Panel inbound list returned a non-JSON response');
        error.code = 'PANEL_INBOUND_LIST_FAILED';
        error.response = listRes;
        throw error;
    }
    if (data.success === false) {
        const error: any = new Error(String(data.msg || data.message || 'Panel inbound list request failed'));
        error.code = 'PANEL_INBOUND_LIST_FAILED';
        error.response = listRes;
        throw error;
    }
    if (!Array.isArray(data.obj)) {
        const error: any = new Error('Panel inbound list payload obj is not an array');
        error.code = 'PANEL_INBOUND_LIST_FAILED';
        error.response = listRes;
        throw error;
    }
    return {
        client,
        inbounds: data.obj,
    };
}

export { getAuthenticatedPanelClient, listPanelInbounds };
