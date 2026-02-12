@echo off
REM Windows batch file for SEFS quick start
echo ================================
echo   SEFS Quick Start (Windows)
echo ================================

echo.
echo [1/4] Checking Python installation...
python --version 2>NUL
if errorlevel 1 (
    echo ERROR: Python not found!
    echo Please install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

echo [2/4] Installing backend dependencies...
cd backend
pip install -e .
cd ..

echo [3/4] Starting backend server...
start /B cmd /c "cd backend && uvicorn app.main:app --port 8484"

echo [4/4] Starting frontend...
cd frontend
npm install
npm run dev

echo.
echo SEFS is running! Open http://localhost:5173
pause
