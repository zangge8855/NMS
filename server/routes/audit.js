import { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import auditStore from '../store/auditStore.js';

const router = Router();

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

router.use(authMiddleware);

router.get('/events', (req, res) => {
    const result = auditStore.queryEvents({
        page: toPositiveInt(req.query.page, 1),
        pageSize: toPositiveInt(req.query.pageSize, 20),
        from: req.query.from,
        to: req.query.to,
        eventType: req.query.eventType,
        actor: req.query.actor,
        serverId: req.query.serverId,
        targetEmail: req.query.targetEmail,
        outcome: req.query.outcome,
        q: req.query.q,
    });

    return res.json({
        success: true,
        obj: result,
    });
});

router.get('/events/:id', (req, res) => {
    const item = auditStore.getEventById(req.params.id);
    if (!item) {
        return res.status(404).json({
            success: false,
            msg: 'Audit event not found',
        });
    }
    return res.json({
        success: true,
        obj: item,
    });
});

router.delete('/events', adminOnly, (req, res) => {
    auditStore.clearEvents();
    return res.json({ success: true, msg: '操作审计日志已清空' });
});

router.delete('/subscription-access', adminOnly, (req, res) => {
    auditStore.clearSubscriptionAccess();
    return res.json({ success: true, msg: '订阅访问日志已清空' });
});

export default router;

