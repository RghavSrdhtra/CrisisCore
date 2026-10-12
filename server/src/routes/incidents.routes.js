import express from 'express';
import { prisma } from '../config/db.js';
import { authenticate, optionalAuthenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { wsBroadcaster } from '../ws/socketHandler.js';

const router = express.Router();

// GET /api/incidents - RBAC scoped list
router.get('/', authenticate, async (req, res) => {
  try {
    const user = req.user;
    let queryWhere = {};

    if (user.role === ROLES.CIVILIAN) {
      // Privacy Isolation (Section 4.11): Civilians only view their own reported incidents
      queryWhere = { reporterId: user.id };
    } else if (user.role === ROLES.RESPONDER) {
      // Responders view incidents assigned to them
      const responder = await prisma.responder.findUnique({ where: { userId: user.id } });
      if (!responder) return res.json({ incidents: [] });

      queryWhere = {
        assignments: {
          some: { responderId: responder.id }
        }
      };
    }
    // COORDINATOR and ADMIN see all incidents

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
    const { type, description, affectedCount, severity, lat, lng, address, reporterContact } = req.body;

    if (!type || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Emergency type, lat, and lng are required.' });
    }

    // Auto-generate incident tracking number e.g. INC-2026-XXXX
    const count = await prisma.incident.count();
    const incidentNumber = `INC-2026-${String(count + 101).padStart(4, '0')}`;

    // Priority heuristic baseline (ML model integration in Week 4 will refine this)
    let initialPriority = 'MEDIUM';
    const parsedAffected = parseInt(affectedCount || 1, 10);
    if (severity === 'CRITICAL' || parsedAffected >= 10 || type === 'INDUSTRIAL' || type === 'FIRE') {
      initialPriority = 'HIGH';
      if (parsedAffected >= 10 || severity === 'CRITICAL') initialPriority = 'CRITICAL';
    } else if (severity === 'LOW') {
      initialPriority = 'LOW';
    }

    const newIncident = await prisma.incident.create({
      data: {
        incidentNumber,
        type: type.toUpperCase(),
        description: description || 'No description provided.',
        affectedCount: parsedAffected,
        status: 'REPORTED',
        severity: severity || 'MEDIUM',
        predictedPriority: initialPriority,
        priorityConfidence: 0.85,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        address: address || null,
        reporterContact: reporterContact || (req.user?.phone || null),
        locationSharingActive: true,
        reporterId: req.user?.id || null
      },
      include: {
        reporter: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    // Create initial LocationLog breadcrumb
    await prisma.locationLog.create({
      data: {
        incidentId: newIncident.id,
        lat: newIncident.lat,
        lng: newIncident.lng,
        accuracy: 5.0,
        source: 'GPS',
        isActive: true
      }
    });

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

// PATCH /api/incidents/:id/location-toggle - Civilian voluntary privacy switch (Section 4.11)
router.patch('/:id/location-toggle', optionalAuthenticate, async (req, res) => {
  try {
    const { active } = req.body;
    const { id } = req.params;

    const updated = await prisma.incident.update({
      where: { id },
      data: { locationSharingActive: Boolean(active) }
    });

    res.json({
      message: `Voluntary location sharing has been ${updated.locationSharingActive ? 'enabled' : 'disabled'}.`,
      locationSharingActive: updated.locationSharingActive
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update location sharing preference.' });
  }
});

export default router;
