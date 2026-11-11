@echo off
echo ===================================================
echo Welcome to CrisisCore - Rapid Crisis Response Platform
echo ===================================================
echo.
echo Checking dependencies...
call npm install --silent

echo.
echo Starting CrisisCore Services (Backend Gateway :3001 and Vite Web :5173)...
echo.
call npm run dev
