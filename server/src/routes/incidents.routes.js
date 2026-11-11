import express from 'express';
import { prisma } from '../config/db.js';
import { authenticate, optionalAuthenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { wsBroadcaster } from '../ws/socketHandler.js';
import { mlClient } from '../services/mlClient.js';

const router = express.Router();

// GET /api/incidents - RBAC scoped list
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const user = req.user;
    let queryWhere = {};

    if (user && user.role === ROLES.CIVILIAN) {
      // Privacy Isolation (Section 4.11): Civilians only view their own reported incidents
      queryWhere = { reporterId: user.id };
    } else if (user && user.role === ROLES.RESPONDER) {
      // Responders view incidents assigned to them
      const responder = await prisma.responder.findUnique({ where: { userId: user.id } });
      if (!responder) return res.json({ incidents: [] });

      queryWhere = {
        assignments: {
          some: { responderId: responder.id }
        }
      };
    }
    // COORDINATOR, ADMIN, and dashboard preview see all incidents

    const incidents = await prisma.incident.findMany({
      where: queryWhere,
      include: {
        assignments: {
          include: {
            responder: true
          }
        },
        reporter: {
          select: { id: true, name: true, phone: true }
        }
      },
      orderBy: { reportedAt: 'desc' }
    });

    res.json({ incidents });
  } catch (err) {
    console.error('Error fetching incidents:', err);
    res.status(500).json({ error: 'Failed to retrieve incidents.' });
  }
});

// POST /api/incidents - Submit SOS (Civilian or unauthenticated public with optional auth)
router.post('/', optionalAuthenticate, async (req, res) => {
  try {
    const {
      type,
      description,
      affectedCount,
      severity,
      lat,
      lng,
      address,
      reporterContact,
      locationSharingActive = true,
      source = 'GPS',
      accuracy = 5.0,
      resourceNeeds = null
    } = req.body;

    if (!type || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Emergency type, lat, and lng are required.' });
    }

    // Normalize type string
    let normalizedType = String(type).trim().toUpperCase().replace(/\s+/g, '_');
    if (['FLOOD', 'EARTHQUAKE', 'STORM'].includes(normalizedType)) {
      normalizedType = 'NATURAL_DISASTER';
    } else if (normalizedType === 'COLLAPSE') {
      normalizedType = 'INDUSTRIAL';
    } else if (!['MEDICAL', 'FIRE', 'SECURITY', 'NATURAL_DISASTER', 'INDUSTRIAL', 'OTHER'].includes(normalizedType)) {
      normalizedType = 'OTHER';
    }

    // Auto-generate incident tracking number e.g. INC-2026-XXXX
    const count = await prisma.incident.count();
    const incidentNumber = `INC-2026-${String(count + 101).padStart(4, '0')}`;

    // Priority heuristic baseline
    let initialPriority = 'MEDIUM';
    const parsedAffected = Math.max(1, parseInt(affectedCount || 1, 10));
    const upperSev = severity ? String(severity).toUpperCase() : 'MEDIUM';

    if (upperSev === 'CRITICAL' || parsedAffected >= 10 || normalizedType === 'INDUSTRIAL' || normalizedType === 'FIRE') {
      initialPriority = 'HIGH';
      if (parsedAffected >= 10 || upperSev === 'CRITICAL') initialPriority = 'CRITICAL';
    } else if (upperSev === 'LOW') {
      initialPriority = 'LOW';
    }

    let predictedPriority = initialPriority;
    let priorityConfidence = 0.85;

    // ML Priority Classification via Python microservice (Week 4)
    try {
      const mlResult = await mlClient.evaluateIncident({
        type: normalizedType,
        description: description || '',
        affectedCount: parsedAffected,
        resourceNeeds: typeof resourceNeeds === 'object' && resourceNeeds !== null ? resourceNeeds : {},
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      });
      if (mlResult && mlResult.triage) {
        predictedPriority = mlResult.triage.priority || initialPriority;
        priorityConfidence = mlResult.triage.priority_score || (mlResult.triage.confidence ? mlResult.triage.confidence / 100 : 0.85);
      }
    } catch (mlErr) {
      console.warn('ML Priority evaluation skipped, using baseline heuristic:', mlErr.message);
    }

    const isLocationActive = Boolean(locationSharingActive);
    const parsedResourceNeeds = resourceNeeds ? (typeof resourceNeeds === 'object' ? JSON.stringify(resourceNeeds) : String(resourceNeeds)) : null;

    const newIncident = await prisma.incident.create({
      data: {
        incidentNumber,
        type: normalizedType,
        description: description || 'Emergency SOS assistance requested.',
        affectedCount: parsedAffected,
        status: 'REPORTED',
        severity: upperSev,
        predictedPriority,
        priorityConfidence,
        resourceNeeds: parsedResourceNeeds,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        address: address || null,
        reporterContact: reporterContact || (req.user?.phone || null),
        locationSharingActive: isLocationActive,
        reporterId: req.user?.id || null
      },
      include: {
        reporter: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    // Create initial LocationLog breadcrumb if location sharing is allowed
    if (isLocationActive) {
      await prisma.locationLog.create({
        data: {
          incidentId: newIncident.id,
          lat: newIncident.lat,
          lng: newIncident.lng,
          accuracy: parseFloat(accuracy) || 5.0,
          source: source === 'MANUAL' ? 'MANUAL' : 'GPS',
          isActive: true
        }
      });
    }

    // Notify coordinators in real-time via WebSocket
    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyNewIncident(io, newIncident);
    }

    res.status(201).json({
      message: 'SOS Emergency Request submitted successfully.',
      incident: newIncident
    });
  } catch (err) {
    console.error('Error creating SOS incident:', err);
    res.status(500).json({ error: 'Failed to record emergency request.' });
  }
});

// GET /api/incidents/:id - Incident detail
router.get('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: {
        assignments: {
          include: { responder: true }
        },
        locationLogs: {
          where: { isActive: true },
          orderBy: { timestamp: 'desc' },
          take: 10
        }
      }
    });

    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    // Access check for civilian: if registered civilian, ensure ownership
    if (req.user && req.user.role === ROLES.CIVILIAN && incident.reporterId && incident.reporterId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied to this incident.' });
    }

    res.json({ incident });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch incident details.' });
  }
});

