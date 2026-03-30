@echo off
REM Combined startup script for Flask Simulator + AWS IoT Publisher (Windows)

echo.
echo 🚀 Starting ADAS Simulator + AWS IoT Integration...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if virtual environment exists, create if not
if not exist "venv" (
    echo [0/3] Creating Python virtual environment...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo [0/3] Installing Python dependencies...
    pip install -r requirements.txt
)

REM Activate venv
call venv\Scripts\activate.bat

REM Start Flask simulator in a new window
echo [1/3] Starting Flask ADAS Simulator (http://localhost:5000)...
start "Flask Simulator" cmd /k python simulator.py
timeout /t 2 /nobreak

REM Install Node dependencies and start AWS IoT Publisher
echo [2/3] Installing Node.js dependencies and starting AWS IoT Publisher...
cd simulator
call npm install
echo.
echo ═══════════════════════════════════════════════════
echo ✅ Both services are running!
echo 📊 Dashboard: http://localhost:5000
echo 📡 Publishing to AWS IoT Core (vehicle/*/telemetry)
echo.
echo Press Ctrl+C in both windows to stop all services...
echo ═══════════════════════════════════════════════════
echo.
npm start

pause
