import { Router, type Request, type Response } from 'express';
import { authMiddleware, anyRole } from '../middleware/auth.js';
import { issueWsTicket } from '../lib/wsTicket.js';

const router = Router();

router.post('/ticket', authMiddleware, anyRole, (req: Request, res: Response) => {
    const issued = issueWsTicket((req as any).user || {});
    return res.json({
        success: true,
        obj: issued,
    });
});

export default router;