// PATCH /api/incidents/:id/status - Status change (Coordinator / Admin / Responder on scene)
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, manualPriority } = req.body;
    const { id } = req.params;

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    const updateData = {};
    if (status) {
      updateData.status = status;
      if (status === 'RESOLVED' || status === 'CANCELLED') {
        updateData.resolvedAt = new Date();
        // Section 4.11: Voluntary location terminates immediately upon resolution
        updateData.locationSharingActive = false;

        // Deactivate location breadcrumbs for this incident
        await prisma.locationLog.updateMany({
          where: { incidentId: id },
          data: { isActive: false }
        });
      }
    }

    if (manualPriority && [ROLES.COORDINATOR, ROLES.ADMIN].includes(req.user.role)) {
      updateData.manualPriority = manualPriority;
    }

    const updated = await prisma.incident.update({
      where: { id },
      data: updateData,
      include: {
        assignments: { include: { responder: true } }
      }
    });

    // Audit log status modification
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STATUS_UPDATE',
        resourceType: 'INCIDENT',
        resourceId: id,
        details: JSON.stringify({ oldStatus: incident.status, newStatus: status, userRole: req.user.role })
      }
    });

    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyIncidentUpdated(io, updated);
    }

    res.json({ message: 'Incident updated successfully.', incident: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update incident.' });
  }
});

// POST /api/incidents/:id/cancel - Civilian voluntary cancellation / Mark Safe (Section 4.1 & 4.11)
router.post('/:id/cancel', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Civilian marked safe / Cancelled by reporter' } = req.body;

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    // Ensure access: if user is logged in as civilian, check reporterId
    if (req.user && req.user.role === ROLES.CIVILIAN && incident.reporterId && incident.reporterId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to cancel this emergency request.' });
    }

    const updated = await prisma.incident.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        resolvedAt: new Date(),
        locationSharingActive: false
      },
      include: {
        assignments: { include: { responder: true } }
      }
    });

    // Deactivate location breadcrumbs for this incident (Privacy Policy Sec 4.11)
    await prisma.locationLog.updateMany({
      where: { incidentId: id },
      data: { isActive: false }
    });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CIVILIAN_CANCEL_SOS',
          resourceType: 'INCIDENT',
          resourceId: id,
          details: JSON.stringify({ reason })
        }
      });
    }

    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyIncidentUpdated(io, updated);
      io.to(`incident:${id}`).emit('incident:cancelled', { id, reason, timestamp: new Date().toISOString() });
    }

    res.json({
      message: 'SOS request successfully cancelled. Location tracking terminated.',
      incident: updated
    });
  } catch (err) {
    console.error('Error cancelling incident:', err);
    res.status(500).json({ error: 'Failed to cancel emergency request.' });
  }
});

