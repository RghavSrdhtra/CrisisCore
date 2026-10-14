import express from 'express';
import { prisma } from '../config/db.js';
import { authenticate, optionalAuthenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { wsBroadcaster } from '../ws/socketHandler.js';

const router = express.Router();

// GET /api/assignments - View assignments
router.get('/', optionalAuthenticate, async (req, res) => {
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

// POST /api/assignments - Coordinator/Admin dispatches a responder to an incident
router.post('/', optionalAuthenticate, async (req, res) => {
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
        assignedByCoordinatorId: req.user?.id || null,
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

    // Broadcast through WebSocket to coordinator room, responder room, and civilian incident room
    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyNewAssignment(io, assignment);
      // Also broadcast prompt to coordinator dashboard
      wsBroadcaster.notifyResponderAction(io, {
        type: 'DISPATCHED',
        responderName: responder.name,
        callsign: responder.callsign,
        incidentNumber: incident.incidentNumber,
        incidentId: incident.id,
        notes: `Dispatched to ${incident.type} emergency`
      });
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

// PATCH /api/assignments/:id/status - Update assignment lifecycle state (Accept, Decline, En Route, On Scene, Completed)
router.patch('/:id/status', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, declineReason } = req.body;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { responder: true, incident: true }
    });

    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });

    const upperStatus = (status || '').toUpperCase();
    const updateData = { status: upperStatus };
    if (notes) updateData.notes = notes;
    if (declineReason) updateData.declineReason = declineReason;

    if (upperStatus === 'ACKNOWLEDGED' || upperStatus === 'ACCEPTED') {
      updateData.status = 'ACKNOWLEDGED';
      updateData.acknowledgedAt = new Date();
    } else if (upperStatus === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    const updatedAssignment = await prisma.assignment.update({
      where: { id },
      data: updateData,
      include: { responder: true, incident: true }
    });

    const io = req.app.get('io');

    // Handle State Transitions
    if (upperStatus === 'ACKNOWLEDGED' || upperStatus === 'ACCEPTED') {
      // Respondent ACCEPTED dispatch
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'EN_ROUTE', lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'DISPATCHED' }
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'ACCEPTED',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Respondent accepted assignment and is mobilizing.'
        });
      }

    } else if (upperStatus === 'DECLINED') {
      // Respondent DECLINED dispatch
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'AVAILABLE', currentIncidentId: null, lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'TRIAGED' } // Returns to triaged pool for re-dispatch
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'DECLINED',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: declineReason || notes || 'Respondent unavailable or scene hazards outside unit capability.'
        });
      }

    } else if (upperStatus === 'EN_ROUTE') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'EN_ROUTE', lastStatusUpdate: new Date() }
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'EN_ROUTE',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Unit en route with sirens & GPS telemetry engaged.'
        });
      }

    } else if (upperStatus === 'ON_SCENE') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'ON_SCENE', lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'ON_SCENE' }
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'ON_SCENE',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Unit arrived on scene. Establishing triage perimeter.'
        });
      }

    } else if (upperStatus === 'COMPLETED') {
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

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'COMPLETED',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Operation successfully completed. Scene secured and unit returning to available pool.'
        });
      }
    }

    // Broadcast assignment state update to coordinator & civilian rooms
    if (io) {
      io.emit('assignment:updated', updatedAssignment);
      io.to('coordinators').emit('assignment:updated', updatedAssignment);
      const statusPayload = {
        incidentId: assignment.incidentId,
        status: updatedAssignment.status,
        incidentStatus: updatedAssignment.status === 'COMPLETED' ? 'RESOLVED' : updatedAssignment.status,
        responderName: assignment.responder.name,
        responderCallsign: assignment.responder.callsign
      };
      io.emit('incident:status', statusPayload);
      io.to(`incident:${assignment.incidentId}`).emit('incident:status', statusPayload);

      // Refresh incident state for all coordinator views
      const freshIncident = await prisma.incident.findUnique({
        where: { id: assignment.incidentId },
        include: { assignments: { include: { responder: true } } }
      });
      if (freshIncident) {
        wsBroadcaster.notifyIncidentUpdated(io, freshIncident);
      }
    }

    res.json({ message: 'Assignment state updated.', assignment: updatedAssignment });
  } catch (err) {
    console.error('Error updating assignment state:', err);
    res.status(500).json({ error: 'Failed to update assignment state.' });
  }
});

export default router;
