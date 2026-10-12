import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { ROLES, hasPermission } from '../constants/roles.js';

const JWT_SECRET = process.env.JWT_SECRET || 'crisiscore-crisis-coordination-jwt-secret-2026';

// Middleware to extract and verify JWT
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        agency: true,
        badgeNumber: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found or token invalid.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.', details: err.message });
  }
};

// Optional auth: sets req.user if valid token provided, but doesn't block unauthenticated civilians submitting anonymous SOS
export const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, name: true, role: true, agency: true }
      });
      if (user) req.user = user;
    }
  } catch (_) {
    // ignore token errors for optional auth
  }
  next();
};

// Middleware to enforce specific roles (RBAC)
export const requireRoles = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden. Role '${req.user.role}' lacks sufficient privileges. Required: [${roles.join(', ')}]`
      });
    }

    next();
  };
};

// Middleware to enforce fine-grained permissions
export const requirePermission = (permissionKey) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!hasPermission(req.user.role, permissionKey)) {
      return res.status(403).json({
        error: `Forbidden. Role '${req.user.role}' lacks permission '${permissionKey}'.`
      });
    }

    next();
  };
};
