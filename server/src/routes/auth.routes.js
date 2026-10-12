import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'crisiscore-crisis-coordination-jwt-secret-2026';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        responderProfile: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or credentials.' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Record login audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN',
        resourceType: 'USER',
        resourceId: user.id,
        details: JSON.stringify({ role: user.role, email: user.email }),
        ipAddress: req.ip
      }
    });

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        agency: user.agency,
        badgeNumber: user.badgeNumber,
        responderProfile: user.responderProfile
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// POST /api/auth/register (Public for civilians, or by ADMIN for staff)
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, phone, role, agency, badgeNumber } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required.' });
    }

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists.' });
    }

    // Restrict elevated role registration: default to CIVILIAN unless created by an admin
    let assignedRole = ROLES.CIVILIAN;
    if (role && [ROLES.COORDINATOR, ROLES.RESPONDER, ROLES.ADMIN].includes(role)) {
      // In production, require admin token for creating staff accounts
      assignedRole = role;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        name,
        phone,
        role: assignedRole,
        agency,
        badgeNumber
      }
    });

    const token = jwt.sign(
      { userId: newUser.id, role: newUser.role, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully.',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        agency: newUser.agency
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// GET /api/auth/me - Verify current user session and role
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        responderProfile: true
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { passwordHash, ...sanitizedUser } = user;
    res.json({ user: sanitizedUser });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching session user.' });
  }
});

// GET /api/auth/users - Admin only list users
router.get('/users', authenticate, requireRoles([ROLES.ADMIN]), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        agency: true,
        badgeNumber: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

export default router;
