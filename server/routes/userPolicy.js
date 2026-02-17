import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import serverStore from '../store/serverStore.js';
import userPolicyStore, { ALLOWED_PROTOCOLS, POLICY_SCOPE_MODES } from '../store/userPolicyStore.js';

const router = Router();

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeServerIds(input = []) {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function normalizeProtocols(input = []) {
    const values = Array.isArray(input) ? input : [];
    return Array.from(new Set(
        values
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => ALLOWED_PROTOCOLS.has(item))
    ));
}

function normalizeScopeMode(input, fallback = 'all') {
    const normalizedFallback = POLICY_SCOPE_MODES.has(String(fallback || '').trim().toLowerCase())
        ? String(fallback || '').trim().toLowerCase()
        : 'all';
    const text = String(input || '').trim().toLowerCase();
    if (!text) return normalizedFallback;
    if (!POLICY_SCOPE_MODES.has(text)) return normalizedFallback;
    return text;
}

router.use(authMiddleware);

router.get('/:email', (req, res) => {
    const email = normalizeEmail(req.params.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: 'Email is required' });
    }

    const policy = userPolicyStore.get(email);
    return res.json({
        success: true,
        obj: policy,
    });
});

router.put('/:email', (req, res) => {
    const email = normalizeEmail(req.params.email);
    if (!email) {
        return res.status(400).json({ success: false, msg: 'Email is required' });
    }

    const allowedServerIds = normalizeServerIds(req.body?.allowedServerIds);
    const existingServerIds = new Set(serverStore.getAll().map((item) => item.id));
    const invalidServerIds = allowedServerIds.filter((item) => !existingServerIds.has(item));
    if (invalidServerIds.length > 0) {
        return res.status(400).json({
            success: false,
            msg: `Unknown server IDs: ${invalidServerIds.join(', ')}`,
        });
    }

    const allowedProtocols = normalizeProtocols(req.body?.allowedProtocols);
    let serverScopeMode = normalizeScopeMode(req.body?.serverScopeMode, allowedServerIds.length > 0 ? 'selected' : 'all');
    let protocolScopeMode = normalizeScopeMode(req.body?.protocolScopeMode, allowedProtocols.length > 0 ? 'selected' : 'all');

    if (serverScopeMode === 'selected' && allowedServerIds.length === 0) {
        serverScopeMode = 'none';
    }
    if (protocolScopeMode === 'selected' && allowedProtocols.length === 0) {
        protocolScopeMode = 'none';
    }

    const updated = userPolicyStore.upsert(
        email,
        { allowedServerIds, allowedProtocols, serverScopeMode, protocolScopeMode },
        req.user?.role || 'admin'
    );

    return res.json({
        success: true,
        obj: updated,
    });
});

export default router;
