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
      accuracy = 5.0
    } = req.body;

    if (!type || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Emergency type, lat, and lng are required.' });
    }

    // Normalize type string
    let normalizedType = String(type).trim().toUpperCase().replace(/\s+/g, '_');
    if (!['MEDICAL', 'FIRE', 'SECURITY', 'NATURAL_DISASTER', 'INDUSTRIAL', 'OTHER'].includes(normalizedType)) {
      normalizedType = 'OTHER';
    }

    // Auto-generate incident tracking number e.g. INC-2026-XXXX
    const count = await prisma.incident.count();
    const incidentNumber = `INC-2026-${String(count + 101).padStart(4, '0')}`;

    // Priority heuristic baseline (ML model integration in Week 4 will refine this)
    let initialPriority = 'MEDIUM';
    const parsedAffected = Math.max(1, parseInt(affectedCount || 1, 10));
    const upperSev = severity ? String(severity).toUpperCase() : 'MEDIUM';

    if (upperSev === 'CRITICAL' || parsedAffected >= 10 || normalizedType === 'INDUSTRIAL' || normalizedType === 'FIRE') {
      initialPriority = 'HIGH';
      if (parsedAffected >= 10 || upperSev === 'CRITICAL') initialPriority = 'CRITICAL';
    } else if (upperSev === 'LOW') {
      initialPriority = 'LOW';
    }

    const isLocationActive = Boolean(locationSharingActive);

    const newIncident = await prisma.incident.create({
      data: {
        incidentNumber,
        type: normalizedType,
        description: description || 'Emergency SOS assistance requested.',
        affectedCount: parsedAffected,
        status: 'REPORTED',
        severity: upperSev,
        predictedPriority: initialPriority,
        priorityConfidence: 0.85,
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

export default router;
