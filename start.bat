@echo off
echo ===================================================
echo Welcome to CrisisCore - Rapid Crisis Response Platform
echo ===================================================
echo.
echo Checking dependencies...
call npm install --silent

echo.
echo Starting CrisisCore Backend Gateway (Port 3001)...
start "CrisisCore Backend (Port 3001)" /min cmd /c "node server/src/index.js"

echo Starting CrisisCore ML Optimization Engine (Port 8000)...
start "CrisisCore ML Service (Port 8000)" /min cmd /c "python ml/app.py"

echo.
echo Starting CrisisCore Frontend (Vite on Port 5173)...
echo Once started, open your browser at: http://localhost:5173/
echo.
call npm run dev
