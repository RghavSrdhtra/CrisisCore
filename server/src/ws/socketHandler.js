// Socket.IO Handler with RBAC Room Segmentation (Section 4.9 & Week 1 WebSocket Protocol)

export function initializeWebSocket(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // 1. Coordinators & Admins join tactical operations room
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

    // Handle voluntary location breadcrumb streaming
    socket.on('location:stream', ({ incidentId, responderId, lat, lng }) => {
      if (incidentId) {
        // Broadcast to coordinators
        io.to('coordinators').emit('incident:location_updated', { incidentId, lat, lng });
      }
      if (responderId) {
        // Broadcast to coordinators
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
  // Broadcast new incident to coordinators
  notifyNewIncident: (io, incident) => {
    if (!io) return;
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
      responderCallsign: assignment.responder?.callsign,
      responderType: assignment.responder?.type
    });
  },

  // Notify responder status change to coordinators
  notifyResponderStatus: (io, responder) => {
    if (!io) return;
    io.to('coordinators').emit('responder:updated', responder);
  }
};
