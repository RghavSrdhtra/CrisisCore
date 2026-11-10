#!/bin/bash

echo "==================================================="
echo "Welcome to CrisisCore - Rapid Crisis Response Platform"
echo "==================================================="
echo ""

echo "Starting CrisisCore Backend Gateway (Port 3001)..."
node server/src/index.js &
BACKEND_PID=$!

echo "Starting CrisisCore ML Service (Port 8000)..."
python ml/app.py &
ML_PID=$!

echo "Starting CrisisCore Frontend (Vite on Port 5173)..."
echo "Open your browser at: http://localhost:5173/"
echo ""
npm run dev

kill $BACKEND_PID $ML_PID 2>/dev/null