// POST /api/incidents/:id/location - Live GPS breadcrumb stream (Section 4.1 & 4.11)
router.post('/:id/location', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, lng, accuracy = 5.0, source = 'GPS' } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'lat and lng coordinates are required.' });
    }

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    // Stop tracking if resolved, cancelled, or voluntary sharing is turned off
    if (!incident.locationSharingActive || ['RESOLVED', 'CANCELLED'].includes(incident.status)) {
      return res.status(403).json({
        error: 'Location sharing is disabled or incident is closed.',
        locationSharingActive: false
      });
    }

    const newLog = await prisma.locationLog.create({
      data: {
        incidentId: id,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        accuracy: parseFloat(accuracy) || 5.0,
        source: source === 'MANUAL' ? 'MANUAL' : 'GPS',
        isActive: true
      }
    });

    // Update incident current lat/lng
    const updated = await prisma.incident.update({
      where: { id },
      data: {
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to('coordinators').emit('incident:location_updated', {
        incidentId: id,
        lat: updated.lat,
        lng: updated.lng,
        accuracy: newLog.accuracy,
        timestamp: newLog.timestamp
      });
      io.to(`incident:${id}`).emit('incident:location_updated', {
        lat: updated.lat,
        lng: updated.lng,
        timestamp: newLog.timestamp
      });
    }

    res.json({
      message: 'Location breadcrumb recorded.',
      location: { lat: updated.lat, lng: updated.lng, timestamp: newLog.timestamp }
    });
  } catch (err) {
    console.error('Error recording location breadcrumb:', err);
    res.status(500).json({ error: 'Failed to record location update.' });
  }
});

