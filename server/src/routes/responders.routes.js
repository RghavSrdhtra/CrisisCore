import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { authenticate, optionalAuthenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { wsBroadcaster } from '../ws/socketHandler.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'crisiscore-crisis-coordination-jwt-secret-2026';

// GET /api/responders - List registered emergency response units
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const { status, type } = req.query;
    const queryWhere = {
      userId: { not: null } // Only show registered respondents
    };
    if (status) queryWhere.status = status;
    if (type) queryWhere.type = type;

    const responders = await prisma.responder.findMany({
      where: queryWhere,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, agency: true, badgeNumber: true }
        },
        resources: true,
        assignments: {
          where: {
            status: { in: ['DISPATCHED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE'] }
          },
          include: { incident: true }
        }
      },
      orderBy: { callsign: 'asc' }
    });

    res.json({ responders });
  } catch (err) {
    console.error('Error fetching responders:', err);
    res.status(500).json({ error: 'Failed to retrieve responders fleet.' });
  }
});

// POST /api/responders/register - Register a new Respondent User and their Unit
router.post('/register', optionalAuthenticate, async (req, res) => {
  try {
    const {
      email,
      password = 'password123',
      name,
      phone,
      agency = 'Metro Emergency Services',
      badgeNumber,
      callsign,
      type = 'MEDICAL_AMBULANCE',
      capability = 'Rapid ALS Triage, Emergency Care',
      lat = 28.6139,
      lng = 77.2090
    } = req.body;

    if (!email || !name || !callsign) {
      return res.status(400).json({ error: 'Email, name, and callsign are required.' });
    }

    // Check if email or callsign already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email address already exists.' });
    }

    const existingCallsign = await prisma.responder.findUnique({ where: { callsign } });
    if (existingCallsign) {
      return res.status(400).json({ error: 'A responder unit with this callsign already exists.' });
    }

    const { tosAgreed } = req.body;
    if (tosAgreed !== true && tosAgreed !== 'true') {
      return res.status(400).json({ error: 'You must agree to the Emergency Field Responder Voluntary Terms of Service & Operational Code of Conduct.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create User with role RESPONDER
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: ROLES.RESPONDER,
        phone: phone || '+1-555-0399',
        agency,
        badgeNumber: badgeNumber || `RESP-${Math.floor(1000 + Math.random() * 9000)}`
      }
    });

    // Record audit log for ToS agreement acceptance
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'RESPONDER_TOS_ACCEPTED',
        resourceType: 'RESPONDER',
        resourceId: user.id,
        details: JSON.stringify({
          agreement: 'Emergency Field Responder Voluntary Code of Conduct & Operational Liability Agreement',
          dutyOfCareAcknowledged: true,
          abandonmentPenaltyClausesAccepted: true,
          timestamp: new Date().toISOString()
        }),
        ipAddress: req.ip || '127.0.0.1'
      }
    }).catch(e => console.warn('Audit log write error:', e));

    // Create linked Responder unit
    const responder = await prisma.responder.create({
      data: {
        callsign: callsign.toUpperCase(),
        name: `${name}'s Unit (${callsign.toUpperCase()})`,
        type,
        capability,
        status: 'AVAILABLE',
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        userId: user.id
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, agency: true, badgeNumber: true }
        },
        resources: true,
        assignments: true
      }
    });

    // Notify coordinator room via WebSocket in real time
    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyNewResponder(io, responder);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'New respondent successfully registered and added to fleet.',
      responder,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      token
    });
  } catch (err) {
    console.error('Error registering responder:', err);
    res.status(500).json({ error: 'Failed to register new respondent unit.' });
  }
});

// GET /api/responders/:id - Get responder detail
router.get('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const responder = await prisma.responder.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, agency: true, badgeNumber: true }
        },
        resources: true,
        assignments: {
          include: { incident: true },
          orderBy: { assignedAt: 'desc' },
          take: 5
        }
      }
    });

    if (!responder) return res.status(404).json({ error: 'Responder unit not found.' });
    res.json({ responder });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch responder details.' });
  }
});

// PATCH /api/responders/:id/status - Update operational lifecycle status
router.patch('/:id/status', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) return res.status(400).json({ error: 'Operational status is required.' });

    const responder = await prisma.responder.findUnique({
      where: { id },
      include: { user: true }
    });
    if (!responder) return res.status(404).json({ error: 'Responder not found.' });

    const updateData = {
      status,
      lastStatusUpdate: new Date()
    };

    if (status === 'AVAILABLE') {
      updateData.currentIncidentId = null;
    }

    const updated = await prisma.responder.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, agency: true, badgeNumber: true }
        }
      }
    });

    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyResponderStatus(io, updated);
      wsBroadcaster.notifyResponderAction(io, {
        type: status,
        responderName: responder.name,
        callsign: responder.callsign,
        notes: `Operational status manually set to ${status}`
      });
    }

    res.json({ message: 'Responder operational status updated.', responder: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update responder status.' });
  }
});

// POST /api/responders/:id/location - Update GPS telemetry breadcrumb
router.post('/:id/location', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, lng, accuracy } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Coordinates lat and lng are required.' });
    }

    const updated = await prisma.responder.update({
      where: { id },
      data: {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        lastStatusUpdate: new Date()
      }
    });

    await prisma.locationLog.create({
      data: {
        responderId: id,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        accuracy: accuracy ? parseFloat(accuracy) : null,
        source: 'GPS',
        isActive: true
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to('coordinators').emit('responder:location_updated', {
        responderId: id,
        callsign: updated.callsign,
        lat: updated.lat,
        lng: updated.lng
      });
    }

    res.json({ message: 'Responder telemetry received.', responder: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record responder location.' });
  }
});

export default router;
