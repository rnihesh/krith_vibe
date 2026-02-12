# PowerShell script for Windows SEFS setup
param(
    [switch]$Dev,
    [string]$Port = "8484"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host ">> $msg" -ForegroundColor Cyan
}

Write-Step "Setting up SEFS development environment"

# Check Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python not found. Install Python 3.10+"
    exit 1
}

# Create virtual environment
if (-not (Test-Path ".\venv")) {
    Write-Step "Creating virtual environment..."
    python -m venv venv
}

# Activate venv
.\venv\Scripts\Activate.ps1

# Install dependencies
Write-Step "Installing dependencies..."
pip install -r requirements.txt

# Start server
if ($Dev) {
    Write-Step "Starting development server on port $Port..."
    uvicorn app.main:app --host 0.0.0.0 --port $Port --reload
} else {
    Write-Step "Starting production server on port $Port..."
    uvicorn app.main:app --host 0.0.0.0 --port $Port --workers 4
}
