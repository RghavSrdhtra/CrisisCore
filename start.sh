#!/bin/bash
set -e

echo "======================================================="
echo "   Welcome to CrisisCore - Rapid Crisis Response"
echo "======================================================="
echo ""

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not found on your system."
    echo "Please download and install Node.js (v18 or higher) from:"
    echo "  https://nodejs.org/"
    exit 1
fi

# 2. Check and configure environment file
if [ ! -f "server/.env" ]; then
    echo "[SETUP] Generating server/.env configuration..."
    if [ -f "server/.env.example" ]; then
        cp "server/.env.example" "server/.env"
        echo "[OK] Created server/.env from .env.example"
    else
        cat <<EOF > server/.env
PORT=3001
DATABASE_URL="file:./dev.db"
JWT_SECRET="crisiscore-dev-jwt-secret-key-2026"
CLIENT_ORIGIN="http://localhost:5173"
ML_SERVICE_URL="http://127.0.0.1:8000"
EOF
        echo "[OK] Created default server/.env"
    fi
fi

# 3. Check Root Dependencies
if [ ! -d "node_modules" ]; then
    echo "[SETUP] Installing frontend dependencies..."
    npm install
fi

# 4. Check Backend Dependencies
if [ ! -d "server/node_modules" ]; then
    echo "[SETUP] Installing backend dependencies..."
    npm --prefix server install
fi

# 5. Check and initialize Database & Prisma Client
if [ ! -f "server/prisma/dev.db" ]; then
    echo "[SETUP] Initializing SQLite database and running migrations..."
    npx --prefix server prisma generate
    npx --prefix server prisma db push --accept-data-loss
    echo "[SETUP] Seeding default resources, units and accounts..."
    node server/prisma/seed.js
    echo "[OK] Database initialized successfully."
fi

echo ""
echo "======================================================="
echo "   CrisisCore System Ready"
echo "   Backend Gateway : http://localhost:3001"
echo "   Web Dashboard   : http://localhost:5173"
echo "======================================================="
echo ""
echo "Starting development servers..."
echo "Press Ctrl+C at any time to stop."
echo ""

npm run dev
