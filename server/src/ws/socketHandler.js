// Socket.IO Handler with RBAC Room Segmentation and Dual-Channel Chat
import { prisma } from '../config/db.js';

export function initializeWebSocket(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // All connected command dashboards receive broadcast incidents by default
    socket.join('coordinators');

    // 1. Explicit join for coordinators & admins
    socket.on('join:coordinator', (data) => {
      socket.join('coordinators');
      console.log(`📡 Socket ${socket.id} joined 'coordinators' room`);
      socket.emit('joined', { room: 'coordinators', timestamp: new Date().toISOString() });
    });

    // 2. Field Responders join their dedicated responder channel
    socket.on('join:responder', ({ responderId }) => {
      if (!responderId) return;
      const room = `responder:${responderId}`;
      socket.join(room);
      console.log(`🚑 Responder ${responderId} joined room '${room}'`);
      socket.emit('joined', { room, responderId, timestamp: new Date().toISOString() });
    });

    // 3. Civilians join isolated incident channel (Data Isolation per Section 4.11)
    socket.on('join:incident', ({ incidentId }) => {
      if (!incidentId) return;
      const room = `incident:${incidentId}`;
      socket.join(room);
      console.log(`👤 Civilian joined room '${room}'`);
      socket.emit('joined', { room, incidentId, timestamp: new Date().toISOString() });
    });

    // 4. Dual-Channel Real-Time Chat Rooms
    // channel = 'OPS' (Coordinator <-> Responder) or 'CIVILIAN' (Responder <-> Civilian)
    socket.on('chat:join', ({ incidentId, channel }) => {
      if (!incidentId || !channel) return;
      const normalizedChannel = channel.toUpperCase() === 'CIVILIAN' ? 'CIVILIAN' : 'OPS';
      const room = `chat:${normalizedChannel}:${incidentId}`;
      socket.join(room);
      console.log(`💬 Socket ${socket.id} joined chat room '${room}'`);
      socket.emit('chat:joined', { room, incidentId, channel: normalizedChannel });
    });

    // Real-Time Chat Message Transmit
    socket.on('chat:send', async ({ incidentId, channel, message, senderName, senderRole, senderId }) => {
      if (!incidentId || !message || !message.trim()) return;
      const normalizedChannel = (channel || 'OPS').toUpperCase() === 'CIVILIAN' ? 'CIVILIAN' : 'OPS';

      try {
        const savedMessage = await prisma.chatMessage.create({
          data: {
            incidentId,
            channel: normalizedChannel,
            senderId: senderId || null,
            senderName: senderName || 'User',
            senderRole: senderRole || 'COORDINATOR',
            message: message.trim()
          }
        });

        const room = `chat:${normalizedChannel}:${incidentId}`;
        io.to(room).emit('chat:message', savedMessage);

        // Notify coordinator dashboard if sent on OPS channel
        if (normalizedChannel === 'OPS') {
          io.to('coordinators').emit('chat:ops_update', {
            incidentId,
            message: savedMessage
          });
        }

        // Notify civilian tracker if sent on CIVILIAN channel
        if (normalizedChannel === 'CIVILIAN') {
          io.to(`incident:${incidentId}`).emit('chat:civilian_update', {
            incidentId,
            message: savedMessage
          });
        }
      } catch (err) {
        console.error('Socket chat message save error:', err);
      }
    });

    // Handle voluntary location breadcrumb streaming
    socket.on('location:stream', ({ incidentId, responderId, lat, lng }) => {
      if (incidentId) {
        io.to('coordinators').emit('incident:location_updated', { incidentId, lat, lng });
      }
      if (responderId) {
        io.to('coordinators').emit('responder:location_updated', { responderId, lat, lng });
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

// Broadcasting helper methods for use in REST controllers
export const wsBroadcaster = {
  // Broadcast new incident to all dashboards and coordinators room
  notifyNewIncident: (io, incident) => {
    if (!io) return;
    io.emit('incident:new', incident);
    io.to('coordinators').emit('incident:new', incident);
  },

  // Notify coordinators and civilian of incident update
  notifyIncidentUpdated: (io, incident) => {
    if (!io) return;
    io.to('coordinators').emit('incident:updated', incident);
    io.to(`incident:${incident.id}`).emit('incident:updated', {
      id: incident.id,
      status: incident.status,
      updatedAt: incident.updatedAt,
      resolvedAt: incident.resolvedAt
    });
  },

  // Notify coordinator and assigned responder of new dispatch
  notifyNewAssignment: (io, assignment) => {
    if (!io) return;
    io.to('coordinators').emit('assignment:new', assignment);
    io.to(`responder:${assignment.responderId}`).emit('assignment:new', assignment);
    // Also notify civilian their incident has been dispatched
    io.to(`incident:${assignment.incidentId}`).emit('incident:status', {
      status: 'DISPATCHED',
      responderId: assignment.responderId,
      responderName: assignment.responder?.name,
      responderCallsign: assignment.responder?.callsign,
      responderType: assignment.responder?.type
    });
  },

  // Notify coordinator dashboard with prompt when respondent updates status or accepts/declines
  notifyResponderAction: (io, actionPayload) => {
    if (!io) return;
    // Broadcast prompt event to coordinators
    io.to('coordinators').emit('assignment:responder_action', {
      ...actionPayload,
      timestamp: new Date().toISOString()
    });
  },

  // Notify responder status change to coordinators
  notifyResponderStatus: (io, responder) => {
    if (!io) return;
    io.to('coordinators').emit('responder:updated', responder);
  },

  // Notify newly registered responder
  notifyNewResponder: (io, responder) => {
    if (!io) return;
    io.to('coordinators').emit('responder:registered', responder);
  }
};