// PATCH /api/incidents/:id/location-toggle - Civilian voluntary privacy switch (Section 4.11)
router.patch('/:id/location-toggle', optionalAuthenticate, async (req, res) => {
  try {
    const { active } = req.body;
    const { id } = req.params;

    const isActive = Boolean(active);

    const updated = await prisma.incident.update({
      where: { id },
      data: { locationSharingActive: isActive }
    });

    if (!isActive) {
      await prisma.locationLog.updateMany({
        where: { incidentId: id },
        data: { isActive: false }
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to('coordinators').emit('incident:privacy_toggle', {
        incidentId: id,
        locationSharingActive: isActive,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      message: `Voluntary location sharing has been ${isActive ? 'enabled' : 'disabled'}.`,
      locationSharingActive: isActive
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update location sharing preference.' });
  }
});


// PATCH /api/incidents/:id/triage - Incident Manager updates verified triage and resource needs (Diagram 1)
router.patch('/:id/triage', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { severity, affectedCount, resourceNeeds, managerNotes, manualPriority } = req.body;

    const data = { status: 'TRIAGED' };
    if (severity) data.severity = severity.toUpperCase();
    if (affectedCount !== undefined) data.affectedCount = Math.max(1, parseInt(affectedCount, 10));
    if (managerNotes) data.managerNotes = managerNotes;
    if (manualPriority) data.manualPriority = manualPriority.toUpperCase();
    if (resourceNeeds) {
      data.resourceNeeds = typeof resourceNeeds === 'object' ? JSON.stringify(resourceNeeds) : String(resourceNeeds);
    }

    const updated = await prisma.incident.update({
      where: { id },
      data,
      include: {
        assignments: { include: { responder: true } },
        reporter: { select: { id: true, name: true, phone: true } }
      }
    });

    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyIncidentUpdated(io, updated);
      io.to('coordinators').emit('incident:triaged', updated);
      io.to('channel:admin_incident').emit('incident:triaged', updated);
    }

    res.json({ message: 'Incident triage and resource needs updated by Incident Manager.', incident: updated });
  } catch (err) {
    console.error('Error triaging incident:', err);
    res.status(500).json({ error: 'Failed to update incident triage.' });
  }
});

// GET /api/incidents/:id/tracking - Detailed Individual Request Tracking
router.get('/:id/tracking', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const incident = await prisma.incident.findFirst({
      where: {
        OR: [
          { id },
          { incidentNumber: id }
        ]
      },
      include: {
        reporter: {
          select: { id: true, name: true, phone: true, agency: true, role: true }
        },
        assignments: {
          include: {
            responder: true,
            assignedByCoordinator: { select: { id: true, name: true, badgeNumber: true } }
          },
          orderBy: { assignedAt: 'desc' }
        },
        locationLogs: {
          orderBy: { timestamp: 'desc' },
          take: 20
        },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 30
        }
      }
    });

    if (!incident) {
      return res.status(404).json({ error: 'Incident request not found.' });
    }

    // Build timeline milestones for tracking
    const timeline = [
      {
        step: 1,
        title: 'Emergency Request Reported',
        description: `Submitted by ${incident.reporter?.name || incident.reporterContact || 'Citizen SOS'} (${incident.type} emergency)`,
        timestamp: incident.reportedAt,
        status: 'COMPLETED'
      },
      {
        step: 2,
        title: incident.verificationStatus === 'REJECTED' ? 'Request Rejected' : 'Incident Triage & Verification',
        description: incident.verificationStatus === 'REJECTED'
          ? `Rejected: ${incident.managerNotes || 'Marked invalid/duplicate'}`
          : (incident.verificationStatus === 'VERIFIED'
              ? `Accepted & verified by Incident Manager (${incident.managerNotes || 'Valid emergency'})`
              : 'Pending verification by Incident Manager'),
        timestamp: incident.verifiedAt,
        status: incident.verificationStatus === 'VERIFIED' ? 'COMPLETED' : (incident.verificationStatus === 'REJECTED' ? 'REJECTED' : 'PENDING')
      },
      {
        step: 3,
        title: 'Mission Dispatch & Resource En Route',
        description: incident.assignments.length > 0
          ? `Assigned to ${incident.assignments[0].responder?.name || 'Emergency Unit'} (${incident.assignments[0].responder?.callsign || 'UNIT'})`
          : 'Awaiting Coordinator / Admin HITL mission dispatch',
        timestamp: incident.assignments[0]?.assignedAt || null,
        status: incident.assignments.length > 0 ? (incident.status === 'RESOLVED' ? 'COMPLETED' : 'IN_PROGRESS') : 'PENDING'
      },
      {
        step: 4,
        title: 'Mission Resolved & Done',
        description: incident.status === 'RESOLVED'
          ? `Marked as Done. Scene cleared and casualties aided.`
          : 'Final resolution pending field completion',
        timestamp: incident.resolvedAt,
        status: incident.status === 'RESOLVED' ? 'COMPLETED' : 'PENDING'
      }
    ];

    res.json({
      incident,
      timeline,
      trackingNumber: incident.incidentNumber,
      currentStatus: incident.status,
      verificationStatus: incident.verificationStatus
    });
  } catch (err) {
    console.error('Error fetching incident tracking:', err);
    res.status(500).json({ error: 'Failed to retrieve tracking telemetry.' });
  }
});

