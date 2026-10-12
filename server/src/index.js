import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import incidentsRoutes from './routes/incidents.routes.js';
import respondersRoutes from './routes/responders.routes.js';
import assignmentsRoutes from './routes/assignments.routes.js';
import { initializeWebSocket } from './ws/socketHandler.js';
import { prisma } from './config/db.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Setup Socket.IO with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH']
  }
});

// Attach io instance to express app so routes can broadcast
app.set('io', io);

// Initialize WebSocket event listeners and RBAC rooms
initializeWebSocket(io);

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Request logging in development
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/api/health') {
      console.log(`[${req.method}] ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Quick DB ping
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'healthy',
      system: 'CrisisCore Coordination Server',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/incidents', incidentsRoutes);
app.use('/api/responders', respondersRoutes);
app.use('/api/assignments', assignmentsRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 CrisisCore Server running on port ${PORT}`);
  console.log(`📡 WebSocket ready with RBAC room isolation`);
  console.log(`🔗 REST API mounted at http://localhost:${PORT}/api`);
  console.log(`=======================================================`);
});

export { app, server, io };
