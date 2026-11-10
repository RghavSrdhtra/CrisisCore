import express from 'express';
import { prisma } from '../config/db.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import { wsBroadcaster } from '../ws/socketHandler.js';

const router = express.Router();

// GET /api/issues - View all active issue reports (road blockages, inaccessible hazards, shortages)
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const issues = await prisma.issueReport.findMany({
      orderBy: { reportedAt: 'desc' }
    });
    res.json({ issues });
  } catch (err) {
    console.error('Error fetching issues:', err);
    res.status(500).json({ error: 'Failed to retrieve issue reports.' });
  }
});

// POST /api/issues - Responder logs a field hazard / road blockage / shortage (Week 8)
router.post('/', optionalAuthenticate, async (req, res) => {
  try {
    const { responderId, responderName, incidentId, issueType, description, lat, lng } = req.body;

    if (!description || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'description, lat, and lng are required.' });
    }

    const upperType = (issueType || 'ROAD_BLOCKAGE').toUpperCase();

    const issue = await prisma.issueReport.create({
      data: {
        responderId: responderId || null,
        responderName: responderName || 'Field Unit',
        incidentId: incidentId || null,
        issueType: upperType,
        description,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        status: 'OPEN'
      }
    });

    const io = req.app.get('io');
    if (io) {
      // Alert Coordinators and Admins
      io.to('coordinators').emit('issue:reported', {
        issue,
        alertTitle: `FIELD ALERT: ${upperType.replace('_', ' ')}`,
        notes: description
      });

      // If road blockage or vehicle breakdown, emit dynamic re-optimization trigger
      if (['ROAD_BLOCKAGE', 'INACCESSIBLE_LOCATION', 'VEHICLE_BREAKDOWN'].includes(upperType)) {
        io.to('coordinators').emit('reallocation:triggered', {
          incidentId: incidentId || null,
          reason: `Obstacle reported: ${upperType} - ${description}`,
          requiresAdminApproval: true
        });
      }
    }

    res.status(201).json({
      message: 'Field issue reported successfully.',
      issue
    });
  } catch (err) {
    console.error('Error reporting field issue:', err);
    res.status(500).json({ error: 'Failed to submit issue report.' });
  }
});

// PATCH /api/issues/:id/resolve - Mark issue resolved
router.patch('/:id/resolve', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.issueReport.update({
      where: { id },
      data: { status: 'RESOLVED' }
    });

    const io = req.app.get('io');
    if (io) {
      io.to('coordinators').emit('issue:resolved', updated);
    }

    res.json({ message: 'Issue marked as resolved.', issue: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve issue.' });
  }
});

export default router;

