import jwt from 'jsonwebtoken';
import config from '../config.js';
import { ROLES } from '../store/userStore.js';

/**
 * JWT 认证中间件。
 * 解析 Bearer token 并将用户信息附加到 req.user。
 */
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, msg: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, msg: 'Invalid or expired token' });
    }
}

/**
 * 角色权限检查中间件工厂。
 * 允许指定的角色通过，否则返回 403。
 *
 * 用法:
 *   router.post('/danger', requireRole('admin'), handler);
 *   router.get('/profile', requireRole('admin', 'user'), handler);
 *
 * @param  {...string} allowedRoles  允许通过的角色列表
 */
export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, msg: 'Unauthorized' });
        }
        const userRole = req.user.role || ROLES.user;
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                msg: `权限不足: 需要 ${allowedRoles.join(' 或 ')} 角色`,
            });
        }
        next();
    };
}

/**
 * 便捷中间件: 仅 admin 可访问
 */
export const adminOnly = requireRole(ROLES.admin);

/**
 * 便捷中间件: 历史命名兼容（当前仅 admin）
 */
export const operatorOrAbove = requireRole(ROLES.admin);

/**
 * 便捷中间件: 所有已认证角色可访问 (admin / user)
 */
export const anyRole = requireRole(ROLES.admin, ROLES.user);
