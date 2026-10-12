import express from 'express';
import { prisma } from '../config/db.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { wsBroadcaster } from '../ws/socketHandler.js';

const router = express.Router();

// GET /api/assignments - View assignments
router.get('/', authenticate, async (req, res) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: {
        incident: true,
        responder: true,
        assignedByCoordinator: {
          select: { id: true, name: true, badgeNumber: true }
        }
      },
      orderBy: { assignedAt: 'desc' }
    });
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve assignments.' });
  }
});

// POST /api/assignments - Coordinator/Admin dispatches a responder to an incident (Human-in-the-loop dispatch)
router.post('/', authenticate, requireRoles([ROLES.COORDINATOR, ROLES.ADMIN]), async (req, res) => {
  try {
    const { incidentId, responderId, notes, recommendationScore } = req.body;

    if (!incidentId || !responderId) {
      return res.status(400).json({ error: 'incidentId and responderId are required.' });
    }

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    const responder = await prisma.responder.findUnique({ where: { id: responderId } });

    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    if (!responder) return res.status(404).json({ error: 'Responder unit not found.' });

    // Create assignment record
    const assignment = await prisma.assignment.create({
      data: {
        incidentId,
        responderId,
        status: 'DISPATCHED',
        assignedByCoordinatorId: req.user.id,
        recommendationScore: recommendationScore ? parseFloat(recommendationScore) : null,
        notes: notes || 'Dispatched via Central Command'
      },
      include: {
        incident: true,
        responder: true,
        assignedByCoordinator: {
          select: { id: true, name: true, badgeNumber: true }
        }
      }
    });

    // Update responder status to ASSIGNED and set current incident
    await prisma.responder.update({
      where: { id: responderId },
      data: {
        status: 'ASSIGNED',
        currentIncidentId: incidentId,
        lastStatusUpdate: new Date()
      }
    });

    // Update incident status to DISPATCHED
    await prisma.incident.update({
      where: { id: incidentId },
      data: { status: 'DISPATCHED' }
    });

    // Audit log dispatch action
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DISPATCH_COMMITTED',
        resourceType: 'ASSIGNMENT',
        resourceId: assignment.id,
        details: JSON.stringify({
          incidentNumber: incident.incidentNumber,
          responderCallsign: responder.callsign,
          score: recommendationScore
        }),
        ipAddress: req.ip
      }
    });

    // Broadcast through WebSocket to coordinator room, responder room, and civilian incident room
    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyNewAssignment(io, assignment);
    }

    res.status(201).json({
      message: 'Responder successfully dispatched to incident.',
      assignment
    });
  } catch (err) {
    console.error('Error creating assignment:', err);
    res.status(500).json({ error: 'Failed to create assignment dispatch.' });
  }
});

// PATCH /api/assignments/:id/status - Update assignment lifecycle state
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { responder: true, incident: true }
    });

    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });

    const updateData = { status };
    if (notes) updateData.notes = notes;
    if (status === 'ACKNOWLEDGED') updateData.acknowledgedAt = new Date();
    if (status === 'COMPLETED') updateData.completedAt = new Date();

    const updatedAssignment = await prisma.assignment.update({
      where: { id },
      data: updateData,
      include: { responder: true, incident: true }
    });

    // Synchronize Responder & Incident status based on mission progression
    if (status === 'EN_ROUTE') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'EN_ROUTE', lastStatusUpdate: new Date() }
      });
    } else if (status === 'ON_SCENE') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'ON_SCENE', lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'ON_SCENE' }
      });
    } else if (status === 'COMPLETED') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'AVAILABLE', currentIncidentId: null, lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          locationSharingActive: false
        }
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to('coordinators').emit('assignment:updated', updatedAssignment);
      io.to(`incident:${assignment.incidentId}`).emit('incident:status', {
        status: updatedAssignment.status,
        incidentStatus: updatedAssignment.status === 'COMPLETED' ? 'RESOLVED' : updatedAssignment.status
      });
    }

    res.json({ message: 'Assignment state updated.', assignment: updatedAssignment });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update assignment state.' });
  }
});

export default router;
