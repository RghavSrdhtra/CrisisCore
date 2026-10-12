import express from 'express';
import { prisma } from '../config/db.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { wsBroadcaster } from '../ws/socketHandler.js';

const router = express.Router();

// GET /api/responders - List all emergency response units
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, type } = req.query;
    const queryWhere = {};
    if (status) queryWhere.status = status;
    if (type) queryWhere.type = type;

    const responders = await prisma.responder.findMany({
      where: queryWhere,
      include: {
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
    res.status(500).json({ error: 'Failed to retrieve responders fleet.' });
  }
});

// GET /api/responders/:id - Get responder detail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const responder = await prisma.responder.findUnique({
      where: { id: req.params.id },
      include: {
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
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) return res.status(400).json({ error: 'Operational status is required.' });

    const responder = await prisma.responder.findUnique({ where: { id } });
    if (!responder) return res.status(404).json({ error: 'Responder not found.' });

    // Ensure authorization: must be coordinator/admin OR the responder itself
    if (req.user.role === ROLES.RESPONDER && responder.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot update status of another responder unit.' });
    }

    const updated = await prisma.responder.update({
      where: { id },
      data: {
        status,
        lastStatusUpdate: new Date()
      }
    });

    // Notify coordinator room via WebSocket
    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyResponderStatus(io, updated);
    }

    res.json({ message: 'Responder operational status updated.', responder: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update responder status.' });
  }
});

// POST /api/responders/:id/location - Update GPS telemetry breadcrumb
router.post('/:id/location', authenticate, async (req, res) => {
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

    // Record location log
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
