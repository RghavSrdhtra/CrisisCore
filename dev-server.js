import { spawn } from 'child_process';
import http from 'http';
import path from 'path';

console.log('=======================================================');
console.log('🚀 Starting CrisisCore Unified Development Environment');
console.log('=======================================================');

function isPortInUse(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, () => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.abort();
      resolve(false);
    });
  });
}

async function start() {
  const backendRunning = await isPortInUse(3001);
  let backendProc = null;

  if (backendRunning) {
    console.log('✅ Backend is already running on port 3001.');
  } else {
    console.log('📡 Launching Backend Gateway (port 3001)...');
    backendProc = spawn(process.execPath, ['server/src/index.js'], {
      stdio: 'inherit'
    });

    backendProc.on('error', (err) => {
      console.error('Failed to start backend:', err);
    });
  }

  // Wait 1.5 seconds before starting Vite so backend is ready
  setTimeout(() => {
    console.log('⚡ Launching Vite Dev Server (port 5173)...');
    const viteBin = path.resolve('node_modules', 'vite', 'bin', 'vite.js');
    const viteProc = spawn(process.execPath, [viteBin], {
      stdio: 'inherit'
    });

    viteProc.on('error', (err) => {
      console.error('Failed to start Vite:', err);
    });

    const cleanup = () => {
      console.log('\n🛑 Shutting down CrisisCore dev processes...');
      if (backendProc) {
        try { backendProc.kill(); } catch (e) {}
      }
      try { viteProc.kill(); } catch (e) {}
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }, 1500);
}

start();
