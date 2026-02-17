import { Router } from 'express';
import { authMiddleware, anyRole } from '../middleware/auth.js';
import { issueWsTicket } from '../lib/wsTicket.js';

const router = Router();

router.post('/ticket', authMiddleware, anyRole, (req, res) => {
    const issued = issueWsTicket(req.user || {});
    return res.json({
        success: true,
        obj: issued,
    });
});

export default router;

