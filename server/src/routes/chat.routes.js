import express from 'express';
import { prisma } from '../config/db.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';

const router = express.Router();

// GET /api/chat/:incidentId - Fetch messages for an incident channel (OPS or CIVILIAN)
router.get('/:incidentId', optionalAuthenticate, async (req, res) => {
  try {
    const { incidentId } = req.params;
    const { channel = 'OPS' } = req.query;

    const normalizedChannel = channel.toUpperCase() === 'CIVILIAN' ? 'CIVILIAN' : 'OPS';

    // Verify incident exists
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        assignments: {
          include: { responder: true }
        }
      }
    });

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' });
    }

    // Role-based access validation
    if (req.user) {
      if (normalizedChannel === 'OPS' && req.user.role === ROLES.CIVILIAN) {
        return res.status(403).json({ error: 'Civilians cannot access tactical operations channel.' });
      }
      if (req.user.role === ROLES.RESPONDER) {
        // Ensure responder is assigned to this incident
        const isAssigned = incident.assignments.some(a => a.responder?.userId === req.user.id);
        if (!isAssigned) {
          return res.status(403).json({ error: 'Responder is not assigned to this incident.' });
        }
      }
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        incidentId,
        channel: normalizedChannel
      },
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    res.json({
      incidentId,
      channel: normalizedChannel,
      messages
    });
  } catch (err) {
    console.error('Error fetching chat messages:', err);
    res.status(500).json({ error: 'Failed to retrieve chat messages.' });
  }
});

// POST /api/chat/:incidentId - Send a chat message
router.post('/:incidentId', optionalAuthenticate, async (req, res) => {
  try {
    const { incidentId } = req.params;
    const { channel = 'OPS', message, senderName, senderRole } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message content cannot be empty.' });
    }

    const normalizedChannel = channel.toUpperCase() === 'CIVILIAN' ? 'CIVILIAN' : 'OPS';

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        assignments: {
          include: { responder: true }
        }
      }
    });

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' });
    }

    // Determine sender identity
    const name = senderName || req.user?.name || (req.user?.role === ROLES.CIVILIAN ? 'Citizen (Reporter)' : 'Anonymous');
    const role = senderRole || req.user?.role || (normalizedChannel === 'CIVILIAN' ? 'CIVILIAN' : 'COORDINATOR');

    // Access check for OPS channel
    if (normalizedChannel === 'OPS' && role === 'CIVILIAN') {
      return res.status(403).json({ error: 'Civilians cannot post to the tactical operations channel.' });
    }

    const newChatMessage = await prisma.chatMessage.create({
      data: {
        incidentId,
        channel: normalizedChannel,
        senderId: req.user?.id || null,
        senderName: name,
        senderRole: role,
        message: message.trim()
      }
    });

    // Broadcast message via Socket.IO
    const io = req.app.get('io');
    if (io) {
      const room = `chat:${normalizedChannel}:${incidentId}`;
      io.to(room).emit('chat:message', newChatMessage);

      // If sent on OPS channel, notify coordinator dashboard
      if (normalizedChannel === 'OPS') {
        io.to('coordinators').emit('chat:ops_update', {
          incidentId,
          incidentNumber: incident.incidentNumber,
          message: newChatMessage
        });
      }

      // If sent on CIVILIAN channel by responder, alert civilian
      if (normalizedChannel === 'CIVILIAN') {
        io.to(`incident:${incidentId}`).emit('chat:civilian_update', {
          incidentId,
          message: newChatMessage
        });
      }
    }

    res.status(201).json({
      message: 'Message delivered.',
      chatMessage: newChatMessage
    });
  } catch (err) {
    console.error('Error posting chat message:', err);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

export default router;