// PATCH /api/incidents/:id/verify - Admin / Incident Manager Verification & Lifecycle Workflow
// Handles ACCEPT, REJECT, DONE (Mark as Done), and REOPEN actions for individual requests
router.patch('/:id/verify', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes } = req.body; // action: 'VERIFY' | 'ACCEPT' | 'REJECT' | 'DONE' | 'RESOLVE' | 'REOPEN' | 'PENDING'

    const incident = await prisma.incident.findFirst({
      where: {
        OR: [
          { id },
          { incidentNumber: id }
        ]
      }
    });
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    const upperAction = (action || 'VERIFY').toUpperCase();
    const isAccept = upperAction === 'VERIFY' || upperAction === 'ACCEPT';
    const isReject = upperAction === 'REJECT';
    const isDone = upperAction === 'DONE' || upperAction === 'RESOLVE';
    const isReopen = upperAction === 'REOPEN' || upperAction === 'PENDING';

    const updateData = {};

    if (isAccept) {
      updateData.verificationStatus = 'VERIFIED';
      updateData.verifiedAt = new Date();
      updateData.verifiedBy = req.user?.name || req.user?.id || 'Incident Manager';
      if (['REPORTED', 'CANCELLED'].includes(incident.status)) {
        updateData.status = 'TRIAGED';
      }
      if (notes) updateData.managerNotes = notes;
    } else if (isReject) {
      updateData.verificationStatus = 'REJECTED';
      updateData.status = 'CANCELLED';
      updateData.managerNotes = notes || 'Request rejected by Incident Manager';
    } else if (isDone) {
      updateData.status = 'RESOLVED';
      updateData.resolvedAt = new Date();
      updateData.locationSharingActive = false;
      if (notes) updateData.managerNotes = notes;

      // Release any active responder units assigned to this incident
      const activeAssignments = await prisma.assignment.findMany({ where: { incidentId: incident.id } });
      for (const a of activeAssignments) {
        await prisma.responder.update({
          where: { id: a.responderId },
          data: { status: 'AVAILABLE', currentIncidentId: null, lastStatusUpdate: new Date() }
        }).catch(() => {});
        await prisma.assignment.update({
          where: { id: a.id },
          data: { status: 'COMPLETED', completedAt: new Date() }
        }).catch(() => {});
      }
    } else if (isReopen) {
      updateData.verificationStatus = 'PENDING';
      updateData.status = 'REPORTED';
      updateData.resolvedAt = null;
      if (notes) updateData.managerNotes = notes;
    }

    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: updateData,
      include: {
        assignments: { include: { responder: true } },
        reporter: { select: { id: true, name: true, phone: true } }
      }
    });

    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyIncidentUpdated(io, updated);
      const verifiedPayload = {
        incidentId: incident.id,
        incidentNumber: updated.incidentNumber,
        action: upperAction,
        status: updated.status,
        verificationStatus: updated.verificationStatus,
        notes: notes || `Request marked as ${upperAction} by Incident Manager.`
      };
      io.to('coordinators').emit('incident:verified', verifiedPayload);
      io.emit('incident:verified', verifiedPayload);
      io.emit('incident:status', {
        incidentId: incident.id,
        status: updated.status,
        incidentStatus: updated.status
      });
    }

    // Record Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: `INCIDENT_ACTION_${upperAction}`,
        resourceType: 'INCIDENT',
        resourceId: incident.id,
        details: JSON.stringify({
          incidentNumber: updated.incidentNumber,
          action: upperAction,
          status: updated.status,
          verificationStatus: updated.verificationStatus,
          notes
        })
      }
    }).catch(() => {});

    res.json({
      message: `Incident request ${updated.incidentNumber} marked as ${upperAction} successfully.`,
      incident: updated
    });
  } catch (err) {
    console.error('Error executing incident action:', err);
    res.status(500).json({ error: 'Failed to process incident action.' });
  }
});

// Alias: POST /api/incidents/:id/action
router.post('/:id/action', optionalAuthenticate, async (req, res) => {
  req.method = 'PATCH';
  return router.handle(req, res);
});

// DELETE /api/incidents/:id - Incident Manager / Admin removes false alarms or resolved incidents
router.delete('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const target = await prisma.incident.findFirst({
      where: {
        OR: [
          { id },
          { incidentNumber: id }
        ]
      }
    });

    if (!target) {
      return res.status(404).json({ error: 'Incident not found.' });
    }

    // Clean up dependent records and release responder units
    const assignments = await prisma.assignment.findMany({ where: { incidentId: target.id } });
    for (const a of assignments) {
      await prisma.responder.update({
        where: { id: a.responderId },
        data: { status: 'AVAILABLE', currentIncidentId: null }
      }).catch(() => {});
    }
    await prisma.assignment.deleteMany({ where: { incidentId: target.id } });
    await prisma.chatMessage.deleteMany({ where: { incidentId: target.id } });
    await prisma.locationLog.deleteMany({ where: { incidentId: target.id } });

    const deleted = await prisma.incident.delete({
      where: { id: target.id }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('incident:deleted', { id: target.id, incidentNumber: deleted.incidentNumber });
      io.to('coordinators').emit('incident:deleted', { id: target.id, incidentNumber: deleted.incidentNumber });
    }

    res.json({ message: `Incident ${deleted.incidentNumber} deleted successfully.`, incident: deleted });
  } catch (err) {
    console.error('Error deleting incident:', err);
    res.status(500).json({ error: 'Failed to delete incident.' });
  }
});

export default router;
