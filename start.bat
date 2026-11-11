@echo off
setlocal enabledelayedexpansion

echo =======================================================
echo    Welcome to CrisisCore - Rapid Crisis Response
echo =======================================================
echo.

:: 1. Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found on your system.
    echo Please download and install Node.js (v18 or higher) from:
    echo   https://nodejs.org/
    echo Once installed, restart your terminal and run start.bat again.
    echo.
    pause
    exit /b 1
)

:: 2. Check and configure environment file
if not exist "server\.env" (
    echo [SETUP] Generating server\.env configuration...
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo [OK] Created server\.env from .env.example
    ) else (
        echo PORT=3001 > "server\.env"
        echo DATABASE_URL="file:./dev.db" >> "server\.env"
        echo JWT_SECRET="crisiscore-dev-jwt-secret-key-2026" >> "server\.env"
        echo CLIENT_ORIGIN="http://localhost:5173" >> "server\.env"
        echo ML_SERVICE_URL="http://127.0.0.1:8000" >> "server\.env"
        echo [OK] Created default server\.env
    )
)

:: 3. Check Root Dependencies
if not exist "node_modules\" (
    echo [SETUP] Installing frontend dependencies (this only happens once)...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install root dependencies.
        pause
        exit /b %ERRORLEVEL%
    )
)

:: 4. Check Backend Dependencies
if not exist "server\node_modules\" (
    echo [SETUP] Installing backend dependencies (this only happens once)...
    call npm --prefix server install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install server dependencies.
        pause
        exit /b %ERRORLEVEL%
    )
)

:: 5. Check and initialize Database & Prisma Client
if not exist "server\prisma\dev.db" (
    echo [SETUP] Initializing SQLite database and running migrations...
    call npx --prefix server prisma generate
    call npx --prefix server prisma db push --accept-data-loss
    echo [SETUP] Seeding default resources, units and accounts...
    call node server/prisma/seed.js
    echo [OK] Database initialized successfully.
)

echo.
echo =======================================================
echo    CrisisCore System Ready
echo    Backend Gateway : http://localhost:3001
echo    Web Dashboard   : http://localhost:5173
echo =======================================================
echo.
echo Starting development servers...
echo Press Ctrl+C at any time to stop.
echo.

:: Launch browser in background after 3 seconds
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:5173"

:: Start unified dev server (runs backend + frontend)
call npm run dev
if %ERRORLEVEL% neq 0 (
    echo.
    echo [NOTE] Server terminated.
    pause
)
