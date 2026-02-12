#!/bin/bash
# ─── SEFS Startup Script ───
# Starts both the Python backend and the React frontend

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${PURPLE}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║   🧠 SEFS — Semantic Entropy File System          ║"
echo "  ║   Self-Organising File Manager                    ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Setup root folder ───
ROOT_FOLDER="${ROOT_FOLDER:-$HOME/sefs_root}"
mkdir -p "$ROOT_FOLDER"
echo -e "${CYAN}📁 Root folder: ${ROOT_FOLDER}${NC}"

# ─── Backend setup ───
echo -e "\n${BLUE}[1/4] Setting up Python backend...${NC}"
cd backend

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

source .venv/bin/activate
echo "Installing Python dependencies..."
pip install -q -e ".[dev]" 2>/dev/null || pip install -q -r <(python3 -c "
import tomllib
with open('pyproject.toml', 'rb') as f:
    data = tomllib.load(f)
for dep in data['project']['dependencies']:
    print(dep)
")

cd ..

# ─── Frontend setup ───
echo -e "\n${BLUE}[2/4] Setting up React frontend...${NC}"
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install --silent 2>/dev/null
fi
cd ..

# ─── Start backend ───
echo -e "\n${BLUE}[3/4] Starting backend on port 8484...${NC}"
cd backend
source .venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8484 --reload &
BACKEND_PID=$!
cd ..

# Wait for backend
echo -n "Waiting for backend..."
for i in $(seq 1 30); do
    if curl -s http://localhost:8484/api/status > /dev/null 2>&1; then
        echo -e " ${GREEN}Ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# ─── Start frontend ───
echo -e "\n${BLUE}[4/4] Starting frontend on port 5173...${NC}"
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

sleep 3
echo -e "\n${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ SEFS is running!                              ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║   🌐 Frontend:  http://localhost:5173              ║${NC}"
echo -e "${GREEN}║   🔌 Backend:   http://localhost:8484              ║${NC}"
echo -e "${GREEN}║   📁 Root:      ${ROOT_FOLDER}${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║   Drop PDF/TXT/MD/DOCX/CSV files to get started!  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"

# Cleanup on exit
cleanup() {
    echo -e "\n${BLUE}Shutting down SEFS...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}Goodbye!${NC}"
}
trap cleanup EXIT INT TERM

# Keep alive
wait
