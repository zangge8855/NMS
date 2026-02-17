import api from '../api/client.js';

function toCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
}

export async function attachBatchRiskToken(payload = {}, options = {}) {
    const type = String(options.type || '').trim().toLowerCase();
    const action = String(options.action || '').trim().toLowerCase();
    const isRetry = options.isRetry === true;
    const targetCount = toCount(options.targetCount);
    if (!type || !action) {
        return payload;
    }

    const res = await api.post('/system/batch-risk-token', {
        type,
        action,
        isRetry,
        targetCount,
    });
    const info = res.data?.obj || {};
    if (!info.required || !info.token) {
        return payload;
    }
    return {
        ...payload,
        confirmToken: info.token,
    };
}

